import { subscribe as stateTreeSubscribe } from '../core/stateTree';
import { findSlotIdxByOwner, getPlayerIdSync } from '../core/playerContext';
import type { QuinoaStateSnapshot, QuinoaStorageEntry, QuinoaInventoryItem } from '../types/gameAtoms';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeToolShack', 'toolShack');
let firstStateSeen = false;

// Constants

// Live v1055 value; the shack's upgrade tiers are not in any scraped bundle, so
// capacity is read from the storage entry rather than derived from a level.
export const DEFAULT_TOOL_SHACK_CAPACITY = 25;

// Reactive state

export interface ToolShackItem {
  toolId: string;
  quantity: number;
}

export interface ToolShackState {
  items: ToolShackItem[];
  /** Unique tool types stored — the unit the shack's capacity counts. */
  count: number;
  capacity: number;
  updatedAt: number;
}

let state: ToolShackState = {
  items: [],
  count: 0,
  capacity: DEFAULT_TOOL_SHACK_CAPACITY,
  updatedAt: 0,
};

let storageUnsub: (() => void) | null = null;
const listeners = new Set<(state: ToolShackState) => void>();

function notifyListeners(): void {
  const snapshot = getToolShackState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'notify' }, err);
    }
  }
}

function healthMetrics(): Record<string, number> {
  return {
    count: state.count,
    capacity: state.capacity,
    full: state.count >= state.capacity ? 1 : 0,
  };
}

// State-tree selector

interface ToolShackSlice {
  items: ToolShackItem[];
  capacity: number;
}

const NULL_SLICE: ToolShackSlice = { items: [], capacity: DEFAULT_TOOL_SHACK_CAPACITY };

function toToolShackItem(raw: QuinoaInventoryItem): ToolShackItem | null {
  const toolId = raw.toolId ?? (typeof raw.itemId === 'string' ? raw.itemId : undefined) ?? raw.id;
  if (typeof toolId !== 'string' || !toolId.trim()) return null;
  const rawQty = raw.quantity;
  // Charged crystals carry no quantity (only remainingActiveSeconds) — they occupy one slot.
  const quantity = typeof rawQty === 'number' && Number.isFinite(rawQty) ? Math.max(1, Math.floor(rawQty)) : 1;
  return { toolId: toolId.trim(), quantity };
}

function selectToolShackSlice(snapshot: QuinoaStateSnapshot): ToolShackSlice {
  const playerId = getPlayerIdSync();
  if (!playerId) return NULL_SLICE;

  const userSlots = snapshot.child?.data?.userSlots;
  if (!Array.isArray(userSlots)) return NULL_SLICE;
  const myIdx = findSlotIdxByOwner(userSlots, playerId);
  if (myIdx < 0) return NULL_SLICE;
  const mySlot = userSlots[myIdx];
  if (!mySlot || typeof mySlot !== 'object') return NULL_SLICE;

  const storages = mySlot.data?.inventory?.storages;
  if (!Array.isArray(storages)) return NULL_SLICE;

  const shack = storages.find((s: QuinoaStorageEntry) =>
    s?.decorId === 'ToolShack' || s?.storageId === 'ToolShack' || s?.id === 'ToolShack'
  );
  if (!shack) return NULL_SLICE;

  const rawCapacity = shack.capacitySlots ?? shack.capacityLevel;
  const capacity = typeof rawCapacity === 'number' && Number.isFinite(rawCapacity) && rawCapacity > 0
    ? rawCapacity
    : DEFAULT_TOOL_SHACK_CAPACITY;

  const rawItems = shack.items;
  const items: ToolShackItem[] = [];
  if (Array.isArray(rawItems)) {
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const item = toToolShackItem(raw);
      if (item) items.push(item);
    }
  }

  return { items, capacity };
}

// State updates

function itemsSignature(items: ToolShackItem[]): string {
  return items.map((i) => `${i.toolId}:${i.quantity}`).join('|');
}

function updateFromSlice(slice: ToolShackSlice | null): void {
  const s = slice ?? NULL_SLICE;
  const count = s.items.length;
  const capacity = s.capacity;

  const changed = state.count !== count
    || state.capacity !== capacity
    || itemsSignature(state.items) !== itemsSignature(s.items);

  if (!changed) return;

  state = { items: s.items.map((i) => ({ ...i })), count, capacity, updatedAt: Date.now() };
  notifyListeners();

  const message = `count=${state.count}/${state.capacity}`;
  if (!firstStateSeen) {
    firstStateSeen = true;
    diag.publishOk(message, healthMetrics());
  } else {
    diag.publishMetrics(message, healthMetrics());
  }
}

// Init / stop

export async function startToolShackStore(): Promise<void> {
  if (storageUnsub) return;
  diag.register('Subscribing to state-tree shack slice');

  try {
    storageUnsub = stateTreeSubscribe(
      selectToolShackSlice,
      (slice) => updateFromSlice(slice),
      'store:toolShack',
    );
    diag.log.debug('store initialized (state-tree subscription)');
  } catch (err) {
    diag.warn('QPM-STORE-001', { phase: 'startToolShackStore' }, err);
    throw err;
  }
}

export function stopToolShackStore(): void {
  storageUnsub?.();
  storageUnsub = null;
  firstStateSeen = false;
  listeners.clear();
  state = {
    items: [],
    count: 0,
    capacity: DEFAULT_TOOL_SHACK_CAPACITY,
    updatedAt: 0,
  };
}

// Read API (synchronous)

export function getToolShackState(): ToolShackState {
  return { ...state, items: state.items.map((i) => ({ ...i })) };
}

export function getToolShackItems(): ToolShackItem[] {
  return state.items.map((i) => ({ ...i }));
}

export function getToolShackCount(): number {
  return state.count;
}

export function getToolShackCapacity(): number {
  return state.capacity;
}

export function getToolShackQuantity(toolId: string): number {
  let total = 0;
  for (const item of state.items) {
    if (item.toolId === toolId) total += item.quantity;
  }
  return total;
}

export function hasToolShackItem(toolId: string): boolean {
  return state.items.some((item) => item.toolId === toolId);
}

export function isToolShackFull(): boolean {
  return state.count >= state.capacity;
}

export function isToolShackStoreActive(): boolean {
  return storageUnsub !== null;
}

// Subscribe API

export function onToolShackChange(
  callback: (state: ToolShackState) => void,
  fireImmediately = false,
): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try { callback(getToolShackState()); } catch (err) {
      diag.warn('QPM-STORE-003', { phase: 'onToolShackChange.immediate' }, err);
    }
  }
  return () => { listeners.delete(callback); };
}
