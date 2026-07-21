// Turtle-boosted ETA row for the tile info overlay. Renders a live
// countdown of the *expected* completion time given the player's active
// turtle-timer growth boosts: `remaining = (endTime − now) / effectiveRate`.
// Data comes from the already-reactive TurtleTimerState (no polling).

import { storage } from '../../../utils/storage';
import { getAnySpriteDataUrl } from '../../../sprite-v2/compat';
import { onTurtleTimerState, getTurtleTimerState } from '../../pets/turtleTimer';
import type { TurtleTimerState } from '../../pets/turtleTimer';
import { t } from '../../../i18n';
import { resolveCurrentSlot, resolveCurrentEgg, resolveCurrentPlantEndTime } from './atoms';
import { pageWindow } from '../../../core/pageContext';
import { TOOLTIP_ROW_ATTR, TILE_ETA_STORAGE_KEY } from './types';
import type { TileEtaConfig } from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TileEtaConfig = { enabled: true };
let config: TileEtaConfig = { ...DEFAULT_CONFIG };

export function getTileEtaConfig(): TileEtaConfig {
  return { ...config };
}

export function setTileEtaConfig(updates: Partial<TileEtaConfig>): void {
  config = { ...config, ...updates };
  storage.set(TILE_ETA_STORAGE_KEY, config);
}

export function loadTileEtaConfig(): void {
  const saved = storage.get<TileEtaConfig>(TILE_ETA_STORAGE_KEY, DEFAULT_CONFIG);
  config = { ...DEFAULT_CONFIG, ...saved };
}

// ---------------------------------------------------------------------------
// Turtle sprite (cached data-url — same pattern as valueIndicator's coin)
// ---------------------------------------------------------------------------

let turtleSpriteUrl: string | null | undefined;

function getTurtleSpriteUrl(): string | null {
  if (turtleSpriteUrl !== undefined) return turtleSpriteUrl;
  turtleSpriteUrl = getAnySpriteDataUrl('sprite/pet/Turtle') || null;
  return turtleSpriteUrl;
}

// ---------------------------------------------------------------------------
// Turtle state watch — cache the fields we need + fire reinject on change
// ---------------------------------------------------------------------------

let turtleEnabled = false;
let plantRate: number | null = null;
let eggRate: number | null = null;
let plantHasGrowing = false;
let eggHasGrowing = false;

let turtleUnsub: (() => void) | null = null;
let reinjectCallback: (() => void) | null = null;
let lastSignature = '';

function signatureFor(state: TurtleTimerState): string {
  return [
    state.enabled ? '1' : '0',
    state.plant.effectiveRate ?? 'n',
    state.egg.effectiveRate ?? 'n',
    state.plant.growingSlots > 0 ? '1' : '0',
    state.egg.growingSlots > 0 ? '1' : '0',
  ].join('|');
}

function cacheTurtleState(state: TurtleTimerState): void {
  turtleEnabled = state.enabled;
  plantRate = state.plant.effectiveRate;
  eggRate = state.egg.effectiveRate;
  plantHasGrowing = state.plant.growingSlots > 0;
  eggHasGrowing = state.egg.growingSlots > 0;
}

export function startTurtleEtaWatch(reinject: () => void): void {
  reinjectCallback = reinject;
  // Seed cache from current state so the first render is populated.
  try {
    const initial = getTurtleTimerState();
    cacheTurtleState(initial);
    lastSignature = signatureFor(initial);
  } catch {
    /* turtle timer may not be initialized yet — subscription's fireImmediately will seed */
  }
  turtleUnsub = onTurtleTimerState((state) => {
    const sig = signatureFor(state);
    if (sig === lastSignature) return;
    lastSignature = sig;
    cacheTurtleState(state);
    reinjectCallback?.();
  }, true);
  installDebugHook();
}

export function stopTurtleEtaWatch(): void {
  turtleUnsub?.();
  turtleUnsub = null;
  reinjectCallback = null;
  turtleEnabled = false;
  plantRate = null;
  eggRate = null;
  plantHasGrowing = false;
  eggHasGrowing = false;
  lastSignature = '';
}

// ---------------------------------------------------------------------------
// Formatting — mirrors turtleTimerWindow.formatMs (can't import from src/ui)
// ---------------------------------------------------------------------------

function formatEtaMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Row DOM
// ---------------------------------------------------------------------------

const CONTENT_ID_ATTR = 'data-qpm-content-id';

interface EtaRefs {
  container: HTMLElement;
  textEl: HTMLSpanElement;
  endTime: number;
  rate: number;
  lastText: string;
}

let refs: EtaRefs | null = null;

function removeRow(container: HTMLElement | null): void {
  const target = container ?? refs?.container ?? null;
  if (target) {
    const row = target.querySelector(`:scope > [${TOOLTIP_ROW_ATTR}="eta"]`);
    row?.remove();
  }
  refs = null;
}

function ensureRow(
  container: HTMLElement,
  endTime: number,
  rate: number,
  contentId: string,
): void {
  const ROW_SEL = `:scope > [${TOOLTIP_ROW_ATTR}="eta"]`;
  let row = container.querySelector(ROW_SEL) as HTMLElement | null;
  let textEl: HTMLSpanElement | null = null;

  if (!row) {
    row = document.createElement('span');
    row.setAttribute(TOOLTIP_ROW_ATTR, 'eta');
    row.title = t('feature.turtleTimer.tileEtaTitle');

    const turtleUrl = getTurtleSpriteUrl();
    if (turtleUrl) {
      const img = document.createElement('img');
      img.src = turtleUrl;
      img.alt = t('feature.turtleTimer.tileEtaAlt');
      img.draggable = false;
      row.appendChild(img);
    }

    textEl = document.createElement('span');
    row.appendChild(textEl);

    // Insert after the value row if present, else after the journal row, else append.
    const valueRow = container.querySelector(`[${TOOLTIP_ROW_ATTR}="value"]`);
    if (valueRow) {
      valueRow.insertAdjacentElement('afterend', row);
    } else {
      const journalRow = container.querySelector(`[${TOOLTIP_ROW_ATTR}="journal"]`);
      if (journalRow) {
        journalRow.insertAdjacentElement('afterend', row);
      } else {
        container.appendChild(row);
      }
    }
  } else {
    textEl = row.querySelector('span');
  }

  row.setAttribute(CONTENT_ID_ATTR, contentId);

  if (textEl) {
    const initialMs = Math.max(0, (endTime - Date.now()) / rate);
    const initialText = formatEtaMs(initialMs);
    textEl.textContent = initialText;
    refs = { container, textEl, endTime, rate, lastText: initialText };
  } else {
    refs = null;
  }
}

// ---------------------------------------------------------------------------
// Injector (registered with observer)
// ---------------------------------------------------------------------------

export function injectTileEta(container: HTMLElement): void {
  if (!config.enabled || !turtleEnabled) {
    removeRow(container);
    return;
  }

  // Try plant first, then egg. Decor / other object types → no ETA.
  let endTime: number | null = null;
  let rate: number | null = null;
  let hasGrowing = false;

  const plant = resolveCurrentSlot();
  if (plant) {
    endTime = resolveCurrentPlantEndTime();
    rate = plantRate;
    hasGrowing = plantHasGrowing;
  } else {
    const egg = resolveCurrentEgg();
    if (egg) {
      endTime = egg.maturedAt;
      rate = eggRate;
      hasGrowing = eggHasGrowing;
    }
  }

  if (endTime == null || rate == null || rate <= 1) {
    removeRow(container);
    return;
  }
  if (endTime <= Date.now()) {
    removeRow(container);
    return;
  }
  // Gate on the channel having at least one growing slot known to the turtle
  // timer. This filters foreign-garden tiles (turtle timer only tracks the
  // player's own garden) without exact-endTime membership matching, which is
  // race-sensitive during rapid state updates (planting, harvest, boost proc).
  if (!hasGrowing) {
    removeRow(container);
    return;
  }

  const contentId = `${endTime}:${rate.toFixed(3)}`;
  const existing = container.querySelector(`:scope > [${TOOLTIP_ROW_ATTR}="eta"]`);
  if (existing && existing.getAttribute(CONTENT_ID_ATTR) === contentId && refs && refs.container === container) {
    return;
  }

  ensureRow(container, endTime, rate, contentId);
}

// ---------------------------------------------------------------------------
// Per-frame text updater — called from the observer rAF tick (no new timers).
// Precedent: updateLockBadge at observer.ts:280-281.
// ---------------------------------------------------------------------------

export function updateEtaCountdown(): void {
  if (!refs) return;
  const remaining = (refs.endTime - Date.now()) / refs.rate;
  if (remaining <= 0) {
    removeRow(refs.container);
    return;
  }
  const text = formatEtaMs(remaining);
  if (text !== refs.lastText) {
    refs.textEl.textContent = text;
    refs.lastText = text;
  }
}

// ---------------------------------------------------------------------------
// Debug hook — inspect live state and current-tile decision from the console.
// Usage: window.__QPM_TILE_ETA_DEBUG__()
// ---------------------------------------------------------------------------

let debugHookInstalled = false;

function installDebugHook(): void {
  if (debugHookInstalled) return;
  debugHookInstalled = true;
  const dump = () => {
    const plant = resolveCurrentSlot();
    const egg = resolveCurrentEgg();
    const plantEnd = resolveCurrentPlantEndTime();
    return {
      config: { ...config },
      turtle: {
        enabled: turtleEnabled,
        plantRate,
        eggRate,
        plantHasGrowing,
        eggHasGrowing,
      },
      focused: plant
        ? {
            kind: 'plant',
            species: plant.species,
            slotId: plant.slotId,
            slotEndTime: plant.endTime,
            effectiveEndTime: plantEnd,
            targetScale: plant.targetScale,
            mutations: plant.mutations,
          }
        : egg
          ? { kind: 'egg', eggId: egg.eggId, maturedAt: egg.maturedAt }
          : null,
      refs: refs
        ? { endTime: refs.endTime, rate: refs.rate, lastText: refs.lastText }
        : null,
      now: Date.now(),
    };
  };
  const win = pageWindow as Window & { __QPM_TILE_ETA_DEBUG__?: () => unknown };
  win.__QPM_TILE_ETA_DEBUG__ = dump;
  if (typeof window !== 'undefined' && window !== pageWindow) {
    (window as Window & { __QPM_TILE_ETA_DEBUG__?: () => unknown }).__QPM_TILE_ETA_DEBUG__ = dump;
  }
}
