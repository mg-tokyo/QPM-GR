// src/data/petAbilities.ts
// Ability metadata used for tracker projections.

import {
  getAbilityDef,
  getAllAbilities,
  areCatalogsReady,
} from '../../../catalogs/gameCatalogs';

export type AbilityCategory = 'plantGrowth' | 'eggGrowth' | 'xp' | 'coins' | 'misc';

type AbilityTrigger = 'continuous' | 'hatchEgg' | 'sellAllCrops' | 'sellPet' | 'harvest' | 'playerActivated';

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
  // Wiki effect formula display
  effectLabel?: string; // e.g., "Scale increase", "Growth time reduction", "Coin range"
  effectBaseValue?: number; // e.g., 10 for "10% × STR"
  effectSuffix?: string; // e.g., "%", "m", "" for ranges
  // Weather requirement (for abilities like SnowyPetXpBoost)
  requiredWeather?: 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber';
}

type CatalogParameterMetadata = Pick<
  AbilityDefinition,
  'category' | 'effectUnit' | 'effectLabel' | 'effectBaseValue' | 'effectSuffix'
>;

const ABILITY_DEFINITIONS: AbilityDefinition[] = [
  {
    id: 'ProduceScaleBoost',
    name: 'Crop Size Boost I',
    aliases: ['Crop Size Boost 1'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 0.30,
    rollPeriodMinutes: 1,
    effectUnit: 'coins',
    effectLabel: 'Scale increase',
    effectBaseValue: 6.0,
    effectSuffix: '%',
    notes: 'Chance: 0.30% × STR. Effect: 6% size increase × STR, capped at max scale.',
  },
  {
    id: 'ProduceScaleBoostII',
    name: 'Crop Size Boost II',
    aliases: ['Crop Size Boost 2'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 0.4,
    rollPeriodMinutes: 1,
    effectUnit: 'coins',
    effectLabel: 'Scale increase',
    effectBaseValue: 10,
    effectSuffix: '%',
    notes: 'Chance: 0.40% × STR. Effect: 10% size increase × STR, capped at max scale.',
  },
  {
    id: 'DoubleHarvest',
    name: 'Double Harvest',
    category: 'misc',
    trigger: 'harvest',
    baseProbability: 5,
  },
  {
    id: 'ProduceEater',
    name: 'Crop Eater',
    category: 'coins',
    trigger: 'continuous',
    baseProbability: 60,
    rollPeriodMinutes: 1,
    notes: 'Cannot estimate coin value without live crop data.',
  },
  {
    id: 'SellBoostI',
    name: 'Sell Boost I',
    aliases: ['Sell Boost 1'],
    category: 'misc',
    trigger: 'sellAllCrops',
    baseProbability: 10,
  },
  {
    id: 'SellBoostII',
    name: 'Sell Boost II',
    aliases: ['Sell Boost 2'],
    category: 'misc',
    trigger: 'sellAllCrops',
    baseProbability: 12,
  },
  {
    id: 'SellBoostIII',
    name: 'Sell Boost III',
    aliases: ['Sell Boost 3'],
    category: 'misc',
    trigger: 'sellAllCrops',
    baseProbability: 14,
  },
  {
    id: 'SellBoostIV',
    name: 'Sell Boost IV',
    aliases: ['Sell Boost 4'],
    category: 'misc',
    trigger: 'sellAllCrops',
    baseProbability: 16,
  },
  {
    id: 'ProduceRefund',
    name: 'Crop Refund',
    category: 'misc',
    trigger: 'sellAllCrops',
    baseProbability: 20,
  },
  {
    id: 'PlantGrowthBoost',
    name: 'Plant Growth Boost I',
    aliases: ['Plant Growth Boost 1'],
    category: 'plantGrowth',
    trigger: 'continuous',
    baseProbability: 24,
    rollPeriodMinutes: 1,
    effectValuePerProc: 3,
    effectUnit: 'minutes',
    effectLabel: 'Growth time reduction',
    effectBaseValue: 3,
    effectSuffix: 'm',
  },
  {
    id: 'PlantGrowthBoostII',
    name: 'Plant Growth Boost II',
    aliases: ['Plant Growth Boost 2'],
    category: 'plantGrowth',
    trigger: 'continuous',
    baseProbability: 27,
    rollPeriodMinutes: 1,
    effectValuePerProc: 5,
    effectUnit: 'minutes',
    effectLabel: 'Growth time reduction',
    effectBaseValue: 5,
    effectSuffix: 'm',
  },
  {
    id: 'ProduceMutationBoost',
    name: 'Crop Mutation Boost I',
    aliases: ['Crop Mutation Boost 1'],
    category: 'misc',
    trigger: 'continuous',
    rollPeriodMinutes: 1,
    effectUnit: 'coins',
    effectLabel: 'Chance increase',
    effectBaseValue: 15,
    effectSuffix: '%',
    notes: 'Increases the base weather mutation chance during active weather/lunar events. Grants: Wet (Rain), Chilled (Snow), Dawnlit (Dawn), Ambershine (Amber Moon).',
  },
  {
    id: 'ProduceMutationBoostII',
    name: 'Crop Mutation Boost II',
    aliases: ['Crop Mutation Boost 2'],
    category: 'misc',
    trigger: 'continuous',
    rollPeriodMinutes: 1,
    effectUnit: 'coins',
    effectLabel: 'Chance increase',
    effectBaseValue: 20,
    effectSuffix: '%',
    notes: 'Increases the base weather mutation chance during active weather/lunar events. Grants: Wet (Rain), Chilled (Snow), Dawnlit (Dawn), Ambershine (Amber Moon).',
  },
  {
    id: 'ProduceMutationBoostIII',
    name: 'Crop Mutation Boost III',
    aliases: ['Crop Mutation Boost 3'],
    category: 'misc',
    trigger: 'continuous',
    rollPeriodMinutes: 1,
    effectUnit: 'coins',
    effectLabel: 'Chance increase',
    effectBaseValue: 25,
    effectSuffix: '%',
    notes: 'Increases the base weather mutation chance during active weather/lunar events. Grants: Wet (Rain), Chilled (Snow), Dawnlit (Dawn), Ambershine (Amber Moon).',
  },
  {
    id: 'PetMutationBoost',
    name: 'Pet Mutation Boost I',
    aliases: ['Pet Mutation Boost 1'],
    category: 'misc',
    trigger: 'hatchEgg',
  },
  {
    id: 'PetMutationBoostII',
    name: 'Pet Mutation Boost II',
    aliases: ['Pet Mutation Boost 2'],
    category: 'misc',
    trigger: 'hatchEgg',
  },
  {
    id: 'GoldGranter',
    name: 'Gold Granter',
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 0.72,
    rollPeriodMinutes: 1,
    effectUnit: 'coins',
    notes: 'Converts a random uncolored crop to Gold using live garden snapshot.',
  },
  {
    id: 'RainbowGranter',
    name: 'Rainbow Granter',
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 0.72,
    rollPeriodMinutes: 1,
    effectUnit: 'coins',
    notes: 'Converts a random uncolored crop to Rainbow using live garden snapshot.',
  },
  {
    id: 'RainDance',
    name: 'Rain Dance',
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 10,
    rollPeriodMinutes: 1,
    effectUnit: 'coins',
    notes: 'Grants Wet mutation to crops. Turkey innate ability.',
  },
  {
    id: 'EggGrowthBoost',
    name: 'Egg Growth Boost I',
    aliases: ['Egg Growth Boost 1'],
    category: 'eggGrowth',
    trigger: 'continuous',
    baseProbability: 21,
    rollPeriodMinutes: 1,
    effectValuePerProc: 7,
    effectUnit: 'minutes',
  },
  {
    id: 'EggGrowthBoostII_NEW',
    name: 'Egg Growth Boost II',
    aliases: ['Egg Growth Boost 2'],
    category: 'eggGrowth',
    trigger: 'continuous',
    baseProbability: 24,
    rollPeriodMinutes: 1,
    effectValuePerProc: 9,
    effectUnit: 'minutes',
  },
  {
    id: 'EggGrowthBoostII',
    name: 'Egg Growth Boost III',
    aliases: ['Egg Growth Boost 3'],
    category: 'eggGrowth',
    trigger: 'continuous',
    baseProbability: 27,
    rollPeriodMinutes: 1,
    effectValuePerProc: 11,
    effectUnit: 'minutes',
  },
  {
    id: 'PetAgeBoost',
    name: 'Hatch XP Boost I',
    aliases: ['Hatch XP Boost 1'],
    category: 'xp',
    trigger: 'hatchEgg',
    baseProbability: 50,
    effectValuePerProc: 8000,
    effectUnit: 'xp',
  },
  {
    id: 'PetAgeBoostII',
    name: 'Hatch XP Boost II',
    aliases: ['Hatch XP Boost 2'],
    category: 'xp',
    trigger: 'hatchEgg',
    baseProbability: 60,
    effectValuePerProc: 12000,
    effectUnit: 'xp',
  },
  {
    id: 'PetHatchSizeBoost',
    name: 'Max Strength Boost I',
    aliases: ['Max Strength Boost 1'],
    category: 'misc',
    trigger: 'hatchEgg',
    baseProbability: 12,
  },
  {
    id: 'PetHatchSizeBoostII',
    name: 'Max Strength Boost II',
    aliases: ['Max Strength Boost 2'],
    category: 'misc',
    trigger: 'hatchEgg',
    baseProbability: 14,
  },
  {
    id: 'PetXpBoost',
    name: 'XP Boost I',
    aliases: ['Pet XP Boost I', 'Pet XP Boost 1', 'XP Boost 1'],
    category: 'xp',
    trigger: 'continuous',
    baseProbability: 30,
    rollPeriodMinutes: 1,
    effectValuePerProc: 300,
    effectUnit: 'xp',
  },
  {
    id: 'PetXpBoostII',
    name: 'XP Boost II',
    aliases: ['Pet XP Boost II', 'Pet XP Boost 2', 'XP Boost 2'],
    category: 'xp',
    trigger: 'continuous',
    baseProbability: 35,
    rollPeriodMinutes: 1,
    effectValuePerProc: 400,
    effectUnit: 'xp',
  },
  {
    id: 'PetXpBoostIII',
    name: 'XP Boost III',
    aliases: ['Pet XP Boost III', 'Pet XP Boost 3', 'XP Boost 3'],
    category: 'xp',
    trigger: 'continuous',
    baseProbability: 40,
    rollPeriodMinutes: 1,
    effectValuePerProc: 500,
    effectUnit: 'xp',
  },
  {
    id: 'SnowyPetXpBoost',
    name: 'Snowy XP Boost',
    aliases: ['Snowy Pet XP Boost'],
    category: 'xp',
    trigger: 'continuous',
    baseProbability: 50,
    rollPeriodMinutes: 1,
    effectValuePerProc: 450,
    effectUnit: 'xp',
    requiredWeather: 'snow',
    notes: 'Only active during Frost weather. Chance: 50% × STR. XP: 450 × STR per proc.',
  },
  {
    id: 'HungerRestore',
    name: 'Hunger Restore I',
    aliases: ['Hunger Restore 1'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 12,
    rollPeriodMinutes: 1,
  },
  {
    id: 'HungerRestoreII',
    name: 'Hunger Restore II',
    aliases: ['Hunger Restore 2'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 14,
    rollPeriodMinutes: 1,
  },
  {
    id: 'HungerBoost',
    name: 'Hunger Boost I',
    aliases: ['Hunger Boost 1'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 0,
    rollPeriodMinutes: 1,
  },
  {
    id: 'HungerBoostII',
    name: 'Hunger Boost II',
    aliases: ['Hunger Boost 2'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 0,
    rollPeriodMinutes: 1,
  },
  {
    id: 'PetRefund',
    name: 'Pet Refund I',
    aliases: ['Pet Refund 1'],
    category: 'misc',
    trigger: 'sellPet',
    baseProbability: 5,
  },
  {
    id: 'PetRefundII',
    name: 'Pet Refund II',
    aliases: ['Pet Refund 2'],
    category: 'misc',
    trigger: 'sellPet',
    baseProbability: 7,
  },
  {
    id: 'Copycat',
    name: 'Copycat',
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 1,
    rollPeriodMinutes: 1,
  },
  {
    id: 'CoinFinderI',
    name: 'Coin Finder I',
    aliases: ['Coin Finder 1', 'CoinFinder I', 'CoinFinder 1'],
    category: 'coins',
    trigger: 'continuous',
    baseProbability: 35,
    rollPeriodMinutes: 1,
    effectValuePerProc: 120000,
    effectUnit: 'coins',
    effectLabel: 'Coin range',
    effectBaseValue: 120000,
    effectSuffix: '',
  },
  {
    id: 'CoinFinderII',
    name: 'Coin Finder II',
    aliases: ['Coin Finder 2', 'CoinFinder II', 'CoinFinder 2'],
    category: 'coins',
    trigger: 'continuous',
    baseProbability: 13,
    rollPeriodMinutes: 1,
    effectValuePerProc: 1200000,
    effectUnit: 'coins',
    effectLabel: 'Coin range',
    effectBaseValue: 1200000,
    effectSuffix: '',
  },
  {
    id: 'CoinFinderIII',
    name: 'Coin Finder III',
    aliases: ['Coin Finder 3', 'CoinFinder III', 'CoinFinder 3'],
    category: 'coins',
    trigger: 'continuous',
    baseProbability: 6,
    rollPeriodMinutes: 1,
    effectValuePerProc: 10000000,
    effectUnit: 'coins',
    effectLabel: 'Coin range',
    effectBaseValue: 10000000,
    effectSuffix: '',
  },
  {
    id: 'SeedFinderI',
    name: 'Seed Finder I',
    aliases: ['Seed Finder 1', 'SeedFinder I', 'SeedFinder 1'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 40,
    rollPeriodMinutes: 1,
  },
  {
    id: 'SeedFinderII',
    name: 'Seed Finder II',
    aliases: ['Seed Finder 2', 'SeedFinder II', 'SeedFinder 2'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 20,
    rollPeriodMinutes: 1,
  },
  {
    id: 'SeedFinderIII',
    name: 'Seed Finder III',
    aliases: ['Seed Finder 3', 'SeedFinder III', 'SeedFinder 3'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 10,
    rollPeriodMinutes: 1,
  },
  {
    id: 'SeedFinderIV',
    name: 'Seed Finder IV',
    aliases: ['Seed Finder 4', 'SeedFinder IV', 'SeedFinder 4'],
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 0.01,
    rollPeriodMinutes: 1,
  },
  {
    id: 'RainDance',
    name: 'Rain Dance',
    category: 'misc',
    trigger: 'continuous',
    baseProbability: 10,
    rollPeriodMinutes: 1,
    effectUnit: 'coins',
    effectLabel: 'Mutation chance',
    effectBaseValue: 10,
    effectSuffix: '%',
    notes: 'Chance: 10% × STR per minute. Grants Wet mutation to a random crop.',
  },
  {
    id: 'DoubleHatch',
    name: 'Double Hatch',
    category: 'misc',
    trigger: 'hatchEgg',
    baseProbability: 3.0,
    notes: 'Chance: 3.0% × STR to hatch an extra pet from the same egg.',
  },
];

const abilityLookup = new Map<string, AbilityDefinition>();

const WEATHER_PREFIX_ENTRIES = [
  { prefix: 'snowy', weather: 'snow' },
  { prefix: 'frosty', weather: 'snow' },
  { prefix: 'frost', weather: 'snow' },
  { prefix: 'snow', weather: 'snow' },
  { prefix: 'rainy', weather: 'rain' },
  { prefix: 'rain', weather: 'rain' },
  { prefix: 'wet', weather: 'rain' },
  { prefix: 'dawn', weather: 'dawn' },
  { prefix: 'amber', weather: 'amber' },
] as const;

interface CatalogLookupCache {
  signature: string;
  byKey: Map<string, string>;
}

let catalogLookupCache: CatalogLookupCache | null = null;

const normalizeKey = (value: string): string => value.trim().toLowerCase();
const normalizeCompactKey = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

function addLookupKeys(map: Map<string, AbilityDefinition>, key: string, definition: AbilityDefinition): void {
  const normalized = normalizeKey(key);
  const compact = normalizeCompactKey(key);

  if (normalized.length > 0) {
    map.set(normalized, definition);
  }
  if (compact.length > 0) {
    map.set(compact, definition);
  }
}

for (const definition of ABILITY_DEFINITIONS) {
  addLookupKeys(abilityLookup, definition.id, definition);
  addLookupKeys(abilityLookup, definition.name, definition);
  if (Array.isArray(definition.aliases)) {
    for (const alias of definition.aliases) {
      addLookupKeys(abilityLookup, alias, definition);
    }
  }
}

function resolveWeatherFromPrefix(prefix: string): AbilityDefinition['requiredWeather'] | null {
  const normalized = normalizeCompactKey(prefix);
  if (!normalized) return null;

  const hit = WEATHER_PREFIX_ENTRIES.find((entry) => entry.prefix === normalized);
  return hit ? hit.weather : null;
}

function buildLookupCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>();
  const normalized = normalizeKey(trimmed);
  const compact = normalizeCompactKey(trimmed);

  if (normalized.length > 0) {
    candidates.add(normalized);
  }
  if (compact.length > 0) {
    candidates.add(compact);
  }

  for (const { prefix } of WEATHER_PREFIX_ENTRIES) {
    if (!compact.startsWith(prefix) || compact.length <= prefix.length + 2) {
      continue;
    }
    candidates.add(compact.slice(prefix.length));
    break;
  }

  return [...candidates];
}

function attachWeatherConstraint(raw: string, definition: AbilityDefinition): AbilityDefinition {
  const compactRaw = normalizeCompactKey(raw);
  const compactDef = normalizeCompactKey(definition.id);

  if (!compactRaw || !compactDef || compactRaw === compactDef || !compactRaw.endsWith(compactDef)) {
    return definition;
  }

  const prefix = compactRaw.slice(0, compactRaw.length - compactDef.length);
  const requiredWeather = resolveWeatherFromPrefix(prefix);
  if (!requiredWeather) {
    return definition;
  }

  return {
    ...definition,
    requiredWeather: definition.requiredWeather ?? requiredWeather,
  };
}

function normalizeCatalogTrigger(trigger: unknown): AbilityDefinition['trigger'] {
  if (trigger === 'hatchEgg' || trigger === 'sellAllCrops' || trigger === 'sellPet' || trigger === 'harvest' || trigger === 'playerActivated') {
    return trigger;
  }
  return 'continuous';
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeCatalogRequiredWeather(value: unknown): AbilityDefinition['requiredWeather'] | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeCompactKey(value);
  switch (normalized) {
    case 'sunny':
      return 'sunny';
    case 'rain':
      return 'rain';
    case 'frost':
    case 'snow':
      return 'snow';
    case 'dawn':
      return 'dawn';
    case 'amber':
    case 'ambermoon':
      return 'amber';
    default:
      return undefined;
  }
}

function resolveCatalogParameterMetadata(
  abilityId: string,
  trigger: AbilityDefinition['trigger'],
  baseParameters: Record<string, unknown>,
): CatalogParameterMetadata {
  const knownParameters: Array<[string, CatalogParameterMetadata]> = [
    ['plantGrowthReductionMinutes', {
      category: 'plantGrowth',
      effectUnit: 'minutes',
      effectLabel: 'Growth time reduction',
      effectSuffix: 'm',
    }],
    ['eggGrowthTimeReductionMinutes', {
      category: 'eggGrowth',
      effectUnit: 'minutes',
      effectLabel: 'Hatch time reduction',
      effectSuffix: 'm',
    }],
    ['bonusXp', {
      category: 'xp',
      effectUnit: 'xp',
      effectLabel: 'Bonus XP',
      effectSuffix: '',
    }],
    ['baseMaxCoinsFindable', {
      category: 'coins',
      effectUnit: 'coins',
      effectLabel: 'Coin range',
      effectSuffix: '',
    }],
    ['scaleIncreasePercentage', {
      category: 'misc',
      effectUnit: 'coins',
      effectLabel: 'Scale increase',
      effectSuffix: '%',
    }],
    ['mutationChanceIncreasePercentage', {
      ...(trigger === 'continuous' ? { effectUnit: 'coins' as const } : {}),
      category: 'misc',
      effectLabel: 'Chance increase',
      effectSuffix: '%',
    }],
    ['hungerRestorePercentage', {
      category: 'misc',
      effectLabel: 'Hunger restore',
      effectSuffix: '%',
    }],
    ['hungerRefundPercentage', {
      category: 'misc',
      effectLabel: 'Hunger refund',
      effectSuffix: '%',
    }],
    ['cropSellPriceIncreasePercentage', {
      ...(trigger === 'continuous' ? { effectUnit: 'coins' as const } : {}),
      category: trigger === 'continuous' ? 'coins' : 'misc',
      effectLabel: 'Sell price bonus',
      effectSuffix: '%',
    }],
    ['maxStrengthIncreasePercentage', {
      category: 'misc',
      effectLabel: 'Max Strength increase',
      effectSuffix: '%',
    }],
  ];

  for (const [key, metadata] of knownParameters) {
    const value = toFiniteNumber(baseParameters[key]);
    if (value == null) continue;
    return {
      ...metadata,
      effectBaseValue: value,
    };
  }

  if (abilityId.endsWith('Granter')) {
    return {
      category: 'misc',
      effectUnit: 'coins',
    };
  }

  return {
    category: trigger === 'hatchEgg' ? 'eggGrowth' : 'misc',
  };
}

function buildCatalogLookupCache(): CatalogLookupCache | null {
  if (!areCatalogsReady()) return null;

  const abilityIds = getAllAbilities();
  if (abilityIds.length === 0) return null;

  const signature = [...abilityIds].sort().join('|');
  if (catalogLookupCache && catalogLookupCache.signature === signature) {
    return catalogLookupCache;
  }

  const byKey = new Map<string, string>();
  const addCatalogKey = (key: string, abilityId: string): void => {
    const normalized = normalizeKey(key);
    const compact = normalizeCompactKey(key);

    if (normalized.length > 0 && !byKey.has(normalized)) {
      byKey.set(normalized, abilityId);
    }
    if (compact.length > 0 && !byKey.has(compact)) {
      byKey.set(compact, abilityId);
    }
  };

  for (const abilityId of abilityIds) {
    addCatalogKey(abilityId, abilityId);
    const entry = getAbilityDef(abilityId);
    if (entry && typeof entry.name === 'string' && entry.name.trim().length > 0) {
      addCatalogKey(entry.name, abilityId);
    }
  }

  catalogLookupCache = { signature, byKey };
  return catalogLookupCache;
}

function buildDefinitionFromCatalog(abilityId: string, raw: string): AbilityDefinition | null {
  const catalogEntry = getAbilityDef(abilityId);
  if (!catalogEntry) return null;

  const trigger = normalizeCatalogTrigger(catalogEntry.trigger);
  const baseParameters = catalogEntry.baseParameters && typeof catalogEntry.baseParameters === 'object'
    ? catalogEntry.baseParameters
    : {};
  const parameterMetadata = resolveCatalogParameterMetadata(abilityId, trigger, baseParameters);
  const requiredWeather = normalizeCatalogRequiredWeather(baseParameters['requiredWeather']);
  const definition: AbilityDefinition = {
    id: abilityId,
    name: typeof catalogEntry.name === 'string' && catalogEntry.name.trim().length > 0 ? catalogEntry.name : abilityId,
    category: parameterMetadata.category,
    trigger,
    rollPeriodMinutes: 1,
    notes: 'Auto-discovered from game catalog',
    ...(parameterMetadata.effectUnit ? { effectUnit: parameterMetadata.effectUnit } : {}),
    ...(parameterMetadata.effectLabel ? { effectLabel: parameterMetadata.effectLabel } : {}),
    ...(parameterMetadata.effectBaseValue != null ? { effectBaseValue: parameterMetadata.effectBaseValue } : {}),
    ...(parameterMetadata.effectSuffix != null ? { effectSuffix: parameterMetadata.effectSuffix } : {}),
    ...(requiredWeather ? { requiredWeather } : {}),
  };

  if (typeof catalogEntry.baseProbability === 'number' && Number.isFinite(catalogEntry.baseProbability)) {
    definition.baseProbability = catalogEntry.baseProbability;
  }

  return attachWeatherConstraint(raw, definition);
}

function mergeDefinitionWithCatalog(
  baseDefinition: AbilityDefinition,
  catalogDefinition: AbilityDefinition,
  raw: string,
): AbilityDefinition {
  return attachWeatherConstraint(raw, {
    ...baseDefinition,
    ...catalogDefinition,
    ...(baseDefinition.aliases ? { aliases: baseDefinition.aliases } : {}),
    ...(baseDefinition.notes ? { notes: baseDefinition.notes } : catalogDefinition.notes ? { notes: catalogDefinition.notes } : {}),
  });
}

export function getAbilityDefinition(raw: string | null | undefined): AbilityDefinition | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const lookupCandidates = buildLookupCandidates(trimmed);

  let hardcoded: AbilityDefinition | null = null;
  for (const key of lookupCandidates) {
    hardcoded = abilityLookup.get(key) ?? null;
    if (hardcoded) break;
  }

  let catalogDefinition: AbilityDefinition | null = null;
  if (areCatalogsReady()) {
    const cache = buildCatalogLookupCache();
    if (cache) {
      for (const key of lookupCandidates) {
        const abilityId = cache.byKey.get(key);
        if (!abilityId) continue;
        catalogDefinition = buildDefinitionFromCatalog(abilityId, trimmed);
        if (catalogDefinition) break;
      }
    }
  }

  if (hardcoded && catalogDefinition) {
    return mergeDefinitionWithCatalog(hardcoded, catalogDefinition, trimmed);
  }
  if (hardcoded) {
    return attachWeatherConstraint(trimmed, hardcoded);
  }
  if (catalogDefinition) {
    return catalogDefinition;
  }

  return null;
}

export function getAllAbilityDefinitions(): AbilityDefinition[] {
  const definitions = ABILITY_DEFINITIONS.map((definition) => {
    const catalogDefinition = buildDefinitionFromCatalog(definition.id, definition.id);
    return catalogDefinition ? mergeDefinitionWithCatalog(definition, catalogDefinition, definition.id) : definition;
  });

  // Add catalog abilities that aren't in hardcoded list (FUTUREPROOF!)
  if (areCatalogsReady()) {
    const catalogAbilityIds = getAllAbilities();
    const existingIds = new Set(ABILITY_DEFINITIONS.map(d => normalizeKey(d.id)));

    for (const abilityId of catalogAbilityIds) {
      if (!existingIds.has(normalizeKey(abilityId))) {
        // New ability from catalog - create basic definition
        const definition = buildDefinitionFromCatalog(abilityId, abilityId);
        if (definition) definitions.push(definition);
      }
    }
  }

  return definitions;
}

const STRENGTH_BASELINE = 100;
const MIN_MULTIPLIER = 0.25;
const MAX_CHANCE_PER_SECOND = 0.95 / 60; // Max 95% per minute = ~1.58% per second
const DEFAULT_ROLL_MINUTES = 1;

export interface AbilityStats {
  multiplier: number;
  chancePerRoll: number;
  rollPeriodMinutes: number;
  procsPerHour: number;
  chancePerSecond: number; // Chance per second (game checks every second)
  chancePerMinute: number; // Chance per minute (for display)
}

export function computeAbilityStats(definition: AbilityDefinition, strength: number | null | undefined): AbilityStats {
  // Wiki formula: "X% × STR" means STR acts as a percentage multiplier
  // STR=100 → 100% = 1.0x, STR=62 → 62% = 0.62x, STR=50 → 50% = 0.5x
  const rawStrength = Number.isFinite(strength) ? (strength as number) : STRENGTH_BASELINE;
  const multiplier = Math.max(MIN_MULTIPLIER, rawStrength / 100);

  // Game checks abilities every SECOND, not every minute
  // So we divide the per-minute chance by 60 to get per-second chance
  const baseChancePerMinute = Math.max(0, definition.baseProbability ?? 0);
  const baseChancePerSecond = baseChancePerMinute / 60;

  const chancePerSecondDecimal = Math.max(0, baseChancePerSecond / 100);
  const chancePerRoll = Math.min(MAX_CHANCE_PER_SECOND, chancePerSecondDecimal * multiplier);

  // Abilities roll every SECOND, so 3600 rolls per hour (60 seconds × 60 minutes)
  const rollsPerHour = 3600;
  const procsPerHour = rollsPerHour * chancePerRoll;

  // For display
  const chancePerSecond = chancePerRoll * 100; // Convert to percentage
  const chancePerMinute = chancePerSecond * 60;

  const rollPeriodMinutes = definition.rollPeriodMinutes ?? DEFAULT_ROLL_MINUTES;

  return {
    multiplier,
    chancePerRoll,
    rollPeriodMinutes,
    procsPerHour,
    chancePerSecond,
    chancePerMinute,
  };
}

export function computeEffectPerHour(
  definition: AbilityDefinition,
  stats: AbilityStats,
  strength: number | null | undefined = undefined,
): number {
  const effect = definition.effectValuePerProc ?? 0;
  if (!Number.isFinite(effect) || effect === 0) {
    return 0;
  }
  const strengthScale = strength != null && Number.isFinite(strength)
    ? Math.max(0, strength) / 100
    : 1;
  return stats.procsPerHour * effect * strengthScale;
}

export const abilityDefinitions = ABILITY_DEFINITIONS;

/** Returns true if the ability has trigger 'playerActivated' (e.g. DawnCapture). */
export function isChargedAbility(abilityId: string): boolean {
  const def = getAbilityDef(abilityId);
  return def?.trigger === 'playerActivated';
}

/** Returns the first charged ability ID from the list, or null if none. */
export function getPetChargedAbility(abilities: readonly string[]): string | null {
  for (const id of abilities) {
    if (isChargedAbility(id)) return id;
  }
  return null;
}

