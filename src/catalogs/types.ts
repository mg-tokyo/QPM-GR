// src/catalogs/types.ts
// TypeScript interfaces for Magic Garden game catalogs
// FULLY DYNAMIC - No hardcoded item/pet names, captures whatever the game has

/**
 * Sprite/tile reference for visual assets
 */
export interface TileRef {
  sheet?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  [key: string]: unknown;
}

// ============================================================================
// ITEM CATALOG - Tools, potions, and other purchasable items
// ============================================================================

export interface ItemCatalogEntry {
  tileRef?: TileRef;
  name?: string;
  coinPrice: number;
  creditPrice: number;
  magicDustPrice?: number;
  rarity?: string;
  description?: string;
  [key: string]: unknown;
}

/** Dynamic catalog - keys are item IDs discovered at runtime */
export type ItemCatalog = Record<string, ItemCatalogEntry>;

// ============================================================================
// DECOR CATALOG - Garden decorations
// ============================================================================

export interface DecorCatalogEntry {
  tileRef?: TileRef;
  rotationVariants?: Record<string, TileRef>;
  name?: string;
  coinPrice: number;
  creditPrice: number;
  rarity?: string;
  [key: string]: unknown;
}

/** Dynamic catalog - keys are decor IDs discovered at runtime */
export type DecorCatalog = Record<string, DecorCatalogEntry>;

// ============================================================================
// MUTATION CATALOG - Crop mutations (Gold, Rainbow, weather-based, etc.)
// ============================================================================

export interface MutationCatalogEntry {
  baseChance: number;
  coinMultiplier: number;
  tileRef?: TileRef;
  name?: string;
  /** CSS color or linear-gradient — enriched from the bundle, not in the game dex */
  color?: string;
  [key: string]: unknown;
}

/** Dynamic catalog - keys are mutation IDs discovered at runtime */
export type MutationCatalog = Record<string, MutationCatalogEntry>;

// ============================================================================
// EGG CATALOG - Pet eggs with spawn weights and hatch info
// ============================================================================

export interface EggCatalogEntry {
  tileRef?: TileRef;
  name?: string;
  faunaSpawnWeights: unknown; // Can be array or object, varies by game version
  secondsToHatch: number;
  coinPrice?: number;
  creditPrice?: number;
  magicDustPrice?: number;
  [key: string]: unknown;
}

/** Dynamic catalog - keys are egg IDs discovered at runtime */
export type EggCatalog = Record<string, EggCatalogEntry>;

// ============================================================================
// PET CATALOG - Pet species with diets and hunger costs
// Critical: diet array and coinsToFullyReplenishHunger are the detection keys
// ============================================================================

export interface PetCatalogEntry {
  tileRef?: TileRef;
  name?: string;
  diet: string[];
  coinsToFullyReplenishHunger: number;
  hoursToMature?: number;
  maxScale?: number;
  rarity?: string;
  [key: string]: unknown;
}

/** Dynamic catalog - keys are pet species discovered at runtime */
export type PetCatalog = Record<string, PetCatalogEntry>;

// ============================================================================
// PET ABILITIES - Ability definitions with triggers and parameters
// ============================================================================

export interface PetAbilityEntry {
  trigger: string;
  baseParameters: Record<string, unknown>;
  baseProbability?: number;
  name?: string;
  [key: string]: unknown;
}

/** Dynamic catalog - keys are ability IDs discovered at runtime */
export type PetAbilities = Record<string, PetAbilityEntry>;

// ============================================================================
// PLANT CATALOG - Plants with seed/plant/crop stages
// ============================================================================

export interface PlantStageInfo {
  tileRef?: TileRef;
  name?: string;
  coinPrice?: number;
  creditPrice?: number;
  // --- Flora blueprint fields (captured at runtime, previously untyped) ---
  sprite?: string;                    // atlas frame key, e.g. 'sprite/plant/SproutFruit'
  harvestType?: string;               // 'Single' | 'Multiple'
  baseTileScale?: number;             // world-space scale of this element
  maxScale?: number;                  // max growth scale (crop stage)
  baseWeight?: number;                // base weight in kg (crop stage)
  baseSellPrice?: number;             // base sell price (crop stage)
  slotOffsets?: ReadonlyArray<{ x: number; y: number; rotation: number }>;
  rotateSlotOffsetsRandomly?: boolean;
  tileTransformOrigin?: string;       // 'bottom' | 'center'
  secondsToMature?: number;
  immatureSprite?: string;
  slotCountMin?: number;
  slotCountMax?: number;
  slotCapacity?: number;
  [key: string]: unknown;             // keep for forward compat
}

export interface PlantCatalogEntry {
  seed: PlantStageInfo;
  plant: PlantStageInfo;
  crop: PlantStageInfo;
  name?: string;
  [key: string]: unknown;
}

/** Dynamic catalog - keys are plant species discovered at runtime */
export type PlantCatalog = Record<string, PlantCatalogEntry>;

// ============================================================================
// COSMETIC CATALOG - Avatar cosmetic items
// ============================================================================

export interface CosmeticCatalogEntry {
  id: string;
  type: string;
  filename: string;
  displayName: string;
  availability: string;
  price: number;
  [key: string]: unknown;
}

export type CosmeticCatalog = CosmeticCatalogEntry[];

// ============================================================================
// AGGREGATED CATALOGS CONTAINER
// ============================================================================

export interface GameCatalogs {
  itemCatalog: ItemCatalog | null;
  decorCatalog: DecorCatalog | null;
  mutationCatalog: MutationCatalog | null;
  eggCatalog: EggCatalog | null;
  petCatalog: PetCatalog | null;
  petAbilities: PetAbilities | null;
  plantCatalog: PlantCatalog | null;
  weatherCatalog: Record<string, unknown> | null;
  cosmeticCatalog: CosmeticCatalog | null;
}

/**
 * Type guard to check if a catalog is loaded
 */
export function isCatalogLoaded<T>(catalog: T | null): catalog is T {
  return catalog !== null;
}

/**
 * Get list of all catalog keys
 */
export const CATALOG_KEYS = [
  'itemCatalog',
  'decorCatalog',
  'mutationCatalog',
  'eggCatalog',
  'petCatalog',
  'petAbilities',
  'plantCatalog',
  'weatherCatalog',
  'cosmeticCatalog',
] as const;

export type CatalogKey = typeof CATALOG_KEYS[number];
