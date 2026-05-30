// src/features/eggEfficiency.ts
// Pure catalog-based egg efficiency analysis. No side effects, no UI.

import {
  getEggCatalog,
  getEggType,
  getEggSpawnWeights,
  getEggHatchTime,
  getPetHoursToMature,
  getPetHungerCost,
  areCatalogsReady,
} from '../../catalogs/gameCatalogs';
import { getHungerCapForSpecies } from './data/petHungerCaps';
import { getHungerDepletionTime } from './data/petHungerDepletion';
import { getPetMetadata } from './data/petMetadata';
import {
  SPECIAL_ABILITY_SCORES,
  COMMON_SPECIES,
  UNCOMMON_SPECIES,
  RARE_SPECIES,
  LEGENDARY_SPECIES,
  MYTHICAL_SPECIES,
} from './optimizer/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpeciesBreakdown {
  species: string;
  probability: number;          // 0–1
  petValue: number;             // Rarity-weighted base score
  feedCost: number | null;      // Coins to feed to maturity
  maturityHours: number | null;
  rarity: string | null;
}

export interface EggAnalysis {
  eggId: string;
  eggName: string;
  eggCost: number;              // Coin price
  creditCost: number | null;
  dustCost: number | null;      // magicDustPrice
  hatchHours: number;
  totalInvestment: number;      // eggCost + weighted feed cost
  weightedPetValue: number;
  weightedFeedCost: number;
  efficiency: number;           // value / investment ratio
  speciesBreakdown: SpeciesBreakdown[];
}

// ---------------------------------------------------------------------------
// Rarity scoring — assigns a base value score per species rarity
// ---------------------------------------------------------------------------

const RARITY_SCORES: Record<string, number> = {
  common: 10,
  uncommon: 25,
  rare: 50,
  legendary: 100,
  mythical: 200,
  celestial: 350,
  divine: 500,
};

function getSpeciesRarity(species: string): string | null {
  // 1. Try scraped metadata
  const meta = getPetMetadata(species);
  if (meta?.rarity) return meta.rarity.toLowerCase();

  // 2. Fall back to hardcoded optimizer sets
  if (COMMON_SPECIES.has(species)) return 'common';
  if (UNCOMMON_SPECIES.has(species)) return 'uncommon';
  if (RARE_SPECIES.has(species)) return 'rare';
  if (LEGENDARY_SPECIES.has(species)) return 'legendary';
  if (MYTHICAL_SPECIES.has(species)) return 'mythical';

  return null;
}

function scoreSpecies(species: string): number {
  const rarity = getSpeciesRarity(species);
  return RARITY_SCORES[rarity ?? ''] ?? 30; // unknown → modest default
}

// ---------------------------------------------------------------------------
// Feed cost calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the total coin cost of feeding a species from hatch to maturity.
 * formula: feedsNeeded = ceil(maturityMinutes / depletionMinutes)
 *          feedCost   = feedsNeeded × hungerCap
 */
function calculateFeedCostToMaturity(species: string): number | null {
  const maturityHours = getPetHoursToMature(species);
  if (maturityHours == null) return null;

  const depletionMinutes = getHungerDepletionTime(species);
  if (depletionMinutes == null) return null;

  const hungerCap = getHungerCapForSpecies(species);
  if (hungerCap == null) return null;

  const maturityMinutes = maturityHours * 60;
  const feedsNeeded = Math.ceil(maturityMinutes / depletionMinutes);
  return feedsNeeded * hungerCap;
}

// ---------------------------------------------------------------------------
// Single egg analysis
// ---------------------------------------------------------------------------

function analyzeEgg(eggId: string): EggAnalysis | null {
  const egg = getEggType(eggId);
  if (!egg) return null;

  const hatchSeconds = getEggHatchTime(eggId);
  const hatchHours = hatchSeconds != null ? hatchSeconds / 3600 : 0;

  const eggCost = egg.coinPrice ?? 0;
  const creditCost = egg.creditPrice ?? null;
  const dustCost = egg.magicDustPrice ?? null;
  const eggName = egg.name ?? eggId;

  // Build species breakdown from spawn weights
  const weights = getEggSpawnWeights(eggId);
  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) {
    return {
      eggId,
      eggName,
      eggCost,
      creditCost,
      dustCost,
      hatchHours,
      totalInvestment: eggCost,
      weightedPetValue: 0,
      weightedFeedCost: 0,
      efficiency: 0,
      speciesBreakdown: [],
    };
  }

  const breakdown: SpeciesBreakdown[] = [];
  let weightedValue = 0;
  let weightedFeed = 0;

  for (const [species, weight] of Object.entries(weights)) {
    const prob = weight / totalWeight;
    const petValue = scoreSpecies(species);
    const feedCost = calculateFeedCostToMaturity(species);
    const maturityHours = getPetHoursToMature(species);
    const rarity = getSpeciesRarity(species);

    breakdown.push({ species, probability: prob, petValue, feedCost, maturityHours, rarity });

    weightedValue += prob * petValue;
    weightedFeed += prob * (feedCost ?? 0);
  }

  // Sort by probability desc, then value desc
  breakdown.sort((a, b) => b.probability - a.probability || b.petValue - a.petValue);

  const totalInvestment = eggCost + weightedFeed;
  const efficiency = totalInvestment > 0 ? weightedValue / totalInvestment : 0;

  return {
    eggId,
    eggName,
    eggCost,
    creditCost,
    dustCost,
    hatchHours,
    totalInvestment,
    weightedPetValue: weightedValue,
    weightedFeedCost: weightedFeed,
    efficiency,
    speciesBreakdown: breakdown,
  };
}

// ---------------------------------------------------------------------------
// Analyze all eggs
// ---------------------------------------------------------------------------

/** Egg IDs known to be deprecated / replaced by a newer variant. */
const DEPRECATED_EGG_IDS = new Set(['WinterEgg']);

export function analyzeAllEggs(): EggAnalysis[] {
  if (!areCatalogsReady()) return [];

  const catalog = getEggCatalog();
  if (!catalog) return [];

  const results: EggAnalysis[] = [];
  for (const eggId of Object.keys(catalog)) {
    if (DEPRECATED_EGG_IDS.has(eggId)) continue;
    const analysis = analyzeEgg(eggId);
    if (analysis && analysis.speciesBreakdown.length > 0) results.push(analysis);
  }

  // Sort by egg cost desc (most expensive first) as a sensible default
  results.sort((a, b) => b.eggCost - a.eggCost);
  return results;
}
