// src/ui/shopRestockWindowConstants.ts
// Static data constants for the Shop Restock window.

import type { DetailedWeather } from '../utils/weatherDetection';

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

export const SHOP_ORDER: Record<string, number> = { seed: 0, egg: 1, decor: 2, tool: 3, dawn: 4 };

export const SHOP_CYCLE_INTERVALS: Record<string, number> = {
  seed:  5  * 60 * 1000,
  egg:   15 * 60 * 1000,
  decor: 60 * 60 * 1000,
  tool:  10 * 60 * 1000,
  dawn:  0,  // Dawn Shop has no timer-based cycle (weather-gated)
};

export const TRACKED_KEY    = 'qpm.restock.tracked';
export const UI_STATE_KEY   = 'qpm.restock.ui.v1';
export const ARIEDAM_KEY    = 'qpm.ariedam.gamedata';
export const ARIEDAM_TTL_MS = 24 * 60 * 60 * 1000;
export const SEARCH_DEBOUNCE_MS = 140;
export const UI_STATE_SAVE_DEBOUNCE_MS = 180;
export const HISTORY_CHUNK_SIZE = 40;

export const WEATHER_LOCKED_EGG_IDS = new Set(['SnowEgg', 'DawnEgg']);

export const WEATHER_LOCK_MAP: Record<string, DetailedWeather> = {
  'SnowEgg': 'snow',
  'DawnEgg': 'dawn',
};

export function getRequiredWeather(itemId: string): DetailedWeather | null {
  return WEATHER_LOCK_MAP[itemId] ?? null;
}

export const CELESTIAL_IDS = new Set([
  'Starweaver', 'StarweaverPod',
  'Moonbinder', 'MoonbinderPod', 'MoonCelestial',
  'Dawnbinder', 'DawnbinderPod', 'DawnCelestial',
  'Dawnbreaker',
  'SunCelestial', 'MythicalEgg',
]);

export const SHOP_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Celestial', value: 'celestial' },
  { label: 'Seeds', value: 'seed' },
  { label: 'Eggs', value: 'egg' },
  { label: 'Decor', value: 'decor' },
  { label: 'Tools', value: 'tool' },
  { label: 'Dawn', value: 'dawn' },
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  seed: 'Seeds',
  egg: 'Eggs',
  decor: 'Decor',
  tool: 'Tools',
  dawn: 'Dawn',
};
