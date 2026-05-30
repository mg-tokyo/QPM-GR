// Crop harvest optimization strategies
// Dynamically computed from runtime catalog data when available,
// with hardcoded fallback for pre-catalog-load access.

import {
  areCatalogsReady,
  getAllPlantSpecies,
  getFloraBlueprint,
  getMutationMultiplier,
  onCatalogsReady,
} from '../../../catalogs/gameCatalogs';

/**
 * Harvest Strategy Types
 */
export type HarvestStrategy =
  | 'freeze-and-sell'      // Worth waiting for Frozen mutation
  | 'sell-when-mature'     // Sell immediately when mature
  | 'freeze-if-gold';      // Freeze only if Gold mutation present

/**
 * Crop Optimization Data
 * Includes base rate, frozen value, and recommended strategy
 */
export interface CropOptimizationData {
  species: string;
  baseRatePerHour: number;
  frozenValuePerHour: number;
  amberValuePerHour: number;
  rank: number;
  strategy: HarvestStrategy;
}

// ---------------------------------------------------------------------------
// Hardcoded fallback (used before catalogs load)
// ---------------------------------------------------------------------------

const FALLBACK_OPTIMIZATION: Record<string, CropOptimizationData> = {
  Moonbinder:   { species: 'Moonbinder',   baseRatePerHour: 557746,  frozenValuePerHour: 4615385, amberValuePerHour: 1622001, rank: 1,  strategy: 'freeze-and-sell' },
  Dawnbinder:   { species: 'Dawnbinder',   baseRatePerHour: 309859,  frozenValuePerHour: 2564103, amberValuePerHour: 90112,   rank: 2,  strategy: 'freeze-and-sell' },
  Starweaver:   { species: 'Starweaver',   baseRatePerHour: 281690,  frozenValuePerHour: 2331002, amberValuePerHour: 819193,  rank: 3,  strategy: 'freeze-and-sell' },
  Sunflower:    { species: 'Sunflower',    baseRatePerHour: 100000,  frozenValuePerHour: 503356,  amberValuePerHour: 73478,   rank: 4,  strategy: 'freeze-and-sell' },
  Tulip:        { species: 'Tulip',        baseRatePerHour: 394457,  frozenValuePerHour: 1036,    amberValuePerHour: 79,      rank: 5,  strategy: 'sell-when-mature' },
  Lily:         { species: 'Lily',         baseRatePerHour: 301845,  frozenValuePerHour: 26950,   amberValuePerHour: 2080,    rank: 6,  strategy: 'freeze-if-gold' },
  Cactus:       { species: 'Cactus',       baseRatePerHour: 104400,  frozenValuePerHour: 263636,  amberValuePerHour: 26497,   rank: 7,  strategy: 'freeze-and-sell' },
  Bamboo:       { species: 'Bamboo',       baseRatePerHour: 41667,   frozenValuePerHour: 257732,  amberValuePerHour: 47490,   rank: 8,  strategy: 'freeze-and-sell' },
  BurrosTail:   { species: 'BurrosTail',   baseRatePerHour: 216000,  frozenValuePerHour: 12094,   amberValuePerHour: 930,     rank: 9,  strategy: 'freeze-if-gold' },
  DragonFruit:  { species: 'DragonFruit',  baseRatePerHour: 155909,  frozenValuePerHour: 73605,   amberValuePerHour: 5895,    rank: 10, strategy: 'freeze-if-gold' },
  Lychee:       { species: 'Lychee',       baseRatePerHour: 155556,  frozenValuePerHour: 143149,  amberValuePerHour: 11997,   rank: 11, strategy: 'freeze-if-gold' },
  Echeveria:    { species: 'Echeveria',    baseRatePerHour: 138000,  frozenValuePerHour: 6188,    amberValuePerHour: 476,     rank: 12, strategy: 'freeze-if-gold' },
  Daffodil:     { species: 'Daffodil',     baseRatePerHour: 78480,   frozenValuePerHour: 1470,    amberValuePerHour: 113,     rank: 13, strategy: 'sell-when-mature' },
  Squash:       { species: 'Squash',       baseRatePerHour: 75600,   frozenValuePerHour: 8419,    amberValuePerHour: 651,     rank: 14, strategy: 'freeze-if-gold' },
  Delphinium:   { species: 'Delphinium',   baseRatePerHour: 73385,   frozenValuePerHour: 716,     amberValuePerHour: 55,      rank: 15, strategy: 'sell-when-mature' },
  Pepper:       { species: 'Pepper',       baseRatePerHour: 70887,   frozenValuePerHour: 23166,   amberValuePerHour: 1829,    rank: 16, strategy: 'freeze-if-gold' },
  Mushroom:     { species: 'Mushroom',     baseRatePerHour: 6667,    frozenValuePerHour: 50955,   amberValuePerHour: 14053,   rank: 17, strategy: 'freeze-and-sell' },
  PassionFruit: { species: 'PassionFruit', baseRatePerHour: 32667,   frozenValuePerHour: 43109,   amberValuePerHour: 3769,    rank: 18, strategy: 'freeze-and-sell' },
  Aloe:         { species: 'Aloe',         baseRatePerHour: 24800,   frozenValuePerHour: 418,     amberValuePerHour: 32,      rank: 19, strategy: 'sell-when-mature' },
  Lemon:        { species: 'Lemon',        baseRatePerHour: 14286,   frozenValuePerHour: 24077,   amberValuePerHour: 2191,    rank: 20, strategy: 'freeze-and-sell' },
  Grape:        { species: 'Grape',        baseRatePerHour: 18893,   frozenValuePerHour: 9113,    amberValuePerHour: 731,     rank: 21, strategy: 'freeze-if-gold' },
  Carrot:       { species: 'Carrot',       baseRatePerHour: 18000,   frozenValuePerHour: 27,      amberValuePerHour: 2,       rank: 22, strategy: 'sell-when-mature' },
  Watermelon:   { species: 'Watermelon',   baseRatePerHour: 13540,   frozenValuePerHour: 3563,    amberValuePerHour: 280,     rank: 23, strategy: 'freeze-if-gold' },
  Strawberry:   { species: 'Strawberry',   baseRatePerHour: 7200,    frozenValuePerHour: 41,      amberValuePerHour: 3,       rank: 24, strategy: 'sell-when-mature' },
  Pumpkin:      { species: 'Pumpkin',      baseRatePerHour: 6343,    frozenValuePerHour: 4635,    amberValuePerHour: 381,     rank: 25, strategy: 'freeze-if-gold' },
  Blueberry:    { species: 'Blueberry',    baseRatePerHour: 4436,    frozenValuePerHour: 67,      amberValuePerHour: 5,       rank: 26, strategy: 'sell-when-mature' },
  Banana:       { species: 'Banana',       baseRatePerHour: 2000,    frozenValuePerHour: 4043,    amberValuePerHour: 382,     rank: 27, strategy: 'freeze-and-sell' },
  Corn:         { species: 'Corn',         baseRatePerHour: 2880,    frozenValuePerHour: 49,      amberValuePerHour: 4,       rank: 28, strategy: 'sell-when-mature' },
  Tomato:       { species: 'Tomato',       baseRatePerHour: 2430,    frozenValuePerHour: 55,      amberValuePerHour: 4,       rank: 29, strategy: 'sell-when-mature' },
  Coconut:      { species: 'Coconut',      baseRatePerHour: 470,     frozenValuePerHour: 792,     amberValuePerHour: 72,      rank: 30, strategy: 'freeze-and-sell' },
  Apple:        { species: 'Apple',        baseRatePerHour: 49,      frozenValuePerHour: 156,     amberValuePerHour: 17,      rank: 31, strategy: 'freeze-and-sell' },
};

// ---------------------------------------------------------------------------
// Dynamic computation from catalog
// ---------------------------------------------------------------------------

let dynamicCache: Record<string, CropOptimizationData> | null = null;
let catalogListenerRegistered = false;

/**
 * Compute optimization data for a single plant species from catalog data.
 * Returns null if the species has no sell price or grow time.
 */
function computeForSpecies(species: string): CropOptimizationData | null {
  const bp = getFloraBlueprint(species);
  if (!bp) return null;

  const baseSellPrice = bp.cropBaseSellPrice;
  if (!baseSellPrice || baseSellPrice <= 0) return null;

  // For single-harvest: use crop secondsToMature (per-fruit = total).
  // For multi-harvest: total value per tile = baseSellPrice × slotCount,
  //   denominator = plant secondsToMature (total maturation) or fallback to crop time.
  const isMulti = bp.harvestType === 'Multiple';
  const fruitCount = isMulti ? bp.slotCount : 1;

  // Pick the appropriate grow time denominator
  let growSeconds: number;
  if (isMulti) {
    // Use total plant maturation time for multi-harvest
    growSeconds = bp.plantSecondsToMature ?? bp.secondsToMature ?? 0;
  } else {
    growSeconds = bp.secondsToMature ?? 0;
  }
  if (growSeconds <= 0) return null;

  const totalValuePerTile = baseSellPrice * fruitCount;
  const baseRatePerHour = (totalValuePerTile * 3600) / growSeconds;

  // Get mutation multipliers from catalog (additive formula: 1 × (1 + coinMult - 1) = coinMult)
  const frozenMult = getMutationMultiplier('Frozen') || 6;
  const amberMult = getMutationMultiplier('Ambershine') || 6;

  const frozenValuePerHour = (totalValuePerTile * frozenMult * 3600) / growSeconds;
  const amberValuePerHour = (totalValuePerTile * amberMult * 3600) / growSeconds;

  // Derive strategy from frozen-to-base ratio
  const frozenRatio = frozenMult; // Effective multiplier vs base (1×)
  let strategy: HarvestStrategy;
  if (frozenRatio > 5) {
    strategy = 'freeze-and-sell';
  } else if (frozenRatio > 1.5) {
    strategy = 'freeze-if-gold';
  } else {
    strategy = 'sell-when-mature';
  }

  return {
    species,
    baseRatePerHour: Math.round(baseRatePerHour),
    frozenValuePerHour: Math.round(frozenValuePerHour),
    amberValuePerHour: Math.round(amberValuePerHour),
    rank: 0, // Assigned after sorting
    strategy,
  };
}

function buildDynamicCache(): Record<string, CropOptimizationData> {
  const allSpecies = getAllPlantSpecies();
  const entries: CropOptimizationData[] = [];

  for (const species of allSpecies) {
    const data = computeForSpecies(species);
    if (data) entries.push(data);
  }

  // Sort by frozenValuePerHour descending to assign ranks
  entries.sort((a, b) => b.frozenValuePerHour - a.frozenValuePerHour);
  const result: Record<string, CropOptimizationData> = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    entry.rank = i + 1;
    result[entry.species] = entry;
  }

  return result;
}

function ensureCatalogListener(): void {
  if (catalogListenerRegistered) return;
  catalogListenerRegistered = true;
  onCatalogsReady(() => {
    dynamicCache = null; // Invalidate so next access rebuilds
  });
}

/**
 * Get the optimization table — dynamic from catalog if available, else hardcoded fallback.
 */
function getOptimizationTable(): Record<string, CropOptimizationData> {
  ensureCatalogListener();

  if (!areCatalogsReady()) return FALLBACK_OPTIMIZATION;

  if (!dynamicCache) {
    dynamicCache = buildDynamicCache();
  }

  return dynamicCache;
}

// ---------------------------------------------------------------------------
// Public API (same signatures as before)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use getOptimizationTable() for dynamic access. Kept for backward compat.
 */
export const CROP_OPTIMIZATION = FALLBACK_OPTIMIZATION;

/**
 * Get harvest strategy for a crop species
 */
export function getHarvestStrategy(species: string): HarvestStrategy | null {
  const table = getOptimizationTable();
  return table[species]?.strategy ?? null;
}

/**
 * Get crops by strategy type
 */
export function getCropsByStrategy(strategy: HarvestStrategy): string[] {
  const table = getOptimizationTable();
  return Object.values(table)
    .filter(crop => crop.strategy === strategy)
    .sort((a, b) => a.rank - b.rank)
    .map(crop => crop.species);
}

/**
 * Get strategy description for UI
 */
export function getStrategyDescription(strategy: HarvestStrategy): string {
  switch (strategy) {
    case 'freeze-and-sell':
      return 'Wait for Frozen mutation, then sell (high value gain)';
    case 'freeze-if-gold':
      return 'Freeze only if Gold mutation, otherwise sell when mature';
    case 'sell-when-mature':
      return 'Sell immediately when mature (not worth waiting for mutations)';
  }
}

/**
 * Calculate expected value gain from freezing
 */
export function getFreezingValueGain(species: string): number {
  const table = getOptimizationTable();
  const data = table[species];
  if (!data) return 0;
  return data.frozenValuePerHour - data.baseRatePerHour;
}

/**
 * Determine if crop is worth freezing
 */
export function isWorthFreezing(species: string, hasGoldMutation = false): boolean {
  const table = getOptimizationTable();
  const data = table[species];
  if (!data) return false;

  if (data.strategy === 'freeze-and-sell') return true;
  if (data.strategy === 'freeze-if-gold') return hasGoldMutation;
  return false;
}

/**
 * Get top N most valuable crops to freeze
 */
export function getTopCropsToFreeze(limit = 10): CropOptimizationData[] {
  const table = getOptimizationTable();
  return Object.values(table)
    .filter(crop => crop.strategy === 'freeze-and-sell')
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit);
}

/**
 * Get optimization data for a specific species.
 */
export function getCropOptimization(species: string): CropOptimizationData | null {
  const table = getOptimizationTable();
  return table[species] ?? null;
}
