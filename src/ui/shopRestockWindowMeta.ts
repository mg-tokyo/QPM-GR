// src/ui/shopRestockWindowMeta.ts
// Item meta cache, HTTP helpers, storage, sprite, and UI-state types
// for the Shop Restock window.

import { log } from '../utils/logger';
import { getItemIdVariants } from '../utils/restockDataService';
import { getAnySpriteDataUrl, getCropSpriteCanvas, getPetSpriteCanvas } from '../sprite-v2/compat';
import { canvasToDataUrl } from '../utils/canvasHelpers';
import { storage } from '../utils/storage';
import { getWeatherDef } from '../catalogs/gameCatalogs';
import type { RestockItem } from '../utils/restockDataService';
import {
  TRACKED_KEY,
  UI_STATE_KEY,
  ARIEDAM_KEY,
  ARIEDAM_TTL_MS,
  CELESTIAL_IDS,
} from './shopRestockWindowConstants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ItemMeta { name: string; rarity: string; price: number; priceMagicDust?: number; spriteUrl?: string | null }

export type SortColumn = 'item' | 'qty' | 'last' | null;
export type SortDirection = 'asc' | 'desc';

export interface ShopRestockUiState {
  filter: string;
  search: string;
  predCollapsed: boolean;
  hotCollapsed: boolean;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  historyScrollTop: number;
  pinnedHeight: number | null;
}

// ---------------------------------------------------------------------------
// GmXhr (local minimal type for the Ariedam fetch)
// ---------------------------------------------------------------------------

type GmXhr = (details: {
  method: 'GET';
  url: string;
  timeout?: number;
  onload?: (res: { status: number; responseText: string }) => void;
  onerror?: (err: unknown) => void;
  ontimeout?: () => void;
}) => void;

function resolveGmXhr(): GmXhr | null {
  if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest as unknown as GmXhr;
  const gm = (globalThis as { GM?: { xmlHttpRequest?: GmXhr } }).GM;
  if (typeof gm?.xmlHttpRequest === 'function') return gm.xmlHttpRequest as GmXhr;
  return null;
}

export function gmFetch(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = resolveGmXhr();
    if (!xhr) return reject(new Error('GM_xmlhttpRequest unavailable'));
    xhr({
      method: 'GET',
      url,
      timeout: 10_000,
      onload: (res) => {
        if (res.status >= 200 && res.status < 300) {
          try { resolve(JSON.parse(res.responseText)); }
          catch { reject(new Error('JSON parse failed')); }
        } else {
          reject(new Error(`HTTP ${res.status}`));
        }
      },
      onerror:   () => reject(new Error('Network error')),
      ontimeout: () => reject(new Error('Timeout')),
    });
  });
}

// ---------------------------------------------------------------------------
// Item meta cache
// ---------------------------------------------------------------------------

export const itemMetaCache = new Map<string, ItemMeta>();
export const itemCatalogOrder = new Map<string, number>();
export const toolItemIds   = new Set<string>();

export function buildItemMetaCache(gameData: Record<string, unknown>): void {
  itemMetaCache.clear();
  itemCatalogOrder.clear();
  toolItemIds.clear();

  let seedOrder = 0;
  for (const [plantId, plantData] of Object.entries((gameData.plants ?? {}) as Record<string, Record<string, unknown>>)) {
    const seed = plantData.seed as Record<string, unknown> | undefined;
    if (!seed) continue;
    const key = `seed:${plantId}`;
    itemMetaCache.set(key, {
      name:   String(seed.name ?? `${plantId} Seed`),
      rarity: String(seed.rarity ?? 'common').toLowerCase(),
      price:  Number(seed.coinPrice ?? 0),
    });
    itemCatalogOrder.set(key, seedOrder++);
  }

  let eggOrder = 0;
  for (const [eggId, eggData] of Object.entries((gameData.eggs ?? {}) as Record<string, Record<string, unknown>>)) {
    const key = `egg:${eggId}`;
    itemMetaCache.set(key, {
      name:   String(eggData.name ?? eggId),
      rarity: String(eggData.rarity ?? 'common').toLowerCase(),
      price:  Number(eggData.coinPrice ?? 0),
    });
    itemCatalogOrder.set(key, eggOrder++);
  }

  let decorOrder = 0;
  for (const [decorId, decorData] of Object.entries((gameData.decor ?? {}) as Record<string, Record<string, unknown>>)) {
    const key = `decor:${decorId}`;
    itemMetaCache.set(key, {
      name:   String(decorData.name ?? decorId),
      rarity: String(decorData.rarity ?? 'common').toLowerCase(),
      price:  Number(decorData.coinPrice ?? 0),
      spriteUrl: typeof decorData.sprite === 'string' ? decorData.sprite : null,
    });
    itemCatalogOrder.set(key, decorOrder++);
  }

  let toolOrder = 0;
  for (const [itemId, itemData] of Object.entries((gameData.items ?? {}) as Record<string, Record<string, unknown>>)) {
    const coinPrice = Number(itemData?.coinPrice);
    const dustPrice = Number(itemData?.magicDustPrice);
    const hasValidCoinPrice = Number.isFinite(coinPrice) && coinPrice > 0 && coinPrice < 1_000_000_000;
    const hasValidDustPrice = Number.isFinite(dustPrice) && dustPrice > 0;

    // Skip non-shop items: sentinel prices (mutation potions) and zero-cost items (DawnCapsule).
    if (!hasValidCoinPrice && !hasValidDustPrice) continue;

    const key = `tool:${itemId}`;
    itemMetaCache.set(key, {
      name: (typeof itemData?.name === 'string' && itemData.name.trim()) ? itemData.name : itemId,
      rarity: String(itemData?.rarity ?? 'common').toLowerCase(),
      price: hasValidCoinPrice ? coinPrice : 0,
      ...(hasValidDustPrice ? { priceMagicDust: dustPrice } : {}),
      spriteUrl: typeof itemData?.sprite === 'string' ? itemData.sprite : null,
    });
    itemCatalogOrder.set(key, toolOrder++);
    toolItemIds.add(itemId);
    toolItemIds.add(itemId + 's');
  }
}

export async function initGameData(): Promise<void> {
  const cached = storage.get<{ data: unknown; timestamp: number } | null>(ARIEDAM_KEY, null);
  if (cached && typeof cached.timestamp === 'number' && Date.now() - cached.timestamp < ARIEDAM_TTL_MS) {
    buildItemMetaCache(cached.data as Record<string, unknown>);
    return;
  }

  try {
    const gameData = await gmFetch('https://mg-api.ariedam.fr/data');
    storage.set(ARIEDAM_KEY, { data: gameData, timestamp: Date.now() });
    buildItemMetaCache(gameData as Record<string, unknown>);
  } catch (err) {
    log('[ShopRestock] Ariedam /data fetch failed', err);
    // If we have stale cache, use it rather than nothing
    const stale = storage.get<{ data: unknown; timestamp: number } | null>(ARIEDAM_KEY, null);
    if (stale?.data) buildItemMetaCache(stale.data as Record<string, unknown>);
  }
}

export function getItemMeta(itemId: string, shopType: string): ItemMeta | null {
  const direct = itemMetaCache.get(`${shopType}:${itemId}`);
  if (direct) return direct;
  if (shopType === 'dawn') {
    return itemMetaCache.get(`seed:${itemId}`) ?? itemMetaCache.get(`egg:${itemId}`) ?? null;
  }
  return null;
}

export function getItemName(itemId: string, shopType: string): string {
  if (shopType === 'weather') {
    // Try weather catalog name first, then camelCase split
    const def = getWeatherDef(itemId);
    if (def && typeof def.name === 'string' && def.name) return def.name;
    return (itemId ?? '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  const meta = getItemMeta(itemId, shopType);
  if (meta?.name) return meta.name;
  // Fallback: convert camelCase ID to title case
  return (itemId ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

const WEATHER_RARITY: Record<string, string> = {
  'Dawn':         'legendary',
  'AmberMoon':    'epic',
  'Thunderstorm': 'rare',
  'Snow':         'rare',
  'Rain':         'uncommon',
  'Sunny':        'common',
};

export function getItemRarity(itemId: string, shopType: string): string {
  if (shopType === 'weather') return WEATHER_RARITY[itemId] ?? 'common';
  return getItemMeta(itemId, shopType)?.rarity ?? 'common';
}

export function getItemPrice(itemId: string, shopType: string): number {
  if (shopType === 'weather') return 0;
  return getItemMeta(itemId, shopType)?.price ?? 0;
}

export function getCatalogOrder(itemId: string, shopType: string): number | null {
  let order = itemCatalogOrder.get(`${shopType}:${itemId}`);
  if (!Number.isFinite(order) && shopType === 'dawn') {
    order = itemCatalogOrder.get(`seed:${itemId}`) ?? itemCatalogOrder.get(`egg:${itemId}`);
  }
  return Number.isFinite(order) ? (order as number) : null;
}

export function mergeToolFallbackRows(items: RestockItem[]): RestockItem[] {
  const toolCatalogIds = Array.from(itemMetaCache.keys())
    .filter((key) => key.startsWith('tool:'))
    .map((key) => key.slice('tool:'.length))
    .filter((id) => id.length > 0);

  if (toolCatalogIds.length === 0) return items;

  const existingToolIds = new Set<string>();
  for (const row of items) {
    if (row.shop_type !== 'tool') continue;
    existingToolIds.add(row.item_id);
  }

  if (existingToolIds.size >= toolCatalogIds.length) return items;

  const merged = items.slice();
  for (const toolId of toolCatalogIds) {
    if (existingToolIds.has(toolId)) continue;
    merged.push({
      item_id: toolId,
      shop_type: 'tool',
      current_probability: null,
      appearance_rate: null,
      predicted_next_ms: null,
      estimated_next_timestamp: null,
      median_interval_ms: null,
      last_seen: null,
      average_quantity: null,
      total_quantity: 0,
      total_occurrences: 0,
      algorithm_version: null,
      algorithm_updated_at: null,
      recent_intervals_ms: null,
      empirical_weight: null,
      empirical_probability: null,
      fallback_rate: null,
      baseline_interval_ms: null,
      ema_interval_ms: null,
      weather_intervals: null,
      is_dormant: null,
      current_weather: null,
      weather_baseline_ms: null,
      weather_samples: null,
      weather_used: null,
      weather_rejected_reason: null,
    });
  }
  return merged;
}

/** All items that can appear in the Dawn shop. */
const DAWN_SHOP_ITEM_IDS = [
  'Daisy', 'Lavender', 'Saffron', 'Eggplant', 'Ube',
  'Dawnbreaker', 'DawnCelestial', 'DawnEgg',
] as const;

export function mergeDawnFallbackRows(items: RestockItem[]): RestockItem[] {
  const existingDawnIds = new Set<string>();
  for (const row of items) {
    if (row.shop_type === 'dawn') existingDawnIds.add(row.item_id);
  }

  const missing: string[] = [];
  for (const id of DAWN_SHOP_ITEM_IDS) {
    if (existingDawnIds.has(id)) continue;
    missing.push(id);
  }

  if (missing.length === 0) return items;

  const merged = items.slice();
  for (const id of missing) {
    merged.push({
      item_id: id,
      shop_type: 'dawn',
      current_probability: null,
      appearance_rate: null,
      predicted_next_ms: null,
      estimated_next_timestamp: null,
      median_interval_ms: null,
      last_seen: null,
      average_quantity: null,
      total_quantity: 0,
      total_occurrences: 0,
      algorithm_version: null,
      algorithm_updated_at: null,
      recent_intervals_ms: null,
      empirical_weight: null,
      empirical_probability: null,
      fallback_rate: null,
      baseline_interval_ms: null,
      ema_interval_ms: null,
      weather_intervals: null,
      is_dormant: null,
      current_weather: null,
      weather_baseline_ms: null,
      weather_samples: null,
      weather_used: null,
      weather_rejected_reason: null,
    });
  }
  return merged;
}

export function isCelestial(itemId: string | null | undefined): boolean {
  return !!itemId && CELESTIAL_IDS.has(itemId);
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

export function loadTracked(): Set<string> {
  const saved = storage.get<string[] | null>(TRACKED_KEY, null);
  return new Set(Array.isArray(saved) ? saved : []);
}

export function saveTracked(set: Set<string>): void {
  storage.set(TRACKED_KEY, Array.from(set));
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('qpm:restock-tracked-updated', {
      detail: { count: set.size },
    }));
  }
}

export function loadUiState(): ShopRestockUiState {
  const saved = storage.get<Partial<ShopRestockUiState> | null>(UI_STATE_KEY, null);
  const sortColumn = saved?.sortColumn === 'item' || saved?.sortColumn === 'qty' || saved?.sortColumn === 'last'
    ? saved.sortColumn
    : null;
  const sortDirection: SortDirection = saved?.sortDirection === 'desc' ? 'desc' : 'asc';
  const historyScrollTop = Number.isFinite(saved?.historyScrollTop)
    ? Math.max(0, Math.floor(saved!.historyScrollTop!))
    : 0;
  const pinnedHeight = Number.isFinite(saved?.pinnedHeight) && (saved!.pinnedHeight as number) > 0
    ? Math.floor(saved!.pinnedHeight as number)
    : null;
  return {
    filter: typeof saved?.filter === 'string' ? saved.filter : 'all',
    search: typeof saved?.search === 'string' ? saved.search : '',
    predCollapsed: !!saved?.predCollapsed,
    hotCollapsed: !!saved?.hotCollapsed,
    sortColumn,
    sortDirection,
    historyScrollTop,
    pinnedHeight,
  };
}

// ---------------------------------------------------------------------------
// Sprite helpers
// ---------------------------------------------------------------------------

export const spriteUrlCache = new Map<string, string | null>();
let coinSpriteUrlCache: string | null = null;

export function getCoinSpriteUrl(): string | null {
  if (coinSpriteUrlCache) return coinSpriteUrlCache;
  const url = getAnySpriteDataUrl('sprite/ui/Coin');
  if (url) coinSpriteUrlCache = url;
  return coinSpriteUrlCache;
}

export function getSpriteUrl(item: RestockItem): string | null {
  const id = item.item_id;
  if (!id) return null;

  if (item.shop_type === 'weather') {
    const cacheKey = `weather:${id}`;
    if (spriteUrlCache.has(cacheKey)) return spriteUrlCache.get(cacheKey)!;
    const def = getWeatherDef(id);
    const spriteId = def && typeof def.spriteId === 'string' ? def.spriteId : null;
    if (spriteId) {
      const url = getAnySpriteDataUrl(spriteId) || null;
      spriteUrlCache.set(cacheKey, url);
      return url;
    }
    spriteUrlCache.set(cacheKey, null);
    return null;
  }

  const cacheKey = `${item.shop_type}:${id}`;
  if (spriteUrlCache.has(cacheKey)) return spriteUrlCache.get(cacheKey)!;

  const tryResolve = (candidateId: string): string | null => {
    let resolved: string | null = null;
    try { resolved = canvasToDataUrl(getPetSpriteCanvas(candidateId)) || null; } catch { /* */ }
    if (!resolved) {
      try { resolved = canvasToDataUrl(getCropSpriteCanvas(candidateId)) || null; } catch { /* */ }
    }
    return resolved;
  };

  const directUrl = tryResolve(id);
  if (directUrl) {
    spriteUrlCache.set(cacheKey, directUrl);
    return directUrl;
  }

  for (const variantId of getItemIdVariants(item.shop_type, id)) {
    if (!variantId || variantId === id) continue;
    const variantUrl = tryResolve(variantId);
    if (variantUrl) {
      spriteUrlCache.set(cacheKey, variantUrl);
      return variantUrl;
    }
  }

  const directMetaSprite = getItemMeta(id, item.shop_type)?.spriteUrl ?? null;
  if (directMetaSprite) {
    spriteUrlCache.set(cacheKey, directMetaSprite);
    return directMetaSprite;
  }

  for (const variantId of getItemIdVariants(item.shop_type, id)) {
    if (!variantId || variantId === id) continue;
    const variantMetaSprite = getItemMeta(variantId, item.shop_type)?.spriteUrl ?? null;
    if (variantMetaSprite) {
      spriteUrlCache.set(cacheKey, variantMetaSprite);
      return variantMetaSprite;
    }
  }

  if (item.shop_type === 'tool') {
    const normalizedId = id.endsWith('s') && id.length > 1 ? id.slice(0, -1) : id;
    const fallbackUrl = `https://mg-api.ariedam.fr/assets/sprites/items/${encodeURIComponent(normalizedId)}.png`;
    spriteUrlCache.set(cacheKey, fallbackUrl);
    return fallbackUrl;
  }

  return null;
}

export function clearSpriteUrlCache(): void {
  spriteUrlCache.clear();
  coinSpriteUrlCache = null;
}
