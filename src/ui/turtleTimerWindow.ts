// src/ui/turtleTimerWindow.ts - Turtle Timer floating window

import { log } from '../utils/logger';
import {
  onTurtleTimerState,
  getTurtleTimerState,
  configureTurtleTimer,
  type TurtleTimerState,
  type TurtleTimerChannel,
  type TurtleContribution,
  type TurtleFocusOption,
  type TurtleTimerFocus,
} from '../features/turtleTimer';
import { getPetSpriteDataUrlWithMutations } from '../sprite-v2/compat';
import { throttle } from '../utils/scheduling';
import { storage } from '../utils/storage';
import { clampPct, scaledDimension } from '../utils/windowPosition';
import { t } from '../i18n';

// ============================================================================
// CONSTANTS
// ============================================================================

const LAYOUT_KEY = 'qpm.turtleTimerWindow.layout.v3';
/** Design-baseline dimensions (tuned for 1920px viewport). Used by updateContentScale. */
const DESIGN_WIDTH = 500;
const DESIGN_HEIGHT = 560;
/** Viewport-scaled defaults — always the same fraction of the screen. */
function defaultWidth(): number { return scaledDimension(DESIGN_WIDTH, 'w'); }
function defaultHeight(): number { return scaledDimension(DESIGN_HEIGHT, 'h'); }
const MIN_WIDTH = 380;
const MIN_HEIGHT = 280;

// ============================================================================
// TYPES
// ============================================================================

export interface TurtleTimerWindowState {
  root: HTMLElement;
  summaryStrip: HTMLElement;
  plantTabBtn: HTMLButtonElement;
  eggTabBtn: HTMLButtonElement;
  tabContent: HTMLElement;
  focusZone: HTMLElement;   // focus controls — only rebuilt when mode/targets change
  dynamicZone: HTMLElement; // ETA + turtle list — rebuilt on every state update
  activeTab: 'plant' | 'egg';
  lastFocusSignature: string; // tracks when focus controls need rebuilding
  latestState: TurtleTimerState | null;
  unsubscribeTimer: (() => void) | null;
  resizeListener: (() => void) | null;
  scaleWrapper: HTMLElement;
  scaleOuter: HTMLElement;
  updateScale: (() => void) | null;
  resizeObserver: ResizeObserver | null;
}

interface WindowLayout {
  xPct: number;
  yPct: number;
  width: number;
  height: number;
}

const MARGIN = 8;
let currentPct = { xPct: 0.5, yPct: 0.5 };

function layoutPctToPixels(xPct: number, yPct: number, w: number, h: number): { x: number; y: number } {
  const availW = Math.max(0, window.innerWidth - w - MARGIN * 2);
  const availH = Math.max(0, window.innerHeight - h - MARGIN * 2);
  return {
    x: Math.round(MARGIN + clampPct(xPct) * availW),
    y: Math.round(MARGIN + clampPct(yPct) * availH),
  };
}

function layoutPixelsToPct(x: number, y: number, w: number, h: number): { xPct: number; yPct: number } {
  const availW = Math.max(1, window.innerWidth - w - MARGIN * 2);
  const availH = Math.max(1, window.innerHeight - h - MARGIN * 2);
  return {
    xPct: clampPct((x - MARGIN) / availW),
    yPct: clampPct((y - MARGIN) / availH),
  };
}

// ============================================================================
// LAYOUT PERSISTENCE
// ============================================================================

function loadLayout(): WindowLayout | null {
  try {
    const saved = storage.get<Record<string, unknown> | null>(LAYOUT_KEY, null);
    if (!saved || typeof saved !== 'object') return null;

    const width = (typeof saved.width === 'number' && saved.width >= defaultWidth()) ? saved.width : defaultWidth();
    const height = (typeof saved.height === 'number' && saved.height >= defaultHeight()) ? saved.height : defaultHeight();

    if (typeof saved.xPct === 'number' && typeof saved.yPct === 'number') {
      return { xPct: clampPct(saved.xPct), yPct: clampPct(saved.yPct), width, height };
    }

    if (typeof saved.top === 'number' && typeof saved.left === 'number') {
      const pct = layoutPixelsToPct(saved.left, saved.top, width, height);
      return { xPct: pct.xPct, yPct: pct.yPct, width, height };
    }

    return null;
  } catch { return null; }
}

function saveLayout(root: HTMLElement): void {
  try {
    storage.set(LAYOUT_KEY, {
      xPct: currentPct.xPct,
      yPct: currentPct.yPct,
      width: root.offsetWidth || defaultWidth(),
      height: root.offsetHeight || defaultHeight(),
    } satisfies WindowLayout);
  } catch { /* ignore */ }
}

function capturePositionAndSave(root: HTMLElement): void {
  const rect = root.getBoundingClientRect();
  const pct = layoutPixelsToPct(rect.left, rect.top, rect.width, rect.height);
  currentPct.xPct = pct.xPct;
  currentPct.yPct = pct.yPct;
  saveLayout(root);
}

function applyCurrentPosition(root: HTMLElement): void {
  const { x, y } = layoutPctToPixels(currentPct.xPct, currentPct.yPct, root.offsetWidth, root.offsetHeight);
  root.style.left = `${x}px`;
  root.style.top = `${y}px`;
}

// ============================================================================
// WINDOW CHROME
// ============================================================================

function makeDraggable(root: HTMLElement, handle: HTMLElement, onEnd: () => void): void {
  let sx = 0, sy = 0, startLeft = 0, startTop = 0;
  const onMove = (e: MouseEvent) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const rawLeft = startLeft + dx;
    const rawTop = startTop + dy;
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const maxLeft = Math.max(MARGIN, window.innerWidth - w - MARGIN);
    const maxTop = Math.max(MARGIN, window.innerHeight - h - MARGIN);
    root.style.left = `${Math.max(MARGIN, Math.min(maxLeft, rawLeft))}px`;
    root.style.top = `${Math.max(MARGIN, Math.min(maxTop, rawTop))}px`;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    capturePositionAndSave(root);
    onEnd();
  };
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    sx = e.clientX;
    sy = e.clientY;
    const rect = root.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function makeResizable(root: HTMLElement, handle: HTMLElement, onEnd: () => void): void {
  let sx = 0, sy = 0, sw = 0, sh = 0;
  const onMove = (e: MouseEvent) => {
    const maxW = window.innerWidth - parseFloat(root.style.left || '0') - MARGIN;
    const maxH = window.innerHeight - parseFloat(root.style.top || '0') - MARGIN;
    root.style.width = `${Math.max(MIN_WIDTH, Math.min(sw + e.clientX - sx, maxW))}px`;
    root.style.height = `${Math.max(MIN_HEIGHT, Math.min(sh + e.clientY - sy, maxH))}px`;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    capturePositionAndSave(root);
    onEnd();
  };
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    sx = e.clientX;
    sy = e.clientY;
    sw = root.offsetWidth;
    sh = root.offsetHeight;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ============================================================================
// UTILITY HELPERS
// ============================================================================

function formatMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return '—';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

/** Format a raw minutes value into Xh Ym or Xm */
function formatMinutes(mins: number): string {
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function makeSelect(style: string): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.style.cssText = [
    'background:var(--qpm-surface-2,#1e1e1e)',
    'color:var(--qpm-text,#fff)',
    'border:1px solid var(--qpm-border,#333)',
    'border-radius:4px',
    'font-size:11px',
    'padding:3px 6px',
    'cursor:pointer',
    'outline:none',
    style,
  ].join(';');
  return sel;
}

/**
 * Scale the scroll content proportionally to the window width using
 * CSS transform: scale() so card backgrounds scale correctly alongside text.
 * scaleOuter acts as a height-tracking wrapper (transform doesn't affect layout).
 */
function updateContentScale(scaleWrapper: HTMLElement, scaleOuter: HTMLElement, defaultWidth: number): void {
  const parent = scaleOuter.parentElement;
  if (!parent) return;
  const w = parent.offsetWidth;
  if (w <= 0) return;
  const scale = Math.max(0.65, Math.min(4, w / defaultWidth));
  scaleWrapper.style.transformOrigin = 'top left';
  scaleWrapper.style.transform = `scale(${scale.toFixed(4)})`;
  scaleWrapper.style.width = `${(100 / scale).toFixed(3)}%`;
  scaleOuter.style.height = `${Math.ceil(scaleWrapper.scrollHeight * scale)}px`;
}

// ============================================================================
// TURTLE ROW
// ============================================================================

function buildTurtleRow(contribution: TurtleContribution): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:7px 0',
    'border-top:1px solid rgba(255,255,255,0.05)',
  ].join(';');

  // Sprite
  const spriteUrl = contribution.species
    ? getPetSpriteDataUrlWithMutations(contribution.species, contribution.mutations ?? [])
    : null;
  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.style.cssText = 'width:22px;height:22px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
    img.alt = contribution.species ?? '';
    row.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.style.cssText = 'width:22px;height:22px;background:rgba(255,255,255,0.05);border-radius:3px;flex-shrink:0;';
    row.appendChild(ph);
  }

  // Name
  const nameEl = document.createElement('span');
  nameEl.textContent = contribution.name ?? contribution.species ?? t('feature.turtleTimer.slotFallback', { index: String(contribution.slotIndex + 1) });
  nameEl.style.cssText = 'font-size:11px;font-weight:600;color:var(--qpm-text,#fff);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  row.appendChild(nameEl);

  // Stats columns — fixed widths to align with column headers
  if (contribution.missingStats) {
    const pendingEl = document.createElement('span');
    pendingEl.textContent = t('feature.turtleTimer.dataPending');
    pendingEl.style.cssText = 'font-size:10px;color:#ffa500;font-style:italic;flex-shrink:0;margin-left:auto;';
    row.appendChild(pendingEl);
  } else {
    // Rate column (52px) — shows "−X.X" (unit in column header)
    const rateEl = document.createElement('span');
    if (contribution.perHourReduction > 0) {
      rateEl.textContent = `−${contribution.perHourReduction.toFixed(1)}`;
      rateEl.title = t('feature.turtleTimer.rateTooltip', { rate: contribution.perHourReduction.toFixed(1) });
      rateEl.style.cssText = 'font-size:10px;font-family:monospace;color:var(--qpm-accent,#4CAF50);flex-shrink:0;width:52px;text-align:right;';
    } else {
      rateEl.style.cssText = 'flex-shrink:0;width:52px;';
    }
    row.appendChild(rateEl);

    // Hunger column (44px)
    const hungerEl = document.createElement('span');
    if (contribution.hungerPct != null) {
      const hPct = Math.round(contribution.hungerPct);
      const hColor = hPct < 20 ? '#ef5350' : hPct < 50 ? '#ffa500' : 'var(--qpm-text-muted,#888)';
      hungerEl.textContent = `${hPct}%`;
      hungerEl.title = t('feature.turtleTimer.hungerTooltip');
      hungerEl.style.cssText = `font-size:10px;color:${hColor};flex-shrink:0;width:44px;text-align:right;`;
    } else {
      hungerEl.style.cssText = 'flex-shrink:0;width:44px;';
    }
    row.appendChild(hungerEl);
  }

  return row;
}

// ============================================================================
// TAB CONTENT RENDERING
// ============================================================================

function buildFocusControls(
  isPlant: boolean,
  focusMode: TurtleTimerFocus,
  focusTargetKey: string | null,
  targets: TurtleFocusOption[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;background:var(--qpm-surface-2,#1a1a1a);border-radius:6px;border:1px solid var(--qpm-border,#2a2a2a);';

  const modeLabel = document.createElement('span');
  modeLabel.textContent = t('feature.turtleTimer.trackLabel');
  modeLabel.style.cssText = 'font-size:11px;color:var(--qpm-text-muted,#888);flex-shrink:0;';
  wrap.appendChild(modeLabel);

  // Focus mode selector
  const modeSelect = makeSelect('flex-shrink:0;');
  const modes: { value: TurtleTimerFocus; label: string }[] = [
    { value: 'latest', label: t('feature.turtleTimer.latestFinishing') },
    { value: 'earliest', label: t('feature.turtleTimer.earliestFinishing') },
    { value: 'specific', label: t('feature.turtleTimer.specificSlot') },
  ];
  for (const { value, label } of modes) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === focusMode) opt.selected = true;
    modeSelect.appendChild(opt);
  }
  wrap.appendChild(modeSelect);

  // Specific slot selector (shown when mode === 'specific')
  const targetSelect = makeSelect('flex:1;min-width:0;');
  const noTargetOpt = document.createElement('option');
  noTargetOpt.value = '';
  noTargetOpt.textContent = targets.length ? t('feature.turtleTimer.chooseSlot') : t('feature.turtleTimer.noSlotsAvailable');
  targetSelect.appendChild(noTargetOpt);

  for (const target of targets) {
    const opt = document.createElement('option');
    opt.value = target.key;
    const speciesLabel = target.species ?? t('feature.turtleTimer.unknownSpecies');
    const etaLabel = target.remainingMs != null ? ` (${formatMs(target.remainingMs)})` : '';
    opt.textContent = `${speciesLabel}${etaLabel}`;
    if (target.key === focusTargetKey) opt.selected = true;
    targetSelect.appendChild(opt);
  }

  targetSelect.style.display = focusMode === 'specific' ? '' : 'none';
  wrap.appendChild(targetSelect);

  // Event: mode change
  modeSelect.addEventListener('change', () => {
    const newMode = modeSelect.value as TurtleTimerFocus;
    targetSelect.style.display = newMode === 'specific' ? '' : 'none';
    if (newMode !== 'specific') {
      if (isPlant) {
        configureTurtleTimer({ focus: newMode, focusTargetTileId: null, focusTargetSlotIndex: null });
      } else {
        configureTurtleTimer({ eggFocus: newMode, eggFocusTargetTileId: null, eggFocusTargetSlotIndex: null });
      }
    }
  });

  // Event: specific target change
  targetSelect.addEventListener('change', () => {
    const key = targetSelect.value;
    const target = targets.find(t => t.key === key);
    if (!target) return;
    if (isPlant) {
      configureTurtleTimer({ focus: 'specific', focusTargetTileId: target.tileId, focusTargetSlotIndex: target.slotIndex });
    } else {
      configureTurtleTimer({ eggFocus: 'specific', eggFocusTargetTileId: target.tileId, eggFocusTargetSlotIndex: target.slotIndex });
    }
  });

  return wrap;
}

function buildSlotCountsRow(channel: TurtleTimerChannel): HTMLElement | null {
  if (channel.trackedSlots === 0) return null;

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;font-size:11px;';

  const total = document.createElement('span');
  total.style.color = 'var(--qpm-text-muted,#888)';
  total.textContent = t('feature.turtleTimer.tracked', { count: String(channel.trackedSlots) });
  row.appendChild(total);

  if (channel.growingSlots > 0) {
    const growing = document.createElement('span');
    growing.style.color = 'var(--qpm-text,#ccc)';
    growing.textContent = t('feature.turtleTimer.growing', { count: String(channel.growingSlots) });
    row.appendChild(growing);
  }

  if (channel.maturedSlots > 0) {
    const ready = document.createElement('span');
    ready.style.color = 'var(--qpm-accent,#4CAF50)';
    ready.textContent = t('feature.turtleTimer.ready', { count: String(channel.maturedSlots) });
    row.appendChild(ready);
  }

  return row;
}

function buildEtaBlock(channel: TurtleTimerChannel): HTMLElement {
  const block = document.createElement('div');
  block.style.cssText = [
    'background:rgba(76,175,80,0.08)',
    'border:1px solid rgba(76,175,80,0.2)',
    'border-radius:5px',
    'padding:10px 12px',
    'display:flex',
    'flex-direction:column',
    'gap:4px',
  ].join(';');

  const hasTurtleBoost = channel.minutesSaved != null && channel.minutesSaved > 0;

  // Adjusted ETA (or natural if no turtles)
  const mainRow = document.createElement('div');
  mainRow.style.cssText = 'display:flex;align-items:baseline;gap:8px;';

  const icon = document.createElement('span');
  icon.textContent = '⏱';
  icon.style.cssText = 'font-size:14px;';
  mainRow.appendChild(icon);

  const timeVal = document.createElement('span');
  const displayMs = channel.adjustedMsRemaining ?? channel.naturalMsRemaining;
  timeVal.textContent = formatMs(displayMs);
  timeVal.style.cssText = `font-size:22px;font-weight:700;color:${hasTurtleBoost ? 'var(--qpm-accent,#4CAF50)' : 'var(--qpm-text-muted,#888)'};font-family:monospace;`;
  mainRow.appendChild(timeVal);

  if (hasTurtleBoost) {
    const badge = document.createElement('span');
    badge.textContent = t('feature.turtleTimer.timeSaved', { time: formatMinutes(channel.minutesSaved!) });
    badge.style.cssText = 'font-size:11px;color:var(--qpm-accent,#4CAF50);opacity:0.8;';
    mainRow.appendChild(badge);
  }

  block.appendChild(mainRow);

  // Detail row
  if (hasTurtleBoost && channel.naturalMsRemaining != null) {
    const detail = document.createElement('div');
    detail.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#777);';
    detail.textContent = t('feature.turtleTimer.withoutTurtles', { time: formatMs(channel.naturalMsRemaining) });
    block.appendChild(detail);
  } else if (!hasTurtleBoost && channel.status === 'no-turtles') {
    const note = document.createElement('div');
    note.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#777);';
    note.textContent = t('feature.turtleTimer.noTurtlesAssigned');
    block.appendChild(note);
  }

  // Tracked species
  if (channel.focusSlot?.species) {
    const focusEl = document.createElement('div');
    focusEl.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#666);';
    focusEl.textContent = t('feature.turtleTimer.tracking', { species: channel.focusSlot.species });
    block.appendChild(focusEl);
  }

  return block;
}

function getFocusSignature(
  tab: 'plant' | 'egg',
  focusMode: TurtleTimerFocus,
  focusTargetKey: string | null,
  targets: TurtleFocusOption[],
): string {
  return `${tab}:${focusMode}:${focusTargetKey ?? ''}:${targets.map(t => t.key).join(',')}`;
}

function updateDynamicZone(
  dynamicZone: HTMLElement,
  channel: TurtleTimerChannel,
): void {
  dynamicZone.innerHTML = '';

  const sections: HTMLElement[] = [];

  // Slot counts row
  const countsRow = buildSlotCountsRow(channel);
  if (countsRow) sections.push(countsRow);

  // ETA block or status message
  if (channel.status === 'estimating' || (channel.status === 'no-turtles' && channel.naturalMsRemaining != null)) {
    sections.push(buildEtaBlock(channel));
  } else {
    const statusMessages: Record<string, string> = {
      'disabled': t('feature.turtleTimer.statusDisabled'),
      'no-data': t('feature.turtleTimer.statusNoData'),
      'no-crops': t('feature.turtleTimer.statusNoCrops'),
      'no-eggs': t('feature.turtleTimer.statusNoEggs'),
      'no-turtles': t('feature.turtleTimer.statusNoTurtles'),
    };
    const msg = statusMessages[channel.status] ?? t('feature.turtleTimer.statusUnknown');
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'padding:16px;text-align:center;color:var(--qpm-text-muted,#666);font-size:12px;font-style:italic;';
    statusEl.textContent = msg;
    sections.push(statusEl);
  }

  // Turtle contribution list
  if (channel.contributions.length > 0) {
    const contribCard = document.createElement('div');
    contribCard.style.cssText = [
      'background:var(--qpm-surface-2,#1a1a1a)',
      'border:1px solid var(--qpm-border,#2a2a2a)',
      'border-radius:6px',
      'padding:8px 12px',
    ].join(';');

    const contribHeader = document.createElement('div');
    contribHeader.style.cssText = 'font-size:11px;font-weight:600;color:var(--qpm-text-muted,#888);margin-bottom:2px;';
    contribHeader.textContent = channel.contributions.length === 1
      ? t('feature.turtleTimer.turtleContributing', { count: '1' })
      : t('feature.turtleTimer.turtlesContributing', { count: String(channel.contributions.length) });
    contribCard.appendChild(contribHeader);

    if (channel.effectiveRate != null && channel.effectiveRate > 1) {
      const rateTotal = document.createElement('div');
      rateTotal.style.cssText = 'font-size:10px;color:var(--qpm-accent,#4CAF50);margin-bottom:4px;';
      rateTotal.textContent = t('feature.turtleTimer.combinedGrowthSpeed', { rate: channel.effectiveRate.toFixed(1) });
      contribCard.appendChild(rateTotal);
    }

    // Column header row — aligned with turtle row columns
    const colHeader = document.createElement('div');
    colHeader.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:2px;';
    const chSpacer = document.createElement('div');
    chSpacer.style.cssText = 'width:22px;flex-shrink:0;';
    const chName = document.createElement('span');
    chName.textContent = t('feature.turtleTimer.colTurtle');
    chName.style.cssText = 'flex:1;font-size:9px;color:var(--qpm-text-muted,#555);';
    const chRate = document.createElement('span');
    chRate.textContent = t('feature.turtleTimer.colRate');
    chRate.style.cssText = 'width:52px;text-align:right;font-size:9px;color:var(--qpm-text-muted,#555);flex-shrink:0;';
    const chHunger = document.createElement('span');
    chHunger.textContent = t('feature.turtleTimer.colHunger');
    chHunger.style.cssText = 'width:44px;text-align:right;font-size:9px;color:var(--qpm-text-muted,#555);flex-shrink:0;';
    colHeader.append(chSpacer, chName, chRate, chHunger);
    contribCard.appendChild(colHeader);

    for (const contrib of channel.contributions) {
      contribCard.appendChild(buildTurtleRow(contrib));
    }

    sections.push(contribCard);
  } else if (channel.status === 'estimating') {
    const noTurtles = document.createElement('div');
    noTurtles.style.cssText = 'font-size:11px;color:var(--qpm-text-muted,#666);text-align:center;padding:8px;';
    noTurtles.textContent = t('feature.turtleTimer.noTurtlesActive');
    sections.push(noTurtles);
  }

  for (const section of sections) {
    dynamicZone.appendChild(section);
  }
}

// ============================================================================
// FULL STATE RENDER
// ============================================================================

function renderTurtleTimerState(state: TurtleTimerWindowState, timerState: TurtleTimerState): void {
  state.latestState = timerState;

  // Summary strip
  const summaryParts: string[] = [];
  summaryParts.push(timerState.availableTurtles === 1
    ? t('feature.turtleTimer.summaryTurtle', { count: '1' })
    : t('feature.turtleTimer.summaryTurtles', { count: String(timerState.availableTurtles) }));
  if (timerState.hungerFilteredCount > 0) summaryParts.push(t('feature.turtleTimer.summaryHungry', { count: String(timerState.hungerFilteredCount) }));
  if (timerState.turtlesMissingStats > 0) summaryParts.push(t('feature.turtleTimer.summaryDataPending', { count: String(timerState.turtlesMissingStats) }));
  state.summaryStrip.textContent = summaryParts.join(' · ');

  renderActiveTab(state, timerState);
}

function renderActiveTab(state: TurtleTimerWindowState, timerState: TurtleTimerState): void {
  const isPlant = state.activeTab === 'plant';
  const channel = isPlant ? timerState.plant : timerState.egg;
  const targets = isPlant ? timerState.plantTargets : timerState.eggTargets;
  const focusMode = isPlant ? timerState.focus : timerState.eggFocus;
  const focusTargetKey = isPlant ? timerState.focusTargetKey : timerState.eggFocusTargetKey;

  // Only rebuild focus controls when mode/targets actually change.
  // This prevents destroying the dropdown while the user has it open.
  const sig = getFocusSignature(state.activeTab, focusMode, focusTargetKey, targets);
  if (sig !== state.lastFocusSignature) {
    state.lastFocusSignature = sig;
    state.focusZone.innerHTML = '';
    state.focusZone.appendChild(buildFocusControls(isPlant, focusMode, focusTargetKey, targets));
  }

  // Dynamic zone (ETA + turtle list) always updates freely.
  updateDynamicZone(state.dynamicZone, channel);

  // Sync scaleOuter height after content changes so scrolling reflects visual size.
  state.updateScale?.();
}

const TURTLE_TAB_KEY = 'qpm.turtleTimer.activeTab';

function setActiveTab(state: TurtleTimerWindowState, tab: 'plant' | 'egg'): void {
  state.activeTab = tab;
  storage.set(TURTLE_TAB_KEY, tab);
  // Force focus zone rebuild on tab switch by invalidating the signature.
  state.lastFocusSignature = '';

  const activeStyle = 'padding:6px 14px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:var(--qpm-surface-2,#1a1a1a);color:var(--qpm-text,#fff);border-bottom:2px solid var(--qpm-accent,#4CAF50);';
  const inactiveStyle = 'padding:6px 14px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:transparent;color:var(--qpm-text-muted,#888);border-bottom:2px solid transparent;';

  state.plantTabBtn.style.cssText = tab === 'plant' ? activeStyle : inactiveStyle;
  state.eggTabBtn.style.cssText = tab === 'egg' ? activeStyle : inactiveStyle;

  if (state.latestState) {
    renderActiveTab(state, state.latestState);
  }
}

// ============================================================================
// WINDOW CREATION
// ============================================================================

export function createTurtleTimerWindow(): TurtleTimerWindowState {
  const layout = loadLayout();
  const initWidth = layout?.width ?? defaultWidth();
  const initHeight = layout?.height ?? defaultHeight();
  currentPct = layout
    ? { xPct: layout.xPct, yPct: layout.yPct }
    : { xPct: 0.5, yPct: 0.5 };
  const initPos = layoutPctToPixels(currentPct.xPct, currentPct.yPct, initWidth, initHeight);

  // Root
  const root = document.createElement('div');
  root.id = 'qpm-turtle-timer-window';
  root.style.cssText = [
    'position:fixed',
    `top:${initPos.y}px`,
    `left:${initPos.x}px`,
    `width:${initWidth}px`,
    `height:${initHeight}px`,
    'display:none',
    'flex-direction:column',
    'overflow:hidden',
    'background:var(--qpm-surface-1,#141414)',
    'border:1px solid var(--qpm-border,#2a2a2a)',
    'border-radius:8px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
    'z-index:10003',
    "font-family:'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', sans-serif",
    'color:var(--qpm-text,#fff)',
  ].join(';');

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:8px 12px',
    'background:var(--qpm-surface-1,#141414)',
    'border-bottom:1px solid var(--qpm-border,#2a2a2a)',
    'cursor:grab',
    'user-select:none',
    'flex-shrink:0',
  ].join(';');

  const titleText = document.createElement('span');
  titleText.textContent = `🐢 ${t('feature.turtleTimer.title')}`;
  titleText.style.cssText = 'font-size:13px;font-weight:600;color:var(--qpm-text,#fff);pointer-events:none;flex:1;';
  titleBar.appendChild(titleText);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = [
    'background:none',
    'border:none',
    'color:var(--qpm-text-muted,#888)',
    'cursor:pointer',
    'font-size:14px',
    'padding:0 4px',
    'line-height:1',
  ].join(';');
  titleBar.appendChild(closeBtn);
  root.appendChild(titleBar);

  // Summary strip
  const summaryStrip = document.createElement('div');
  summaryStrip.style.cssText = [
    'padding:5px 14px',
    'font-size:11px',
    'color:var(--qpm-text-muted,#888)',
    'background:var(--qpm-surface-1,#141414)',
    'border-bottom:1px solid var(--qpm-border,#2a2a2a)',
    'flex-shrink:0',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
  ].join(';');
  summaryStrip.textContent = t('common.loading');
  root.appendChild(summaryStrip);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.style.cssText = [
    'display:flex',
    'background:var(--qpm-surface-1,#141414)',
    'border-bottom:1px solid var(--qpm-border,#2a2a2a)',
    'flex-shrink:0',
  ].join(';');

  const activeTabStyle = 'padding:6px 14px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:var(--qpm-surface-2,#1a1a1a);color:var(--qpm-text,#fff);border-bottom:2px solid var(--qpm-accent,#4CAF50);';
  const inactiveTabStyle = 'padding:6px 14px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:transparent;color:var(--qpm-text-muted,#888);border-bottom:2px solid transparent;';

  const savedTurtleTab = storage.get<string>(TURTLE_TAB_KEY, 'plant');

  const plantTabBtn = document.createElement('button');
  plantTabBtn.textContent = `🌱 ${t('feature.turtleTimer.tabPlants')}`;
  plantTabBtn.style.cssText = savedTurtleTab === 'egg' ? inactiveTabStyle : activeTabStyle;
  tabBar.appendChild(plantTabBtn);

  const eggTabBtn = document.createElement('button');
  eggTabBtn.textContent = `🥚 ${t('feature.turtleTimer.tabEggs')}`;
  eggTabBtn.style.cssText = savedTurtleTab === 'egg' ? activeTabStyle : inactiveTabStyle;
  tabBar.appendChild(eggTabBtn);

  root.appendChild(tabBar);

  // Tab content (scrollable) — split into two zones so focus controls
  // are never destroyed mid-interaction.
  const scrollWrapper = document.createElement('div');
  scrollWrapper.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';

  // scaleOuter: height-tracking wrapper (transform on scaleWrapper doesn't affect layout)
  const scaleOuter = document.createElement('div');

  // scaleWrapper: scaled via transform so card backgrounds grow/shrink with the window
  const scaleWrapper = document.createElement('div');
  scaleWrapper.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px;';

  const tabContent = document.createElement('div');
  tabContent.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

  // focusZone: dropdowns — only rebuilt when mode/targets change
  const focusZone = document.createElement('div');
  focusZone.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  tabContent.appendChild(focusZone);

  // dynamicZone: ETA + turtle list — rebuilt freely on every state update
  const dynamicZone = document.createElement('div');
  dynamicZone.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  tabContent.appendChild(dynamicZone);

  scaleWrapper.appendChild(tabContent);
  scaleOuter.appendChild(scaleWrapper);
  scrollWrapper.appendChild(scaleOuter);
  root.appendChild(scrollWrapper);

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.title = t('window.chrome.resizeHint');
  resizeHandle.style.cssText = [
    'position:absolute',
    'bottom:0',
    'right:0',
    'width:14px',
    'height:14px',
    'cursor:se-resize',
    'z-index:1',
    'background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,0.12) 50%)',
    'border-radius:0 0 7px 0',
  ].join(';');
  root.appendChild(resizeHandle);

  document.body.appendChild(root);

  const state: TurtleTimerWindowState = {
    root,
    summaryStrip,
    plantTabBtn,
    eggTabBtn,
    tabContent,
    focusZone,
    dynamicZone,
    activeTab: storage.get<string>(TURTLE_TAB_KEY, 'plant') === 'egg' ? 'egg' as const : 'plant' as const,
    lastFocusSignature: '',
    latestState: null,
    unsubscribeTimer: null,
    resizeListener: null,
    scaleWrapper,
    scaleOuter,
    updateScale: null,
    resizeObserver: null,
  };

  // Tab click handlers
  plantTabBtn.addEventListener('click', () => setActiveTab(state, 'plant'));
  eggTabBtn.addEventListener('click', () => setActiveTab(state, 'egg'));

  // Window behaviours
  const onLayoutChange = () => { /* position saved in capturePositionAndSave */ };
  makeDraggable(root, titleBar, onLayoutChange);
  makeResizable(root, resizeHandle, onLayoutChange);

  closeBtn.addEventListener('click', () => { hideTurtleTimerWindow(state); });

  const resizeListener = () => {
    if (root.style.display !== 'none') applyCurrentPosition(root);
  };
  window.addEventListener('resize', resizeListener);
  state.resizeListener = resizeListener;

  // Content scaling — live update as the user drags the resize handle
  const doUpdateScale = () => updateContentScale(scaleWrapper, scaleOuter, DESIGN_WIDTH);
  state.updateScale = doUpdateScale;
  const scaleObserver = new ResizeObserver(doUpdateScale);
  scaleObserver.observe(root);
  state.resizeObserver = scaleObserver;

  // Subscribe to turtle timer state
  const throttledRender = throttle((timerState: TurtleTimerState) => {
    renderTurtleTimerState(state, timerState);
  }, 500);

  state.unsubscribeTimer = onTurtleTimerState((timerState) => {
    throttledRender(timerState);
  }, false);

  return state;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function showTurtleTimerWindow(state: TurtleTimerWindowState): void {
  state.root.style.display = 'flex';
  applyCurrentPosition(state.root);
  try {
    renderTurtleTimerState(state, getTurtleTimerState()); // calls state.updateScale?.() internally
  } catch (error) {
    log('⚠️ Failed to render turtle timer state', error);
  }
}

export function hideTurtleTimerWindow(state: TurtleTimerWindowState): void {
  state.root.style.display = 'none';
}

export function destroyTurtleTimerWindow(state: TurtleTimerWindowState): void {
  state.resizeObserver?.disconnect();
  if (state.resizeListener) window.removeEventListener('resize', state.resizeListener);
  state.unsubscribeTimer?.();
  state.root.remove();
}
