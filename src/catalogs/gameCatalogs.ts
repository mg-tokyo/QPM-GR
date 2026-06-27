// src/catalogs/gameCatalogs.ts
// Typed access layer for game catalogs
// Provides convenient, type-safe methods to access runtime game data

import {
  getCatalogs,
  areCatalogsReady,
  waitForCatalogs,
  onCatalogsReady,
  initCatalogLoader,
  cleanupCatalogLoader,
  forceWeatherCatalogRefresh,
  getCosmeticOwnership,
  isCosmeticOwned,
  isCosmeticAvailable,
} from './catalogLoader';
import type {
  GameCatalogs,
  PetCatalog,
  PetCatalogEntry,
  PlantCatalog,
  PlantCatalogEntry,
  PlantStageInfo,
  EggCatalog,
  EggCatalogEntry,
  ItemCatalog,
  ItemCatalogEntry,
  DecorCatalog,
  DecorCatalogEntry,
  MutationCatalog,
  MutationCatalogEntry,
  PetAbilities,
  PetAbilityEntry,
  CosmeticCatalog,
  CosmeticCatalogEntry,
} from './types';

// Re-export for convenience
export {
  getCatalogs,
  areCatalogsReady,
  waitForCatalogs,
  onCatalogsReady,
  initCatalogLoader,
  cleanupCatalogLoader,
  forceWeatherCatalogRefresh,
} from './catalogLoader';
export type { GameCatalogs };

// Re-export diagnostic function
import { diagnoseCatalogs } from './catalogLoader';
export { diagnoseCatalogs };

// ============================================================================
// HELPERS
// ============================================================================

/** Clamp non-finite catalog prices (Infinity for dust-only items, NaN) to 0. */
function finiteOrZero(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// ============================================================================
// PET CATALOG ACCESS
// ============================================================================

/**
 * Get the pet catalog (may be null if not loaded)
 */
export function getPetCatalog(): PetCatalog | null {
  return getCatalogs().petCatalog;
}

/**
 * Get a specific pet species entry
 */
export function getPetSpecies(species: string): PetCatalogEntry | null {
  const catalog = getPetCatalog();
  if (!catalog) return null;
  return catalog[species] ?? null;
}

/**
 * Get all pet species keys
 */
export function getAllPetSpecies(): string[] {
  const catalog = getPetCatalog();
  if (!catalog) return [];
  return Object.keys(catalog);
}

/**
 * Get the diet (allowed foods) for a pet species
 * @returns Array of food species names, or empty array if not found
 */
export function getPetDiet(species: string): string[] {
  const pet = getPetSpecies(species);
  if (!pet || !Array.isArray(pet.diet)) return [];
  return [...pet.diet];
}

/**
 * Get hunger cost to fully replenish a pet
 */
export function getPetHungerCost(species: string): number | null {
  const pet = getPetSpecies(species);
  return pet?.coinsToFullyReplenishHunger ?? null;
}

/**
 * Get hours to mature for a pet species (from the live catalog)
 */
export function getPetHoursToMature(species: string): number | null {
  const pet = getPetSpecies(species);
  const hours = pet?.hoursToMature;
  return typeof hours === 'number' && hours > 0 ? hours : null;
}

/**
 * Get max scale for a pet species (from the live catalog)
 */
export function getPetMaxScale(species: string): number | null {
  const pet = getPetSpecies(species);
  const maxScale = pet?.maxScale;
  return typeof maxScale === 'number' && maxScale > 1 ? maxScale : null;
}

/**
 * Check if a food is valid for a pet species
 */
export function canPetEat(petSpecies: string, foodSpecies: string): boolean {
  const diet = getPetDiet(petSpecies);
  if (diet.length === 0) return true; // Unknown pet, allow any food

  // Normalize for comparison (case-insensitive)
  const normalizedFood = foodSpecies.toLowerCase().replace(/\s+/g, '');
  return diet.some(food => food.toLowerCase().replace(/\s+/g, '') === normalizedFood);
}

/**
 * Get all pet diets as a map
 * Useful for replacing hardcoded RAW_PET_DIETS
 */
export function getAllPetDiets(): Record<string, string[]> {
  const catalog = getPetCatalog();
  if (!catalog) return {};

  const diets: Record<string, string[]> = {};
  for (const [species, entry] of Object.entries(catalog)) {
    if (entry && Array.isArray(entry.diet)) {
      diets[species] = [...entry.diet];
    }
  }
  return diets;
}

// ============================================================================
// PLANT CATALOG ACCESS
// ============================================================================

/**
 * Get the plant catalog (may be null if not loaded)
 */
export function getPlantCatalog(): PlantCatalog | null {
  return getCatalogs().plantCatalog;
}

/**
 * Get a specific plant species entry
 */
export function getPlantSpecies(species: string): PlantCatalogEntry | null {
  const catalog = getPlantCatalog();
  if (!catalog) return null;
  return catalog[species] ?? null;
}

/**
 * Get all plant species keys
 */
export function getAllPlantSpecies(): string[] {
  const catalog = getPlantCatalog();
  if (!catalog) return [];
  return Object.keys(catalog);
}

/**
 * Get seed price for a plant
 */
export function getSeedPrice(species: string): { coins: number; credits: number } | null {
  const plant = getPlantSpecies(species);
  if (!plant?.seed) return null;

  return {
    coins: finiteOrZero(plant.seed.coinPrice),
    credits: finiteOrZero(plant.seed.creditPrice),
  };
}

// ============================================================================
// FLORA BLUEPRINT ACCESS (multi-harvest plant data)
// ============================================================================

export interface SlotOffset {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

export interface FloraBlueprint {
  species: string;
  harvestType: 'Single' | 'Multiple';
  plantBaseTileScale: number;
  slotOffsets: ReadonlyArray<SlotOffset>;
  slotCount: number;
  rotateSlotOffsetsRandomly: boolean;
  tileTransformOrigin: string | null;
  secondsToMature: number | null;
  plantSecondsToMature: number | null;
  plantSpriteKey: string | null;
  cropSpriteKey: string | null;
  cropBaseTileScale: number | null;
  cropMaxScale: number | null;
  cropBaseWeight: number | null;
  cropBaseSellPrice: number | null;
}

/** Type-safe number reader from untyped stage info. */
function stageNum(stage: PlantStageInfo | undefined, key: string): number | null {
  if (!stage) return null;
  const v = stage[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Type-safe string reader from untyped stage info. */
function stageStr(stage: PlantStageInfo | undefined, key: string): string | null {
  if (!stage) return null;
  const v = stage[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Build a typed FloraBlueprint from a plant catalog entry.
 * Reads `plant` and `crop` sub-objects defensively since data comes from runtime capture.
 */
export function getFloraBlueprint(species: string): FloraBlueprint | null {
  const entry = getPlantSpecies(species);
  if (!entry) return null;

  const plant = entry.plant;
  const crop = entry.crop;
  if (!plant) return null;

  const harvestTypeRaw = stageStr(plant, 'harvestType');
  const harvestType: 'Single' | 'Multiple' =
    harvestTypeRaw === 'Multiple' ? 'Multiple' : 'Single';

  // Validate slot offsets array
  let slotOffsets: ReadonlyArray<SlotOffset> = [];
  const rawSlots = plant.slotOffsets;
  if (Array.isArray(rawSlots)) {
    slotOffsets = rawSlots.filter(
      (s): s is SlotOffset =>
        s != null &&
        typeof s === 'object' &&
        typeof (s as Record<string, unknown>).x === 'number' &&
        typeof (s as Record<string, unknown>).y === 'number' &&
        typeof (s as Record<string, unknown>).rotation === 'number'
    );
  }

  const slotCountMax = stageNum(plant, 'slotCountMax');
  const slotCount = slotCountMax ?? slotOffsets.length;

  return {
    species,
    harvestType,
    plantBaseTileScale: stageNum(plant, 'baseTileScale') ?? 1,
    slotOffsets,
    slotCount,
    rotateSlotOffsetsRandomly: plant.rotateSlotOffsetsRandomly === true,
    tileTransformOrigin: stageStr(plant, 'tileTransformOrigin'),
    secondsToMature: stageNum(crop, 'secondsToMature'),
    plantSecondsToMature: stageNum(plant, 'secondsToMature'),
    plantSpriteKey: stageStr(plant, 'sprite'),
    cropSpriteKey: stageStr(crop, 'sprite'),
    cropBaseTileScale: stageNum(crop, 'baseTileScale'),
    cropMaxScale: stageNum(crop, 'maxScale'),
    cropBaseWeight: stageNum(crop, 'baseWeight'),
    cropBaseSellPrice: stageNum(crop, 'baseSellPrice'),
  };
}

/**
 * Get slot offsets for a plant species.
 */
export function getSlotOffsets(species: string): ReadonlyArray<SlotOffset> | null {
  const bp = getFloraBlueprint(species);
  return bp?.slotOffsets ?? null;
}

/**
 * Check if a plant species is multi-harvest.
 */
export function isMultiHarvest(species: string): boolean {
  const bp = getFloraBlueprint(species);
  return bp?.harvestType === 'Multiple';
}

/**
 * Get the max scale for a crop species from the runtime catalog.
 */
export function getCropMaxScale(species: string): number | null {
  const bp = getFloraBlueprint(species);
  return bp?.cropMaxScale ?? null;
}

/**
 * Get the plant base tile scale from the runtime catalog.
 */
export function getPlantBaseTileScale(species: string): number | null {
  const bp = getFloraBlueprint(species);
  return bp ? bp.plantBaseTileScale : null;
}

/**
 * Get the crop base sell price from the runtime catalog.
 */
export function getCropBaseSellPrice(species: string): number | null {
  const bp = getFloraBlueprint(species);
  return bp?.cropBaseSellPrice ?? null;
}

/**
 * Get the crop base weight from the runtime catalog.
 */
export function getCropBaseWeight(species: string): number | null {
  const bp = getFloraBlueprint(species);
  return bp?.cropBaseWeight ?? null;
}

/**
 * Get seconds to mature for a crop (per-fruit grow time) from the runtime catalog.
 */
export function getSecondsToMature(species: string): number | null {
  const bp = getFloraBlueprint(species);
  return bp?.secondsToMature ?? null;
}

/**
 * Get seconds to mature for the plant stage (total maturation time) from the runtime catalog.
 */
export function getPlantSecondsToMature(species: string): number | null {
  const bp = getFloraBlueprint(species);
  return bp?.plantSecondsToMature ?? null;
}

// ============================================================================
// EGG CATALOG ACCESS
// ============================================================================

/**
 * Get the egg catalog (may be null if not loaded)
 */
export function getEggCatalog(): EggCatalog | null {
  return getCatalogs().eggCatalog;
}

/**
 * Get a specific egg type entry
 */
export function getEggType(eggId: string): EggCatalogEntry | null {
  const catalog = getEggCatalog();
  if (!catalog) return null;
  return catalog[eggId] ?? null;
}

/**
 * Get all egg type keys
 */
export function getAllEggTypes(): string[] {
  const catalog = getEggCatalog();
  if (!catalog) return [];
  return Object.keys(catalog);
}

/**
 * Get hatch time for an egg in seconds
 */
export function getEggHatchTime(eggId: string): number | null {
  const egg = getEggType(eggId);
  return egg?.secondsToHatch ?? null;
}

/**
 * Get possible pets that can hatch from an egg
 */
export function getEggSpawnWeights(eggId: string): Record<string, number> {
  const egg = getEggType(eggId);
  if (!egg?.faunaSpawnWeights) return {};

  // Handle both array and object formats
  if (Array.isArray(egg.faunaSpawnWeights)) {
    const weights: Record<string, number> = {};
    for (const entry of egg.faunaSpawnWeights) {
      if (entry.species && typeof entry.weight === 'number') {
        weights[entry.species] = entry.weight;
      }
    }
    return weights;
  }

  return { ...egg.faunaSpawnWeights } as Record<string, number>;
}

// ============================================================================
// ITEM CATALOG ACCESS
// ============================================================================

/**
 * Get the item catalog (may be null if not loaded)
 */
export function getItemCatalog(): ItemCatalog | null {
  return getCatalogs().itemCatalog;
}

/**
 * Get a specific item entry
 */
export function getItem(itemId: string): ItemCatalogEntry | null {
  const catalog = getItemCatalog();
  if (!catalog) return null;
  return catalog[itemId] ?? null;
}

/**
 * Get all item keys
 */
export function getAllItems(): string[] {
  const catalog = getItemCatalog();
  if (!catalog) return [];
  return Object.keys(catalog);
}

/**
 * Get item price
 */
export function getItemPrice(itemId: string): { coins: number; credits: number } | null {
  const item = getItem(itemId);
  if (!item) return null;

  return {
    coins: finiteOrZero(item.coinPrice),
    credits: finiteOrZero(item.creditPrice),
  };
}

// ============================================================================
// DECOR CATALOG ACCESS
// ============================================================================

/**
 * Get the decor catalog (may be null if not loaded)
 */
export function getDecorCatalog(): DecorCatalog | null {
  return getCatalogs().decorCatalog;
}

/**
 * Get a specific decoration entry
 */
export function getDecor(decorId: string): DecorCatalogEntry | null {
  const catalog = getDecorCatalog();
  if (!catalog) return null;
  return catalog[decorId] ?? null;
}

/**
 * Get all decoration keys
 */
export function getAllDecor(): string[] {
  const catalog = getDecorCatalog();
  if (!catalog) return [];
  return Object.keys(catalog);
}

// ============================================================================
// MUTATION CATALOG ACCESS
// ============================================================================

/**
 * Get the mutation catalog (may be null if not loaded)
 */
export function getMutationCatalog(): MutationCatalog | null {
  return getCatalogs().mutationCatalog;
}

/**
 * Get a specific mutation entry
 */
export function getMutation(mutationId: string): MutationCatalogEntry | null {
  const catalog = getMutationCatalog();
  if (!catalog) return null;
  return catalog[mutationId] ?? null;
}

/**
 * Get all mutation keys
 */
export function getAllMutations(): string[] {
  const catalog = getMutationCatalog();
  if (!catalog) return [];
  return Object.keys(catalog);
}

// ============================================================================
// WEATHER CATALOG ACCESS
// ============================================================================

/**
 * Get the weather catalog (may be null if not loaded)
 */
export function getWeatherCatalog(): Record<string, unknown> | null {
  return getCatalogs().weatherCatalog;
}

/**
 * Get a specific weather definition
 */
export function getWeatherDef(weatherId: string): Record<string, unknown> | null {
  const catalog = getWeatherCatalog();
  if (!catalog) return null;
  const entry = catalog[weatherId];
  return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
}

/**
 * Get all weather IDs
 */
export function getAllWeatherIds(): string[] {
  const catalog = getWeatherCatalog();
  if (!catalog) return [];
  return Object.keys(catalog);
}

/**
 * Get mutation coin multiplier
 */
export function getMutationMultiplier(mutationId: string): number {
  const mutation = getMutation(mutationId);
  return mutation?.coinMultiplier ?? 1;
}

// ============================================================================
// PET ABILITIES ACCESS
// ============================================================================

/**
 * Get the pet abilities catalog (may be null if not loaded)
 */
export function getPetAbilitiesCatalog(): PetAbilities | null {
  return getCatalogs().petAbilities;
}

/**
 * Get a specific ability definition
 */
export function getAbilityDef(abilityId: string): PetAbilityEntry | null {
  const catalog = getPetAbilitiesCatalog();
  if (!catalog) return null;
  return catalog[abilityId] ?? null;
}

/**
 * Get all ability keys
 */
export function getAllAbilities(): string[] {
  const catalog = getPetAbilitiesCatalog();
  if (!catalog) return [];
  return Object.keys(catalog);
}

// ============================================================================
// COSMETIC CATALOG ACCESS
// ============================================================================

export function getCosmeticCatalog(): CosmeticCatalog | null {
  return getCatalogs().cosmeticCatalog;
}

export function getCosmeticByFilename(filename: string): CosmeticCatalogEntry | undefined {
  const catalog = getCosmeticCatalog();
  if (!catalog) return undefined;
  return catalog.find(c => c.filename === filename);
}

export function getCosmeticsByType(type: string): CosmeticCatalogEntry[] {
  const catalog = getCosmeticCatalog();
  if (!catalog) return [];
  return catalog.filter(c => c.type === type);
}

// ============================================================================
// COSMETIC OWNERSHIP ACCESS
// ============================================================================

export { getCosmeticOwnership, isCosmeticOwned, isCosmeticAvailable };

// ============================================================================
// DIAGNOSTIC UTILITIES
// ============================================================================

/**
 * Get a summary of loaded catalogs for debugging
 */
export function getCatalogLoadStatus(): Record<string, { loaded: boolean; count: number }> {
  const catalogs = getCatalogs();

  return {
    petCatalog: {
      loaded: catalogs.petCatalog !== null,
      count: catalogs.petCatalog ? Object.keys(catalogs.petCatalog).length : 0,
    },
    plantCatalog: {
      loaded: catalogs.plantCatalog !== null,
      count: catalogs.plantCatalog ? Object.keys(catalogs.plantCatalog).length : 0,
    },
    eggCatalog: {
      loaded: catalogs.eggCatalog !== null,
      count: catalogs.eggCatalog ? Object.keys(catalogs.eggCatalog).length : 0,
    },
    itemCatalog: {
      loaded: catalogs.itemCatalog !== null,
      count: catalogs.itemCatalog ? Object.keys(catalogs.itemCatalog).length : 0,
    },
    decorCatalog: {
      loaded: catalogs.decorCatalog !== null,
      count: catalogs.decorCatalog ? Object.keys(catalogs.decorCatalog).length : 0,
    },
    mutationCatalog: {
      loaded: catalogs.mutationCatalog !== null,
      count: catalogs.mutationCatalog ? Object.keys(catalogs.mutationCatalog).length : 0,
    },
    petAbilities: {
      loaded: catalogs.petAbilities !== null,
      count: catalogs.petAbilities ? Object.keys(catalogs.petAbilities).length : 0,
    },
    weatherCatalog: {
      loaded: catalogs.weatherCatalog !== null,
      count: catalogs.weatherCatalog ? Object.keys(catalogs.weatherCatalog).length : 0,
    },
  };
}

/**
 * Log current catalog load status to console
 */
export function logCatalogStatus(): void {
  const status = getCatalogLoadStatus();
  console.log('[QPM Catalogs] Load Status:');
  for (const [name, info] of Object.entries(status)) {
    console.log(`  ${name}: ${info.loaded ? `✅ (${info.count} entries)` : '❌ not loaded'}`);
  }
}
