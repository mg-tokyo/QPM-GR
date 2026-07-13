export const FOOD_FAMILY_KEYS = new Set(['hungerrestore', 'hungerboost']);
export const HATCH_DOLLAR_FAMILY_KEYS = new Set(['petrefund']);
export const HATCH_TRIO_FAMILY_KEYS = new Set(['petmutationboost', 'petageboost', 'pethatchsizeboost', 'doublehatch']);
export const ISOLATED_ABILITY_IDS = new Set(['Copycat', 'RainDance']);
export const HATCH_MODIFIER_PARAM_KEYS = new Set(['mutationChanceIncreasePercentage']);
export const CONTINUOUS_MODIFIER_PARAM_KEYS = new Set([
  'mutationChanceIncreasePercentage',
  'hungerRefundPercentage',
  'hungerRestorePercentage',
  'plantGrowthReductionMinutes',
  'eggGrowthTimeReductionMinutes',
]);
export const OPTIMIZER_HIDDEN_FAMILY_KEYS = new Set(['dawnsustain', 'dawnbinderboost']);

/** Tiers here are distinct roles (different seed pools), not strength variants — preserve tier suffix in exactFamilyKey so each competes independently. */
export const TIER_INDEPENDENT_FAMILY_IDS = new Set([
  'SeedFinderI', 'SeedFinderII', 'SeedFinderIII', 'SeedFinderIV',
]);
export const OPTIMIZER_BROAD_ROLE_LABELS: Record<string, string> = {
  coinfinder: 'Coin Finder',
  egggrowthboost: 'Egg Growth Boost',
  goldgranter: 'Gold Granter',
  hungerboost: 'Hunger Boost',
  hungerrestore: 'Hunger Restore',
  petageboost: 'Hatch XP Boost',
  pethatchsizeboost: 'Max Strength Boost',
  petmutationboost: 'Pet Mutation Boost',
  petrefund: 'Pet Refund',
  petxpboost: 'XP Boost',
  plantgrowthboost: 'Plant Growth Boost',
  producemutationboost: 'Crop Mutation Boost',
  produceeater: 'Crop Eater',
  producescaleboost: 'Crop Size Boost',
  rainbowgranter: 'Rainbow Granter',
  seedfinder: 'Seed Finder',
  sellboost: 'Sell Boost',
};

export const ABILITY_BASE_TRIGGER_VALUE: Record<string, number> = {
  // Sale / crop-proc approximations (relative values for compare scoring when direct value is absent)
  SellBoostI: 0.5,
  SellBoostII: 0.65,
  SellBoostIII: 0.8,
  SellBoostIV: 1.0,
  ProduceRefund: 0.45,
  DoubleHarvest: 0.5,

  // Hatch trio / progression-oriented proc approximations
  PetMutationBoost: 0.45,
  PetMutationBoostII: 0.7,
  PetAgeBoost: 0.6,
  PetAgeBoostII: 0.9,
  PetHatchSizeBoostII: 1.0,
  DoubleHatch: 0.95,

  // Food
  HungerRestore: 0.2,
  HungerRestoreII: 0.35,
  HungerBoost: 0.2,
  HungerBoostII: 0.3,

  // Hatch dollar
  PetRefund: 0.5,
  PetRefundII: 0.75,
};
