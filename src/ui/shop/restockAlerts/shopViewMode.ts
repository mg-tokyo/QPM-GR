// `viewMode` for PurchaseShopItem (required by the server since game v1294; a
// send without it is refused `invalid_message`). Mirrors the game's own value:
// the player's persisted per-shop toggle, else the deterministic A/B default
// from the `shop-view-default-v1` experiment.

import { getPlayerIdSync } from '../../../core/playerContext';

export type ShopViewMode = 'list' | 'grid';

const VARIANTS: readonly ShopViewMode[] = ['list', 'grid'];
const EXPERIMENT_KEY = 'shop-view-default-v1';

function isShopViewMode(value: unknown): value is ShopViewMode {
  return value === 'list' || value === 'grid';
}

/** Game's variant hash: FNV-1a with a murmur-style finalizer, as an unsigned 32-bit int. */
function hashVariantKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 569420461);
  h ^= h >>> 15;
  return h >>> 0;
}

export function defaultShopViewMode(playerId: string): ShopViewMode {
  const bucket = hashVariantKey(`${EXPERIMENT_KEY}:${playerId}`) / 4294967296;
  return VARIANTS[Math.floor(bucket * VARIANTS.length)] ?? 'list';
}

/** Game-owned localStorage key (written as JSON by the shop's view toggle). */
function readStoredShopViewMode(playerId: string, shopType: string): ShopViewMode | null {
  try {
    const raw = localStorage.getItem(`shop:${playerId}:${shopType}:viewMode`);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isShopViewMode(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveShopViewMode(shopType: string, playerId: string | null = getPlayerIdSync()): ShopViewMode {
  if (!playerId) return 'list';
  return readStoredShopViewMode(playerId, shopType) ?? defaultShopViewMode(playerId);
}
