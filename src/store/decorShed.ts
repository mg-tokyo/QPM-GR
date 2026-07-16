import { subscribe as stateTreeSubscribe } from '../core/stateTree';
import { getPlayerIdSync } from '../core/playerContext';
import type { QuinoaStateSnapshot, QuinoaStorageEntry, QuinoaInventoryItem } from '../types/gameAtoms';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeDecorShed', 'decorShed');
let firstStateSeen = false;

// Constants

export const DEFAULT_DECOR_SHED_CAPACITY = 10;

// DecorShed upgrade tiers, verified at scraped-data/BetaGameSourceFiles/
// gg-preview-pr-3208-app/.../decorDex.ts:778-817 (toCapacitySlots values).
const DECOR_SHED_CAPACITY_BY_LEVEL: readonly number[] = [
  10, 15, 20, 25, 30, 35, 40, 45, 50,
];

export function decorShedCapacityForLevel(level: number): number {
  const clamped = Math.max(0, Math.min(level, DECOR_SHED_CAPACITY_BY_LEVEL.length - 1));
  return DECOR_SHED_CAPACITY_BY_LEVEL[clamped] ?? DEFAULT_DECOR_SHED_CAPACITY;
}

function decorShedLevelForCapacity(capacity: number): number {
  const idx = DECOR_SHED_CAPACITY_BY_LEVEL.indexOf(capacity);
  return idx >= 0 ? idx : 0;
}

// Reactive state

export interface DecorShedState {
  count: number;
  capacity: number;
  capacityLevel: number;
  updatedAt: number;
}

let state: DecorShedState = {
  count: 0,
  capacity: DEFAULT_DECOR_SHED_CAPACITY,
  capacityLevel: 0,
  updatedAt: 0,
};

let storageUnsub: (() => void) | null = null;
const listeners = new Set<(state: DecorShedState) => void>();

function notifyListeners(): void {
  const snapshot = getDecorShedState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'notify' }, err);
    }
  }
}

function publishDecorShedHealth(): void {
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

interface DecorShedSlice {
  items: QuinoaInventoryItem[];
  capacity: number;
}

const NULL_SLICE: DecorShedSlice = { items: [], capacity: DEFAULT_DECOR_SHED_CAPACITY };

function selectDecorShedSlice(snapshot: QuinoaStateSnapshot): DecorShedSlice {
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

  const shed = storages.find((s: QuinoaStorageEntry) =>
    s?.decorId === 'DecorShed' || s?.storageId === 'DecorShed' || s?.id === 'DecorShed'
  );
  if (!shed) return NULL_SLICE;

  const rawCapacity = shed.capacitySlots ?? shed.capacityLevel;
  const capacity = typeof rawCapacity === 'number' && Number.isFinite(rawCapacity) && rawCapacity > 0
    ? rawCapacity
    : DEFAULT_DECOR_SHED_CAPACITY;

  // No itemType filter — shed can hold Decor/Plant/Produce mixed.
  const rawItems = shed.items;
  const items = Array.isArray(rawItems)
    ? rawItems.filter((i): i is QuinoaInventoryItem => !!i && typeof i === 'object')
    : [];

  return { items, capacity };
}

// State updates

function updateFromSlice(slice: DecorShedSlice | null): void {
  const s = slice ?? NULL_SLICE;
  const count = s.items.length;
  const capacity = s.capacity;
  const capacityLevel = decorShedLevelForCapacity(capacity);

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
    publishDecorShedHealth();
  }
}

// Init / stop

export async function startDecorShedStore(): Promise<void> {
  if (storageUnsub) return;
  diag.register('Subscribing to state-tree shed slice');

  try {
    storageUnsub = stateTreeSubscribe(
      selectDecorShedSlice,
      (slice) => updateFromSlice(slice),
      'store:decorShed',
    );
    diag.log.debug('store initialized (state-tree subscription)');
  } catch (err) {
    diag.warn('QPM-STORE-001', { phase: 'startDecorShedStore' }, err);
    throw err;
  }
}

export function stopDecorShedStore(): void {
  storageUnsub?.();
  storageUnsub = null;
  firstStateSeen = false;
  listeners.clear();
  state = {
    count: 0,
    capacity: DEFAULT_DECOR_SHED_CAPACITY,
    capacityLevel: 0,
    updatedAt: 0,
  };
}

// Read API (synchronous)

export function getDecorShedState(): DecorShedState {
  return { ...state };
}

export function getDecorShedCount(): number {
  return state.count;
}

export function getDecorShedCapacity(): number {
  return state.capacity;
}

export function getDecorShedCapacityLevel(): number {
  return state.capacityLevel;
}

export function isDecorShedFull(): boolean {
  return state.count >= state.capacity;
}

export function isDecorShedStoreActive(): boolean {
  return storageUnsub !== null;
}

// Subscribe API

export function onDecorShedChange(
  callback: (state: DecorShedState) => void,
  fireImmediately = false,
): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try { callback(getDecorShedState()); } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'onDecorShedChange.immediate' }, err);
    }
  }
  return () => { listeners.delete(callback); };
}
