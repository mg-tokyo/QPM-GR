// Pure parsing helpers for shop stock normalization. No side effects; no module-level state.

import type {
  ShopInventoryEntry,
  ShopCategorySnapshot,
  ShopPurchasesAtomSnapshot,
} from '../types/gameAtoms';
import { type ShopCategory, type StandardShopId } from '../types/shops';
import { getKnownShopIds, isStandardShop } from './shopRegistry';
import {
  getPurchaseCount,
  getShopCycle,
  isBucketAheadOfCycle,
  resolveStockSnapshot,
  type CustomRestock,
  type ShopCycle,
} from './shopPurchaseCycle';

export { getPurchaseCount, getShopCycle, extractMyDataShopPurchases, type ShopCycle } from './shopPurchaseCycle';

// Constants & type aliases (exported for use in shopStock.ts)

/** The four standard shops use a plural category id and a singular atom key. */
const STANDARD_ATOM_KEY: Record<StandardShopId, 'seed' | 'egg' | 'tool' | 'decor'> = {
  seeds: 'seed',
  eggs: 'egg',
  tools: 'tool',
  decor: 'decor',
};

/** Standard shops use a singular atom key; other ids pass through verbatim. */
export function getAtomKeyForCategory(category: string): string {
  if (isStandardShop(category)) {
    return STANDARD_ATOM_KEY[category as StandardShopId];
  }
  return category;
}

/** The full set of atom-side keys backed by the registry's known shop ids. */
export function getShopPurchaseKeys(): readonly string[] {
  return getKnownShopIds().map(getAtomKeyForCategory);
}

/** `myUserSlot.customRestockInventories`: per-shop snapshots shaped like a `shops` entry. */
export type CustomInventoryMap = Record<string, ShopCategorySnapshot | null> | null;

// Public type definitions

export interface ShopStockItem {
  category: ShopCategory;
  id: string;
  label: string;
  orderIndex: number;
  initialStock: number | null;
  currentStock: number | null;
  remaining: number | null;
  purchased: number;
  canSpawn: boolean;
  isAvailable: boolean;
  priceCoins: number | null;
  priceCredits: number | null;
  priceMagicDust: number | null;
  quantityPerPurchase: number;
  raw: ShopInventoryEntry;
}

export interface ShopStockCategoryState {
  category: ShopCategory;
  secondsUntilRestock: number | null;
  nextRestockAt: number | null;
  restockIntervalMs: number | null;
  items: ShopStockItem[];
  availableCount: number;
  signature: string;
  updatedAt: number;
  raw: ShopCategorySnapshot | null;
}

export interface ShopStockState {
  updatedAt: number;
  categories: Record<ShopCategory, ShopStockCategoryState>;
}

// Value coercion

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

export function toPositiveInteger(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric == null) {
    return null;
  }
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : null;
}

export function toNonNegativeInteger(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric == null) {
    return null;
  }
  const rounded = Math.round(numeric);
  return rounded >= 0 ? rounded : null;
}

// Item field derivation

export interface ShopEntryIdentity {
  /** Game ItemType string ('Seed' | 'Egg' | 'Tool' | 'Decor' | future). */
  itemType: string;
  /** The wire field carrying the id (`species`, `eggId`, `toolId`, `decorId`, or a future `<kind>Id`). */
  idField: string;
  id: string;
}

const KNOWN_ID_FIELDS: ReadonlyArray<{ field: string; itemType: string }> = [
  { field: 'species', itemType: 'Seed' },
  { field: 'eggId',   itemType: 'Egg' },
  { field: 'toolId',  itemType: 'Tool' },
  { field: 'decorId', itemType: 'Decor' },
];

/**
 * Identify a shop entry's item type and id field without a fixed type list:
 * explicit `itemType` wins, known fields next, then any `<kind>Id` string field.
 */
export function getShopEntryIdentity(entry: Record<string, unknown> | null | undefined): ShopEntryIdentity | null {
  if (!entry) return null;
  const explicitType = typeof entry.itemType === 'string' && entry.itemType ? entry.itemType : null;
  for (const { field, itemType } of KNOWN_ID_FIELDS) {
    const value = entry[field];
    if (typeof value === 'string' && value) return { itemType: explicitType ?? itemType, idField: field, id: value };
  }
  for (const [key, value] of Object.entries(entry)) {
    const match = /^([a-z]+)Id$/.exec(key);
    if (!match || key === 'itemId' || typeof value !== 'string' || !value) continue;
    const stem = match[1]!;
    return { itemType: explicitType ?? stem.charAt(0).toUpperCase() + stem.slice(1), idField: key, id: value };
  }
  return null;
}

export function deriveItemId(category: ShopCategory, entry: ShopInventoryEntry): string | null {
  switch (category) {
    case 'seeds':
      return entry.species != null ? String(entry.species) : entry.id != null ? String(entry.id) : null;
    case 'eggs':
      return entry.eggId != null ? String(entry.eggId) : entry.id != null ? String(entry.id) : null;
    case 'tools':
      return entry.toolId != null ? String(entry.toolId) : entry.id != null ? String(entry.id) : null;
    case 'decor':
      return entry.decorId != null ? String(entry.decorId) : entry.id != null ? String(entry.id) : null;
    default:
      return getShopEntryIdentity(entry)?.id ?? (entry.id != null ? String(entry.id) : null);
  }
}

export function deriveItemLabel(entry: ShopInventoryEntry): string {
  const label =
    entry.name ??
    entry.displayName ??
    entry.species ??
    entry.petSpecies ??
    entry.toolId ??
    entry.decorId ??
    entry.eggId ??
    entry.id ??
    'Item';
  return String(label).trim();
}

export function extractInitialStock(entry: ShopInventoryEntry): number | null {
  const candidates = [
    entry.initialStock,
    entry.stock,
    entry.availableStock,
    entry.quantity,
    entry.count,
    entry.amount,
  ];
  for (const candidate of candidates) {
    const numeric = toNonNegativeInteger(candidate);
    if (numeric != null) {
      return numeric;
    }
  }
  return null;
}

export function extractQuantityPerPurchase(entry: ShopInventoryEntry): number {
  const candidates = [
    entry.quantityPerPurchase,
    entry.bundleSize,
    entry.quantityPerClick,
    entry.quantity,
  ];
  for (const candidate of candidates) {
    const numeric = toPositiveInteger(candidate);
    if (numeric != null) {
      return numeric;
    }
  }
  return 1;
}

export function extractPrice(entry: ShopInventoryEntry): { coins: number | null; credits: number | null; magicDust: number | null } {
  const coinsCandidates = [entry.priceCoins, entry.coins, entry.price, entry.cost];
  const creditsCandidates = [entry.priceCredits, entry.credits, entry.creditCost];
  const dustCandidates = [entry.priceMagicDust, entry.magicDustPrice, entry.dustPrice, entry.priceDust];
  let coins: number | null = null;
  let credits: number | null = null;
  let magicDust: number | null = null;
  for (const candidate of coinsCandidates) {
    const numeric = toPositiveInteger(candidate);
    if (numeric != null) {
      coins = numeric;
      break;
    }
  }
  for (const candidate of creditsCandidates) {
    const numeric = toPositiveInteger(candidate);
    if (numeric != null) {
      credits = numeric;
      break;
    }
  }
  for (const candidate of dustCandidates) {
    const numeric = toPositiveInteger(candidate);
    if (numeric != null) {
      magicDust = numeric;
      break;
    }
  }
  return { coins, credits, magicDust };
}

function computeRemaining(initialStock: number | null, purchased: number, canSpawn: boolean): number | null {
  if (initialStock == null) {
    return 0;
  }
  const bought = Number.isFinite(purchased) ? Math.max(0, Math.round(purchased)) : 0;
  const remaining = Math.max(0, initialStock - bought);
  return canSpawn ? remaining : 0;
}

// Extraction helpers (pure — all inputs are passed as parameters)

export function extractCustomInventories(slotValue: unknown): CustomInventoryMap {
  if (!slotValue || typeof slotValue !== 'object') return null;
  const slot = slotValue as Record<string, unknown>;
  const custom = slot.customRestockInventories;
  if (!custom || typeof custom !== 'object') return null;
  return custom as CustomInventoryMap;
}

export function hasPurchaseBucket(
  snapshot: ShopPurchasesAtomSnapshot | null,
  key: string,
): boolean {
  const bucket = snapshot?.[key]?.purchases;
  return !!bucket && typeof bucket === 'object';
}

// Item normalization

export function normalizeEntry(
  category: ShopCategory,
  entry: ShopInventoryEntry,
  purchases: ShopPurchasesAtomSnapshot | null,
  orderIndex: number,
  cycle?: ShopCycle | null,
): ShopStockItem | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = deriveItemId(category, entry);
  if (!id) {
    return null;
  }

  const label = deriveItemLabel(entry);
  const initialStock = extractInitialStock(entry);
  const currentStock = toNonNegativeInteger(entry.stock ?? entry.availableStock);
  const quantityPerPurchase = extractQuantityPerPurchase(entry);
  const { coins: priceCoins, credits: priceCredits, magicDust: priceMagicDust } = extractPrice(entry);
  // NOTE: canSpawnHere was removed from the game in Nov 2025 update
  // Treat all items as spawnable (default true for backward compatibility)
  const canSpawn = entry.canSpawnHere !== false;
  // The game counts an ahead bucket as the whole initial stock bought (`rn` → null → sold out).
  const purchased = isBucketAheadOfCycle(purchases?.[getAtomKeyForCategory(category)], cycle)
    ? initialStock ?? 0
    : getPurchaseCount(category, String(id), purchases, cycle);
  let remaining = computeRemaining(initialStock, purchased, canSpawn);

  if (currentStock != null) {
    // Use the tighter bound when both are available; either source can lag.
    remaining = remaining != null ? Math.min(remaining, currentStock) : currentStock;
  }

  let isAvailable = false;
  if (!canSpawn) {
    isAvailable = false;
  } else if (currentStock != null) {
    isAvailable = currentStock > 0;
  } else if (remaining != null) {
    isAvailable = remaining > 0;
  } else {
    isAvailable = false;
  }

  return {
    category,
    id: String(id),
    label,
    orderIndex,
    initialStock,
    currentStock,
    remaining,
    purchased,
    canSpawn,
    isAvailable,
    priceCoins,
    priceCredits,
    priceMagicDust,
    quantityPerPurchase,
    raw: entry,
  };
}

// The game reads `.inventory` (v1361); `.items` was QPM's older reading of custom inventories,
// kept until a live custom restock confirms the shape.
function readStockInventory(stock: ShopCategorySnapshot | null): ShopInventoryEntry[] {
  const inventory = stock?.inventory ?? stock?.items;
  return Array.isArray(inventory) ? (inventory as ShopInventoryEntry[]) : [];
}

// Category normalization (pure — customInventory is passed explicitly). Timers and `raw` stay on
// the global snapshot; items and the purchase cycle come from the snapshot the shop sells from.
export function buildCategoryState(
  category: ShopCategory,
  snapshot: ShopCategorySnapshot | null,
  purchases: ShopPurchasesAtomSnapshot | null,
  customInventory: ShopCategorySnapshot | null,
  customRestock: CustomRestock | null,
): ShopStockCategoryState {
  const now = Date.now();
  const stock = resolveStockSnapshot(getAtomKeyForCategory(category), snapshot, customRestock, customInventory);
  const inventory = readStockInventory(stock);
  const cycle = getShopCycle(stock);
  const items: ShopStockItem[] = [];
  inventory.forEach((entry, index) => {
    const normalized = normalizeEntry(category, entry, purchases, index, cycle);
    if (normalized) {
      items.push(normalized);
    }
  });

  const availableCount = items.filter((item) => item.isAvailable).length;
  const signature = items
    .map((item) => `${item.id}:${item.remaining ?? 'x'}:${item.currentStock ?? 'x'}:${item.purchased}`)
    .join('|');

  const secondsUntilRestock = typeof snapshot?.secondsUntilRestock === 'number' ? snapshot!.secondsUntilRestock! : null;
  const nextRestockAt = typeof snapshot?.nextRestockAt === 'number' ? snapshot!.nextRestockAt! : null;
  const restockIntervalMs = typeof snapshot?.restockIntervalMs === 'number' ? snapshot!.restockIntervalMs! : null;

  return {
    category,
    secondsUntilRestock,
    nextRestockAt,
    restockIntervalMs,
    items,
    availableCount,
    signature,
    updatedAt: now,
    raw: snapshot ?? null,
  };
}
