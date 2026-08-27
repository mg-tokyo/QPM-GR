// src/ui/shopRestockWindowConstants.ts
// Static data constants for the Shop Restock window.

import type { DetailedWeather } from '../../utils/game/weatherDetection';
import { STANDARD_RESTOCK_SHOP_TYPES } from '../../types/shops';
import { getShopWeatherKind, getWeatherShopIds } from '../../store/shopRegistry';
import { areShopCatalogsLoaded, getItemCatalogRarity, getItemEligibleShops } from '../../catalogs/shopEligibility';

// Time-limited seasonal items -- hidden from history after expiry.
// Key: "shopType:itemId"  Value: expiry timestamp (ms UTC)
// Items permanently hidden from the list (stale/bad data entries).
export const ITEM_HIDDEN = new Set([
  'seed:StoneBirdbath',
  'seed:StoneGnome',
  'seed:WoodBirdhouse',
  'seed:WoodOwl',
]);

export const ITEM_EXPIRY: Record<string, number> = {
  'seed:PineTree':             1768179600000,
  'seed:Poinsettia':           1768179600000,
  'egg:WinterEgg':             1768179600000,
  'decor:Cauldron':            1762477200000,
  'decor:ColoredStringLights': 1768179600000,
  'decor:LargeGravestone':     1762477200000,
  'decor:MarbleCaribou':       1768179600000,
  'decor:MediumGravestone':    1762477200000,
  'decor:SmallGravestone':     1762477200000,
  'decor:StoneCaribou':        1768179600000,
  'decor:WoodCaribou':         1768179600000,
};

export const RARITY_COLORS: Record<string, string> = {
  common:    '#E7E7E7',
  uncommon:  '#67BD4D',
  rare:      '#0071C6',
  legendary: '#FFC734',
  mythic:    '#9944A7',
  mythical:  '#9944A7',
  divine:    '#FF7835',
  celestial: '#FF00FF',
};

export const RARITY_ORDER = ['celestial', 'divine', 'mythical', 'mythic', 'legendary', 'rare', 'uncommon', 'common'] as const;

export const RARITY_GLOW: Record<string, string> = {
  legendary: '0 0 8px rgba(255,199,52,0.3)',
  mythic:    '0 0 10px rgba(153,68,167,0.4)',
  mythical:  '0 0 10px rgba(153,68,167,0.4)',
  divine:    '0 0 12px rgba(255,120,53,0.5)',
  celestial: '0 0 12px rgba(255,0,255,0.5)',
};

// Celestial-item row tinting. Derived from --qpm-gold via color-mix so palette
// changes propagate. Used for celestial pinned/history rows.
export const CELESTIAL_BG_TINT  = 'color-mix(in srgb, var(--qpm-gold) 4%, transparent)';
export const CELESTIAL_BG_HOVER = 'color-mix(in srgb, var(--qpm-gold) 9%, transparent)';
export const CELESTIAL_BORDER   = 'color-mix(in srgb, var(--qpm-gold) 22%, transparent)';

const STANDARD_SHOP_ORDER: Record<string, number> = { seed: 0, egg: 1, decor: 2, tool: 3 };

/** Standard shops first, weather shops in registry order, weather events last. */
export function getShopOrder(shopType: string): number {
  const standard = STANDARD_SHOP_ORDER[shopType];
  if (standard !== undefined) return standard;
  if (shopType === 'weather') return 99;
  const index = getWeatherShopIds().indexOf(shopType);
  return index >= 0 ? 10 + index : 98;
}

const STANDARD_SHOP_CYCLE_INTERVALS: Record<string, number> = {
  seed:  5  * 60 * 1000,
  egg:   15 * 60 * 1000,
  decor: 60 * 60 * 1000,
  tool:  10 * 60 * 1000,
};

/** Weather-gated shops have no timer cycle → 0. */
export function getShopCycleInterval(shopType: string): number {
  return STANDARD_SHOP_CYCLE_INTERVALS[shopType] ?? 0;
}

export const TRACKED_KEY    = 'qpm.restock.tracked';
export const UI_STATE_KEY   = 'qpm.restock.ui.v1';
export const ARIEDAM_KEY    = 'qpm.ariedam.gamedata';
export const ARIEDAM_TTL_MS = 24 * 60 * 60 * 1000;
export const SEARCH_DEBOUNCE_MS = 140;
export const UI_STATE_SAVE_DEBOUNCE_MS = 180;
export const HISTORY_CHUNK_SIZE = 40;

/** Catalog-unavailable fallback only; live answers come from blueprints' `eligibleShops`. */
const WEATHER_LOCK_FALLBACK: Record<string, DetailedWeather> = {
  'SnowEgg': 'snow',
  'DawnEgg': 'dawn',
  'ThunderEgg': 'thunderstorm',
};

/** Weather an item is locked behind: its blueprint's weather shop, unless a standard shop also sells it. */
export function getRequiredWeather(itemId: string): DetailedWeather | null {
  const shops = getItemEligibleShops(itemId);
  if (shops.length > 0) {
    if (shops.some((id) => STANDARD_RESTOCK_SHOP_TYPES.has(id))) return null;
    for (const id of shops) {
      const kind = getShopWeatherKind(id);
      if (kind) return kind;
    }
    return null;
  }
  return areShopCatalogsLoaded() ? null : (WEATHER_LOCK_FALLBACK[itemId] ?? null);
}

/** Curated highlight set (pods, MythicalEgg) on top of catalog rarity `Celestial`. */
export const CELESTIAL_IDS = new Set([
  'Starweaver', 'StarweaverPod',
  'Moonbinder', 'MoonbinderPod', 'MoonCelestial',
  'Dawnbinder', 'DawnbinderPod', 'DawnCelestial',
  'Dawnbreaker',
  'SunCelestial', 'MythicalEgg',
]);

export function isCelestialItem(itemId: string): boolean {
  if (CELESTIAL_IDS.has(itemId)) return true;
  return getItemCatalogRarity(itemId)?.toLowerCase() === 'celestial';
}

export interface ShopFilter { label: string; value: string }

const SHOP_FILTERS_HEAD: readonly ShopFilter[] = [
  { label: 'All', value: 'all' },
  { label: 'Celestial', value: 'celestial' },
  { label: 'Seeds', value: 'seed' },
  { label: 'Eggs', value: 'egg' },
  { label: 'Decor', value: 'decor' },
  { label: 'Tools', value: 'tool' },
];

const SHOP_FILTERS_TAIL: readonly ShopFilter[] = [
  { label: 'Weather', value: 'weather' },
];

/** Fixed chips plus one per weather shop the registry knows (dawn, snow, thunder, future). */
export function getShopFilters(): ShopFilter[] {
  const weatherShops = getWeatherShopIds().map((id) => ({
    label: id.charAt(0).toUpperCase() + id.slice(1),
    value: id,
  }));
  return [...SHOP_FILTERS_HEAD, ...weatherShops, ...SHOP_FILTERS_TAIL];
}
