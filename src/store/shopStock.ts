// src/store/shopStock.ts
// Normalized view of shop atom data and restock timers.

import { readAtomValue as readRegistryAtomValue, subscribeAtomValue } from '../core/atomRegistry';
import { getAtomByLabel, readAtomValue as readJotaiAtomValue, subscribeAtom, getCachedStore } from '../core/jotaiBridge';
import { log } from '../utils/logger';
import type {
  ShopsAtomSnapshot,
  ShopPurchasesAtomSnapshot,
} from '../types/gameAtoms';
import { SHOP_CATEGORIES, type ShopCategory } from '../types/shops';
import {
  ATOM_KEY_BY_CATEGORY,
  SHOP_PURCHASE_KEYS,
  buildCategoryState,
  extractCustomInventories,
  extractMyDataShopPurchases,
  hasPurchaseBucket,
  type CustomInventoryMap,
  type ShopPurchaseKey,
  type ShopStockItem,
  type ShopStockCategoryState,
  type ShopStockState,
} from './shopStockParsers';
import { getPlantSpecies, getEggType, getItem, getDecor } from '../catalogs/gameCatalogs';

// Re-export types so existing importers of shopStock.ts continue to work.
export type { ShopStockItem, ShopStockCategoryState, ShopStockState } from './shopStockParsers';

const MY_USER_SLOT_ATOM_LABEL = 'myUserSlotAtom';
const MY_DATA_ATOM_LABEL = 'myDataAtom';
const QUINOA_DATA_ATOM_LABEL = 'quinoaDataAtom';

const ITEM_TYPE_BY_CATEGORY: Record<ShopCategory, 'Seed' | 'Egg' | 'Tool' | 'Decor' | 'Dawn' | 'Snow'> = {
  seeds: 'Seed',
  eggs: 'Egg',
  tools: 'Tool',
  decor: 'Decor',
  dawn: 'Dawn',
  snow: 'Snow',
};

const listeners = new Set<(state: ShopStockState) => void>();
let shopsSnapshot: ShopsAtomSnapshot | null = null;
let purchasesSnapshot: ShopPurchasesAtomSnapshot | null = null;
let myDataPurchasesSnapshot: ShopPurchasesAtomSnapshot | null = null;
let customInventories: CustomInventoryMap = null;
let quinoaDataShopsSnapshot: ShopsAtomSnapshot | null = null;
let cachedState: ShopStockState = createEmptyState();
let startPromise: Promise<void> | null = null;
let shopsUnsubscribe: (() => void) | null = null;
let purchasesUnsubscribe: (() => void) | null = null;
let myDataPurchasesUnsubscribe: (() => void) | null = null;
let customInventoriesUnsubscribe: (() => void) | null = null;
let quinoaDataShopsUnsubscribe: (() => void) | null = null;
let myDataAtomRef: unknown = null;
let myUserSlotAtomRef: unknown = null;
let quinoaDataAtomRef: unknown = null;

function createEmptyState(): ShopStockState {
  const categories = Object.create(null) as Record<ShopCategory, ShopStockCategoryState>;
  const now = Date.now();
  for (const category of SHOP_CATEGORIES) {
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
      log('⚠️ ShopStock listener error', error);
    }
  }
}

function getEffectivePurchasesSnapshot(): ShopPurchasesAtomSnapshot | null {
  if (!purchasesSnapshot && !myDataPurchasesSnapshot) {
    return null;
  }

  const merged: ShopPurchasesAtomSnapshot = {};
  let hasAny = false;
  for (const key of SHOP_PURCHASE_KEYS) {
    const typedKey = key as ShopPurchaseKey;
    const primaryHas = hasPurchaseBucket(purchasesSnapshot, typedKey);
    const fallbackHas = hasPurchaseBucket(myDataPurchasesSnapshot, typedKey);
    if (primaryHas && purchasesSnapshot) {
      merged[key] = purchasesSnapshot[key] ?? null;
      hasAny = true;
      continue;
    }
    if (fallbackHas && myDataPurchasesSnapshot) {
      merged[key] = myDataPurchasesSnapshot[key] ?? null;
      hasAny = true;
      continue;
    }
    merged[key] = null;
  }
  return hasAny ? merged : null;
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
  for (const category of SHOP_CATEGORIES) {
    const atomKey = ATOM_KEY_BY_CATEGORY[category];
    const snapshot = effectiveShops?.[atomKey] ?? null;
    const customInventory = customInventories?.[atomKey] ?? null;
    categories[category] = buildCategoryState(category, snapshot, effectivePurchases, customInventory);
  }
  // Weather-gated shop items have no price fields in raw atom data — resolve from game catalogs.
  resolveWeatherShopCatalogPrices(categories.dawn.items);
  resolveWeatherShopCatalogPrices(categories.snow.items);
  cachedState = { updatedAt: now, categories };
  notifyState();
}

export async function startShopStockStore(): Promise<void> {
  if (startPromise) {
    return startPromise;
  }
  startPromise = (async () => {
    try {
      shopsSnapshot = await readRegistryAtomValue('shops');
    } catch (error) {
      log('⚠️ Failed to read shops atom initially', error);
      shopsSnapshot = null;
    }

    try {
      purchasesSnapshot = await readRegistryAtomValue('shopPurchases');
    } catch (error) {
      log('⚠️ Failed to read shop purchases atom initially', error);
      purchasesSnapshot = null;
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

    try {
      purchasesUnsubscribe = await subscribeAtomValue('shopPurchases', (value) => {
        purchasesSnapshot = value;
        rebuildState();
      });
    } catch (error) {
      log('⚠️ Failed to subscribe to shop purchases atom', error);
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
    log('⚠️ startShopStockStore error', error);
    startPromise = null;
  });
  return startPromise;
}

export function stopShopStockStore(): void {
  try {
    shopsUnsubscribe?.();
  } catch {}
  try {
    purchasesUnsubscribe?.();
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
  shopsUnsubscribe = null;
  purchasesUnsubscribe = null;
  myDataPurchasesUnsubscribe = null;
  customInventoriesUnsubscribe = null;
  quinoaDataShopsUnsubscribe = null;
  startPromise = null;
  shopsSnapshot = null;
  purchasesSnapshot = null;
  myDataPurchasesSnapshot = null;
  customInventories = null;
  quinoaDataShopsSnapshot = null;
  myDataAtomRef = null;
  myUserSlotAtomRef = null;
  quinoaDataAtomRef = null;
  cachedState = createEmptyState();
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

  // Re-read purchases atom
  try {
    const purchasesAtom = getAtomByLabel('myShopPurchasesAtom');
    if (purchasesAtom) {
      const fresh = store.get(purchasesAtom) as ShopPurchasesAtomSnapshot | null;
      if (fresh !== purchasesSnapshot) {
        purchasesSnapshot = fresh;
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
  const pieces = [ITEM_TYPE_BY_CATEGORY[item.category], item.label];
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
