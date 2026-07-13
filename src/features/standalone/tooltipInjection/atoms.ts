// src/features/tooltipInjection/atoms.ts
// Reactive tile-state source for the tooltip subsystem. Manages the
// subscriptions to `gardenObject` + `selectedSlotId` internally and exposes
// an `onTileChanged` push API. Consumers (observer.ts, lockBadge.ts) register
// listeners; both atom callbacks funnel through a single notify. This
// eliminates the race between two separate cache reads that used to happen
// during rapid slot cycling.

import { readAtomValue, subscribeAtomValue } from '../../../core/atomRegistry';
import { log } from '../../../utils/logger';
import { isRecord } from '../../../utils/typeGuards';
import { getCropMaxScaleSafe } from '../../../utils/game/catalogHelpers';
import type { ResolvedSlot, TileLockContext } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RETRY_DELAY_MS = 2500;
const MAX_RETRIES = 8;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cachedGardenObject: Record<string, unknown> | null = null;
let cachedSelectedSlotId = 0;
let retryCount = 0;
let retryTimer: number | null = null;

const cleanups: Array<() => void> = [];
const listeners = new Set<() => void>();

let trackingStarted = false;
let trackingPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSlot(raw: unknown): ResolvedSlot | null {
  if (!isRecord(raw)) return null;

  const species = raw.species;
  if (typeof species !== 'string' || !species) return null;

  const targetScale = raw.targetScale ?? raw.scale;
  if (typeof targetScale !== 'number') return null;

  const slotId = typeof raw.slotId === 'number' ? raw.slotId : 0;
  const endTime = typeof raw.endTime === 'number' ? raw.endTime : 0;

  const mutations = Array.isArray(raw.mutations)
    ? raw.mutations.filter((m): m is string => typeof m === 'string')
    : [];

  return { species, targetScale, mutations, slotId, endTime };
}

function computeSizePercent(species: string, targetScale: number): number {
  const maxScale = getCropMaxScaleSafe(species);
  if (maxScale === null || maxScale <= 1) return 100;
  const clamped = Math.max(1, Math.min(maxScale, targetScale));
  return Math.max(50, Math.min(100, Math.round(50 + ((clamped - 1) / (maxScale - 1)) * 50)));
}

function notify(): void {
  for (const cb of listeners) {
    try { cb(); } catch { /* isolate listener failures */ }
  }
}

// ---------------------------------------------------------------------------
// Public API — resolvers (read from subscription-populated cache)
// ---------------------------------------------------------------------------

/** Resolve the currently selected slot from the cached garden object + selected slot ID. */
export function resolveCurrentSlot(): ResolvedSlot | null {
  if (!cachedGardenObject) return null;
  if (cachedGardenObject.objectType !== 'plant') return null;

  const slots = cachedGardenObject.slots;
  if (!Array.isArray(slots) || slots.length === 0) return null;

  for (const raw of slots) {
    if (!isRecord(raw)) continue;
    if (raw.slotId === cachedSelectedSlotId) return parseSlot(raw);
  }

  return parseSlot(slots[0]);
}

/**
 * Resolve the currently-focused garden tile to a lock-check context.
 * Returns null when no tile is focused or the tile has no meaningful lock target.
 * Both `cachedGardenObject` and `cachedSelectedSlotId` are updated by push
 * callbacks funneled through the same notify, so this always reads a
 * consistent snapshot — no race between the two atoms during rapid cycling.
 */
export function resolveCurrentTile(): TileLockContext | null {
  const obj = cachedGardenObject;
  if (!obj) return null;

  const objectType = obj.objectType;
  if (typeof objectType !== 'string' || objectType.length === 0) return null;

  if (objectType === 'plant') {
    const slot = resolveCurrentSlot();
    if (!slot) return null;
    const ctx: Extract<TileLockContext, { kind: 'plant' }> = {
      kind: 'plant',
      species: slot.species,
      mutations: slot.mutations,
      sizePercent: computeSizePercent(slot.species, slot.targetScale),
    };
    // Tile-level base species — differs from slot.species on rare-variant slots
    if (typeof obj.species === 'string' && obj.species.length > 0 && obj.species !== slot.species) {
      ctx.baseSpecies = obj.species;
    }
    return ctx;
  }

  if (objectType === 'egg') {
    const eggId = obj.eggId;
    if (typeof eggId !== 'string' || eggId.length === 0) return null;
    return { kind: 'egg', eggId };
  }

  // Any other objectType is a decor id (matches guard.ts:203-205).
  return { kind: 'decor', decorId: objectType };
}

// ---------------------------------------------------------------------------
// Public API — listener registration + lifecycle
// ---------------------------------------------------------------------------

/**
 * Register a listener called whenever the focused tile or selected slot
 * changes. Idempotent: multiple consumers may subscribe. Returns an
 * unsubscribe function. Automatically starts internal atom tracking on
 * first registration.
 */
export function onTileChanged(cb: () => void): () => void {
  listeners.add(cb);
  void startTileTracking();
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Start the internal atom subscriptions. Idempotent — safe to call multiple
 * times. Returns a promise that resolves when subscriptions are attached
 * (or when retries exhaust). Consumers can await this if they need to
 * synchronize with initial state; otherwise `onTileChanged` alone is enough.
 */
export function startTileTracking(): Promise<void> {
  if (trackingStarted) return trackingPromise ?? Promise.resolve();
  trackingStarted = true;
  trackingPromise = attemptSubscribe();
  return trackingPromise;
}

/** Stop internal subscriptions and clear caches. Idempotent. */
export function stopTileTracking(): void {
  for (const cleanup of cleanups) {
    try { cleanup(); } catch { /* ignore */ }
  }
  cleanups.length = 0;
  cachedGardenObject = null;
  cachedSelectedSlotId = 0;
  retryCount = 0;
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  trackingStarted = false;
  trackingPromise = null;
}

// ---------------------------------------------------------------------------
// Internals — subscription attachment with retry
// ---------------------------------------------------------------------------

async function attemptSubscribe(): Promise<void> {
  // Garden object — try `gardenObject` first, fall back to `ownGardenObject`.
  let gardenUnsub = await subscribeAtomValue('gardenObject', (value) => {
    cachedGardenObject = isRecord(value) ? value : null;
    notify();
  });
  if (!gardenUnsub) {
    gardenUnsub = await subscribeAtomValue('ownGardenObject', (value) => {
      cachedGardenObject = isRecord(value) ? value : null;
      notify();
    });
  }

  if (!gardenUnsub) {
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        attemptSubscribe().catch(() => {});
      }, RETRY_DELAY_MS);
    } else {
      log('[TooltipAtoms] Garden object atom not found after retries');
    }
    return;
  }

  log('[TooltipAtoms] Found garden object atom');
  cleanups.push(gardenUnsub);

  try {
    let initial = await readAtomValue('gardenObject');
    if (initial == null) initial = await readAtomValue('ownGardenObject');
    cachedGardenObject = isRecord(initial) ? initial : null;
  } catch { /* ignore */ }

  const slotIdUnsub = await subscribeAtomValue('selectedSlotId', (value) => {
    cachedSelectedSlotId = typeof value === 'number' ? value : 0;
    notify();
  });
  if (slotIdUnsub) {
    cleanups.push(slotIdUnsub);
    try {
      const initial = await readAtomValue('selectedSlotId');
      cachedSelectedSlotId = typeof initial === 'number' ? initial : 0;
    } catch { /* ignore */ }
    log('[TooltipAtoms] Found mySelectedSlotIdAtom');
  }

  // Fire initial notification so late-registering listeners see current state.
  notify();
}
