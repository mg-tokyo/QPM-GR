// Tracked-set logic for shop restock alerts: DOM-free so features can read
// the tracked list without pulling `src/ui/**` (which brings sprite/canvas
// helpers into the graph). UI modules re-export from here for back-compat.

import { storage } from '../utils/storage';
import { canonicalItemId, getItemIdVariants } from '../utils/restock/dataService';
import { isWeatherShopType } from '../types/shops';

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
