import { subscribe as stateTreeSubscribe } from '../core/stateTree';
import { getPlayerIdSync } from '../core/playerContext';
import type { QuinoaStateSnapshot, QuinoaStorageEntry, QuinoaInventoryItem } from '../types/gameAtoms';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeSeedSilo', 'seedSilo');
let firstStateSeen = false;

// Constants

export const DEFAULT_SEED_SILO_CAPACITY = 10;

// SeedSilo upgrade tiers, verified at scraped-data/BetaGameSourceFiles/
// gg-preview-pr-3208-app/.../decorDex.ts:918-983 (toCapacitySlots values).
const SEED_SILO_CAPACITY_BY_LEVEL: readonly number[] = [
  10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100,
];

export function seedSiloCapacityForLevel(level: number): number {
  const clamped = Math.max(0, Math.min(level, SEED_SILO_CAPACITY_BY_LEVEL.length - 1));
  return SEED_SILO_CAPACITY_BY_LEVEL[clamped] ?? DEFAULT_SEED_SILO_CAPACITY;
}

function seedSiloLevelForCapacity(capacity: number): number {
  const idx = SEED_SILO_CAPACITY_BY_LEVEL.indexOf(capacity);
  return idx >= 0 ? idx : 0;
}

// Reactive state

export interface SeedSiloState {
  count: number;
  capacity: number;
  capacityLevel: number;
  updatedAt: number;
}

let state: SeedSiloState = {
  count: 0,
  capacity: DEFAULT_SEED_SILO_CAPACITY,
  capacityLevel: 0,
  updatedAt: 0,
};

let storageUnsub: (() => void) | null = null;
const listeners = new Set<(state: SeedSiloState) => void>();

function notifyListeners(): void {
  const snapshot = getSeedSiloState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'notify' }, err);
    }
  }
}

function publishSeedSiloHealth(): void {
  diag.publishMetrics(
    `count=${state.count}/${state.capacity} (level ${state.capacityLevel})`,
    {
      count: state.count,
      capacity: state.capacity,
      capacityLevel: state.capacityLevel,
      full: state.count >= state.capacity ? 1 : 0,
    },
  );
}

// State-tree selector

interface SeedSiloSlice {
  items: QuinoaInventoryItem[];
  capacity: number;
}

const NULL_SLICE: SeedSiloSlice = { items: [], capacity: DEFAULT_SEED_SILO_CAPACITY };

function selectSeedSiloSlice(snapshot: QuinoaStateSnapshot): SeedSiloSlice {
  const playerId = getPlayerIdSync();
  if (!playerId) return NULL_SLICE;

  const userSlots = snapshot.child?.data?.userSlots;
  if (!Array.isArray(userSlots)) return NULL_SLICE;
  const myIdx = userSlots.findIndex((s) => !!s && s.playerId === playerId);
  if (myIdx < 0) return NULL_SLICE;
  const mySlot = userSlots[myIdx];
  if (!mySlot || typeof mySlot !== 'object') return NULL_SLICE;

  const storages = mySlot.data?.inventory?.storages;
  if (!Array.isArray(storages)) return NULL_SLICE;

  const silo = storages.find((s: QuinoaStorageEntry) =>
    s?.decorId === 'SeedSilo' || s?.storageId === 'SeedSilo' || s?.id === 'SeedSilo'
  );
  if (!silo) return NULL_SLICE;

  const rawCapacity = silo.capacitySlots ?? silo.capacityLevel;
  const capacity = typeof rawCapacity === 'number' && Number.isFinite(rawCapacity) && rawCapacity > 0
    ? rawCapacity
    : DEFAULT_SEED_SILO_CAPACITY;

  const rawItems = silo.items;
  const items = Array.isArray(rawItems)
    ? rawItems.filter((i): i is QuinoaInventoryItem => !!i && typeof i === 'object')
    : [];

  return { items, capacity };
}

// State updates

function updateFromSlice(slice: SeedSiloSlice | null): void {
  const s = slice ?? NULL_SLICE;
  const count = s.items.length;
  const capacity = s.capacity;
  const capacityLevel = seedSiloLevelForCapacity(capacity);

  const changed = state.count !== count
    || state.capacity !== capacity
    || state.capacityLevel !== capacityLevel;

  if (!changed) return;

  state = { count, capacity, capacityLevel, updatedAt: Date.now() };
  notifyListeners();

  if (!firstStateSeen) {
    firstStateSeen = true;
    diag.publishOk(
      `count=${state.count}/${state.capacity} (level ${state.capacityLevel})`,
      {
        count: state.count,
        capacity: state.capacity,
        capacityLevel: state.capacityLevel,
        full: state.count >= state.capacity ? 1 : 0,
      },
    );
  } else {
    publishSeedSiloHealth();
  }
}

// Init / stop

export async function startSeedSiloStore(): Promise<void> {
  if (storageUnsub) return;
  diag.register('Subscribing to state-tree silo slice');

  try {
    storageUnsub = stateTreeSubscribe(
      selectSeedSiloSlice,
      (slice) => updateFromSlice(slice),
      'store:seedSilo',
    );
    diag.log.debug('store initialized (state-tree subscription)');
  } catch (err) {
    diag.warn('QPM-STORE-001', { phase: 'startSeedSiloStore' }, err);
    throw err;
  }
}

export function stopSeedSiloStore(): void {
  storageUnsub?.();
  storageUnsub = null;
  firstStateSeen = false;
  listeners.clear();
  state = {
    count: 0,
    capacity: DEFAULT_SEED_SILO_CAPACITY,
    capacityLevel: 0,
    updatedAt: 0,
  };
}

// Read API (synchronous)

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

export function isSeedSiloStoreActive(): boolean {
  return storageUnsub !== null;
}

// Subscribe API

export function onSeedSiloChange(
  callback: (state: SeedSiloState) => void,
  fireImmediately = false,
): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try { callback(getSeedSiloState()); } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'onSeedSiloChange.immediate' }, err);
    }
  }
  return () => { listeners.delete(callback); };
}
