import { createStoreDiagnostics } from './_storeDiagnostics';
import { getAtomKeyForCategory, type ShopStockItem, type ShopStockCategoryState, type ShopStockState } from './shopStockParsers';
import { canonicalItemId } from '../utils/restock/dataService';

const diag = createStoreDiagnostics('storeShops', 'shops');

const itemsByKey = new Map<string, ShopStockItem>();
const keyChangeListeners = new Map<string, Set<(item: ShopStockItem | null) => void>>();
const lastItemFingerprintByKey = new Map<string, string>();

function fingerprintItemForCycle(item: ShopStockItem, bucket: ShopStockCategoryState | undefined): string {
  const nr = bucket?.nextRestockAt ?? '';
  const init = item.initialStock ?? '';
  const cur = item.currentStock ?? '';
  const rem = item.remaining ?? '';
  const pur = item.purchased;
  const spawn = item.canSpawn ? '1' : '0';
  return `${nr}|${init}|${cur}|${rem}|${pur}|${spawn}`;
}

export function indexItemsByKey(state: ShopStockState): Map<string, string> {
  const nextFingerprints = new Map<string, string>();
  itemsByKey.clear();
  for (const [category, bucket] of Object.entries(state.categories)) {
    if (!bucket || !Array.isArray(bucket.items)) continue;
    const shopType = getAtomKeyForCategory(category);
    for (const item of bucket.items) {
      const key = `${shopType}:${canonicalItemId(shopType, item.id).trim().toLowerCase()}`;
      itemsByKey.set(key, item);
      nextFingerprints.set(key, fingerprintItemForCycle(item, bucket));
    }
  }
  return nextFingerprints;
}

export function notifyItemListeners(nextFingerprints: Map<string, string>): void {
  for (const [key, subs] of keyChangeListeners) {
    if (subs.size === 0) continue;
    const nextItem = itemsByKey.get(key) ?? null;
    const nextFp = nextFingerprints.get(key) ?? null;
    const prevFp = lastItemFingerprintByKey.get(key) ?? null;
    if (nextFp === prevFp) continue;
    for (const cb of Array.from(subs)) {
      try { cb(nextItem); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'keyChangeListener' }, error); }
    }
  }
  lastItemFingerprintByKey.clear();
  for (const [k, v] of nextFingerprints) lastItemFingerprintByKey.set(k, v);
}

export function resetShopStockItemIndex(): void {
  itemsByKey.clear();
  keyChangeListeners.clear();
  lastItemFingerprintByKey.clear();
}

/** O(1) lookup by canonical `${shopType}:${itemId.toLowerCase()}` key. Null when the item isn't in any category. */
export function getShopStockItemByKey(canonicalKey: string): ShopStockItem | null {
  return itemsByKey.get(canonicalKey) ?? null;
}

/**
 * Fires when the item at `canonicalKey` transitions in ways that matter for
 * cycle rollover / stale-purchase detection (nextRestockAt, initialStock,
 * currentStock, remaining, purchased, canSpawn). Fires with null if the item
 * is no longer in any category. Reactive; driven off the shop atom fanout.
 */
export function onShopStockItemChange(
  canonicalKey: string,
  cb: (item: ShopStockItem | null) => void,
): () => void {
  let subs = keyChangeListeners.get(canonicalKey);
  if (!subs) {
    subs = new Set();
    keyChangeListeners.set(canonicalKey, subs);
  }
  subs.add(cb);
  return () => {
    const set = keyChangeListeners.get(canonicalKey);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) keyChangeListeners.delete(canonicalKey);
  };
}
