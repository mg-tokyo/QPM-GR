// src/store/shopStock.ts
// Normalized view of shop atom data and restock timers.

import { readAtomValue as readRegistryAtomValue, subscribeAtomValue } from '../core/atomRegistry';
import { getAtomByLabel, readAtomValue as readJotaiAtomValue, subscribeAtom, getCachedStore } from '../core/jotaiBridge';
import { log } from '../utils/logger';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeShops', 'shops');
let shopFirstPublished = false;
import type {
  ShopsAtomSnapshot,
  ShopPurchasesAtomSnapshot,
} from '../types/gameAtoms';
import { type ShopCategory } from '../types/shops';
import {
  getAtomKeyForCategory,
  buildCategoryState,
  extractCustomInventories,
  extractMyDataShopPurchases,
  type CustomInventoryMap,
  type ShopStockItem,
  type ShopStockCategoryState,
  type ShopStockState,
} from './shopStockParsers';
import {
  getKnownShopIds,
  getWeatherGatedShopIds,
  onShopDiscovered,
} from './shopRegistry';
import { getPlantSpecies, getEggType, getItem, getDecor } from '../catalogs/gameCatalogs';

// Re-export types so existing importers of shopStock.ts continue to work.
export type { ShopStockItem, ShopStockCategoryState, ShopStockState } from './shopStockParsers';

const MY_USER_SLOT_ATOM_LABEL = 'myUserSlotAtom';
const MY_DATA_ATOM_LABEL = 'myDataAtom';
const QUINOA_DATA_ATOM_LABEL = 'quinoaDataAtom';

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
let quinoaDataShopsSnapshot: ShopsAtomSnapshot | null = null;
let cachedState: ShopStockState = createEmptyState();
let startPromise: Promise<void> | null = null;
let shopsUnsubscribe: (() => void) | null = null;
let myDataPurchasesUnsubscribe: (() => void) | null = null;
let customInventoriesUnsubscribe: (() => void) | null = null;
let quinoaDataShopsUnsubscribe: (() => void) | null = null;
let myDataAtomRef: unknown = null;
let myUserSlotAtomRef: unknown = null;
let quinoaDataAtomRef: unknown = null;
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

function notifyState(): void {
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

/**
 * Weather-gated shop items (Dawn, Snow) lack price fields in their raw atom data.
 * Resolve prices by detecting the underlying item type and looking up
 * the catalog price for that type (seeds, eggs, tools, decor).
 */
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

function rebuildState(): void {
  const now = Date.now();
  const categories = Object.create(null) as Record<ShopCategory, ShopStockCategoryState>;
  const effectivePurchases = getEffectivePurchasesSnapshot();
  const effectiveShops = shopsSnapshot ?? quinoaDataShopsSnapshot;
  for (const category of getKnownShopIds()) {
    const atomKey = getAtomKeyForCategory(category);
    const snapshot = effectiveShops?.[atomKey] ?? null;
    const customInventory = customInventories?.[atomKey] ?? null;
    categories[category] = buildCategoryState(category, snapshot, effectivePurchases, customInventory);
  }
  // Weather-gated shop items have no price fields in raw atom data — resolve from game catalogs.
  for (const id of getWeatherGatedShopIds()) {
    const cat = categories[id];
    if (cat) resolveWeatherShopCatalogPrices(cat.items);
  }
  cachedState = { updatedAt: now, categories };
  notifyState();
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

    myDataAtomRef = getAtomByLabel(MY_DATA_ATOM_LABEL);
    if (myDataAtomRef) {
      try {
        const myDataValue = await readJotaiAtomValue<unknown>(myDataAtomRef);
        myDataPurchasesSnapshot = extractMyDataShopPurchases(myDataValue);
      } catch (error) {
        log('⚠️ Failed to read myDataAtom shop purchases initially', error);
        myDataPurchasesSnapshot = null;
      }
    }

    rebuildState();

    try {
      shopsUnsubscribe = await subscribeAtomValue('shops', (value) => {
        shopsSnapshot = value;
        rebuildState();
      });
    } catch (error) {
      log('⚠️ Failed to subscribe to shops atom', error);
    }

    if (myDataAtomRef) {
      try {
        myDataPurchasesUnsubscribe = await subscribeAtom<unknown>(myDataAtomRef, (value) => {
          myDataPurchasesSnapshot = extractMyDataShopPurchases(value);
          rebuildState();
        });
      } catch (error) {
        log('⚠️ Failed to subscribe to myDataAtom shop purchases', error);
      }
    }

    myUserSlotAtomRef = getAtomByLabel(MY_USER_SLOT_ATOM_LABEL);
    if (myUserSlotAtomRef) {
      try {
        customInventoriesUnsubscribe = await subscribeAtom<unknown>(myUserSlotAtomRef, (value) => {
          customInventories = extractCustomInventories(value);
          rebuildState();
        });
      } catch (error) {
        log('⚠️ Failed to subscribe to myUserSlotAtom', error);
      }
    }

    // Newly-discovered shop ids get their bucket created on the next rebuild.
    discoveryUnsubscribe = onShopDiscovered(() => {
      rebuildState();
    });

    // Fallback: subscribe to quinoaDataAtom.shops for categories not covered
    // by customRestockInventories (e.g. dawn shop, which has no custom restock).
    quinoaDataAtomRef = getAtomByLabel(QUINOA_DATA_ATOM_LABEL);
    if (quinoaDataAtomRef) {
      try {
        quinoaDataShopsUnsubscribe = await subscribeAtom<unknown>(quinoaDataAtomRef, (value) => {
          const shops = (value && typeof value === 'object' && 'shops' in value)
            ? (value as Record<string, unknown>).shops as ShopsAtomSnapshot | null
            : null;
          quinoaDataShopsSnapshot = shops;
          rebuildState();
        });
      } catch (error) {
        log('⚠️ Failed to subscribe to quinoaDataAtom shops', error);
      }
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
  shopsSnapshot = null;
  myDataPurchasesSnapshot = null;
  customInventories = null;
  quinoaDataShopsSnapshot = null;
  myDataAtomRef = null;
  myUserSlotAtomRef = null;
  quinoaDataAtomRef = null;
  cachedState = createEmptyState();
  shopFirstPublished = false;
}

/**
 * Re-read shop atoms directly via store.get() and rebuild if changed.
 * Used by the background atom poller to detect changes when native
 * Jotai subscriptions don't fire (background tabs).
 */
export function forceRefreshShopStock(): void {
  const store = getCachedStore();
  if (!store || store.__polyfill) return;

  let changed = false;

  // Re-read shops atom
  try {
    const shopsAtom = getAtomByLabel('shopsAtom');
    if (shopsAtom) {
      const fresh = store.get(shopsAtom) as ShopsAtomSnapshot | null;
      if (fresh !== shopsSnapshot) {
        shopsSnapshot = fresh;
        changed = true;
      }
    }
  } catch {}

  // Re-read myDataAtom purchases
  if (myDataAtomRef) {
    try {
      const freshMyData = store.get(myDataAtomRef);
      const freshPurchases = extractMyDataShopPurchases(freshMyData);
      if (freshPurchases !== myDataPurchasesSnapshot) {
        myDataPurchasesSnapshot = freshPurchases;
        changed = true;
      }
    } catch {}
  }

  // Re-read custom inventories
  if (myUserSlotAtomRef) {
    try {
      const freshSlot = store.get(myUserSlotAtomRef);
      const freshCustom = extractCustomInventories(freshSlot);
      if (freshCustom !== customInventories) {
        customInventories = freshCustom;
        changed = true;
      }
    } catch {}
  }

  // Re-read quinoaDataAtom shops (fallback for dawn and other non-custom-restock shops)
  if (quinoaDataAtomRef) {
    try {
      const freshQD = store.get(quinoaDataAtomRef) as Record<string, unknown> | null;
      const freshShops = (freshQD && typeof freshQD === 'object' && 'shops' in freshQD)
        ? freshQD.shops as ShopsAtomSnapshot | null
        : null;
      if (freshShops !== quinoaDataShopsSnapshot) {
        quinoaDataShopsSnapshot = freshShops;
        changed = true;
      }
    } catch {}
  }

  if (changed) rebuildState();
}

export function getShopStockState(): ShopStockState {
  return cachedState;
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
      log('⚠️ ShopStock immediate listener error', error);
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
