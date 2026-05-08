// src/ui/trackerWindow.ts - Ability Tracker floating window

import { log } from '../utils/logger';
import { onActivePetInfos, type ActivePetInfo } from '../store/pets';
import { getPetSpriteDataUrlWithMutations } from '../sprite-v2/compat';
import { getAbilityDefinition, computeAbilityStats, type AbilityDefinition } from '../data/petAbilities';
import { getAbilityColor } from '../utils/petCardRenderer';
import { findAbilityHistoryForIdentifiers, onAbilityHistoryUpdate } from '../store/abilityLogs';
import { formatCoinsAbbreviated } from '../features/valueCalculator';
import { throttle } from '../utils/scheduling';
import { storage } from '../utils/storage';
import { clampPct, scaledDimension } from '../utils/windowPosition';
import {
  buildAbilityValuationContext,
  resolveDynamicAbilityEffect,
  type AbilityValuationContext,
} from '../features/abilityValuation';
import { onGardenSnapshot } from '../features/gardenBridge';
import { visibleInterval } from '../utils/timerManager';

// ============================================================================
// CONSTANTS
// ============================================================================

const LAYOUT_KEY = 'qpm.trackerWindow.layout.v3';
/** Design-baseline dimensions (tuned for 1920px viewport). Used by updateContentScale. */
const DESIGN_WIDTH = 440;
const DESIGN_HEIGHT = 560;
/** Viewport-scaled defaults — always the same fraction of the screen. */
function defaultWidth(): number { return scaledDimension(DESIGN_WIDTH, 'w'); }
function defaultHeight(): number { return scaledDimension(DESIGN_HEIGHT, 'h'); }
const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
const TICKER_INTERVAL_MS = 1000;

// ============================================================================
// PERSISTENT UI STATE — survives re-renders
// ============================================================================

/** Whether each pet card is collapsed. Keyed by pet id/slot. */
const petCardCollapsed = new Map<string, boolean>();

/** Per-pet set of ability IDs that the user has hidden (removed from view). */
const hiddenAbilities = new Map<string, Set<string>>();

/** Per-ability stats visibility. Key = `petKey:abilityId`. True = stats are hidden. */
const abilityStatsHidden = new Map<string, boolean>();

function getCardPetKey(pet: ActivePetInfo): string {
  return pet.petId ?? pet.slotId ?? `slot:${pet.slotIndex}`;
}

// ============================================================================
// TYPES
// ============================================================================

export interface AbilityTrackerWindowState {
  root: HTMLElement;
  scrollContent: HTMLElement;
  summaryStrip: HTMLElement;
  cardsContainer: HTMLElement;
  latestPets: ActivePetInfo[];
  tickerInterval: (() => void) | null;
  unsubscribePets: (() => void) | null;
  unsubscribeHistory: (() => void) | null;
  unsubscribeGarden: (() => void) | null;
  resizeListener: (() => void) | null;
  scaleWrapper: HTMLElement;
  scaleOuter: HTMLElement;
  updateScale: (() => void) | null;
  resizeObserver: ResizeObserver | null;
  /** Pre-built list of timer-cell elements — populated after each render, iterated by the 1s tick. */
  timerCells: HTMLElement[];
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

function formatAgo(ts: number | null | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - ts;
  if (ms < 5000) return 'just now';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

/** Format the average interval between procs (shown when no history yet). */
function formatAvgInterval(procsPerHour: number): string {
  if (procsPerHour <= 0) return '—';
  const avgMins = 60 / procsPerHour;
  if (avgMins >= 60) {
    const h = Math.floor(avgMins / 60);
    const m = Math.round(avgMins % 60);
    return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
  }
  if (avgMins >= 1) return `~${Math.round(avgMins)}m`;
  return `~${Math.round(avgMins * 60)}s`;
}

/**
 * Exported utility kept for API compatibility.
 */
export function calculateLiveETA(
  lastProcAt: number,
  expectedMinutesBetween: number | null,
  effectiveProcsPerHour?: number,
): { text: string; isOverdue: boolean } {
  const minutesBetween = effectiveProcsPerHour
    ? effectiveProcsPerHour > 0 ? 60 / effectiveProcsPerHour : null
    : expectedMinutesBetween;
  if (!minutesBetween || minutesBetween <= 0) return { text: '—', isOverdue: false };
  const expectedNextProc = lastProcAt + minutesBetween * 60 * 1000;
  const msRemaining = expectedNextProc - Date.now();
  const abs = Math.abs(msRemaining);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const prefix = msRemaining < 0 ? '-' : '';
  const text = h > 0 ? `${prefix}${h}h ${m}m` : m > 0 ? `${prefix}${m}m ${s}s` : `${prefix}${s}s`;
  return { text, isOverdue: msRemaining < 0 };
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
  // Width compensation: after scaling, content visually fills the container exactly.
  // (100/scale)% × scale = 100% of the parent width.
  scaleWrapper.style.width = `${(100 / scale).toFixed(3)}%`;
  // Sync outer height so the scroll container reflects the post-transform visual height.
  scaleOuter.style.height = `${Math.ceil(scaleWrapper.scrollHeight * scale)}px`;
}

// ============================================================================
// PET CARD BUILDING
// ============================================================================

interface ActiveAbility {
  def: AbilityDefinition;
  raw: string;
  procsPerHour: number;
  coinsPerHour: number | null;
  suppressRateDisplay?: boolean;
}

export interface AbilityTrackerTotals {
  procsPerHour: number;
  coinsPerHour: number;
  abilityCount: number;
  petCount: number;
}

const SUPPRESS_RATE_ABILITY_IDS = new Set(['ProduceMutationBoost', 'ProduceMutationBoostII']);

function resolvePetAbilities(pet: ActivePetInfo, gardenCtx?: AbilityValuationContext): ActiveAbility[] {
  if (!pet.abilities?.length) return [];
  const result: ActiveAbility[] = [];
  for (const raw of pet.abilities) {
    if (!raw) continue;
    const def = getAbilityDefinition(raw);
    if (!def || def.trigger !== 'continuous' || (def.baseProbability ?? 0) <= 0) continue;
    const stats = computeAbilityStats(def, pet.strength);
    let coinsPerHour: number | null = null;
    if (stats.procsPerHour > 0) {
      if (def.effectUnit === 'coins' && def.effectValuePerProc != null) {
        // Static coins per proc (e.g. Coin Finder)
        coinsPerHour = stats.procsPerHour * def.effectValuePerProc * (stats.multiplier ?? 1);
      } else if (gardenCtx && def.effectUnit !== 'xp' && def.effectUnit !== 'minutes') {
        // Dynamic value — granters, scale boosts, and other garden-dependent abilities
        try {
          const dynamic = resolveDynamicAbilityEffect(def.id, gardenCtx, pet.strength);
          if (dynamic && dynamic.effectPerProc > 0) {
            coinsPerHour = dynamic.effectPerProc * stats.procsPerHour;
          }
        } catch { /* ignore if garden not ready */ }
      }
    }
    result.push({ def, raw, procsPerHour: stats.procsPerHour, coinsPerHour, suppressRateDisplay: SUPPRESS_RATE_ABILITY_IDS.has(def.id) });
  }
  return result;
}

function buildAbilityRow(
  pet: ActivePetInfo,
  petKey: string,
  ability: ActiveAbility,
  onHide: (abilityId: string) => void,
): HTMLElement {
  const statsKey = `${petKey}:${ability.def.id}`;

  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:5px 0',
    'border-top:1px solid rgba(255,255,255,0.05)',
    'cursor:pointer',
    'border-radius:3px',
    'transition:background 0.1s',
  ].join(';');

  // Color dot — click to hide this ability entirely (stopPropagation keeps row click separate)
  const color = getAbilityColor(ability.def.id);
  const dot = document.createElement('div');
  dot.title = 'Click to hide this ability';
  dot.style.cssText = [
    `background:${color.base}`,
    `box-shadow:0 0 4px ${color.glow}`,
    'width:8px',
    'height:8px',
    'border-radius:50%',
    'flex-shrink:0',
    'cursor:pointer',
    'transition:opacity 0.1s',
  ].join(';');
  dot.addEventListener('mouseenter', () => { dot.style.opacity = '0.4'; });
  dot.addEventListener('mouseleave', () => { dot.style.opacity = '1'; });
  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    row.style.display = 'none'; // immediate feedback
    onHide(ability.def.id);
  });
  row.appendChild(dot);

  // Ability name
  const name = document.createElement('span');
  name.textContent = ability.def.name;
  name.style.cssText = 'flex:1;font-size:11px;color:var(--qpm-text,#fff);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  row.appendChild(name);

  // Fixed-width stat columns — widths match the card column header for alignment.
  const procsChip = document.createElement('span');
  if (ability.suppressRateDisplay) {
    procsChip.textContent = '—';
    procsChip.title = 'Rate cannot be accurately calculated for this ability';
    procsChip.style.cssText = 'font-size:10px;font-family:monospace;color:var(--qpm-text-muted,rgba(232,224,255,0.4));flex-shrink:0;width:52px;text-align:right;';
  } else {
    procsChip.textContent = `${ability.procsPerHour.toFixed(1)}/hr`;
    procsChip.title = 'Expected procs per hour (based on strength)';
    procsChip.style.cssText = 'font-size:10px;font-family:monospace;color:var(--qpm-accent,#4CAF50);flex-shrink:0;width:52px;text-align:right;';
  }
  row.appendChild(procsChip);

  const coinsChip = document.createElement('span');
  if (ability.suppressRateDisplay) {
    // Empty placeholder keeps column alignment intact.
    coinsChip.style.cssText = 'flex-shrink:0;width:62px;';
  } else if (ability.coinsPerHour != null && ability.coinsPerHour > 0) {
    coinsChip.textContent = `${formatCoinsAbbreviated(ability.coinsPerHour)}/hr`;
    coinsChip.title = 'Estimated coins per hour';
    coinsChip.style.cssText = 'font-size:10px;font-family:monospace;color:var(--qpm-warning,#ffa500);flex-shrink:0;width:62px;text-align:right;';
  } else {
    // Empty placeholder keeps column alignment intact for non-coin abilities.
    coinsChip.style.cssText = 'flex-shrink:0;width:62px;';
  }
  row.appendChild(coinsChip);

  // Timer cell: countdown when history known; avg interval when no history yet.
  const history = findAbilityHistoryForIdentifiers(ability.def.id, {
    petId: pet.petId,
    slotId: pet.slotId,
    slotIndex: pet.slotIndex,
  });
  const lastProcAt = history?.lastPerformedAt ?? null;

  const timerEl = document.createElement('span');
  timerEl.style.cssText = 'font-size:10px;white-space:nowrap;flex-shrink:0;width:76px;text-align:right;';
  if (ability.suppressRateDisplay) {
    timerEl.textContent = '—';
    timerEl.style.color = 'rgba(232,224,255,0.3)';
  } else {
    timerEl.dataset.timerCell = '1';
    timerEl.dataset.lastProc = lastProcAt ? String(lastProcAt) : '';
    timerEl.dataset.procsPerHour = String(ability.procsPerHour);
    updateTimerCell(timerEl);
  }
  row.appendChild(timerEl);

  // Stats visibility toggle — click the row to show/hide procs/coins/timer columns.
  const applyStatsVisibility = () => {
    const hidden = abilityStatsHidden.get(statsKey) ?? false;
    const vis = hidden ? 'none' : '';
    procsChip.style.display = vis;
    coinsChip.style.display = vis;
    timerEl.style.display = vis;
    name.style.opacity = hidden ? '0.55' : '1';
    row.title = hidden ? `${ability.def.name} — stats hidden (click to show)` : `${ability.def.name} — click to hide stats`;
  };

  applyStatsVisibility();

  row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
  row.addEventListener('mouseleave', () => { row.style.background = ''; });
  row.addEventListener('click', () => {
    const nowHidden = !(abilityStatsHidden.get(statsKey) ?? false);
    abilityStatsHidden.set(statsKey, nowHidden);
    applyStatsVisibility();
  });

  return row;
}

function updateTimerCell(el: HTMLElement): void {
  const lastProc = el.dataset.lastProc ? parseInt(el.dataset.lastProc, 10) : null;
  const procsPerHour = el.dataset.procsPerHour ? parseFloat(el.dataset.procsPerHour) : 0;

  if (lastProc && procsPerHour > 0) {
    const { text, isOverdue } = calculateLiveETA(lastProc, null, procsPerHour);
    if (isOverdue) {
      el.textContent = `Late ${text}`;
      el.style.color = '#ef5350';
    } else {
      el.textContent = `Next: ${text}`;
      el.style.color = 'var(--qpm-accent,#4CAF50)';
    }
  } else if (lastProc) {
    el.textContent = formatAgo(lastProc);
    el.style.color = 'var(--qpm-text-muted,#666)';
  } else if (procsPerHour > 0) {
    // No proc history yet — show average interval so the column is immediately useful.
    el.textContent = formatAvgInterval(procsPerHour);
    el.style.color = 'var(--qpm-text-muted,#555)';
  } else {
    el.textContent = '—';
    el.style.color = 'var(--qpm-text-muted,#555)';
  }
}

function buildPetCard(pet: ActivePetInfo, gardenCtx?: AbilityValuationContext): HTMLElement | null {
  const petKey = getCardPetKey(pet);
  const allAbilities = resolvePetAbilities(pet, gardenCtx);
  if (!allAbilities.length) return null;

  const hiddenSet = hiddenAbilities.get(petKey) ?? new Set<string>();
  const visibleAbilities = allAbilities.filter(a => !hiddenSet.has(a.def.id));

  const card = document.createElement('div');
  card.style.cssText = [
    'background:var(--qpm-surface-2,#1a1a1a)',
    'border:1px solid var(--qpm-border,#2a2a2a)',
    'border-radius:6px',
    'padding:10px 12px',
    'display:flex',
    'flex-direction:column',
    'gap:4px',
  ].join(';');

  // Card header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;cursor:pointer;user-select:none;';

  // Sprite
  const spriteUrl = getPetSpriteDataUrlWithMutations(pet.species ?? '', pet.mutations ?? []);
  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.style.cssText = 'width:28px;height:28px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
    img.alt = pet.species ?? '';
    header.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = 'width:28px;height:28px;background:rgba(255,255,255,0.05);border-radius:4px;flex-shrink:0;';
    header.appendChild(placeholder);
  }

  // Pet name + strength
  const nameWrap = document.createElement('div');
  nameWrap.style.cssText = 'display:flex;flex-direction:column;gap:1px;overflow:hidden;flex:1;';

  const petName = document.createElement('span');
  petName.textContent = pet.name ?? pet.species ?? `Slot ${pet.slotIndex + 1}`;
  petName.style.cssText = 'font-size:13px;font-weight:600;color:var(--qpm-text,#fff);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  nameWrap.appendChild(petName);

  const petMeta = document.createElement('span');
  const strText = pet.strength != null ? `STR ${pet.strength}` : 'STR ?';
  const speciesText = pet.species ? ` · ${pet.species}` : '';
  petMeta.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#888);';
  nameWrap.appendChild(petMeta);

  header.appendChild(nameWrap);

  // "N hidden" badge — click to restore all hidden abilities for this pet
  let hiddenBadge: HTMLElement | null = null;
  const updateHiddenBadge = () => {
    const currentHidden = hiddenAbilities.get(petKey)?.size ?? 0;
    if (currentHidden > 0) {
      if (!hiddenBadge) {
        hiddenBadge = document.createElement('button');
        hiddenBadge.style.cssText = [
          'background:rgba(255,255,255,0.07)',
          'border:1px solid rgba(255,255,255,0.12)',
          'border-radius:4px',
          'color:var(--qpm-text-muted,#888)',
          'font-size:9px',
          'cursor:pointer',
          'padding:1px 5px',
          'flex-shrink:0',
          'white-space:nowrap',
        ].join(';');
        hiddenBadge.title = 'Click to show all hidden abilities';
        hiddenBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          hiddenAbilities.delete(petKey);
          // Rebuild abilities container
          rebuildAbilities();
          updateHiddenBadge();
        });
        header.insertBefore(hiddenBadge, header.lastChild);
      }
      hiddenBadge.textContent = `${currentHidden} hidden`;
    } else if (hiddenBadge) {
      hiddenBadge.remove();
      hiddenBadge = null;
    }
  };

  // Collapse toggle
  const collapseBtn = document.createElement('button');
  collapseBtn.style.cssText = [
    'background:none',
    'border:none',
    'color:var(--qpm-text-muted,#666)',
    'cursor:pointer',
    'font-size:12px',
    'padding:2px 4px',
    'line-height:1',
    'flex-shrink:0',
    'transition:transform 0.15s ease',
  ].join(';');
  header.appendChild(collapseBtn);

  card.appendChild(header);

  // Column header row — labels align with the fixed-width stat columns.
  // Widths match: [dot 8px] [gap 8px] [name flex:1] [procs 52px] [coins 62px] [timer 76px]
  const colHeader = document.createElement('div');
  colHeader.style.cssText = 'display:flex;align-items:center;gap:8px;padding-bottom:2px;';

  const colHeaderSpacer = document.createElement('span');
  colHeaderSpacer.style.cssText = 'width:8px;flex-shrink:0;';
  colHeader.appendChild(colHeaderSpacer);

  const colHeaderName = document.createElement('span');
  colHeaderName.style.cssText = 'flex:1;';
  colHeader.appendChild(colHeaderName);

  const colHeaderProcs = document.createElement('span');
  colHeaderProcs.textContent = 'procs/hr';
  colHeaderProcs.style.cssText = 'font-size:9px;color:var(--qpm-text-muted,#555);flex-shrink:0;width:52px;text-align:right;';
  colHeader.appendChild(colHeaderProcs);

  const colHeaderCoins = document.createElement('span');
  colHeaderCoins.textContent = 'coins/hr';
  colHeaderCoins.style.cssText = 'font-size:9px;color:var(--qpm-text-muted,#555);flex-shrink:0;width:62px;text-align:right;';
  colHeader.appendChild(colHeaderCoins);

  const colHeaderTimer = document.createElement('span');
  colHeaderTimer.textContent = 'next proc';
  colHeaderTimer.style.cssText = 'font-size:9px;color:var(--qpm-text-muted,#555);flex-shrink:0;width:76px;text-align:right;';
  colHeader.appendChild(colHeaderTimer);

  card.appendChild(colHeader);

  // Abilities container — rebuilt in place without re-rendering the card
  const abilitiesContainer = document.createElement('div');
  abilitiesContainer.style.cssText = 'display:flex;flex-direction:column;';
  card.appendChild(abilitiesContainer);

  const buildAbilityRows = () => {
    abilitiesContainer.innerHTML = '';
    const currentHidden = hiddenAbilities.get(petKey) ?? new Set<string>();
    const currentVisible = allAbilities.filter(a => !currentHidden.has(a.def.id));
    if (currentVisible.length === 0) {
      const msg = document.createElement('div');
      msg.textContent = 'All abilities hidden — click badge to restore';
      msg.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#555);font-style:italic;padding:4px 0;';
      abilitiesContainer.appendChild(msg);
    } else {
      for (const ability of currentVisible) {
        abilitiesContainer.appendChild(buildAbilityRow(pet, petKey, ability, (id) => {
          const set = hiddenAbilities.get(petKey) ?? new Set<string>();
          set.add(id);
          hiddenAbilities.set(petKey, set);
          buildAbilityRows();
          updateHiddenBadge();
        }));
      }
    }
  };

  const rebuildAbilities = buildAbilityRows;
  buildAbilityRows();

  // Collapse/expand — persisted across re-renders
  let expanded = !(petCardCollapsed.get(petKey) ?? false);

  const applyCollapseState = () => {
    abilitiesContainer.style.display = expanded ? 'flex' : 'none';
    colHeader.style.display = expanded ? 'flex' : 'none';
    collapseBtn.textContent = expanded ? '▾' : '▸';
    collapseBtn.title = expanded ? 'Collapse abilities' : 'Expand abilities';
    collapseBtn.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    // Update meta text
    const strLine = `${strText}${speciesText}`;
    petMeta.textContent = expanded ? strLine : strLine;
  };

  const toggleCollapse = () => {
    expanded = !expanded;
    petCardCollapsed.set(petKey, !expanded); // store: true = collapsed
    applyCollapseState();
  };

  applyCollapseState();
  updateHiddenBadge();

  collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(); });
  header.addEventListener('click', toggleCollapse);

  return card;
}

// ============================================================================
// RENDER LOGIC
// ============================================================================

function getTotals(pets: ActivePetInfo[], gardenCtx?: AbilityValuationContext): AbilityTrackerTotals {
  let procsPerHour = 0;
  let coinsPerHour = 0;
  let abilityCount = 0;
  let petCount = 0;
  for (const pet of pets) {
    const abilities = resolvePetAbilities(pet, gardenCtx);
    if (!abilities.length) continue;
    petCount++;
    for (const a of abilities) {
      if (!a.suppressRateDisplay) {
        procsPerHour += a.procsPerHour;
        coinsPerHour += a.coinsPerHour ?? 0;
      }
      abilityCount++;
    }
  }
  return { procsPerHour, coinsPerHour, abilityCount, petCount };
}

export function getAbilityTrackerTotals(pets: ActivePetInfo[]): AbilityTrackerTotals {
  let gardenCtx: AbilityValuationContext | undefined;
  try { gardenCtx = buildAbilityValuationContext(); } catch { /* not ready yet */ }
  return getTotals(pets, gardenCtx);
}

function renderAbilityTracker(state: AbilityTrackerWindowState): void {
  const activePets = state.latestPets;

  // Build garden context once per render for dynamic abilities (e.g. Crop Size Boost).
  let gardenCtx: AbilityValuationContext | undefined;
  try { gardenCtx = buildAbilityValuationContext(); } catch { /* not ready yet */ }

  const totals = getTotals(activePets, gardenCtx);
  const summaryParts: string[] = [
    `${totals.petCount} pet${totals.petCount !== 1 ? 's' : ''}`,
    `${totals.abilityCount} abilit${totals.abilityCount !== 1 ? 'ies' : 'y'}`,
    `${totals.procsPerHour.toFixed(1)} procs/hr`,
  ];
  if (totals.coinsPerHour > 0) {
    summaryParts.push(`${formatCoinsAbbreviated(totals.coinsPerHour)}/hr coins`);
  }
  state.summaryStrip.textContent = summaryParts.join(' · ');

  const container = state.cardsContainer;
  container.innerHTML = '';

  if (!activePets.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:24px;text-align:center;color:var(--qpm-text-muted,#666);font-size:12px;';
    empty.textContent = 'No active pets found.';
    container.appendChild(empty);
    return;
  }

  let hasCards = false;
  for (const pet of activePets) {
    const card = buildPetCard(pet, gardenCtx);
    if (card) {
      container.appendChild(card);
      hasCards = true;
    }
  }

  if (!hasCards) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:24px;text-align:center;color:var(--qpm-text-muted,#666);font-size:12px;';
    empty.textContent = 'No continuous abilities detected on active pets.';
    container.appendChild(empty);
  }

  // Cache timer-cell element refs so the 1s tick doesn't need a querySelectorAll
  state.timerCells = Array.from(container.querySelectorAll<HTMLElement>('[data-timer-cell]'));

  // Sync scaleOuter height after content changes so scrolling reflects visual size.
  state.updateScale?.();
}

function tickAllTimers(state: AbilityTrackerWindowState): void {
  // Iterate the pre-built array instead of querying the DOM on every 1s tick
  for (const el of state.timerCells) {
    updateTimerCell(el);
  }
}

function startTicker(state: AbilityTrackerWindowState): void {
  if (state.tickerInterval !== null) return;
  state.tickerInterval = visibleInterval('ability-tracker-tick', () => tickAllTimers(state), TICKER_INTERVAL_MS);
}

function stopTicker(state: AbilityTrackerWindowState): void {
  if (state.tickerInterval !== null) {
    state.tickerInterval();
    state.tickerInterval = null;
  }
}

// ============================================================================
// WINDOW CREATION
// ============================================================================

export function createAbilityTrackerWindow(): AbilityTrackerWindowState {
  const layout = loadLayout();
  const initWidth = layout?.width ?? defaultWidth();
  const initHeight = layout?.height ?? defaultHeight();
  currentPct = layout
    ? { xPct: layout.xPct, yPct: layout.yPct }
    : { xPct: 0.5, yPct: 0.5 };
  const initPos = layoutPctToPixels(currentPct.xPct, currentPct.yPct, initWidth, initHeight);

  // Root
  const root = document.createElement('div');
  root.id = 'qpm-ability-tracker-window';
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
    'z-index:10002',
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
  titleText.textContent = '📈 Ability Tracker';
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
    'padding:6px 14px',
    'font-size:11px',
    'color:var(--qpm-text-muted,#888)',
    'background:var(--qpm-surface-1,#141414)',
    'border-bottom:1px solid var(--qpm-border,#2a2a2a)',
    'flex-shrink:0',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
  ].join(';');
  summaryStrip.textContent = 'Loading…';
  root.appendChild(summaryStrip);

  // Scroll content
  const scrollContent = document.createElement('div');
  scrollContent.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';

  // scaleOuter: height-tracking wrapper (transform on scaleWrapper doesn't affect layout)
  const scaleOuter = document.createElement('div');

  // scaleWrapper: scaled via transform so card backgrounds grow/shrink with the window
  const scaleWrapper = document.createElement('div');
  scaleWrapper.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px;';

  const cardsContainer = document.createElement('div');
  cardsContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  scaleWrapper.appendChild(cardsContainer);
  scaleOuter.appendChild(scaleWrapper);
  scrollContent.appendChild(scaleOuter);
  root.appendChild(scrollContent);

  // Footer hint
  const footerHint = document.createElement('div');
  footerHint.textContent = 'Click an ability to show/hide its stats!';
  footerHint.style.cssText = [
    'padding:4px 12px',
    'font-size:10px',
    'color:var(--qpm-text-muted,#555)',
    'text-align:center',
    'border-top:1px solid var(--qpm-border,#1e1e1e)',
    'flex-shrink:0',
    'user-select:none',
  ].join(';');
  root.appendChild(footerHint);

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.title = 'Drag to resize';
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

  const state: AbilityTrackerWindowState = {
    root,
    scrollContent,
    summaryStrip,
    cardsContainer,
    latestPets: [],
    tickerInterval: null,
    unsubscribePets: null,
    unsubscribeHistory: null,
    unsubscribeGarden: null,
    resizeListener: null,
    scaleWrapper,
    scaleOuter,
    updateScale: null,
    resizeObserver: null,
    timerCells: [],
  };

  // Window behaviours
  const onLayoutChange = () => { /* position saved in capturePositionAndSave */ };
  makeDraggable(root, titleBar, onLayoutChange);
  makeResizable(root, resizeHandle, onLayoutChange);

  closeBtn.addEventListener('click', () => { hideAbilityTrackerWindow(state); });

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

  // Pet subscription — render on update
  const throttledRender = throttle((pets: ActivePetInfo[]) => {
    state.latestPets = pets;
    renderAbilityTracker(state);
  }, 400);
  state.unsubscribePets = onActivePetInfos(throttledRender);

  // History subscription — update timer data-attrs when new procs arrive
  state.unsubscribeHistory = onAbilityHistoryUpdate(() => {
    renderAbilityTracker(state);
  });

  // Garden subscription — re-render when crops change so dynamic ability
  // values (e.g. Crop Size Boost coins/hr) stay current.
  const throttledGardenRender = throttle(() => {
    renderAbilityTracker(state);
  }, 2000);
  state.unsubscribeGarden = onGardenSnapshot(() => {
    throttledGardenRender();
  });

  return state;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function showAbilityTrackerWindow(state: AbilityTrackerWindowState): void {
  state.root.style.display = 'flex';
  applyCurrentPosition(state.root);
  renderAbilityTracker(state); // calls state.updateScale?.() internally
  startTicker(state);
}

export function hideAbilityTrackerWindow(state: AbilityTrackerWindowState): void {
  state.root.style.display = 'none';
  stopTicker(state);
}

export function destroyAbilityTrackerWindow(state: AbilityTrackerWindowState): void {
  stopTicker(state);
  state.resizeObserver?.disconnect();
  if (state.resizeListener) window.removeEventListener('resize', state.resizeListener);
  state.unsubscribePets?.();
  state.unsubscribeHistory?.();
  state.unsubscribeGarden?.();
  state.root.remove();
}

/** No-op — kept for API compatibility. */
export function setGlobalAbilityTrackerState(_state: AbilityTrackerWindowState): void {
  // intentionally empty
}
