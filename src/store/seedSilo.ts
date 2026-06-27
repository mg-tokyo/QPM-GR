// src/store/seedSilo.ts
// Reactive seed silo state: slot count, capacity, and upgrade level via Jotai subscription.

import { getAtomByLabel, subscribeAtom } from '../core/jotaiBridge';
import { log } from '../utils/logger';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeSeedSilo', 'seedSilo');
let firstAtomValueSeen = false;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVENTORY_ATOM_LABEL = 'myInventoryAtom';

export const DEFAULT_SEED_SILO_CAPACITY = 25;

/**
 * Seed silo capacity by upgrade level (0-5).
 * Level 0 = base (no upgrade) = 25 slots.
 * Level 5 = max upgrade = 50 slots.
 */
const SEED_SILO_CAPACITY_BY_LEVEL: readonly number[] = [25, 30, 35, 40, 45, 50];

export function seedSiloCapacityForLevel(level: number): number {
  const clamped = Math.max(0, Math.min(level, SEED_SILO_CAPACITY_BY_LEVEL.length - 1));
  return SEED_SILO_CAPACITY_BY_LEVEL[clamped] ?? DEFAULT_SEED_SILO_CAPACITY;
}

// ---------------------------------------------------------------------------
// Storage entry matching
// ---------------------------------------------------------------------------

const SILO_TOKENS = ['seedsilo', 'seed_silo', 'silo'];

function isSeedSiloEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const row = entry as Record<string, unknown>;
  const fields = [row.storageId, row.decorId, row.id, row.type, row.name];
  for (const field of fields) {
    if (typeof field !== 'string' || !field) continue;
    const normalized = field.trim().toLowerCase().replace(/\s+/g, '');
    if (SILO_TOKENS.some((token) => normalized === token || normalized.includes(token))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Reactive state
// ---------------------------------------------------------------------------

export interface SeedSiloState {
  /** Number of unique seed types (slots used). */
  count: number;
  /** Maximum slot capacity (based on upgrade level). */
  capacity: number;
  /** Upgrade level (0-5). */
  capacityLevel: number;
  /** Timestamp of last update. */
  updatedAt: number;
}

let state: SeedSiloState = {
  count: 0,
  capacity: DEFAULT_SEED_SILO_CAPACITY,
  capacityLevel: 0,
  updatedAt: 0,
};

let inventoryUnsub: (() => void) | null = null;
const listeners = new Set<(state: SeedSiloState) => void>();

function notifyListeners(): void {
  const snapshot = getSeedSiloState();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'notify' }, err);
    }
  }
}

function publishSeedSiloHealth(initial: boolean): void {
  const message = `count=${state.count}/${state.capacity} (level ${state.capacityLevel})`;
  const metrics = {
    count: state.count,
    capacity: state.capacity,
    capacityLevel: state.capacityLevel,
    full: state.count >= state.capacity ? 1 : 0,
  };
  if (initial) {
    diag.publishOk(message, metrics);
  } else {
    diag.publishMetrics(message, metrics);
  }
}

function updateFromInventory(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const record = raw as Record<string, unknown>;
  const storages = Array.isArray(record.storages) ? record.storages : [];

  for (const storage of storages) {
    if (!isSeedSiloEntry(storage)) continue;
    const entry = storage as Record<string, unknown>;

    // Capacity level
    const level = Number(entry.capacityLevel ?? entry.level);
    const capacityLevel = Number.isFinite(level) && level >= 0
      ? Math.max(0, Math.min(Math.floor(level), SEED_SILO_CAPACITY_BY_LEVEL.length - 1))
      : 0;
    const capacity = SEED_SILO_CAPACITY_BY_LEVEL[capacityLevel] ?? DEFAULT_SEED_SILO_CAPACITY;

    // Count = number of items (each item = one unique seed type slot)
    const items = Array.isArray(entry.items) ? entry.items : [];
    const count = items.length;

    // Only notify if something changed
    if (state.count === count && state.capacity === capacity && state.capacityLevel === capacityLevel) {
      if (!firstAtomValueSeen) {
        firstAtomValueSeen = true;
        publishSeedSiloHealth(true);
      }
      return;
    }

    state = { count, capacity, capacityLevel, updatedAt: Date.now() };
    notifyListeners();
    const wasFirst = !firstAtomValueSeen;
    firstAtomValueSeen = true;
    publishSeedSiloHealth(wasFirst);
    return;
  }
}

// ---------------------------------------------------------------------------
// Init / stop
// ---------------------------------------------------------------------------

export async function startSeedSiloStore(): Promise<void> {
  if (inventoryUnsub) return;
  diag.register('Waiting for myInventoryAtom (silo slice)');

  try {
    const invAtom = getAtomByLabel(INVENTORY_ATOM_LABEL);
    if (!invAtom) {
      diag.warn('QPM-STORE-002', { atom: INVENTORY_ATOM_LABEL });
      return;
    }

    inventoryUnsub = await subscribeAtom(invAtom, (value: unknown) => {
      updateFromInventory(value);
    });

    log(`[SeedSilo] Store initialized (capacity=${state.capacity}, count=${state.count}, level=${state.capacityLevel})`);
  } catch (err) {
    diag.warn('QPM-STORE-001', { phase: 'startSeedSiloStore' }, err);
    throw err;
  }
}

export function stopSeedSiloStore(): void {
  inventoryUnsub?.();
  inventoryUnsub = null;
  firstAtomValueSeen = false;
  listeners.clear();
  state = {
    count: 0,
    capacity: DEFAULT_SEED_SILO_CAPACITY,
    capacityLevel: 0,
    updatedAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Read API (synchronous)
// ---------------------------------------------------------------------------

export function getSeedSiloState(): SeedSiloState {
  return { ...state };
}

export function getSeedSiloCount(): number {
  return state.count;
}

export function getSeedSiloCapacity(): number {
  return state.capacity;
}

export function getSeedSiloCapacityLevel(): number {
  return state.capacityLevel;
}

export function isSeedSiloFull(): boolean {
  return state.count >= state.capacity;
}

/** True if the seed silo store is actively subscribed. */
export function isSeedSiloStoreActive(): boolean {
  return inventoryUnsub !== null;
}

// ---------------------------------------------------------------------------
// Subscribe API
// ---------------------------------------------------------------------------

export function onSeedSiloChange(
  callback: (state: SeedSiloState) => void,
  fireImmediately = false,
): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try {
      callback(getSeedSiloState());
    } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'onSeedSiloChange.immediate' }, err);
    }
  }
  return () => { listeners.delete(callback); };
}
