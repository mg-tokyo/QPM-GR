// Friend bonus from the game's own derived atom (ALR-12.1). While the atom is unresolved the
// pre-ALR-12 userSlots formula stands in, labelled 'fallback' with a degraded diagnostic (PD1).

import { explain, readSync, subscribe } from '../core/gameState';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeFriendBonus', 'friendBonus');

export interface RoomOccupancy {
  filled: number;
  /** userSlots length: the room's seat count, read from the game rather than a literal. */
  seats: number;
}

export type FriendBonusSource = 'atom' | 'fallback';

export function occupancyOf(userSlots: unknown): RoomOccupancy {
  if (!Array.isArray(userSlots)) return { filled: 0, seats: 0 };
  return { filled: userSlots.filter((slot) => slot != null).length, seats: userSlots.length };
}

/** The pre-ALR-12 formula: min(2.0, 1.0 + max(0, floor(filled − 1)) × 0.1). */
export function fallbackMultiplier(filled: number): number {
  return Math.min(2.0, 1.0 + Math.max(0, Math.floor(filled - 1)) * 0.1);
}

let started = false;
let multiplier = 1.0;
let atomMultiplier: number | null = null;
let occupancy: RoomOccupancy = { filled: 0, seats: 0 };
let degraded = false;
const unsubs: Array<() => void> = [];

const listeners = new Set<(multiplier: number) => void>();
const occupancyListeners = new Set<(occupancy: RoomOccupancy) => void>();

function atomBound(): boolean {
  try { return explain('friendBonusMultiplier').boundVia !== null; } catch { return false; }
}

function recompute(): void {
  if (atomMultiplier === null && !degraded && occupancy.seats > 0 && !atomBound()) {
    degraded = true;
    diag.warn('QPM-STORE-002', { atom: 'friendBonusMultiplierAtom', fallback: 'userSlots formula' });
  }
  const next = atomMultiplier ?? fallbackMultiplier(occupancy.filled);
  if (next === multiplier) return;
  multiplier = next;
  for (const cb of listeners) {
    try { cb(multiplier); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'notify' }, error); }
  }
}

function applyOccupancy(userSlots: unknown): void {
  const next = occupancyOf(userSlots);
  if (next.filled !== occupancy.filled || next.seats !== occupancy.seats) {
    occupancy = next;
    for (const cb of occupancyListeners) {
      try { cb(occupancy); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'notifyOccupancy' }, error); }
    }
  }
  recompute();
}

function applyAtom(value: unknown): void {
  atomMultiplier = typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : null;
  if (atomMultiplier !== null) {
    degraded = false;
    diag.publishOk('Friend bonus from the game atom', { multiplier: atomMultiplier });
  }
  recompute();
}

/** Current friend bonus multiplier (1.0 – 2.0). */
export function getFriendBonusMultiplier(): number {
  return multiplier;
}

/** Register a callback for when the multiplier changes. Returns unsubscribe fn. */
export function onFriendBonusChange(cb: (multiplier: number) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getRoomOccupancy(): RoomOccupancy {
  return occupancy;
}

/** Fires only when the filled or seat count changes. */
export function onRoomOccupancyChange(cb: (occupancy: RoomOccupancy) => void): () => void {
  occupancyListeners.add(cb);
  return () => { occupancyListeners.delete(cb); };
}

export function startFriendBonusStore(): void {
  if (started) return;
  started = true;
  diag.register('Starting friend bonus store');
  // A key with no source yet stays pending in the registry and delivers once it binds, so no retry.
  try {
    unsubs.push(subscribe('friendBonusMultiplier', applyAtom));
    unsubs.push(subscribe('userSlots', applyOccupancy));
  } catch (error) {
    diag.error('QPM-STORE-001', { phase: 'subscribe' }, error);
    return;
  }
  if (!degraded) diag.publishOk('Friend bonus subscribed', { multiplier, source: atomMultiplier !== null ? 'atom' : 'fallback' });
}

export function stopFriendBonusStore(): void {
  if (!started) return;
  started = false;
  for (const off of unsubs.splice(0)) off();
  listeners.clear();
  occupancyListeners.clear();
  multiplier = 1.0;
  atomMultiplier = null;
  occupancy = { filled: 0, seats: 0 };
  degraded = false;
}

export function getFriendBonusState(): {
  multiplier: number;
  source: FriendBonusSource;
  atomMultiplier: number | null;
  fallbackMultiplier: number;
  filled: number;
  seats: number;
  spectating: boolean | null;
  degraded: boolean;
} {
  let spectating: boolean | null = null;
  try { spectating = readSync('isSpectating'); } catch { /* registry down: unknown */ }
  return {
    multiplier,
    source: atomMultiplier !== null ? 'atom' : 'fallback',
    atomMultiplier,
    fallbackMultiplier: fallbackMultiplier(occupancy.filled),
    ...occupancy,
    spectating,
    degraded,
  };
}
