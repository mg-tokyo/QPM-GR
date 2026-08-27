// src/types/shops.ts
// Shared definitions for shop categories.

/** Any shop id observed in `quinoaData.shops` — standard, weather-gated, or future. */
export type ShopCategory = string;

/** The four standard shops with paid restocks and per-shop UI customisations. */
export type StandardShopId = 'seeds' | 'eggs' | 'tools' | 'decor';

export const STANDARD_SHOP_IDS: readonly StandardShopId[] = ['seeds', 'eggs', 'tools', 'decor'] as const;

/**
 * Weather-gated shop ids the codebase ships knowing about. The registry
 * seeds its known set with these; further shop ids are picked up at
 * runtime instead of by code edits.
 */
export const INITIALLY_KNOWN_WEATHER_GATED_SHOP_IDS: readonly string[] = ['dawn', 'snow', 'thunder'] as const;

/**
 * The complete initially-known shop set. Kept exported for back-compat
 * with existing call sites; new code should prefer `getKnownShopIds()`
 * from the registry, which includes runtime-discovered ids.
 */
export const SHOP_CATEGORIES: readonly string[] = [
  ...STANDARD_SHOP_IDS,
  ...INITIALLY_KNOWN_WEATHER_GATED_SHOP_IDS,
] as const;

/**
 * Singular shop-type ids used by restock UI and by the game's own `shops` keys.
 * Weather-gated shops use their shop id verbatim (`dawn`, `snow`, `thunder`, runtime-discovered).
 */
export const STANDARD_RESTOCK_SHOP_TYPES: ReadonlySet<string> = new Set(['seed', 'egg', 'decor', 'tool']);

/** `'weather'` is the weather-event pseudo-type, not a shop; anything else non-standard is a shop id by construction. */
export function isWeatherShopType(shopType: string): boolean {
  return shopType !== 'weather' && !STANDARD_RESTOCK_SHOP_TYPES.has(shopType);
}
