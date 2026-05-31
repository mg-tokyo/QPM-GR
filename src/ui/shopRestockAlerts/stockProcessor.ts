// src/ui/shopRestockAlerts/stockProcessor.ts
// Stock-change processing: tracked set, dismiss cycle management, and processShopStock.

import { storage } from '../../utils/storage';
import { canonicalItemId, getItemIdVariants } from '../../utils/restockDataService';
import type { ShopStockCategoryState, ShopStockItem, ShopStockState } from '../../store/shopStock';
import type { ShopCategory } from '../../types/shops';
import {
  TRACKED_KEY,
  type RestockShopType,
} from './types';
import {
  dismissedCyclesByKey,
  dismissedInStockKeys,
  activeAlerts,
  pendingOwnershipConfirmations,
  debugLastStockStateByKey,
  fallbackCycleByKey,
  lastSeenStockQtyByKey,
} from './alertState';
import {
  asNonNegativeQuantity,
  toCanonicalKey,
  firstString,
  debugLog,
  debugLogStockStateIfChanged,
} from './ownershipTracker';
import {
  applyInventoryCapToQuantity,
  getToolInventoryLimitFromKey,
  getOwnedToolCount,
} from './purchaseActions';
import { removeAlert, upsertAlert, updateAlertQuantity } from './alertDom';

// ---------------------------------------------------------------------------
// Dismiss cycle management (in-memory only)
// ---------------------------------------------------------------------------

export function loadDismissedCycles(): void {
  dismissedCyclesByKey.clear();
}

function saveDismissedCycles(): void {
  // Dismissals are in-memory only; persistence caused stale suppression across refreshes.
}

export function markDismissedCycle(key: string, cycleId: string | null): void {
  if (!cycleId) return;
  const normalized = key.trim().toLowerCase();
  if (!normalized) return;
  if (dismissedCyclesByKey.get(normalized) === cycleId) return;
  dismissedCyclesByKey.set(normalized, cycleId);
  saveDismissedCycles();
}

export function clearDismissedCycle(key: string): void {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return;
  if (!dismissedCyclesByKey.delete(normalized)) return;
  saveDismissedCycles();
}

export function isDismissedForCycle(key: string, cycleId: string | null): boolean {
  if (!cycleId) return false;
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;
  return dismissedCyclesByKey.get(normalized) === cycleId;
}

// ---------------------------------------------------------------------------
// Tracked set
// ---------------------------------------------------------------------------

export function loadTrackedSet(): Set<string> {
  const saved = storage.get<string[] | null>(TRACKED_KEY, null);
  return new Set(Array.isArray(saved) ? saved : []);
}

export function isTrackedItem(tracked: Set<string>, shopType: RestockShopType, itemId: string): boolean {
  const variants = getItemIdVariants(shopType, itemId);
  for (const variant of variants) {
    if (tracked.has(`${shopType}:${variant}`)) return true;
  }
  const canonical = canonicalItemId(shopType, itemId);
  if (tracked.has(`${shopType}:${canonical}`)) return true;
  const lowerTracked = new Set<string>();
  for (const key of tracked) {
    lowerTracked.add(key.toLowerCase());
  }
  for (const variant of variants) {
    if (lowerTracked.has(`${shopType}:${variant}`.toLowerCase())) return true;
  }
  if (lowerTracked.has(`${shopType}:${canonical}`.toLowerCase())) return true;

  // Dawn shop carries items from all categories — if an item is tracked under
  // its underlying type (e.g. seed:DawnCelestial), it should alert from dawn too.
  if (shopType === 'dawn') {
    for (const prefix of ['seed', 'egg', 'tool', 'decor'] as const) {
      const crossCanonical = canonicalItemId(prefix, itemId);
      if (tracked.has(`${prefix}:${crossCanonical}`)) return true;
      if (lowerTracked.has(`${prefix}:${crossCanonical}`.toLowerCase())) return true;
      for (const v of getItemIdVariants(prefix, itemId)) {
        if (tracked.has(`${prefix}:${v}`)) return true;
        if (lowerTracked.has(`${prefix}:${v}`.toLowerCase())) return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

export function categoryToShopType(category: ShopCategory): RestockShopType | null {
  switch (category) {
    case 'seeds':  return 'seed';
    case 'eggs':   return 'egg';
    case 'decor':  return 'decor';
    case 'tools':  return 'tool';
    case 'dawn':   return 'dawn';
    default:       return null;
  }
}

// ---------------------------------------------------------------------------
// Stock quantity helpers
// ---------------------------------------------------------------------------

function getPurchaseLimitedQuantity(item: ShopStockItem): number | null {
  const initialStock = asNonNegativeQuantity(item.initialStock);
  if (initialStock == null) return null;
  const purchased = asNonNegativeQuantity(item.purchased) ?? 0;
  return Math.max(0, initialStock - purchased);
}

export function getItemQuantity(item: ShopStockItem): number {
  const liveStock = asNonNegativeQuantity(item.currentStock);
  const derivedRemaining = asNonNegativeQuantity(item.remaining);
  const purchaseLimited = getPurchaseLimitedQuantity(item);

  let quantity: number | null = null;
  for (const candidate of [liveStock, derivedRemaining, purchaseLimited]) {
    if (candidate == null) continue;
    quantity = quantity == null ? candidate : Math.min(quantity, candidate);
  }
  if (quantity != null) return quantity;

  // Avoid ghost alerts when stock fields are temporarily missing/ambiguous.
  return 0;
}

/**
 * Detect the V16 ItemType for a dawn shop entry from the presence of
 * type-specific ID fields when raw.itemType isn't set explicitly.
 */
function detectDawnItemType(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.itemType === 'string') return raw.itemType;
  if (raw.species != null) return 'Seed';
  if (raw.eggId != null) return 'Egg';
  if (raw.toolId != null) return 'Tool';
  if (raw.decorId != null) return 'Decor';
  return undefined;
}

export function getPurchaseItemId(shopType: RestockShopType, item: ShopStockItem): string {
  const raw = item.raw as Record<string, unknown> | undefined;
  if (shopType === 'seed')  return firstString([raw?.species, item.id, raw?.id]) ?? item.id;
  if (shopType === 'egg')   return firstString([raw?.eggId,   item.id, raw?.id]) ?? item.id;
  if (shopType === 'decor') return firstString([raw?.decorId, item.id, raw?.id]) ?? item.id;
  if (shopType === 'tool')  return firstString([raw?.toolId,  item.id, raw?.id]) ?? item.id;
  if (shopType === 'dawn') {
    // Dawn shop carries mixed item types — detect type from raw fields
    const itemType = raw ? detectDawnItemType(raw) : undefined;
    if (itemType === 'Egg')   return firstString([raw?.eggId,   item.id, raw?.id]) ?? item.id;
    if (itemType === 'Tool')  return firstString([raw?.toolId,  item.id, raw?.id]) ?? item.id;
    if (itemType === 'Decor') return firstString([raw?.decorId, item.id, raw?.id]) ?? item.id;
    // Default: treat as seed (most Dawn items are seeds)
    return firstString([raw?.species, item.id, raw?.id]) ?? item.id;
  }
  return item.id;
}

// ---------------------------------------------------------------------------
// Fallback cycle tracking
// ---------------------------------------------------------------------------

function nextFallbackCycleForKey(key: string, currentQty: number): number {
  const prevQty = lastSeenStockQtyByKey.get(key) ?? 0;
  let cycle = fallbackCycleByKey.get(key) ?? 0;
  if (currentQty > 0 && prevQty <= 0) {
    cycle += 1;
    fallbackCycleByKey.set(key, cycle);
  } else if (!fallbackCycleByKey.has(key)) {
    fallbackCycleByKey.set(key, cycle);
  }
  lastSeenStockQtyByKey.set(key, currentQty);
  return cycle;
}

function getStockCycleId(
  key: string,
  bucket: ShopStockCategoryState | undefined,
  item: ShopStockItem,
  currentQty: number,
): string | null {
  const fallbackCycle = nextFallbackCycleForKey(key, currentQty);
  const nextRestockAt = bucket?.nextRestockAt;
  if (typeof nextRestockAt === 'number' && Number.isFinite(nextRestockAt)) {
    return `next:${Math.floor(nextRestockAt)}:cycle:${fallbackCycle}`;
  }
  const initialStock = asNonNegativeQuantity(item.initialStock);
  if (initialStock != null) {
    return `stock:${initialStock}:cycle:${fallbackCycle}`;
  }
  return `cycle:${fallbackCycle}`;
}

// ---------------------------------------------------------------------------
// Main stock processor
// ---------------------------------------------------------------------------

export function processShopStock(state: ShopStockState): void {
  const tracked = loadTrackedSet();
  const seenKeys = new Set<string>();
  const categories: ShopCategory[] = ['seeds', 'eggs', 'decor', 'tools', 'dawn'];

  for (const category of categories) {
    const shopType = categoryToShopType(category);
    if (!shopType) continue;
    const bucket = state.categories[category];
    const items = Array.isArray(bucket?.items) ? bucket.items : [];
    for (const item of items) {
      const purchaseItemId = getPurchaseItemId(shopType, item);
      const canonicalId    = canonicalItemId(shopType, purchaseItemId).trim();
      const canonicalKey   = toCanonicalKey(shopType, purchaseItemId);
      seenKeys.add(canonicalKey);

      const trackedNow            = isTrackedItem(tracked, shopType, purchaseItemId);
      const rawQty                = getItemQuantity(item);
      const currentQty            = applyInventoryCapToQuantity(shopType, purchaseItemId, canonicalKey, rawQty);
      const stockCycleId          = getStockCycleId(canonicalKey, bucket, item, rawQty);
      const dismissedForCycle     = isDismissedForCycle(canonicalKey, stockCycleId);
      const hasActiveAlert        = activeAlerts.has(canonicalKey);
      const hasPendingConfirmation = pendingOwnershipConfirmations.has(canonicalKey);

      if (trackedNow || hasActiveAlert || hasPendingConfirmation) {
        debugLogStockStateIfChanged(canonicalKey, {
          trackedNow,
          shopType,
          itemId: purchaseItemId,
          label: item.label,
          currentQty,
          rawQty,
          cappedOutByInventoryLimit: rawQty > 0 && currentQty <= 0,
          toolInventoryLimit: getToolInventoryLimitFromKey(canonicalKey),
          currentStock: item.currentStock,
          remaining: item.remaining,
          initialStock: item.initialStock,
          purchased: item.purchased,
          stockCycleId,
          dismissedForCycle,
          dismissedInMemory: dismissedInStockKeys.has(canonicalKey),
          hasActiveAlert,
          hasPendingConfirmation,
        });
      } else if (debugLastStockStateByKey.has(canonicalKey)) {
        debugLastStockStateByKey.delete(canonicalKey);
      }

      if (stockCycleId && !dismissedForCycle && dismissedInStockKeys.has(canonicalKey)) {
        // New cycle detected for this item; release prior-cycle dismiss lock.
        dismissedInStockKeys.delete(canonicalKey);
        clearDismissedCycle(canonicalKey);
        debugLog('Released dismiss lock on cycle change', { key: canonicalKey, stockCycleId });
      }
      if (dismissedForCycle) {
        dismissedInStockKeys.add(canonicalKey);
      }

      if (!trackedNow) {
        dismissedInStockKeys.delete(canonicalKey);
        clearDismissedCycle(canonicalKey);
        removeAlert(canonicalKey);
        continue;
      }

      if (currentQty <= 0) {
        if (rawQty > 0 && getToolInventoryLimitFromKey(canonicalKey) != null) {
          debugLog('Suppressing alert because inventory tool stack limit reached', {
            key: canonicalKey,
            shopType,
            itemId: purchaseItemId,
            stockQty: rawQty,
            cappedQty: currentQty,
            inventoryOwned: getOwnedToolCount(purchaseItemId, canonicalKey),
            limit: getToolInventoryLimitFromKey(canonicalKey),
          });
        }
        // Keep same-cycle dismiss lock to avoid hide/show flicker during purchase sync.
        // If this item has no cycle signal, clear lock at zero to avoid permanent suppression.
        if (!stockCycleId) {
          dismissedInStockKeys.delete(canonicalKey);
          clearDismissedCycle(canonicalKey);
          debugLog('Cleared dismiss lock at zero stock (no cycle id)', { key: canonicalKey });
        }
        removeAlert(canonicalKey);
        continue;
      }

      if (dismissedInStockKeys.has(canonicalKey)) {
        // User dismissed this stock cycle; keep it hidden until quantity drops to zero.
        debugLog('Suppressing alert because key is dismissed for current cycle', { key: canonicalKey, stockCycleId });
        removeAlert(canonicalKey);
        continue;
      }

      const raw = item.raw as Record<string, unknown> | undefined;
      upsertAlert({
        key: canonicalKey,
        shopType,
        itemId: purchaseItemId,
        stockCycleId,
        label: item.label || canonicalId,
        quantity: currentQty,
        priceCoins: item.priceCoins ?? null,
        itemType: shopType === 'dawn' && raw
          ? detectDawnItemType(raw)
          : raw?.itemType as string | undefined,
      });

      const active = activeAlerts.get(canonicalKey);
      if (active) {
        if (currentQty <= 0 && !active.busy) {
          removeAlert(canonicalKey);
        } else {
          updateAlertQuantity(active, currentQty);
        }
      }
    }
  }

  // Clean stale keys that no longer exist in the latest stock snapshot.
  for (const key of Array.from(dismissedInStockKeys.keys())) {
    if (seenKeys.has(key)) continue;
    dismissedInStockKeys.delete(key);
    clearDismissedCycle(key);
  }
  for (const key of Array.from(activeAlerts.keys())) {
    if (seenKeys.has(key)) continue;
    removeAlert(key);
  }
  for (const key of Array.from(lastSeenStockQtyByKey.keys())) {
    if (seenKeys.has(key)) continue;
    lastSeenStockQtyByKey.delete(key);
    fallbackCycleByKey.delete(key);
  }
}
