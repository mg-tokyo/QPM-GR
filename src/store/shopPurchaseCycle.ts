// Purchase-bucket parsing and stock-cycle scoping. Pure; no module-level state.

import type {
  ShopCategorySnapshot,
  ShopPurchaseBucket,
  ShopPurchasesAtomSnapshot,
} from '../types/gameAtoms';
import { type ShopCategory } from '../types/shops';
import { getAtomKeyForCategory, getShopPurchaseKeys } from './shopStockParsers';
import { discoverShopPurchasesRoot } from './shopPurchasesDiscovery';

/** The stock cycle a shop snapshot belongs to; null when the snapshot carries no `restockId`. */
export interface ShopCycle {
  restockId: string;
  startedAtMs: number | null;
}

export function getShopCycle(snapshot: ShopCategorySnapshot | null | undefined): ShopCycle | null {
  const restockId = snapshot?.restockId;
  if (typeof restockId !== 'string' || !restockId) return null;
  return { restockId, startedAtMs: typeof snapshot?.startedAtMs === 'number' ? snapshot.startedAtMs : null };
}

/** `myData.customRestocks[shop]` (v1361 schema): non-null while a bought custom restock is live. */
export interface CustomRestock {
  purchasedAt: number;
}

export type CustomRestockMap = Record<string, CustomRestock | null> | null;

export function extractMyDataCustomRestocks(value: unknown): CustomRestockMap {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as Record<string, unknown>).customRestocks;
  if (!raw || typeof raw !== 'object') return null;
  const map: Record<string, CustomRestock | null> = {};
  for (const [shop, entry] of Object.entries(raw as Record<string, unknown>)) {
    const purchasedAt = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).purchasedAt : null;
    map[shop] = typeof purchasedAt === 'number' && Number.isFinite(purchasedAt) ? { purchasedAt } : null;
  }
  return map;
}

/**
 * The snapshot a shop sells from, mirroring the game's `nn` (v1361 bootScreen chunk): a live custom
 * restock sells only from the custom inventory whose id is `${shop}:custom:${purchasedAt}`, and a
 * null `restockId` sells nothing. Null = no stock.
 */
export function resolveStockSnapshot(
  shopKey: string,
  snapshot: ShopCategorySnapshot | null,
  customRestock: CustomRestock | null,
  customInventory: ShopCategorySnapshot | null,
): ShopCategorySnapshot | null {
  if (customRestock) {
    return customInventory?.restockId === `${shopKey}:custom:${customRestock.purchasedAt}` ? customInventory : null;
  }
  return snapshot?.restockId === null ? null : snapshot;
}

// Mirrors the game's `rn`: an OLDER cycle's purchases count as 0; a bucket NEWER than the snapshot
// (different id, not older) makes the game show the shop sold out. Unstamped legacy shapes count.
function classifyBucketCycle(bucket: ShopPurchaseBucket, cycle: ShopCycle | null | undefined): 'current' | 'stale' | 'ahead' {
  if (!cycle || typeof bucket.restockId !== 'string') return 'current';
  if (bucket.restockId === cycle.restockId) return 'current';
  const bucketStart = bucket.startedAtMs;
  return typeof bucketStart === 'number' && cycle.startedAtMs != null && bucketStart < cycle.startedAtMs ? 'stale' : 'ahead';
}

export function isBucketAheadOfCycle(bucket: ShopPurchaseBucket | null | undefined, cycle: ShopCycle | null | undefined): boolean {
  return bucket != null && classifyBucketCycle(bucket, cycle) === 'ahead';
}

/** Purchases of `rawId` within `cycle`; 0 for an ahead bucket too — callers check `isBucketAheadOfCycle`. */
export function getPurchaseCount(
  category: ShopCategory,
  rawId: string,
  purchases: ShopPurchasesAtomSnapshot | null,
  cycle?: ShopCycle | null,
): number {
  const key = getAtomKeyForCategory(category);
  const entry = purchases?.[key];
  const bucket = entry?.purchases;
  if (!entry || !bucket || typeof bucket !== 'object' || classifyBucketCycle(entry, cycle) !== 'current') {
    return 0;
  }

  const parseCount = (value: unknown): number | null => {
    if (value == null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const normalizeId = (value: string): string => value.trim().toLowerCase();
  const id = rawId.trim();
  const candidates = new Set<string>();
  if (id.length > 0) {
    candidates.add(id);
    // Some tool IDs are observed with inconsistent trailing "s" across atoms.
    if (id.endsWith('s') && id.length > 1) {
      candidates.add(id.slice(0, -1));
    } else {
      candidates.add(`${id}s`);
    }
  }

  for (const candidate of candidates) {
    const direct = parseCount(bucket[candidate]);
    if (direct != null) {
      return direct;
    }
  }

  const numericKey = Number(rawId);
  if (Number.isFinite(numericKey) && bucket[numericKey] != null && Number.isFinite(Number(bucket[numericKey]))) {
    return Number(bucket[numericKey]);
  }

  if (candidates.size > 0) {
    const normalizedCandidates = new Set<string>(Array.from(candidates).map(normalizeId));
    for (const [bucketKey, bucketValue] of Object.entries(bucket)) {
      if (!normalizedCandidates.has(normalizeId(bucketKey))) continue;
      const parsed = parseCount(bucketValue);
      if (parsed != null) {
        return parsed;
      }
    }
  }

  return 0;
}

function toPurchaseRecord(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed: Record<string, number> = {};
  let hasAny = false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    parsed[key] = numeric;
    hasAny = true;
  }
  return hasAny ? parsed : null;
}

function normalizePurchaseBucket(raw: unknown): ShopPurchaseBucket | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.purchases && typeof row.purchases === 'object') {
    const bucket: ShopPurchaseBucket = { purchases: toPurchaseRecord(row.purchases) ?? {} };
    if (typeof row.restockId === 'string') bucket.restockId = row.restockId;
    if (typeof row.startedAtMs === 'number') bucket.startedAtMs = row.startedAtMs;
    return bucket;
  }
  const direct = toPurchaseRecord(row);
  if (direct) {
    return { purchases: direct };
  }
  return null;
}

export function extractMyDataShopPurchases(value: unknown): ShopPurchasesAtomSnapshot | null {
  // Discovered by shape (see shopPurchasesDiscovery.ts) — no hardcoded field name.
  const root = discoverShopPurchasesRoot(value);
  if (!root) return null;

  const snapshot: ShopPurchasesAtomSnapshot = {};
  let hasAnyBucket = false;
  for (const key of getShopPurchaseKeys()) {
    const bucket = normalizePurchaseBucket(root[key]);
    snapshot[key] = bucket;
    if (bucket?.purchases && Object.keys(bucket.purchases).length > 0) {
      hasAnyBucket = true;
    }
  }
  return hasAnyBucket ? snapshot : null;
}
