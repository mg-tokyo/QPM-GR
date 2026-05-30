// src/features/shopEnhancer/types.ts
// Shared types for the shop enhancer feature.

import type { ShopCategory } from '../../../types/shops';

/** Maps activeModalAtom values to ShopCategory keys for shops we enhance. */
export const MODAL_TO_CATEGORY: Record<string, ShopCategory> = {
  seedShop: 'seeds',
  eggShop: 'eggs',
  toolShop: 'tools',
  decorShop: 'decor',
};

/** Shop types recognised by the enhancer (excludes dawnShop). */
export const ENHANCEABLE_SHOP_IDS = new Set(Object.keys(MODAL_TO_CATEGORY));

/** Map ShopCategory to RestockShopType for purchase sends. */
export const CATEGORY_TO_SHOP_TYPE: Record<ShopCategory, string> = {
  seeds: 'seed',
  eggs: 'egg',
  tools: 'tool',
  decor: 'decor',
  dawn: 'dawn',
};

export interface ShopRowInfo {
  /** The PIXI row container. */
  node: Record<string, unknown>;
  /** Extracted item name label. */
  itemName: string;
  /** Matched stock item ID (from shopStock store). */
  itemId: string | null;
  /** Whether the item is in stock. */
  isAvailable: boolean;
  /** Stock remaining (null if unknown). */
  remaining: number | null;
  /** Price in coins (null if unknown). */
  priceCoins: number | null;
  /** The item type hint for purchase sends. */
  itemType: string | undefined;
}
