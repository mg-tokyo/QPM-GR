import {
  getAbilityDef,
  getAllAbilities,
  areCatalogsReady,
} from '../../../../catalogs/gameCatalogs';
import {
  ABILITY_DEFINITIONS,
  type AbilityDefinition,
  type CatalogParameterMetadata,
} from './definitions';

const abilityLookup = new Map<string, AbilityDefinition>();

export const WEATHER_PREFIX_ENTRIES = [
  { prefix: 'snowy', weather: 'snow' },
  { prefix: 'frosty', weather: 'snow' },
  { prefix: 'frost', weather: 'snow' },
  { prefix: 'snow', weather: 'snow' },
  { prefix: 'rainy', weather: 'rain' },
  { prefix: 'rain', weather: 'rain' },
  { prefix: 'wet', weather: 'rain' },
  { prefix: 'thunder', weather: 'thunderstorm' },
  { prefix: 'dawn', weather: 'dawn' },
  { prefix: 'amber', weather: 'amber' },
] as const;

interface CatalogLookupCache {
  signature: string;
  byKey: Map<string, string>;
}

let catalogLookupCache: CatalogLookupCache | null = null;

export const normalizeKey = (value: string): string => value.trim().toLowerCase();
export const normalizeCompactKey = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

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

function buildHardcodedLookup(): void {
  for (const definition of ABILITY_DEFINITIONS) {
    addLookupKeys(abilityLookup, definition.id, definition);
    addLookupKeys(abilityLookup, definition.name, definition);
    if (Array.isArray(definition.aliases)) {
      for (const alias of definition.aliases) {
        addLookupKeys(abilityLookup, alias, definition);
      }
    }
  }
}
buildHardcodedLookup();

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
    case 'thunderstorm':
    case 'thunder':
      return 'thunderstorm';
    default:
      return undefined;
  }
}

export function resolveCatalogParameterMetadata(
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
    ['petDustIncreasePercentage', {
      category: 'misc',
      effectLabel: 'Pet dust bonus',
      effectSuffix: '%',
    }],
    ['plantAbilityChanceBoostPercentage', {
      category: 'misc',
      effectLabel: 'Plant ability chance',
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

// Drift diagnostics compare live catalog keys against this;
// known-but-unlabeled keys are listed so drift only flags genuinely new keys.
export const KNOWN_PARAMETER_KEYS: ReadonlySet<string> = new Set([
  'plantGrowthReductionMinutes',
  'eggGrowthTimeReductionMinutes',
  'bonusXp',
  'baseMaxCoinsFindable',
  'scaleIncreasePercentage',
  'mutationChanceIncreasePercentage',
  'hungerRestorePercentage',
  'hungerRefundPercentage',
  'cropSellPriceIncreasePercentage',
  'maxStrengthIncreasePercentage',
  'petDustIncreasePercentage',
  'plantAbilityChanceBoostPercentage',
  'grantedMutations',
  'requiredWeather',
  'cooldownSeconds',
  'activationSprite',
  'targetMutations',
  'tileRadius',
]);

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

  if (areCatalogsReady()) {
    const catalogAbilityIds = getAllAbilities();
    const existingIds = new Set(ABILITY_DEFINITIONS.map(d => normalizeKey(d.id)));

    for (const abilityId of catalogAbilityIds) {
      if (!existingIds.has(normalizeKey(abilityId))) {
        const definition = buildDefinitionFromCatalog(abilityId, abilityId);
        if (definition) definitions.push(definition);
      }
    }
  }

  return definitions;
}
