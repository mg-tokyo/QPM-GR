import { createButton, showConfirmDialog } from '../../../ui/components';
import { t } from '../../../i18n';
import { notify as coreNotify } from '../../../core/notifications';
import { formatNumber } from '../../../utils/formatters';
import { PRESCRIPTED_ROUNDS } from '../constants';
import { cancelPlacement } from '../engine/tower';
import { getMatchSnapshot, notify, setPaused } from '../state';
import type { MatchSnapshot } from '../types';
import {
  deleteSave,
  getActiveSlot,
  getAutosave,
  listSlots,
  onSavesChanged,
  saveRunToSlot,
} from '../saves/store';
import {
  AUTO_REF,
  MAX_SAVE_SLOTS,
  sameRef,
  slotRef,
  type SaveEntry,
  type SaveSlotRef,
} from '../saves/types';
import { renderSaveThumbnail } from '../saves/thumbnail';
import { tdPlay } from '../sounds';
import { injectSavesStyles, removeSavesStyles } from './savesStyles';

const THUMB_WIDTH = 120;
const WIDE_THUMB_WIDTH = 160;

export type SavesOverlayMode = 'launch' | 'inGame';

export interface SavesOverlayOptions {
  readonly mode: SavesOverlayMode;
  readonly host: HTMLElement;
  // Invoked AFTER the overlay has closed. Loading itself is launch.ts's job.
  readonly onLoad: (ref: SaveSlotRef) => void;
  readonly onNewGame?: () => void;
  readonly onDismiss?: () => void;
}

interface CardAction {
  readonly run: () => void;
}

let closeCurrent: (() => void) | null = null;

export function isSavesOverlayOpen(): boolean {
  return closeCurrent !== null;
}

export function closeSavesOverlay(): void {
  closeCurrent?.();
}

export function openSavesOverlay(opts: SavesOverlayOptions): void {
  if (closeCurrent) return;
  injectSavesStyles();

  const inGame = opts.mode === 'inGame';
  const cleanups: Array<() => void> = [];
  let confirmOpen = false;
  // Empty slots are noisy on the picker. Show only the first one (in-game as
  // "+ New save") by default; a toggle reveals the rest. Reset each open.
  let showAllEmpties = false;

  // Freeze the sim while the picker is up; restore whatever pause state the
  // player had on close. Pending placement would otherwise fight the overlay
  // for Space/Escape.
  let wasPaused = false;
  if (inGame) {
    cancelPlacement();
    wasPaused = getMatchSnapshot().paused;
    if (!wasPaused) { setPaused(true); notify(); }
  }

  const overlay = document.createElement('div');
  overlay.className = 'qpm-td-saves-overlay';
  const panel = document.createElement('div');
  panel.className = 'qpm-td-saves-panel';

  const head = document.createElement('div');
  head.className = 'qpm-td-saves-head';
  const title = document.createElement('div');
  title.className = 'qpm-td-saves-title';
  title.textContent = t('feature.towerDefense.saves.title');
  const hint = document.createElement('div');
  hint.className = 'qpm-td-saves-hint';
  hint.textContent = buildHint(inGame, getMatchSnapshot());
  head.append(title, hint);

  // Corner × for the modal itself. Separate from card-level delete affordance;
  // the shared `qpm-td-saves-close` class carries the button chrome.
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'qpm-td-saves-close';
  closeBtn.textContent = '×';
  closeBtn.title = t('common.close');
  closeBtn.setAttribute('aria-label', t('common.close'));
  closeBtn.addEventListener('click', () => dismiss());

  const body = document.createElement('div');
  body.className = 'qpm-td-saves-body';
  const autoHost = document.createElement('div');
  autoHost.className = 'qpm-td-saves-auto';
  const grid = document.createElement('div');
  grid.className = 'qpm-td-saves-grid';
  const moreHost = document.createElement('div');
  moreHost.className = 'qpm-td-saves-more';
  body.append(autoHost, grid, moreHost);

  const foot = document.createElement('div');
  foot.className = 'qpm-td-saves-foot';
  if (!inGame) {
    foot.appendChild(createButton(t('feature.towerDefense.saves.newGame'), {
      variant: 'primary',
      onClick: () => finish(opts.onNewGame),
    }));
  }

  panel.append(head, body, foot, closeBtn);
  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  opts.host.appendChild(overlay);

  function close(): void {
    if (closeCurrent === null) return;
    closeCurrent = null;
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* teardown must not throw */ }
    }
    try { overlay.remove(); } catch { /* already gone */ }
    removeSavesStyles();
    if (inGame && !wasPaused) { setPaused(false); notify(); }
  }
  closeCurrent = close;

  function finish(after?: () => void): void {
    close();
    after?.();
  }

  function dismiss(): void {
    finish(opts.onDismiss);
  }

  function pick(ref: SaveSlotRef): void {
    tdPlay('uiClick');
    finish(() => opts.onLoad(ref));
  }

  async function saveTo(index: number, existing: SaveEntry | null, isActive: boolean): Promise<void> {
    if (existing && !isActive) {
      confirmOpen = true;
      const ok = await showConfirmDialog({
        title: t('feature.towerDefense.saves.overwriteTitle', { n: index + 1 }),
        message: t('feature.towerDefense.saves.overwriteBody', { round: existing.snapshot.round }),
        confirmLabel: t('feature.towerDefense.saves.actionOverwrite'),
        variant: 'danger',
      });
      confirmOpen = false;
      if (!ok || closeCurrent !== close) return;
    }
    const saved = saveRunToSlot(index, getMatchSnapshot());
    if (!saved) return;
    tdPlay('uiClick');
    coreNotify({
      feature: 'towerDefense',
      level: 'success',
      message: t('feature.towerDefense.saves.savedToast', { n: index + 1 }),
    });
    dismiss();
  }

  async function remove(ref: SaveSlotRef, entry: SaveEntry): Promise<void> {
    confirmOpen = true;
    const ok = await showConfirmDialog({
      title: t('feature.towerDefense.saves.deleteTitle'),
      message: t('feature.towerDefense.saves.deleteBody', { round: entry.snapshot.round, ago: formatAgo(entry.savedAt) }),
      confirmLabel: t('feature.towerDefense.saves.delete'),
      variant: 'danger',
    });
    confirmOpen = false;
    if (!ok || closeCurrent !== close) return;
    tdPlay('uiClick');
    deleteSave(ref);
  }

  function primaryFor(ref: SaveSlotRef, entry: SaveEntry | null, isActive: boolean): CardAction | null {
    if (!inGame || ref.kind === 'auto') {
      return entry ? { run: () => pick(ref) } : null;
    }
    const index = ref.index;
    if (!entry) return { run: () => { void saveTo(index, null, false); } };
    if (isActive) return { run: () => { void saveTo(index, entry, true); } };
    return { run: () => { void saveTo(index, entry, false); } };
  }

  function buildCard(ref: SaveSlotRef, entry: SaveEntry | null): HTMLElement {
    const isAuto = ref.kind === 'auto';
    const isActive = sameRef(getActiveSlot(), ref);
    const primary = primaryFor(ref, entry, isActive);

    const card = document.createElement('div');
    card.className = 'qpm-td-save-card';
    if (isAuto) card.classList.add('qpm-td-save-card--wide');
    if (!entry) card.classList.add('qpm-td-save-card--empty');
    if (isActive) card.classList.add('qpm-td-save-card--active');
    if (primary) {
      card.classList.add('qpm-td-save-card--actionable');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.addEventListener('click', () => primary.run());
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); primary.run(); }
      });
    }

    const headRow = document.createElement('div');
    headRow.className = 'qpm-td-save-card-head';
    const label = document.createElement('span');
    label.className = 'qpm-td-save-card-label';
    label.textContent = isAuto
      ? t('feature.towerDefense.saves.continue')
      : t('feature.towerDefense.saves.slot', { n: ref.kind === 'slot' ? ref.index + 1 : 0 });
    headRow.appendChild(label);
    if (isAuto || isActive) {
      const badge = document.createElement('span');
      badge.className = 'qpm-td-save-badge';
      badge.textContent = isAuto
        ? t('feature.towerDefense.saves.autosaveBadge')
        : t('feature.towerDefense.saves.currentBadge');
      headRow.appendChild(badge);
    }
    if (entry) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'qpm-td-save-delete';
      del.textContent = '×';
      del.title = t('feature.towerDefense.saves.delete');
      del.setAttribute('aria-label', t('feature.towerDefense.saves.delete'));
      del.addEventListener('click', (e) => { e.stopPropagation(); void remove(ref, entry); });
      headRow.appendChild(del);
    }

    if (isAuto) {
      // Wide card: thumbnail first, then a column with header + meta.
      const column = document.createElement('div');
      column.className = 'qpm-td-save-card-meta';
      column.append(headRow, ...buildMeta(entry, ref));
      const thumb = entry ? renderSaveThumbnail(entry, WIDE_THUMB_WIDTH) : null;
      if (thumb) { thumb.className = 'qpm-td-save-card-thumb'; card.appendChild(thumb); }
      card.appendChild(column);
      return card;
    }

    card.appendChild(headRow);
    if (entry) {
      const thumb = renderSaveThumbnail(entry, THUMB_WIDTH);
      if (thumb) { thumb.className = 'qpm-td-save-card-thumb'; card.appendChild(thumb); }
    } else {
      // Only in-game reaches this — render() hides empty slots in launch mode.
      const empty = document.createElement('div');
      empty.className = 'qpm-td-save-card-empty';
      empty.textContent = t('feature.towerDefense.saves.newSaveTile');
      card.appendChild(empty);
    }
    if (entry) {
      const meta = document.createElement('div');
      meta.className = 'qpm-td-save-card-meta';
      meta.append(...buildMeta(entry, ref));
      card.appendChild(meta);
    }
    return card;
  }

  function buildMeta(entry: SaveEntry | null, ref: SaveSlotRef): HTMLElement[] {
    if (!entry) return [];
    const snap = entry.snapshot;
    const round = document.createElement('div');
    round.className = 'qpm-td-save-card-round';
    round.textContent = snap.isEndless
      ? t('feature.towerDefense.roundEndless', { n: snap.round })
      : t('feature.towerDefense.roundLabel', { round: snap.round, total: PRESCRIPTED_ROUNDS });
    const summary = document.createElement('div');
    summary.className = 'qpm-td-save-card-summary';
    // Compact: cash · lives · towers · ago on one line. Cash + lives get their
    // own spans so they match the in-game HUD stat colors (hud.ts:131-137).
    const cashSpan = document.createElement('span');
    cashSpan.className = 'qpm-td-save-card-cash';
    cashSpan.textContent = t('feature.towerDefense.saves.cashLabel', { cash: formatNumber(snap.cash) });
    const livesSpan = document.createElement('span');
    livesSpan.className = snap.lives <= 20
      ? 'qpm-td-save-card-lives qpm-td-save-card-lives--low'
      : 'qpm-td-save-card-lives';
    livesSpan.textContent = t('feature.towerDefense.saves.livesLabel', { lives: snap.lives });
    const towersText = t('feature.towerDefense.saves.towersLabel', { towers: snap.towers.length });
    summary.append(cashSpan, ' · ', livesSpan, ` · ${towersText} · ${formatAgo(entry.savedAt)}`);
    const parts: HTMLElement[] = [round, summary];
    if (inGame && ref.kind === 'slot') {
      // Save is the card's primary action in-game; Load rides along as a
      // ghost button. Reverting the bound slot is allowed (see launch.ts).
      const foot = document.createElement('div');
      foot.className = 'qpm-td-save-card-foot';
      const loadBtn = createButton(t('feature.towerDefense.saves.actionLoad'), {
        variant: 'ghost',
        size: 'sm',
        onClick: () => pick(ref),
      });
      loadBtn.addEventListener('click', (e) => e.stopPropagation());
      foot.appendChild(loadBtn);
      parts.push(foot);
    }
    return parts;
  }

  function render(): void {
    const auto = getAutosave();
    autoHost.replaceChildren();
    autoHost.hidden = auto === null;
    if (auto) autoHost.appendChild(buildCard(AUTO_REF, auto));

    grid.replaceChildren();
    moreHost.replaceChildren();
    const slots = listSlots();

    // Occupied first, in slot order.
    for (let i = 0; i < MAX_SAVE_SLOTS; i++) {
      if (slots[i]) grid.appendChild(buildCard(slotRef(i), slots[i] ?? null));
    }

    // Empty slots: launch mode hides all (inert anyway); in-game shows first
    // one as "+ New save" plus a "Show more" toggle for the rest.
    if (!inGame) return;
    const emptyIdx: number[] = [];
    for (let i = 0; i < MAX_SAVE_SLOTS; i++) if (!slots[i]) emptyIdx.push(i);
    if (emptyIdx.length === 0) return;
    const visible = showAllEmpties ? emptyIdx : emptyIdx.slice(0, 1);
    for (const i of visible) grid.appendChild(buildCard(slotRef(i), null));
    const hidden = emptyIdx.length - visible.length;
    if (hidden > 0) {
      moreHost.appendChild(createButton(t('feature.towerDefense.saves.showMore', { n: hidden }), {
        variant: 'tonal',
        size: 'sm',
        onClick: () => { showAllEmpties = true; render(); },
      }));
    } else if (showAllEmpties && emptyIdx.length > 1) {
      moreHost.appendChild(createButton(t('feature.towerDefense.saves.showFewer'), {
        variant: 'tonal',
        size: 'sm',
        onClick: () => { showAllEmpties = false; render(); },
      }));
    }
  }

  render();
  cleanups.push(onSavesChanged(render));

  // Capture on window so the game's own key handling never sees Escape while
  // the picker is up. Ignored while a confirm dialog owns Escape.
  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || confirmOpen) return;
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  }
  window.addEventListener('keydown', onKey, true);
  cleanups.push(() => window.removeEventListener('keydown', onKey, true));

  closeBtn.focus();
}

function buildHint(inGame: boolean, snap: MatchSnapshot): string {
  if (!inGame) return t('feature.towerDefense.saves.hintLaunch');
  const base = t('feature.towerDefense.saves.hintInGame');
  if (snap.phase !== 'inRound') return base;
  return `${base} ${t('feature.towerDefense.saves.hintInRound', { round: snap.round })}`;
}

function formatAgo(ts: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (minutes < 1) return t('feature.towerDefense.saves.ago.justNow');
  if (minutes < 60) return t('feature.towerDefense.saves.ago.minutes', { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('feature.towerDefense.saves.ago.hours', { h: hours });
  return t('feature.towerDefense.saves.ago.days', { d: Math.floor(hours / 24) });
}
