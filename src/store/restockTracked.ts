// Tracked-set logic for shop restock alerts: DOM-free so features can read
// the tracked list without pulling `src/ui/**` (which brings sprite/canvas
// helpers into the graph). UI modules re-export from here for back-compat.

import { storage } from '../utils/storage';
import { canonicalItemId, getItemIdVariants } from '../utils/restock/dataService';
import { isWeatherShopType } from '../types/shops';
import { getItemEligibleShops } from '../catalogs/shopEligibility';

export const TRACKED_KEY = 'qpm.restock.tracked';

/** Standard singular types, the 'weather' event pseudo-type, or any weather-gated shop id (dawn, snow, thunder, runtime-discovered). */
export type RestockShopType = 'seed' | 'egg' | 'decor' | 'tool' | 'weather' | (string & {});

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

  // Weather shops carry items from all categories — if an item is tracked under
  // its underlying type (e.g. seed:DawnCelestial), it should alert from there too.
  if (isWeatherShopType(shopType)) {
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

/**
 * Re-keys pins whose shop no longer sells the item to the shops the catalog lists now
 * (Moonbinder moved seed → amber, Dawnbinder seed → dawn). The restock window drops rows
 * for ineligible shops, so an un-migrated pin vanishes from the panel. Null when unchanged.
 */
export function rekeyStalePins(keys: readonly string[], eligibleShopsFor: (itemId: string) => string[]): string[] | null {
  const next: string[] = [];
  let changed = false;
  for (const key of keys) {
    const sep = key.indexOf(':');
    const shopType = sep > 0 ? key.slice(0, sep) : '';
    const itemId = sep > 0 ? key.slice(sep + 1) : '';
    if (!shopType || !itemId || shopType === 'weather') {
      next.push(key);
      continue;
    }
    const canonical = canonicalItemId(shopType, itemId);
    const eligible = eligibleShopsFor(canonical);
    if (eligible.length === 0 || eligible.includes(shopType)) {
      next.push(key);
      continue;
    }
    changed = true;
    for (const shop of eligible) next.push(`${shop}:${canonical}`);
  }
  return changed ? Array.from(new Set(next)) : null;
}

/** Persists {@link rekeyStalePins} over the saved pins; true when the stored list changed. */
export function migrateStaleRestockPins(): boolean {
  const saved = storage.get<string[] | null>(TRACKED_KEY, null);
  if (!Array.isArray(saved) || saved.length === 0) return false;
  const next = rekeyStalePins(saved, getItemEligibleShops);
  if (!next) return false;
  storage.set(TRACKED_KEY, next);
  return true;
}
