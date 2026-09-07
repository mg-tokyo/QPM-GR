import { subscribeAtomValue } from '../core/atomRegistry';
import type { QuinoaInventoryItem } from '../types/gameAtoms';
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

let latestItems: ToolShackItem[] = [];
let latestCapacity: number = DEFAULT_TOOL_SHACK_CAPACITY;
let itemsUnsub: (() => void) | null = null;
let capacityUnsub: (() => void) | null = null;
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

// Item normalisation

function toToolShackItem(raw: QuinoaInventoryItem): ToolShackItem | null {
  const toolId = raw.toolId ?? (typeof raw.itemId === 'string' ? raw.itemId : undefined) ?? raw.id;
  if (typeof toolId !== 'string' || !toolId.trim()) return null;
  const rawQty = raw.quantity;
  // Charged crystals carry no quantity (only remainingActiveSeconds) — they occupy one slot.
  const quantity = typeof rawQty === 'number' && Number.isFinite(rawQty) ? Math.max(1, Math.floor(rawQty)) : 1;
  return { toolId: toolId.trim(), quantity };
}

function mapItems(raw: QuinoaInventoryItem[] | null): ToolShackItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolShackItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = toToolShackItem(entry);
    if (item) out.push(item);
  }
  return out;
}

// State updates

function itemsSignature(items: ToolShackItem[]): string {
  return items.map((i) => `${i.toolId}:${i.quantity}`).join('|');
}

function applyLatestState(): void {
  const count = latestItems.length;
  const capacity = latestCapacity;

  const changed = state.count !== count
    || state.capacity !== capacity
    || itemsSignature(state.items) !== itemsSignature(latestItems);

  if (!changed) return;

  state = { items: latestItems.map((i) => ({ ...i })), count, capacity, updatedAt: Date.now() };
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
  if (itemsUnsub || capacityUnsub) return;
  diag.register('Subscribing to toolShack registry keys');

  try {
    itemsUnsub = await subscribeAtomValue('toolShackItems', (raw) => {
      latestItems = mapItems(raw);
      applyLatestState();
    });
    capacityUnsub = await subscribeAtomValue('toolShackCapacity', (raw) => {
      latestCapacity = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TOOL_SHACK_CAPACITY;
      applyLatestState();
    });
    diag.log.debug('store initialized (registry subscriptions)');
  } catch (err) {
    diag.warn('QPM-STORE-001', { phase: 'startToolShackStore' }, err);
    throw err;
  }
}

export function stopToolShackStore(): void {
  itemsUnsub?.();
  capacityUnsub?.();
  itemsUnsub = null;
  capacityUnsub = null;
  firstStateSeen = false;
  listeners.clear();
  latestItems = [];
  latestCapacity = DEFAULT_TOOL_SHACK_CAPACITY;
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
  return itemsUnsub !== null || capacityUnsub !== null;
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
