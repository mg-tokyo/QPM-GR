// Normalized view of shop atom data and restock timers.

import { readAtomValue as readRegistryAtomValue, readAtomValueSync, subscribeAtomValue } from '../core/atomRegistry';
// Polyfill early-return needs the raw store handle to detect the __polyfill
// flag — no registry equivalent for that check (D1 Step 3 handoff).
// eslint-disable-next-line no-restricted-imports -- polyfill flag detection
import { getCachedStore } from '../core/jotaiBridge';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeShops', 'shops');
let shopFirstPublished = false;
import type {
  ShopsAtomSnapshot,
  ShopPurchaseBucket,
  ShopPurchasesAtomSnapshot,
} from '../types/gameAtoms';
import { type ShopCategory } from '../types/shops';
import {
  getAtomKeyForCategory,
  buildCategoryState,
  extractCustomInventories,
  extractMyDataShopPurchases,
  readRestockTiming,
  type CustomInventoryMap,
  type ShopStockItem,
  type ShopStockCategoryState,
  type ShopStockState,
} from './shopStockParsers';
import { extractMyDataCustomRestocks, isPastDeadline, resolveStockSnapshot, type CustomRestockMap } from './shopPurchaseCycle';
import { getServerNowMs } from './serverClock';
import { indexItemsByKey, notifyItemListeners, resetShopStockItemIndex } from './shopStockItemIndex';
import {
  getKnownShopIds,
  getWeatherGatedShopIds,
  onShopDiscovered,
} from './shopRegistry';
import { getPlantSpecies, getEggType, getItem, getDecor } from '../catalogs/gameCatalogs';
import { deepEqual } from '../utils/deepEqual';

// Re-export types so existing importers of shopStock.ts continue to work.
export type { ShopStockItem, ShopStockCategoryState, ShopStockState } from './shopStockParsers';
export { getShopStockItemByKey, onShopStockItemChange } from './shopStockItemIndex';

function itemTypeLabel(category: string): string {
  switch (category) {
    case 'seeds': return 'Seed';
    case 'eggs': return 'Egg';
    case 'tools': return 'Tool';
    case 'decor': return 'Decor';
    default: return category.charAt(0).toUpperCase() + category.slice(1);
  }
}

const listeners = new Set<(state: ShopStockState) => void>();
let shopsSnapshot: ShopsAtomSnapshot | null = null;
let myDataPurchasesSnapshot: ShopPurchasesAtomSnapshot | null = null;
let customInventories: CustomInventoryMap = null;
let customRestocks: CustomRestockMap = null;
let quinoaDataShopsSnapshot: ShopsAtomSnapshot | null = null;
let cachedState: ShopStockState = createEmptyState();
let lastNotifySignature: string | null = null;
let startPromise: Promise<void> | null = null;
let shopsUnsubscribe: (() => void) | null = null;
let myDataPurchasesUnsubscribe: (() => void) | null = null;
let customInventoriesUnsubscribe: (() => void) | null = null;
let quinoaDataShopsUnsubscribe: (() => void) | null = null;
let discoveryUnsubscribe: (() => void) | null = null;

function createEmptyState(): ShopStockState {
  const categories = Object.create(null) as Record<ShopCategory, ShopStockCategoryState>;
  const now = Date.now();
  for (const category of getKnownShopIds()) {
    categories[category] = {
      category,
      secondsUntilRestock: null,
      nextRestockAt: null,
      restockIntervalMs: null,
      items: [],
      availableCount: 0,
      signature: '',
      updatedAt: now,
      raw: null,
    };
  }
  return { updatedAt: now, categories };
}

function buildStateSignature(state: ShopStockState): string {
  // Per-category composite of the already-computed per-item sig plus the
  // restock cycle fields subscribers key on. Skips `updatedAt` and the
  // per-second `secondsUntilRestock` countdown: the server patches that every
  // frame, and waking every listener for it was the top state-tree cost in the
  // Firefox field report. `getShopStockState()` still carries the live value.
  let sig = '';
  for (const category of getKnownShopIds()) {
    const cat = state.categories[category];
    if (!cat) {
      sig += `${category}|_\n`;
      continue;
    }
    sig += `${category}|${cat.signature}|${cat.availableCount}|${cat.nextRestockAt ?? ''}|${cat.restockIntervalMs ?? ''}\n`;
  }
  return sig;
}

function notifyState(): void {
  const signature = buildStateSignature(cachedState);
  if (signature === lastNotifySignature) return;
  lastNotifySignature = signature;

  for (const listener of listeners) {
    try {
      listener(cachedState);
    } catch (error) {
      diag.warn('QPM-STORE-003', { phase: 'notifyState' }, error);
    }
  }
  if (!shopFirstPublished) {
    shopFirstPublished = true;
    const totalItems = Object.values(cachedState.categories).reduce(
      (sum, cat) => sum + (cat?.items?.length ?? 0),
      0,
    );
    diag.publishOk(
      `${totalItems} item(s) across ${Object.keys(cachedState.categories).length} shop(s)`,
      { totalItems, categoryCount: Object.keys(cachedState.categories).length },
    );
  }
}

function getEffectivePurchasesSnapshot(): ShopPurchasesAtomSnapshot | null {
  return myDataPurchasesSnapshot;
}

/** Weather-gated shop items lack price fields in raw atom data — resolve via catalog lookup by item type. */
function resolveWeatherShopCatalogPrices(items: ShopStockItem[]): void {
  for (const item of items) {
    if (item.priceCoins != null) continue;
    const raw = item.raw as Record<string, unknown> | null;
    if (!raw) continue;

    let price: number | null = null;
    if (raw.species != null) {
      price = getPlantSpecies(String(raw.species))?.seed?.coinPrice ?? null;
    } else if (raw.eggId != null) {
      price = getEggType(String(raw.eggId))?.coinPrice ?? null;
    } else if (raw.toolId != null) {
      price = getItem(String(raw.toolId))?.coinPrice ?? null;
    } else if (raw.decorId != null) {
      price = getDecor(String(raw.decorId))?.coinPrice ?? null;
    }

    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      item.priceCoins = price;
    }
  }
}

// Every server frame patches `shops/<id>/secondsUntilRestock` (five shops, once
// a second), and the tree is cloned per frame, so identity never short-circuits.
// Re-parsing ten categories with catalog lookups for a countdown tick was the
// costliest consumer in the Firefox field report; reuse the parsed items while
// the inventory, purchases and custom inventory are content-equal.
interface CategoryMemo {
  inventory: unknown;
  customInventory: unknown;
  customRestock: unknown;
  // A restock can repeat the same inventory; purchases only count within one cycle.
  // Undefined (legacy shape, counts) and null (no stock) must stay distinct.
  restockId: unknown;
  // Past `deadlineMs` with no roll yet: nothing in the inputs changes at a deadline, only this.
  gated: boolean;
  state: ShopStockCategoryState;
}
const categoryMemo = new Map<ShopCategory, CategoryMemo>();
let memoPurchases: ShopPurchasesAtomSnapshot | null = null;

const DEADLINE_MARGIN_MS = 50;
let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
let deadlineTimerTarget: string | null = null;

function clearDeadlineTimer(): void {
  if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  deadlineTimer = null;
  deadlineTimerTarget = null;
}

// No patch arrives at a deadline (`shops` changes only at rolls and purchases), so one one-shot
// at the nearest future deadline re-runs the gate. Only future deadlines arm (delay ≥ margin, no
// tight loop); a gated shop waiting for a late roll arms nothing, the roll's own patch rebuilds.
function armDeadlineTimer(deadlineMs: number | null, serverNowMs: number | null): void {
  const target = deadlineMs === null ? null : `${deadlineMs}:${serverNowMs !== null}`;
  if (target === deadlineTimerTarget) return;
  clearDeadlineTimer();
  if (deadlineMs === null) return;
  deadlineTimerTarget = target;
  deadlineTimer = setTimeout(() => {
    deadlineTimer = null;
    deadlineTimerTarget = null;
    rebuildState();
  }, deadlineMs - (serverNowMs ?? Date.now()) + DEADLINE_MARGIN_MS);
}

function rebuildState(): void {
  const now = Date.now();
  const serverNowMs = getServerNowMs();
  const clockNow = serverNowMs ?? now;
  let nearestDeadline: number | null = null;
  const categories = Object.create(null) as Record<ShopCategory, ShopStockCategoryState>;
  const effectivePurchases = getEffectivePurchasesSnapshot();
  const effectiveShops = shopsSnapshot ?? quinoaDataShopsSnapshot;
  const purchasesSame = deepEqual(effectivePurchases, memoPurchases);
  if (!purchasesSame) memoPurchases = effectivePurchases;
  const weatherGated = new Set<ShopCategory>(getWeatherGatedShopIds());
  for (const category of getKnownShopIds()) {
    const atomKey = getAtomKeyForCategory(category);
    const snapshot = effectiveShops?.[atomKey] ?? null;
    const customInventory = customInventories?.[atomKey] ?? null;
    const customRestock = customRestocks?.[atomKey] ?? null;
    const inventory = snapshot?.inventory ?? null;
    const restockId = snapshot?.restockId;
    const selling = resolveStockSnapshot(atomKey, snapshot, customRestock, customInventory);
    const gated = isPastDeadline(selling, serverNowMs);
    const deadline = selling?.deadlineMs;
    if (typeof deadline === 'number' && Number.isFinite(deadline) && deadline > clockNow && (nearestDeadline === null || deadline < nearestDeadline)) {
      nearestDeadline = deadline;
    }
    const memo = categoryMemo.get(category);
    if (memo && purchasesSame && restockId === memo.restockId && gated === memo.gated && deepEqual(inventory, memo.inventory) && deepEqual(customInventory, memo.customInventory) && deepEqual(customRestock, memo.customRestock)) {
      const prev = memo.state;
      const state: ShopStockCategoryState = {
        ...prev,
        ...readRestockTiming(snapshot),
        updatedAt: now,
        raw: snapshot ?? null,
      };
      categories[category] = state;
      memo.state = state;
      continue;
    }
    const built = buildCategoryState(category, snapshot, effectivePurchases, customInventory, customRestock, serverNowMs);
    // Weather-gated shop items have no price fields in raw atom data — resolve from game catalogs.
    if (weatherGated.has(category)) resolveWeatherShopCatalogPrices(built.items);
    categories[category] = built;
    categoryMemo.set(category, { inventory, customInventory, customRestock, restockId, gated, state: built });
  }
  cachedState = { updatedAt: now, categories };
  // Index before notifyState (alerts created there baseline from getShopStockItemByKey,
  // which held the previous cycle's item); per-key listeners still fire after it.
  const fingerprints = indexItemsByKey(cachedState);
  notifyState();
  notifyItemListeners(fingerprints);
  armDeadlineTimer(nearestDeadline, serverNowMs);
}

export async function startShopStockStore(): Promise<void> {
  if (startPromise) {
    return startPromise;
  }
  diag.register('Resolving shop atoms');
  startPromise = (async () => {
    try {
      shopsSnapshot = await readRegistryAtomValue('shops');
    } catch (error) {
      diag.warn('QPM-STORE-002', { atom: 'shops', phase: 'initial-read' }, error);
      shopsSnapshot = null;
    }

    try {
      const myData = await readRegistryAtomValue('myData');
      myDataPurchasesSnapshot = extractMyDataShopPurchases(myData);
      customRestocks = extractMyDataCustomRestocks(myData);
    } catch (error) {
      diag.warn('QPM-STORE-002', { atom: 'myData', phase: 'initial-shop-purchases' }, error);
      myDataPurchasesSnapshot = null;
    }

    rebuildState();

    try {
      shopsUnsubscribe = await subscribeAtomValue('shops', (value) => {
        shopsSnapshot = value;
        rebuildState();
      });
    } catch (error) {
      diag.warn('QPM-STORE-002', { atom: 'shops', phase: 'subscribe' }, error);
    }

    try {
      const unsub = await subscribeAtomValue('myData', (value) => {
        myDataPurchasesSnapshot = extractMyDataShopPurchases(value);
        customRestocks = extractMyDataCustomRestocks(value);
        rebuildState();
      });
      if (unsub) myDataPurchasesUnsubscribe = unsub;
    } catch (error) {
      diag.warn('QPM-STORE-002', { atom: 'myData', phase: 'subscribe-shop-purchases' }, error);
    }

    try {
      const unsub = await subscribeAtomValue('myUserSlot', (value) => {
        customInventories = extractCustomInventories(value);
        rebuildState();
      });
      if (unsub) customInventoriesUnsubscribe = unsub;
    } catch (error) {
      diag.warn('QPM-STORE-002', { atom: 'myUserSlot', phase: 'subscribe' }, error);
    }

    // Newly-discovered shop ids get their bucket created on the next rebuild.
    discoveryUnsubscribe = onShopDiscovered(() => {
      rebuildState();
    });

    // Fallback: subscribe to quinoaData.shops for categories with no customRestockInventories (e.g. dawn shop).
    try {
      const unsub = await subscribeAtomValue('quinoaData', (value) => {
        const next = value?.shops ?? null;
        if (next === quinoaDataShopsSnapshot) return;
        quinoaDataShopsSnapshot = next;
        // `shops` (own subscription) already rebuilds for the same frame; only
        // rebuild here when the shops atom is unavailable and this is the source.
        if (shopsSnapshot === null) rebuildState();
      });
      if (unsub) quinoaDataShopsUnsubscribe = unsub;
    } catch (error) {
      diag.warn('QPM-STORE-002', { atom: 'quinoaData', phase: 'subscribe' }, error);
    }
  })().catch((error) => {
    diag.warn('QPM-STORE-001', { phase: 'startShopStockStore' }, error);
    startPromise = null;
  });
  return startPromise;
}

export function stopShopStockStore(): void {
  try {
    shopsUnsubscribe?.();
  } catch {}
  try {
    myDataPurchasesUnsubscribe?.();
  } catch {}
  try {
    customInventoriesUnsubscribe?.();
  } catch {}
  try {
    quinoaDataShopsUnsubscribe?.();
  } catch {}
  try {
    discoveryUnsubscribe?.();
  } catch {}
  shopsUnsubscribe = null;
  myDataPurchasesUnsubscribe = null;
  customInventoriesUnsubscribe = null;
  quinoaDataShopsUnsubscribe = null;
  discoveryUnsubscribe = null;
  startPromise = null;
  clearDeadlineTimer();
  categoryMemo.clear();
  memoPurchases = null;
  shopsSnapshot = null;
  myDataPurchasesSnapshot = null;
  customInventories = null;
  customRestocks = null;
  quinoaDataShopsSnapshot = null;
  cachedState = createEmptyState();
  shopFirstPublished = false;
  lastNotifySignature = null;
  resetShopStockItemIndex();
}

/** Re-read shop atoms via the registry and rebuild if changed — used by the background atom poller when subscriptions don't fire (background tabs). */
export function forceRefreshShopStock(): void {
  const store = getCachedStore();
  // Polyfill store IS the state-tree read; nothing separate to force-refresh.
  if (!store || store.__polyfill) return;

  let changed = false;

  try {
    const fresh = readAtomValueSync('shops');
    if (fresh !== shopsSnapshot) {
      shopsSnapshot = fresh;
      changed = true;
    }
  } catch {}

  try {
    const freshMyData = readAtomValueSync('myData');
    const freshPurchases = extractMyDataShopPurchases(freshMyData);
    if (freshPurchases !== myDataPurchasesSnapshot) {
      myDataPurchasesSnapshot = freshPurchases;
      changed = true;
    }
    const freshRestocks = extractMyDataCustomRestocks(freshMyData);
    if (!deepEqual(freshRestocks, customRestocks)) {
      customRestocks = freshRestocks;
      changed = true;
    }
  } catch {}

  try {
    const freshCustom = extractCustomInventories(readAtomValueSync('myUserSlot'));
    if (freshCustom !== customInventories) {
      customInventories = freshCustom;
      changed = true;
    }
  } catch {}

  try {
    const freshQD = readAtomValueSync('quinoaData');
    const freshShops = freshQD?.shops ?? null;
    if (freshShops !== quinoaDataShopsSnapshot) {
      quinoaDataShopsSnapshot = freshShops;
      changed = true;
    }
  } catch {}

  if (changed) rebuildState();
}

export function getShopStockState(): ShopStockState {
  return cachedState;
}

export function getPurchaseBucket(category: ShopCategory): ShopPurchaseBucket | null {
  return myDataPurchasesSnapshot?.[getAtomKeyForCategory(category)] ?? null;
}

export function isCategoryGated(category: ShopCategory): boolean {
  return categoryMemo.get(category)?.gated ?? false;
}

export function onShopStock(
  callback: (state: ShopStockState) => void,
  fireImmediately = true,
): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try {
      callback(cachedState);
    } catch (error) {
      diag.warn('QPM-STORE-003', { phase: 'onShopStock.immediate' }, error);
    }
  }
  return () => {
    listeners.delete(callback);
  };
}

export function getAvailableItems(category: ShopCategory): ShopStockItem[] {
  const state = cachedState.categories[category];
  return state ? state.items.filter((item) => item.isAvailable) : [];
}

export function describeItemForLog(item: ShopStockItem): string {
  const pieces = [itemTypeLabel(item.category), item.label];
  if (item.remaining != null) {
    if (item.initialStock != null) {
      pieces.push(`${item.remaining}/${item.initialStock}`);
    } else {
      pieces.push(`${item.remaining} left`);
    }
  } else if (item.currentStock != null) {
    pieces.push(`${item.currentStock} stock`);
  }
  if (item.priceCoins != null) {
    pieces.push(`${item.priceCoins}c`);
  }
  if (item.priceCredits != null) {
    pieces.push(`${item.priceCredits}★`);
  }
  return pieces.join(' • ');
}
