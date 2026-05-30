// src/data/abilityStrategies.ts
// Ability strategy categorization for Pet Optimizer

export type StrategyCategory =
  | 'growth'
  | 'coins'
  | 'mutations'
  | 'xp'
  | 'harvest'
  | 'specialty'
  | 'general';

export interface StrategyDefinition {
  id: StrategyCategory;
  name: string;
  icon: string;
  description: string;
}

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [
  {
    id: 'growth',
    name: 'Growth Acceleration',
    icon: '🌱',
    description: 'Speeds up plant or egg growth',
  },
  {
    id: 'coins',
    name: 'Coin Generation',
    icon: '💰',
    description: 'Increases coin income',
  },
  {
    id: 'mutations',
    name: 'Mutation Boosting',
    icon: '✨',
    description: 'Boosts mutation chances or grants special mutations',
  },
  {
    id: 'xp',
    name: 'XP Farming',
    icon: '📈',
    description: 'Increases XP gains',
  },
  {
    id: 'harvest',
    name: 'Harvest Boosting',
    icon: '🌾',
    description: 'Increases harvest yields',
  },
  {
    id: 'specialty',
    name: 'Specialty',
    icon: '⭐',
    description: 'Unique or rare abilities',
  },
  {
    id: 'general',
    name: 'General',
    icon: '📋',
    description: 'Other useful abilities',
  },
];

// Map of ability IDs to their strategy categories
const ABILITY_STRATEGY_MAP: Record<string, StrategyCategory> = {
  // Growth abilities
  PlantGrowthBoost: 'growth',
  PlantGrowthBoostII: 'growth',
  EggGrowthBoost: 'growth',
  EggGrowthBoostII: 'growth',
  EggGrowthBoostII_NEW: 'growth',

  // Coin abilities
  CoinFinder: 'coins',
  CoinFinderII: 'coins',
  CoinFinderIII: 'coins',
  SellBoostI: 'coins',
  SellBoostII: 'coins',
  SellBoostIII: 'coins',
  SellBoostIV: 'coins',
  ProduceRefund: 'coins',

  // Mutation abilities
  RainbowGranter: 'mutations',
  GoldGranter: 'mutations',
  ProduceMutationBoost: 'mutations',
  ProduceMutationBoostII: 'mutations',
  PetMutationBoost: 'mutations',
  PetMutationBoostII: 'mutations',

  // XP abilities
  PetXpBoost: 'xp',
  PetXpBoostII: 'xp',

  // Harvest abilities
  DoubleHarvest: 'harvest',
  ProduceScaleBoost: 'harvest',
  ProduceScaleBoostII: 'harvest',

  // Specialty abilities
  RainDance: 'specialty',
  PetHatchSizeBoost: 'specialty',
  PetHatchSizeBoostII: 'specialty',
  PetAgeBoostII: 'specialty',

  // Seed finders
  SeedFinder: 'coins',
  SeedFinderII: 'coins',
  SeedFinderIII: 'coins',
  SeedFinderIV: 'coins',

  // Other
  ProduceEater: 'general',
  PetRefund: 'general',
  DoubleHatch: 'specialty',
};

/**
 * Get strategy category for an ability
 */
export function getAbilityStrategy(abilityId: string): StrategyCategory {
  return ABILITY_STRATEGY_MAP[abilityId] || 'general';
}

/**
 * Abilities that don't stack (only the highest tier applies)
 */
export const NON_STACKING_ABILITIES = new Set([
  'SellBoostI',
  'SellBoostII',
  'SellBoostIII',
  'SellBoostIV',
  'PlantGrowthBoost',
  'PlantGrowthBoostII',
  'EggGrowthBoost',
  'EggGrowthBoostII',
  'EggGrowthBoostII_NEW',
  'CoinFinder',
  'CoinFinderII',
  'CoinFinderIII',
  'SeedFinder',
  'SeedFinderII',
  'SeedFinderIII',
  'SeedFinderIV',
  'ProduceMutationBoost',
  'ProduceMutationBoostII',
  'PetMutationBoost',
  'PetMutationBoostII',
  'PetXpBoost',
  'PetXpBoostII',
  'ProduceScaleBoost',
  'ProduceScaleBoostII',
  'PetHatchSizeBoost',
  'PetHatchSizeBoostII',
]);
