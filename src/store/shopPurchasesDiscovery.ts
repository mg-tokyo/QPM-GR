// Fingerprint-based discovery of the shopPurchases root on the myData snapshot.
// The game's field name for this record has been stable but is not guaranteed;
// this module locates it by SHAPE ({ [shopId]: { purchases?: { [itemId]: number } | { [itemId]: number } })
// cross-checked against getKnownShopIds(), so a bundle rename doesn't require a code change.

import { getKnownShopIds } from './shopRegistry';
import { getAtomKeyForCategory } from './shopStockParsers';

let cachedPathKey: string | null = null;

function isPurchaseBucket(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const nested = row.purchases;
  const candidate = (nested && typeof nested === 'object') ? nested as Record<string, unknown> : row;
  let numericCount = 0;
  let totalCount = 0;
  for (const val of Object.values(candidate)) {
    totalCount++;
    if (typeof val === 'number' && Number.isFinite(val)) numericCount++;
    if (totalCount >= 12) break;
  }
  if (totalCount === 0) return true;
  return numericCount / totalCount >= 0.75;
}

function knownShopKeys(): ReadonlySet<string> {
  const set = new Set<string>();
  for (const id of getKnownShopIds()) set.add(getAtomKeyForCategory(id));
  return set;
}

function shapeMatches(candidate: Record<string, unknown>, knownKeys: ReadonlySet<string>): boolean {
  if (knownKeys.size === 0) return false;
  let matchedKnown = 0;
  let bucketLike = 0;
  let hostile = 0;
  for (const [key, val] of Object.entries(candidate)) {
    if (knownKeys.has(key)) matchedKnown++;
    // Inactive weather-shop buckets appear as `null` (verified live 2026-09-10:
    // myData.shopPurchases has 5 buckets + 5 nulls). Null is compatible; only
    // a non-null, non-bucket-shaped value disqualifies the candidate.
    if (val === null) continue;
    if (!isPurchaseBucket(val)) { hostile++; continue; }
    bucketLike++;
  }
  return matchedKnown >= 1 && bucketLike >= 1 && hostile === 0;
}

/** Return the discovered shopPurchases record from myData, or null when nothing fits. */
export function discoverShopPurchasesRoot(myData: unknown): Record<string, unknown> | null {
  if (!myData || typeof myData !== 'object') return null;
  const source = myData as Record<string, unknown>;
  const knownKeys = knownShopKeys();

  if (cachedPathKey !== null) {
    const value = source[cachedPathKey];
    if (value && typeof value === 'object' && shapeMatches(value as Record<string, unknown>, knownKeys)) {
      return value as Record<string, unknown>;
    }
    cachedPathKey = null;
  }

  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object') continue;
    const candidate = value as Record<string, unknown>;
    if (!shapeMatches(candidate, knownKeys)) continue;
    cachedPathKey = key;
    return candidate;
  }
  return null;
}

/** Discovered field name (for diagnostics). Null before first successful discovery. */
export function getDiscoveredShopPurchasesFieldName(): string | null {
  return cachedPathKey;
}

/** Reset the cache. Test-only; production re-discovery happens automatically when the cached shape drifts. */
export function __resetShopPurchasesDiscovery(): void {
  cachedPathKey = null;
}
