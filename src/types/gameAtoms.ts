// src/types/gameAtoms.ts
// Shared type definitions for known MagicGarden jotai atoms we consume.

export type WeatherAtomValue = string | null | undefined;

export interface GridPosition {
  x: number;
  y: number;
}

export interface PlayerAtomValue {
  id?: string;
  name?: string;
  cosmetic?: unknown;
  discordUserId?: string;
  databaseUserId?: string;
  [key: string]: unknown;
}

export interface ShopInventoryEntry {
  species?: string;
  eggId?: string;
  toolId?: string;
  decorId?: string;
  itemId?: string;
  name?: string;
  displayName?: string;
  price?: number;
  priceCoins?: number;
  priceCredits?: number;
  currency?: 'coins' | 'credits' | 'magicDust';
  stock?: number;
  initialStock?: number;
  /** @deprecated Removed in game update. Kept for backward compatibility. All items can now spawn. */
  canSpawnHere?: boolean;
  restockAt?: number;
  restockMs?: number;
  quantityPerPurchase?: number;
  [key: string]: unknown;
}

export interface ShopCategorySnapshot {
  inventory?: ShopInventoryEntry[];
  purchases?: Record<string, number>;
  nextRestockAt?: number | null;
  restockIntervalMs?: number | null;
  secondsUntilRestock?: number | null;
  [key: string]: unknown;
}

export interface ShopsAtomSnapshot {
  seed?: ShopCategorySnapshot;
  egg?: ShopCategorySnapshot;
  tool?: ShopCategorySnapshot;
  decor?: ShopCategorySnapshot;
  [key: string]: ShopCategorySnapshot | undefined;
}

export interface ShopPurchasesAtomSnapshot {
  seed?: { purchases?: Record<string, number> } | null;
  egg?: { purchases?: Record<string, number> } | null;
  tool?: { purchases?: Record<string, number> } | null;
  decor?: { purchases?: Record<string, number> } | null;
  [key: string]: { purchases?: Record<string, number> } | null | undefined;
}
