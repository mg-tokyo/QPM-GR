import { subscribe as stateTreeSubscribe } from '../core/stateTree';
import { getPlayerIdSync } from '../core/playerContext';
import type { QuinoaStateSnapshot, QuinoaStorageEntry, QuinoaInventoryItem } from '../types/gameAtoms';
import { log } from '../utils/logger';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeHutch', 'hutch');
let firstStateSeen = false;

// Constants

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

/** Reverse-derives upgrade level (0-10) from capacity slot count; falls back to 0 if unmatched. */
function hutchLevelForCapacity(capacity: number): number {
  const idx = HUTCH_CAPACITY_BY_LEVEL.indexOf(capacity);
  return idx >= 0 ? idx : 0;
}

// Reactive state

export interface HutchState {
  /** Number of pets currently in the hutch. */
  count: number;
  /** Maximum hutch capacity (actual slot count from state tree). */
  capacity: number;
  /** Upgrade level (0-10) reverse-derived from capacity. */
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

let storageUnsub: (() => void) | null = null;
const listeners = new Set<(state: HutchState) => void>();

function notify(): void {
  const snapshot = getHutchState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'notify' }, err);
    }
  }
}

function publishHutchHealth(): void {
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

interface HutchSlice {
  items: QuinoaInventoryItem[];
  capacity: number;
}

const NULL_HUTCH_SLICE: HutchSlice = { items: [], capacity: DEFAULT_HUTCH_CAPACITY };

/**
 * Selector: state → { items, capacity } for the local player's PetHutch.
 * Fully atom-independent (derives user-slot from playerId, not `myUserSlotIdxAtom`).
 * Returns NULL_HUTCH_SLICE when playerId/slot/storage isn't resolvable yet.
 */
function selectHutchSlice(snapshot: QuinoaStateSnapshot): HutchSlice {
  const playerId = getPlayerIdSync();
  if (!playerId) return NULL_HUTCH_SLICE;

  const userSlots = snapshot.child?.data?.userSlots;
  if (!Array.isArray(userSlots)) return NULL_HUTCH_SLICE;
  const myIdx = userSlots.findIndex((s) => !!s && s.playerId === playerId);
  if (myIdx < 0) return NULL_HUTCH_SLICE;
  const mySlot = userSlots[myIdx];
  if (!mySlot || typeof mySlot !== 'object') return NULL_HUTCH_SLICE;

  // Storages are nested under inventory — matches the beta atom chain
  // myItemStoragesAtom → myInventoryAtom (= myDataAtom.inventory) → .storages
  // (inventoryAtoms.ts:145-148 in gg-preview-pr-2994-app).
  const storages = mySlot.data?.inventory?.storages;
  if (!Array.isArray(storages)) return NULL_HUTCH_SLICE;

  const hutch = storages.find((s: QuinoaStorageEntry) =>
    s?.decorId === 'PetHutch' || s?.storageId === 'PetHutch' || s?.id === 'PetHutch'
  );
  if (!hutch) return NULL_HUTCH_SLICE;

  const rawCapacity = hutch.capacitySlots ?? hutch.capacityLevel;
  const capacity = typeof rawCapacity === 'number' && Number.isFinite(rawCapacity) && rawCapacity > 0
    ? rawCapacity
    : DEFAULT_HUTCH_CAPACITY;

  const rawItems = hutch.items;
  const items = Array.isArray(rawItems)
    ? rawItems.filter((i): i is QuinoaInventoryItem =>
        !!i && typeof i === 'object' && (i as QuinoaInventoryItem).itemType === 'Pet'
      )
    : [];

  return { items, capacity };
}

// State updates

function updateFromSlice(slice: HutchSlice | null): void {
  const s = slice ?? NULL_HUTCH_SLICE;

  const petIds = new Set<string>();
  for (const item of s.items) {
    if (!item) continue;
    const id = typeof item.id === 'string' ? item.id : null;
    if (id) petIds.add(id);
  }

  const count = s.items.length;
  const capacity = s.capacity;
  const capacityLevel = hutchLevelForCapacity(capacity);

  const changed = state.count !== count
    || state.capacity !== capacity
    || state.capacityLevel !== capacityLevel
    || !setsEqual(state.petIds, petIds);

  if (!changed) return;

  state = { count, capacity, capacityLevel, petIds, updatedAt: Date.now() };
  notify();

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
    publishHutchHealth();
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// Init / stop

export async function startHutchStore(): Promise<void> {
  if (storageUnsub) return;
  diag.register('Subscribing to state-tree hutch slice');

  try {
    storageUnsub = stateTreeSubscribe(
      selectHutchSlice,
      (slice) => updateFromSlice(slice),
      'store:hutch',
    );
    log('[Hutch] Store initialized (state-tree subscription)');
  } catch (err) {
    diag.warn('QPM-STORE-001', { phase: 'startHutchStore' }, err);
    throw err;
  }
}

export function stopHutchStore(): void {
  storageUnsub?.();
  storageUnsub = null;
  firstStateSeen = false;
  listeners.clear();
  state = {
    count: 0,
    capacity: DEFAULT_HUTCH_CAPACITY,
    capacityLevel: 0,
    petIds: new Set(),
    updatedAt: 0,
  };
}

// Read API (synchronous)

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

export function isHutchStoreActive(): boolean {
  return storageUnsub !== null;
}

// Subscribe API

export function onHutchChange(
  callback: (state: HutchState) => void,
  fireImmediately = false,
): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try { callback(getHutchState()); } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'onHutchChange.immediate' }, err);
    }
  }
  return () => { listeners.delete(callback); };
}
