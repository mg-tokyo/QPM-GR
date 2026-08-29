// Shop membership, tool caps, and capsule weights read from the captured dexes,
// so new shops / capsules / caps need no code edits.

import { getCatalogs, getItem } from './gameCatalogs';

export type ShopCatalogKind = 'plant' | 'egg' | 'item' | 'decor';
const SHOP_CATALOG_KINDS: readonly ShopCatalogKind[] = ['plant', 'egg', 'item', 'decor'];

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function getKindCatalog(kind: ShopCatalogKind): Record<string, unknown> | null {
  const catalogs = getCatalogs();
  switch (kind) {
    case 'plant': return catalogs.plantCatalog;
    case 'egg':   return catalogs.eggCatalog;
    case 'item':  return catalogs.itemCatalog;
    case 'decor': return catalogs.decorCatalog;
  }
}

/** Flora blueprints keep shop-facing fields (eligibleShops, rarity, prices) on `.seed`; other dexes keep them top-level. */
function toShopFacingEntry(kind: ShopCatalogKind, entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object') return null;
  if (kind !== 'plant') return entry as Record<string, unknown>;
  const seed = (entry as Record<string, unknown>).seed;
  return seed && typeof seed === 'object' ? seed as Record<string, unknown> : null;
}

export function getShopFacingCatalogEntry(itemId: string): { kind: ShopCatalogKind; entry: Record<string, unknown> } | null {
  for (const kind of SHOP_CATALOG_KINDS) {
    const entry = toShopFacingEntry(kind, getKindCatalog(kind)?.[itemId]);
    if (entry) return { kind, entry };
  }
  return null;
}

export function getItemEligibleShops(itemId: string): string[] {
  return readStringArray(getShopFacingCatalogEntry(itemId)?.entry.eligibleShops);
}

/** Restock/alert ids may be lowercased; fall back to a case-insensitive id match per catalog. */
function findShopFacingEntryLoose(itemId: string): Record<string, unknown> | null {
  const exact = getShopFacingCatalogEntry(itemId);
  if (exact) return exact.entry;
  for (const kind of SHOP_CATALOG_KINDS) {
    const id = findCatalogIdCaseInsensitive(kind, itemId);
    if (!id) continue;
    const entry = toShopFacingEntry(kind, getKindCatalog(kind)?.[id]);
    if (entry) return entry;
  }
  return null;
}

/** Item/egg/seed blueprints keep the atlas key on `sprite`; decor blueprints keep it on `art`. */
export function getItemCatalogSpriteKey(itemId: string): string | null {
  const entry = findShopFacingEntryLoose(itemId);
  const key = entry?.sprite ?? entry?.art;
  return typeof key === 'string' && key ? key : null;
}

export function getItemCatalogName(itemId: string): string | null {
  const name = findShopFacingEntryLoose(itemId)?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** Shop-facing price fields as the game shops read them; `null` when the id is unknown to every catalog. */
export function getItemCatalogPricing(itemId: string): { coinPrice: number | null; dustPrice: number | null; rarity: string | null } | null {
  const entry = findShopFacingEntryLoose(itemId);
  if (!entry) return null;
  const coin = entry.coinPrice;
  const dust = entry.magicDustPrice ?? entry.dustPrice;
  return {
    coinPrice: typeof coin === 'number' && Number.isFinite(coin) ? coin : null,
    dustPrice: typeof dust === 'number' && Number.isFinite(dust) ? dust : null,
    rarity: typeof entry.rarity === 'string' && entry.rarity ? entry.rarity : null,
  };
}

export function getItemCatalogRarity(itemId: string): string | null {
  const rarity = getShopFacingCatalogEntry(itemId)?.entry.rarity;
  return typeof rarity === 'string' && rarity ? rarity : null;
}

export function areShopCatalogsLoaded(): boolean {
  return SHOP_CATALOG_KINDS.every((kind) => getKindCatalog(kind) !== null);
}

export function isItemCatalogLoaded(): boolean {
  return getKindCatalog('item') !== null;
}

let eligibleMemo: { refs: Array<Record<string, unknown> | null>; byShop: Map<string, string[]> } | null = null;

/** Every catalog item whose blueprint lists `shopId` in `eligibleShops`. Memoised per catalog identity. */
export function getShopEligibleItemIds(shopId: string): string[] {
  const refs = SHOP_CATALOG_KINDS.map(getKindCatalog);
  if (!eligibleMemo || refs.some((ref, i) => ref !== eligibleMemo!.refs[i])) {
    eligibleMemo = { refs, byShop: new Map() };
  }
  const cached = eligibleMemo.byShop.get(shopId);
  if (cached) return cached;
  const out: string[] = [];
  SHOP_CATALOG_KINDS.forEach((kind, i) => {
    const catalog = refs[i];
    if (!catalog) return;
    for (const [id, raw] of Object.entries(catalog)) {
      const entry = toShopFacingEntry(kind, raw);
      if (entry && readStringArray(entry.eligibleShops).includes(shopId)) out.push(id);
    }
  });
  eligibleMemo.byShop.set(shopId, out);
  return out;
}

const lowerIdIndexByCatalog = new WeakMap<object, Map<string, string>>();

/** Restock keys are lowercased; resolve them back to the catalog's exact id. */
export function findCatalogIdCaseInsensitive(kind: ShopCatalogKind, id: string): string | null {
  const catalog = getKindCatalog(kind);
  if (!catalog) return null;
  if (catalog[id] !== undefined) return id;
  let index = lowerIdIndexByCatalog.get(catalog);
  if (!index) {
    index = new Map<string, string>();
    for (const key of Object.keys(catalog)) index.set(key.toLowerCase(), key);
    lowerIdIndexByCatalog.set(catalog, index);
  }
  return index.get(id.toLowerCase()) ?? null;
}

/** Capsule drop weights (`floraSpawnWeights`), same shape handling as `getEggSpawnWeights`. */
export function getToolSpawnWeights(toolId: string): Record<string, number> {
  const raw = getItem(toolId)?.floraSpawnWeights;
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const weights: Record<string, number> = {};
    for (const entry of raw as Array<{ species?: unknown; weight?: unknown }>) {
      if (typeof entry?.species === 'string' && typeof entry.weight === 'number') weights[entry.species] = entry.weight;
    }
    return weights;
  }
  if (typeof raw !== 'object') return {};
  const weights: Record<string, number> = {};
  for (const [species, weight] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof weight === 'number' && Number.isFinite(weight)) weights[species] = weight;
  }
  return weights;
}

export function getToolMaxInventoryQuantity(toolId: string): number | null {
  const qty = getItem(toolId)?.maxInventoryQuantity;
  return typeof qty === 'number' && Number.isFinite(qty) && qty > 0 ? qty : null;
}
