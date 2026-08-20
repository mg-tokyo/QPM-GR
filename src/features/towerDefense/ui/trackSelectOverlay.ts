import { createButton } from '../../../ui/components';
import { t } from '../../../i18n';
import { renderBoardThumbnail } from '../saves/thumbnail';
import {
  getDifficultyLabel,
  getTrackDifficulty,
  getTrackDisplayName,
  getTrackLength,
  listTracks,
} from '../tracks/registry';
import type { TrackDef } from '../tracks/types';
import { tdPlay } from '../sounds';
import { injectTrackStyles, removeTrackStyles } from './trackStyles';

const THUMB_WIDTH = 140;

export interface TrackSelectOptions {
  readonly host: HTMLElement;
  readonly initialTrackId?: string;
  readonly onPick: (track: TrackDef) => void;
  readonly onCancel?: () => void;
}

let closeCurrent: (() => void) | null = null;

export function isTrackSelectOverlayOpen(): boolean {
  return closeCurrent !== null;
}

export function closeTrackSelectOverlay(): void {
  closeCurrent?.();
}

export function openTrackSelectOverlay(opts: TrackSelectOptions): void {
  if (closeCurrent) return;
  injectTrackStyles();

  const overlay = document.createElement('div');
  overlay.className = 'qpm-td-track-select-overlay';

  const panel = document.createElement('div');
  panel.className = 'qpm-td-track-select-panel';

  const head = document.createElement('div');
  head.className = 'qpm-td-track-select-head';
  const title = document.createElement('div');
  title.className = 'qpm-td-track-select-title';
  title.textContent = t('feature.towerDefense.tracks.selectTitle');
  const hint = document.createElement('div');
  hint.className = 'qpm-td-track-select-hint';
  hint.textContent = t('feature.towerDefense.tracks.selectHint');
  head.append(title, hint);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'qpm-td-track-select-close';
  closeBtn.textContent = '×';
  closeBtn.title = t('common.close');
  closeBtn.setAttribute('aria-label', t('common.close'));
  closeBtn.addEventListener('click', () => cancel());

  const grid = document.createElement('div');
  grid.className = 'qpm-td-track-select-grid';

  function buildCard(track: TrackDef): HTMLElement {
    const card = document.createElement('div');
    card.className = 'qpm-td-track-select-card';
    if (opts.initialTrackId && track.id === opts.initialTrackId) {
      card.classList.add('qpm-td-track-select-card--recent');
    }
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    const pick = (): void => {
      tdPlay('uiClick');
      finish(() => opts.onPick(track));
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });

    const thumb = renderBoardThumbnail({ corners: track.corners, towers: [], width: THUMB_WIDTH });
    if (thumb) { thumb.className = 'qpm-td-track-select-thumb'; card.appendChild(thumb); }

    const body = document.createElement('div');
    body.className = 'qpm-td-track-select-body';
    const nameRow = document.createElement('div');
    nameRow.className = 'qpm-td-track-select-name-row';
    const name = document.createElement('span');
    name.className = 'qpm-td-track-select-name';
    name.textContent = getTrackDisplayName(track);
    nameRow.appendChild(name);
    if (opts.initialTrackId && track.id === opts.initialTrackId) {
      const badge = document.createElement('span');
      badge.className = 'qpm-td-track-badge';
      badge.textContent = t('feature.towerDefense.tracks.recent');
      nameRow.appendChild(badge);
    }
    const meta = document.createElement('div');
    meta.className = 'qpm-td-track-select-meta';
    const difficulty = getTrackDifficulty(track);
    const chip = document.createElement('span');
    chip.className = `qpm-td-track-chip qpm-td-track-chip--${difficulty}`;
    chip.textContent = getDifficultyLabel(difficulty);
    const tiles = document.createElement('span');
    tiles.textContent = t('feature.towerDefense.tracks.tiles', { n: getTrackLength(track) });
    meta.append(chip, tiles);
    body.append(nameRow, meta);
    card.appendChild(body);
    return card;
  }

  for (const track of listTracks()) grid.appendChild(buildCard(track));

  const foot = document.createElement('div');
  foot.className = 'qpm-td-track-select-foot';
  foot.appendChild(createButton(t('feature.towerDefense.tracks.selectCancel'), {
    variant: 'secondary',
    onClick: () => cancel(),
  }));

  panel.append(head, grid, foot, closeBtn);
  overlay.appendChild(panel);
  // Backdrop click dismisses; clicks inside the panel are absorbed.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });
  opts.host.appendChild(overlay);

  function close(): void {
    if (closeCurrent === null) return;
    closeCurrent = null;
    try { overlay.remove(); } catch { /* already gone */ }
    removeTrackStyles();
  }
  closeCurrent = close;

  function finish(after?: () => void): void {
    close();
    after?.();
  }

  function cancel(): void {
    finish(opts.onCancel);
  }
}
