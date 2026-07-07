import type { OptimizerConfig } from './types';

export const HIGH_VALUE_ABILITIES = new Set([
  'RainbowGranter',
  'GoldGranter',
  'SellBoostIII',
  'SellBoostIV',
  'PetXpBoost',
  'PetXpBoostII',
  'ProduceScaleBoost',
  'ProduceScaleBoostII',
  'PlantGrowthBoostII',
  'EggGrowthBoostII_NEW',
  'EggGrowthBoostII',
  'ProduceMutationBoostII',
  'PetMutationBoostII',
  'PetHatchSizeBoost',
  'PetHatchSizeBoostII',
  'PetAgeBoostII',
  'CoinFinderIII',
  'SeedFinderIII',
  'SeedFinderIV',
  'DoubleHarvest',
  'RainDance',
  // Dawn content (PR-2644)
  'DawnCapture',
  'DawnCoinFinder',
  'DawnXpBoost',
  'DawnBoost',
  'DawnlitGranter',
  'DawnbinderBoost',
  'DawnPlantGrowthBoost',
  'AmberMoonBoost',
  'AmberlitGranter',
  'AmberPlantGrowthBoost',
  // Thunder content (PR-3014)
  'Thundercharger',
  'ThunderstruckGranter',
  'ThunderCoinFinder',
  'ThunderBoost',
  'ThunderPlantGrowthBoost',
]);

export const LOW_VALUE_ABILITIES = new Set([
  'PlantGrowthBoost',
  'EggGrowthBoost',
  'CoinFinder',
  'SeedFinder',
  'SeedFinderI',
  'SellBoostI',
  'ProduceMutationBoost',
  'PetMutationBoost',
  'PetXpBoost',
  'ProduceScaleBoost',
  'PetHatchSizeBoost',
  'ProduceEater',
]);

export const COMMON_SPECIES = new Set(['Worm', 'Snail', 'Bee']);
export const UNCOMMON_SPECIES = new Set(['Chicken', 'Bunny', 'Dragonfly']);
export const RARE_SPECIES = new Set(['Pig', 'Cow', 'Turkey']);
export const LEGENDARY_SPECIES = new Set(['Squirrel', 'Turtle', 'Goat', 'Sheep', 'Horse', 'Pony', 'Bat', 'Platypus']);
export const MYTHICAL_SPECIES = new Set(['Butterfly', 'Peacock', 'Capybara', 'Hedgehog', 'FireHorse', 'ThunderWolf']);

export const MAX_BETTER_ALTERNATIVES = 12;
export const GOLD_DISLIKE_FACTOR = 0.5;
export const GRANTER_ANCHOR_PENALTY_CAP = 0.04;
export const ANALYSIS_CACHE_TTL_MS = 30000;

export const TIER_SCORES: Record<string, number> = {
  I: 25,
  II: 50,
  III: 75,
  IV: 100,
};

export const SPECIAL_ABILITY_SCORES: Record<string, number> = {
  Copycat: 100,
  RainDance: 80,
  DoubleHatch: 90,
  DoubleHarvest: 85,
  RainbowGranter: 95,
  GoldGranter: 85,
  SeedFinderIV: 100,
  CoinFinderIII: 100,
  Thundercharger: 85,
};

export const TIME_FAMILY_KEYS = new Set([
  'plantgrowthboost',
  'egggrowthboost',
  'hungerrestore',
  'hungerboost',
]);

// Hatch-outcome abilities: support each other only, never continuous/per-hour anchors.
// Mirrored from HATCH_TRIO_FAMILY_KEYS in petCompareEngine.ts.
export const HATCH_TRIO_BROAD_ROLE_KEYS = new Set([
  'petmutationboost',
  'petageboost',
  'pethatchsizeboost',
  'doublehatch',
]);

export const RAINBOW_TIME_UPLIFT_BASE: Record<'early' | 'mid' | 'late', number> = {
  early: 3,
  mid: 6,
  late: 7,
};

export const GOLD_TIME_UPLIFT_EARLY = 1.0;
export const GOLD_TIME_UPLIFT_DECAYED = 0.1;
export const MAX_TIME_UPLIFT_STR_EQ = 15;
export const GOLD_INTERACTION_MULTIPLIER_CAP = 1.2;

export const TURTLE_COMPOSITE_WEIGHTS: Array<{ familyKey: string; weight: number }> = [
  { familyKey: 'plantgrowthboost', weight: 0.35 },
  { familyKey: 'egggrowthboost', weight: 0.35 },
  { familyKey: 'hungerrestore', weight: 0.20 },
  { familyKey: 'hungerboost', weight: 0.10 },
];

export const SLOT_SUPPORT_WEIGHTS = [0.55, 0.30, 0.15] as const;
export const SLOT_BONUS_CAP = 0.15;
export const RAINBOW_AUTO_KEEP_MIN_SCORE = 600;
export const RAINBOW_AUTO_KEEP_MIN_MAX_STRENGTH = 90;
export const RAINBOW_AUTO_KEEP_MAX_RANK = 6;

export const PET_LOCATION_PRIORITY = {
  active: 3,
  inventory: 2,
  hutch: 1,
} as const;

export const DEFAULT_CONFIG: OptimizerConfig = {
  selectedStrategy: 'all',
  recommendationMode: 'slot_efficiency',
  showReview: true,
  showSell: true,
  showAllKeeps: false,
  dislikeGold: true,
  showTop3Only: false,
  groupBySpecies: false,
  sortBy: 'score',
  sortDirection: 'desc',
  minStrengthThreshold: 100,
  protectedPetIds: new Set(),
  mutationProtection: 'both',
  minMaxStrength: 0,
  minTargetScale: 1.0,
  minAbilityCount: 1,
  onlyRarePlus: false,
  markLowValueAbilities: false,
  prioritizeActivePets: true,
};

export function isRarePlus(species: string | null): boolean {
  if (!species) return false;
  return RARE_SPECIES.has(species) || LEGENDARY_SPECIES.has(species) || MYTHICAL_SPECIES.has(species);
}
