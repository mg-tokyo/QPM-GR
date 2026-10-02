export type AbilityCategory = 'plantGrowth' | 'eggGrowth' | 'xp' | 'coins' | 'misc';

export type AbilityTrigger = 'continuous' | 'hatchEgg' | 'sellAllCrops' | 'sellPet' | 'harvest' | 'playerActivated';

export interface AbilityDefinition {
  id: string;
  name: string;
  aliases?: readonly string[];
  category: AbilityCategory;
  trigger: AbilityTrigger;
  baseProbability?: number;
  rollPeriodMinutes?: number;
  effectValuePerProc?: number;
  effectUnit?: 'minutes' | 'xp' | 'coins';
  notes?: string;
  effectLabel?: string;      // e.g., "Scale increase", "Growth time reduction", "Coin range"
  effectBaseValue?: number;  // e.g., 10 for "10% × STR"
  effectSuffix?: string;     // e.g., "%", "m", "" for ranges
  requiredWeather?: 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | 'thunderstorm';
  // Present only for crop-size boosts. 'flatSize' = adds N Size points (v1118).
  // 'scalePercent' = legacy pre-v1118 shape.
  effectMode?: 'flatSize' | 'scalePercent';
  // Whether pet strength multiplies the effect value (chance is separate).
  strengthScalesEffect?: boolean;
}

export type CatalogParameterMetadata = Pick<
  AbilityDefinition,
  'category' | 'effectUnit' | 'effectLabel' | 'effectBaseValue' | 'effectSuffix' | 'effectMode' | 'strengthScalesEffect' | 'effectValuePerProc'
>;

// QPM-owned only: legacy strings that must resolve to a catalog id. Every game value
// (chance, effect, trigger, weather, name) comes from the petAbilities catalog. The ids
// also feed drift `hardcodedOnly`, the optimizer's partial-capture check.
export interface AbilityMetadata {
  id: string;
  aliases: readonly string[];
  notes?: string;
}

export const ABILITY_METADATA: readonly AbilityMetadata[] = [
  { id: 'ProduceScaleBoost', aliases: ['Crop Size Boost I', 'Crop Size Boost 1'] },
  { id: 'ProduceScaleBoostII', aliases: ['Crop Size Boost II', 'Crop Size Boost 2'] },
  { id: 'ProduceScaleBoostIII', aliases: ['Crop Size Boost III', 'Crop Size Boost 3'] },
  { id: 'SnowyCropSizeBoost', aliases: ['Snow Crop Size Boost'] },
  { id: 'DoubleHarvest', aliases: ['Double Harvest'] },
  { id: 'ProduceEater', aliases: ['Crop Eater'], notes: 'Cannot estimate coin value without live crop data.' },
  { id: 'SellBoostI', aliases: ['Sell Boost I', 'Sell Boost 1'] },
  { id: 'SellBoostII', aliases: ['Sell Boost II', 'Sell Boost 2'] },
  { id: 'SellBoostIII', aliases: ['Sell Boost III', 'Sell Boost 3'] },
  { id: 'SellBoostIV', aliases: ['Sell Boost IV', 'Sell Boost 4'] },
  { id: 'ProduceRefund', aliases: ['Crop Refund'] },
  { id: 'PlantGrowthBoost', aliases: ['Plant Growth Boost I', 'Plant Growth Boost 1'] },
  { id: 'PlantGrowthBoostII', aliases: ['Plant Growth Boost II', 'Plant Growth Boost 2'] },
  { id: 'ProduceMutationBoost', aliases: ['Crop Mutation Boost I', 'Crop Mutation Boost 1'] },
  { id: 'ProduceMutationBoostII', aliases: ['Crop Mutation Boost II', 'Crop Mutation Boost 2'] },
  { id: 'ProduceMutationBoostIII', aliases: ['Crop Mutation Boost III', 'Crop Mutation Boost 3'] },
  { id: 'PetMutationBoost', aliases: ['Pet Mutation Boost I', 'Pet Mutation Boost 1'] },
  { id: 'PetMutationBoostII', aliases: ['Pet Mutation Boost II', 'Pet Mutation Boost 2'] },
  { id: 'GoldGranter', aliases: ['Gold Granter'] },
  { id: 'RainbowGranter', aliases: ['Rainbow Granter'] },
  { id: 'RainDance', aliases: ['Rain Dance'] },
  { id: 'EggGrowthBoost', aliases: ['Egg Growth Boost I', 'Egg Growth Boost 1'] },
  { id: 'EggGrowthBoostII_NEW', aliases: ['Egg Growth Boost II', 'Egg Growth Boost 2'] },
  { id: 'EggGrowthBoostII', aliases: ['Egg Growth Boost III', 'Egg Growth Boost 3'] },
  { id: 'PetAgeBoost', aliases: ['Hatch XP Boost I', 'Hatch XP Boost 1'] },
  { id: 'PetAgeBoostII', aliases: ['Hatch XP Boost II', 'Hatch XP Boost 2'] },
  { id: 'PetHatchSizeBoost', aliases: ['Max Strength Boost I', 'Max Strength Boost 1'] },
  { id: 'PetHatchSizeBoostII', aliases: ['Max Strength Boost II', 'Max Strength Boost 2'] },
  { id: 'PetXpBoost', aliases: ['XP Boost I', 'Pet XP Boost I', 'Pet XP Boost 1', 'XP Boost 1'] },
  { id: 'PetXpBoostII', aliases: ['XP Boost II', 'Pet XP Boost II', 'Pet XP Boost 2', 'XP Boost 2'] },
  { id: 'PetXpBoostIII', aliases: ['XP Boost III', 'Pet XP Boost III', 'Pet XP Boost 3', 'XP Boost 3'] },
  { id: 'SnowyPetXpBoost', aliases: ['Snowy XP Boost', 'Snowy Pet XP Boost'] },
  { id: 'HungerRestore', aliases: ['Hunger Restore I', 'Hunger Restore 1'] },
  { id: 'HungerRestoreII', aliases: ['Hunger Restore II', 'Hunger Restore 2'] },
  { id: 'HungerBoost', aliases: ['Hunger Boost I', 'Hunger Boost 1'] },
  { id: 'HungerBoostII', aliases: ['Hunger Boost II', 'Hunger Boost 2'] },
  { id: 'PetRefund', aliases: ['Pet Refund I', 'Pet Refund 1'] },
  { id: 'PetRefundII', aliases: ['Pet Refund II', 'Pet Refund 2'] },
  { id: 'Copycat', aliases: [] },
  { id: 'CoinFinderI', aliases: ['Coin Finder I', 'Coin Finder 1', 'CoinFinder I', 'CoinFinder 1'] },
  { id: 'CoinFinderII', aliases: ['Coin Finder II', 'Coin Finder 2', 'CoinFinder II', 'CoinFinder 2'] },
  { id: 'CoinFinderIII', aliases: ['Coin Finder III', 'Coin Finder 3', 'CoinFinder III', 'CoinFinder 3'] },
  { id: 'SeedFinderI', aliases: ['Seed Finder I', 'Seed Finder 1', 'SeedFinder I', 'SeedFinder 1'] },
  { id: 'SeedFinderII', aliases: ['Seed Finder II', 'Seed Finder 2', 'SeedFinder II', 'SeedFinder 2'] },
  { id: 'SeedFinderIII', aliases: ['Seed Finder III', 'Seed Finder 3', 'SeedFinder III', 'SeedFinder 3'] },
  { id: 'SeedFinderIV', aliases: ['Seed Finder IV', 'Seed Finder 4', 'SeedFinder IV', 'SeedFinder 4'] },
  { id: 'DoubleHatch', aliases: ['Double Hatch'] },
  { id: 'DoubleHatchII', aliases: ['Double Hatch II'] },
  { id: 'ThunderstruckGranter', aliases: ['Thunderstruck Granter'] },
];

/** Ids QPM lists ahead of stale captured catalogs (old cached client bundles).
 * Their absence from a catalog is a stale bundle, not a rename regression —
 * drift reports them but must not degrade the feature over them. */
export const FORWARD_COMPAT_ABILITY_IDS: ReadonlySet<string> = new Set([
  'DoubleHatchII',
  'ThunderstruckGranter',
]);
