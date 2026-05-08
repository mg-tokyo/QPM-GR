// src/store/shopStockParsers.ts
// Pure parsing helpers for shop stock normalization.
// No side effects; no module-level state; safe to import anywhere.

import type {
  ShopInventoryEntry,
  ShopCategorySnapshot,
  ShopPurchasesAtomSnapshot,
} from '../types/gameAtoms';
import type { ShopCategory } from '../types/shops';

// ---------------------------------------------------------------------------
// Constants & type aliases (exported for use in shopStock.ts)
// ---------------------------------------------------------------------------

export const ATOM_KEY_BY_CATEGORY: Record<ShopCategory, 'seed' | 'egg' | 'tool' | 'decor' | 'dawn'> = {
  seeds: 'seed',
  eggs: 'egg',
  tools: 'tool',
  decor: 'decor',
  dawn: 'dawn',
};

export type CustomInventoryMap = Record<string, { items: ShopInventoryEntry[] } | null> | null;
export type ShopPurchaseKey = 'seed' | 'egg' | 'tool' | 'decor' | 'dawn';
export const SHOP_PURCHASE_KEYS: ShopPurchaseKey[] = ['seed', 'egg', 'tool', 'decor', 'dawn'];

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Item field derivation
// ---------------------------------------------------------------------------

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
      return entry.id != null ? String(entry.id) : null;
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

export function getPurchaseCount(
  category: ShopCategory,
  rawId: string,
  purchases: ShopPurchasesAtomSnapshot | null,
): number {
  const key = ATOM_KEY_BY_CATEGORY[category];
  const bucket = purchases?.[key]?.purchases;
  if (!bucket || typeof bucket !== 'object') {
    return 0;
  }

  const parseCount = (value: unknown): number | null => {
    if (value == null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const normalizeId = (value: string): string => value.trim().toLowerCase();
  const id = rawId.trim();
  const candidates = new Set<string>();
  if (id.length > 0) {
    candidates.add(id);
    // Some tool IDs are observed with inconsistent trailing "s" across atoms.
    if (id.endsWith('s') && id.length > 1) {
      candidates.add(id.slice(0, -1));
    } else {
      candidates.add(`${id}s`);
    }
  }

  for (const candidate of candidates) {
    const direct = parseCount(bucket[candidate]);
    if (direct != null) {
      return direct;
    }
  }

  const numericKey = Number(rawId);
  if (Number.isFinite(numericKey) && bucket[numericKey] != null && Number.isFinite(Number(bucket[numericKey]))) {
    return Number(bucket[numericKey]);
  }

  if (candidates.size > 0) {
    const normalizedCandidates = new Set<string>(Array.from(candidates).map(normalizeId));
    for (const [bucketKey, bucketValue] of Object.entries(bucket)) {
      if (!normalizedCandidates.has(normalizeId(bucketKey))) continue;
      const parsed = parseCount(bucketValue);
      if (parsed != null) {
        return parsed;
      }
    }
  }

  return 0;
}

function computeRemaining(initialStock: number | null, purchased: number, canSpawn: boolean): number | null {
  if (initialStock == null) {
    return 0;
  }
  const bought = Number.isFinite(purchased) ? Math.max(0, Math.round(purchased)) : 0;
  const remaining = Math.max(0, initialStock - bought);
  return canSpawn ? remaining : 0;
}

// ---------------------------------------------------------------------------
// Extraction helpers (pure — all inputs are passed as parameters)
// ---------------------------------------------------------------------------

export function extractCustomInventories(slotValue: unknown): CustomInventoryMap {
  if (!slotValue || typeof slotValue !== 'object') return null;
  const slot = slotValue as Record<string, unknown>;
  const custom = slot.customRestockInventories;
  if (!custom || typeof custom !== 'object') return null;
  return custom as CustomInventoryMap;
}

function toPurchaseRecord(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed: Record<string, number> = {};
  let hasAny = false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    parsed[key] = numeric;
    hasAny = true;
  }
  return hasAny ? parsed : null;
}

function normalizePurchaseBucket(raw: unknown): { purchases?: Record<string, number> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const nested = toPurchaseRecord(row.purchases);
  if (nested) {
    return { purchases: nested };
  }
  const direct = toPurchaseRecord(row);
  if (direct) {
    return { purchases: direct };
  }
  return null;
}

export function extractMyDataShopPurchases(value: unknown): ShopPurchasesAtomSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const rawShopPurchases = (value as Record<string, unknown>).shopPurchases;
  if (!rawShopPurchases || typeof rawShopPurchases !== 'object') return null;
  const root = rawShopPurchases as Record<string, unknown>;

  const snapshot: ShopPurchasesAtomSnapshot = {};
  let hasAnyBucket = false;
  for (const key of SHOP_PURCHASE_KEYS) {
    const bucket = normalizePurchaseBucket(root[key]);
    snapshot[key] = bucket;
    if (bucket?.purchases && Object.keys(bucket.purchases).length > 0) {
      hasAnyBucket = true;
    }
  }
  return hasAnyBucket ? snapshot : null;
}

export function hasPurchaseBucket(
  snapshot: ShopPurchasesAtomSnapshot | null,
  key: ShopPurchaseKey,
): boolean {
  const bucket = snapshot?.[key]?.purchases;
  return !!bucket && typeof bucket === 'object';
}

// ---------------------------------------------------------------------------
// Item normalization
// ---------------------------------------------------------------------------

export function normalizeEntry(
  category: ShopCategory,
  entry: ShopInventoryEntry,
  purchases: ShopPurchasesAtomSnapshot | null,
  orderIndex: number,
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
  const purchased = getPurchaseCount(category, String(id), purchases);
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

// ---------------------------------------------------------------------------
// Category normalization (pure — customInventory is passed explicitly)
// ---------------------------------------------------------------------------

export function buildCategoryState(
  category: ShopCategory,
  snapshot: ShopCategorySnapshot | null,
  purchases: ShopPurchasesAtomSnapshot | null,
  customInventory: { items: ShopInventoryEntry[] } | null,
): ShopStockCategoryState {
  const now = Date.now();
  const inventory: ShopInventoryEntry[] = Array.isArray(customInventory?.items)
    ? (customInventory!.items as ShopInventoryEntry[])
    : Array.isArray(snapshot?.inventory) ? snapshot!.inventory : [];
  const items: ShopStockItem[] = [];
  inventory.forEach((entry, index) => {
    const normalized = normalizeEntry(category, entry, purchases, index);
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
