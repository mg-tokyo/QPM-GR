import {
  getAbilityDef,
  getAllAbilities,
  areCatalogsReady,
} from '../../../../catalogs/gameCatalogs';
import {
  ABILITY_DEFINITIONS,
  type AbilityCategory,
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

// Structural params feed logic (weather gates, mutation targets, activation sprite, radius,
// cooldown) — never rendered as a leading effect value. Rules skip these.
const STRUCTURAL_PARAMETER_KEYS: ReadonlySet<string> = new Set([
  'requiredWeather',
  'grantedMutations',
  'targetMutations',
  'tileRadius',
  'cooldownSeconds',
  'activationSprite',
]);

// Specific overrides keep exact legacy labels/units for the params we've seen historically.
// Anything not matched here falls through to suffix rules + label derivation.
interface SpecificRule {
  match: RegExp;
  category?: AbilityCategory;
  effectUnit?: CatalogParameterMetadata['effectUnit'];
  effectLabel?: string;
  effectSuffix?: string;
  // Applied only when the ability trigger is 'continuous' — legacy quirk where
  // percentage buffs get treated as coin-per-hour projections.
  coinUnitWhenContinuous?: boolean;
  coinsCategoryWhenContinuous?: boolean;
}

const SPECIFIC_RULES: readonly SpecificRule[] = [
  { match: /^plant.*Growth.*Minutes$/i,     category: 'plantGrowth', effectUnit: 'minutes', effectLabel: 'Growth time reduction', effectSuffix: 'm' },
  { match: /^egg.*Growth.*Minutes$/i,       category: 'eggGrowth',   effectUnit: 'minutes', effectLabel: 'Hatch time reduction',  effectSuffix: 'm' },
  { match: /^bonusXp$/,                     category: 'xp',          effectUnit: 'xp',      effectLabel: 'Bonus XP',              effectSuffix: '' },
  { match: /^baseMaxCoinsFindable$/,        category: 'coins',       effectUnit: 'coins',   effectLabel: 'Coin range',            effectSuffix: '' },
  { match: /^scaleIncreasePercentage$/,     category: 'misc',        effectUnit: 'coins',   effectLabel: 'Scale increase',        effectSuffix: '%' },
  { match: /^mutationChanceIncreasePercentage$/, category: 'misc',   effectLabel: 'Chance increase',       effectSuffix: '%', coinUnitWhenContinuous: true },
  { match: /^cropSellPriceIncreasePercentage$/,  effectLabel: 'Sell price bonus', effectSuffix: '%', coinUnitWhenContinuous: true, coinsCategoryWhenContinuous: true },
  { match: /^hungerRestorePercentage$/,     category: 'misc',        effectLabel: 'Hunger restore',        effectSuffix: '%' },
  { match: /^hungerRefundPercentage$/,      category: 'misc',        effectLabel: 'Hunger refund',         effectSuffix: '%' },
  { match: /^maxStrengthIncreasePercentage$/, category: 'misc',      effectLabel: 'Max Strength increase', effectSuffix: '%' },
  { match: /^petDustIncreasePercentage$/,   category: 'misc',        effectLabel: 'Pet dust bonus',        effectSuffix: '%' },
  { match: /^plantAbilityChanceBoostPercentage$/, category: 'misc',  effectLabel: 'Plant ability chance',  effectSuffix: '%' },
];

// Generic suffix rules — apply to any key that didn't hit a specific rule.
// Order: most specific suffix first. Each rule fills only the field(s) it names.
interface SuffixRule {
  match: RegExp;
  effectUnit?: CatalogParameterMetadata['effectUnit'];
  effectSuffix?: string;
}

const SUFFIX_RULES: readonly SuffixRule[] = [
  { match: /Minutes$/,    effectUnit: 'minutes', effectSuffix: 'm' },
  { match: /Seconds$/,                           effectSuffix: 's' },
  { match: /Percentage$/,                        effectSuffix: '%' },
  // *Amount / *Count / *Boost / *Value: raw numeric quantities, no display unit.
  { match: /(Amount|Count|Boost|Value)$/ },
];

function deriveLabelFromKey(key: string): string {
  const stripped = key.replace(/(Percentage|PerSecond|PerMinute|Minutes|Seconds|Amount)$/i, '');
  const spaced = stripped.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// True if we can produce useful metadata for this key — either it's structural (skipped
// intentionally) or a rule matches. Drift uses this to decide whether a key is "known".
export function canResolveParameterKey(key: string): boolean {
  if (STRUCTURAL_PARAMETER_KEYS.has(key)) return true;
  if (SPECIFIC_RULES.some((r) => r.match.test(key))) return true;
  if (SUFFIX_RULES.some((r) => r.match.test(key))) return true;
  return false;
}

export function resolveCatalogParameterMetadata(
  abilityId: string,
  trigger: AbilityDefinition['trigger'],
  baseParameters: Record<string, unknown>,
): CatalogParameterMetadata {
  for (const [key, rawValue] of Object.entries(baseParameters)) {
    if (STRUCTURAL_PARAMETER_KEYS.has(key)) continue;
    const value = toFiniteNumber(rawValue);
    if (value == null) continue;

    let category: AbilityCategory | undefined;
    let effectUnit: CatalogParameterMetadata['effectUnit'];
    let effectSuffix: string | undefined;
    let effectLabel: string | undefined;

    for (const rule of SPECIFIC_RULES) {
      if (!rule.match.test(key)) continue;
      category = rule.category ?? category;
      effectUnit = rule.effectUnit ?? effectUnit;
      effectSuffix = rule.effectSuffix ?? effectSuffix;
      effectLabel = rule.effectLabel ?? effectLabel;
      if (rule.coinUnitWhenContinuous && trigger === 'continuous' && !effectUnit) effectUnit = 'coins';
      if (rule.coinsCategoryWhenContinuous && trigger === 'continuous' && !category) category = 'coins';
      break;
    }

    if (!effectSuffix || !effectUnit) {
      for (const rule of SUFFIX_RULES) {
        if (!rule.match.test(key)) continue;
        if (!effectUnit && rule.effectUnit) effectUnit = rule.effectUnit;
        if (effectSuffix == null && rule.effectSuffix != null) effectSuffix = rule.effectSuffix;
      }
    }

    if (!category) category = trigger === 'hatchEgg' ? 'eggGrowth' : 'misc';
    if (!effectLabel) effectLabel = deriveLabelFromKey(key);

    return {
      category,
      effectBaseValue: value,
      ...(effectUnit ? { effectUnit } : {}),
      ...(effectSuffix != null ? { effectSuffix } : {}),
      ...(effectLabel ? { effectLabel } : {}),
    };
  }

  if (abilityId.endsWith('Granter')) {
    return { category: 'misc', effectUnit: 'coins' };
  }

  return { category: trigger === 'hatchEgg' ? 'eggGrowth' : 'misc' };
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
