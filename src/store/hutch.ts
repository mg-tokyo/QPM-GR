// src/store/hutch.ts
// Reactive hutch state: pet count, capacity, and pet IDs via Jotai subscriptions.

import { getAtomByLabel, subscribeAtom, readAtomValue } from '../core/jotaiBridge';
import { log } from '../utils/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUTCH_ATOM_LABEL = 'myPetHutchPetItemsAtom';
const CAPACITY_ATOM_LABEL = 'myPetHutchCapacityLevelAtom';
const INVENTORY_ATOM_LABEL = 'myInventoryAtom';

export const DEFAULT_HUTCH_CAPACITY = 25;
export const INVENTORY_MAX = 100;

/**
 * Hutch capacity by upgrade level (0-10).
 * Verified from beta source: decorDex.ts PetHutch upgrade tiers.
 */
const HUTCH_CAPACITY_BY_LEVEL: readonly number[] = [
  25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100,
];

export function hutchCapacityForLevel(level: number): number {
  const clamped = Math.max(0, Math.min(level, HUTCH_CAPACITY_BY_LEVEL.length - 1));
  return HUTCH_CAPACITY_BY_LEVEL[clamped] ?? DEFAULT_HUTCH_CAPACITY;
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export interface HutchState {
  /** Number of pets currently in the hutch. */
  count: number;
  /** Maximum hutch capacity (based on upgrade level). */
  capacity: number;
  /** Upgrade level (0-10). */
  capacityLevel: number;
  /** Set of item IDs in the hutch. */
  petIds: Set<string>;
  /** Timestamp of last update. */
  updatedAt: number;
}

let state: HutchState = {
  count: 0,
  capacity: DEFAULT_HUTCH_CAPACITY,
  capacityLevel: 0,
  petIds: new Set(),
  updatedAt: 0,
};

let hutchUnsub: (() => void) | null = null;
let capacityUnsub: (() => void) | null = null;
let capacityFromStorages = false;
const listeners = new Set<(state: HutchState) => void>();

function notify(): void {
  const snapshot = getHutchState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch (err) { log('[Hutch] listener threw', err); }
  }
}

function updateHutchItems(raw: unknown): void {
  const items = Array.isArray(raw) ? raw : [];
  const petIds = new Set<string>();
  let count = 0;

  for (const item of items) {
    if (!item) continue;
    count++;
    if (typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id
        : typeof record.itemId === 'string' ? record.itemId
        : null;
      if (id) petIds.add(id);
    }
  }

  state = { ...state, count, petIds, updatedAt: Date.now() };
  notify();
}

function updateCapacityLevel(level: number): void {
  const clamped = Math.max(0, Math.min(Math.floor(level), HUTCH_CAPACITY_BY_LEVEL.length - 1));
  const capacity = HUTCH_CAPACITY_BY_LEVEL[clamped] ?? DEFAULT_HUTCH_CAPACITY;
  if (state.capacityLevel === clamped && state.capacity === capacity) return;
  state = { ...state, capacityLevel: clamped, capacity, updatedAt: Date.now() };
  notify();
}

// ---------------------------------------------------------------------------
// Init / stop
// ---------------------------------------------------------------------------

export async function startHutchStore(): Promise<void> {
  if (hutchUnsub) return;

  // Subscribe to hutch items atom
  const hutchAtom = getAtomByLabel(HUTCH_ATOM_LABEL);
  if (hutchAtom) {
    hutchUnsub = await subscribeAtom(hutchAtom, (value: unknown) => {
      updateHutchItems(value);
    });
  }

  // Subscribe to capacity level — try dedicated atom first
  const capAtom = getAtomByLabel(CAPACITY_ATOM_LABEL);
  if (capAtom) {
    capacityUnsub = await subscribeAtom(capAtom, (value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        updateCapacityLevel(value);
      }
    });
    log('[Hutch] Store initialized (reactive capacity via atom)');
  } else {
    // Fallback: read capacityLevel from myInventoryAtom.storages[] once
    await resolveCapacityFromStorages();
    log('[Hutch] Store initialized (capacity from storages fallback)');
  }
}

async function resolveCapacityFromStorages(): Promise<void> {
  try {
    const invAtom = getAtomByLabel(INVENTORY_ATOM_LABEL);
    if (!invAtom) return;
    const raw = await readAtomValue(invAtom);
    if (!raw || typeof raw !== 'object') return;
    const record = raw as Record<string, unknown>;
    const storages = Array.isArray(record.storages) ? record.storages : [];
    for (const st of storages) {
      if (!st || typeof st !== 'object') continue;
      const entry = st as Record<string, unknown>;
      if (entry.decorId === 'PetHutch' || entry.id === 'PetHutch' || entry.storageId === 'PetHutch') {
        const level = Number(entry.capacityLevel ?? entry.level);
        if (Number.isFinite(level) && level >= 0) {
          capacityFromStorages = true;
          updateCapacityLevel(level);
          return;
        }
      }
    }
  } catch { /* fallback failed — stays at default */ }
}

export function stopHutchStore(): void {
  hutchUnsub?.();
  hutchUnsub = null;
  capacityUnsub?.();
  capacityUnsub = null;
  capacityFromStorages = false;
  listeners.clear();
  state = {
    count: 0,
    capacity: DEFAULT_HUTCH_CAPACITY,
    capacityLevel: 0,
    petIds: new Set(),
    updatedAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Read API (synchronous)
// ---------------------------------------------------------------------------

export function getHutchState(): HutchState {
  return { ...state, petIds: new Set(state.petIds) };
}

export function getHutchCount(): number {
  return state.count;
}

export function getHutchCapacity(): number {
  return state.capacity;
}

export function getHutchCapacityLevel(): number {
  return state.capacityLevel;
}

export function getHutchPetIds(): Set<string> {
  return new Set(state.petIds);
}

export function isHutchFull(): boolean {
  return state.count >= state.capacity;
}

/** True if the hutch store is actively subscribed. */
export function isHutchStoreActive(): boolean {
  return hutchUnsub !== null;
}

// ---------------------------------------------------------------------------
// Subscribe API
// ---------------------------------------------------------------------------

export function onHutchChange(
  callback: (state: HutchState) => void,
  fireImmediately = false,
): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try { callback(getHutchState()); } catch (err) { log('[Hutch] immediate callback threw', err); }
  }
  return () => { listeners.delete(callback); };
}
