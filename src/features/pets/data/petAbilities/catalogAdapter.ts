import {
  getAbilityDef,
  getAllAbilities,
} from '../../../../catalogs/gameCatalogs';
import {
  ABILITY_METADATA,
  type AbilityCategory,
  type AbilityDefinition,
  type AbilityMetadata,
  type CatalogParameterMetadata,
} from './definitions';
import { FLAT_SIZE_KEYS, PERCENT_SIZE_KEYS } from './sizeBoost';

interface MetadataLookup {
  byId: Map<string, AbilityMetadata>;
  byAlias: Map<string, AbilityMetadata>;
}

let metadataLookup: MetadataLookup | null = null;

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

function getMetadataLookup(): MetadataLookup {
  if (metadataLookup) return metadataLookup;
  const byId = new Map<string, AbilityMetadata>();
  const byAlias = new Map<string, AbilityMetadata>();
  for (const entry of ABILITY_METADATA) {
    byId.set(entry.id, entry);
    for (const alias of entry.aliases) {
      const normalized = normalizeKey(alias);
      const compact = normalizeCompactKey(alias);
      if (normalized.length > 0) byAlias.set(normalized, entry);
      if (compact.length > 0) byAlias.set(compact, entry);
    }
  }
  metadataLookup = { byId, byAlias };
  return metadataLookup;
}

function resolveWeatherFromPrefix(prefix: string): AbilityDefinition['requiredWeather'] | null {
  const normalized = normalizeCompactKey(prefix);
  if (!normalized) return null;

  const hit = WEATHER_PREFIX_ENTRIES.find((entry) => entry.prefix === normalized);
  return hit ? hit.weather : null;
}

// Tier suffix must be stripped from the RAW id (case-sensitive: 'II' in
// 'DoubleHatchII'), before keys are lowercased for lookup.
const TIER_SUFFIX_RE = /(IV|III|II|I)(_NEW)?$/;

function buildLookupCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>();
  const addForms = (value: string): void => {
    const normalized = normalizeKey(value);
    const compact = normalizeCompactKey(value);
    if (normalized.length > 0) candidates.add(normalized);
    if (compact.length > 0) candidates.add(compact);
    for (const { prefix } of WEATHER_PREFIX_ENTRIES) {
      if (!compact.startsWith(prefix) || compact.length <= prefix.length + 2) {
        continue;
      }
      candidates.add(compact.slice(prefix.length));
      break;
    }
  };

  addForms(trimmed);
  // Tier walk (DoubleHatchII → DoubleHatch): a game update can ship pets carrying a
  // new tier before the captured catalog knows it — degrade to the base definition
  // instead of marking the whole pet unknown. Exact-id candidates stay first.
  const tierMatch = trimmed.match(TIER_SUFFIX_RE);
  if (tierMatch && tierMatch.index !== undefined && tierMatch.index > 0) {
    addForms(trimmed.slice(0, tierMatch.index));
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
  // Effect of one proc at STR 100: the param itself, or the mean of the game's
  // uniform 1..param roll (coin finders: server-side payout, tooltip `1 - max`).
  perProc?: 'value' | 'uniformMean';
}

const SPECIFIC_RULES: readonly SpecificRule[] = [
  { match: /^plant.*Growth.*Minutes$/i,     category: 'plantGrowth', effectUnit: 'minutes', effectLabel: 'Growth time reduction', effectSuffix: 'm', perProc: 'value' },
  { match: /^egg.*Growth.*Minutes$/i,       category: 'eggGrowth',   effectUnit: 'minutes', effectLabel: 'Hatch time reduction',  effectSuffix: 'm', perProc: 'value' },
  { match: /^bonusXp$/,                     category: 'xp',          effectUnit: 'xp',      effectLabel: 'Bonus XP',              effectSuffix: '',  perProc: 'value' },
  { match: /^baseMaxCoinsFindable$/,        category: 'coins',       effectUnit: 'coins',   effectLabel: 'Coin range',            effectSuffix: '',  perProc: 'uniformMean' },
  { match: /^scaleIncreasePercentage$/,     category: 'misc',        effectUnit: 'coins',   effectLabel: 'Scale increase',        effectSuffix: '%' },
  // v1118 flat-Size shape: {sizeIncrease: N}. Bare integer, no unit suffix — the game renders
  // it as "+N Size" via its own Size icon.
  { match: /^sizeIncrease$/,                category: 'misc',                              effectLabel: 'Size increase',         effectSuffix: '' },
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
    let perProc: SpecificRule['perProc'];

    for (const rule of SPECIFIC_RULES) {
      if (!rule.match.test(key)) continue;
      category = rule.category ?? category;
      effectUnit = rule.effectUnit ?? effectUnit;
      effectSuffix = rule.effectSuffix ?? effectSuffix;
      effectLabel = rule.effectLabel ?? effectLabel;
      perProc = rule.perProc;
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

    let effectMode: CatalogParameterMetadata['effectMode'];
    let strengthScalesEffect: CatalogParameterMetadata['strengthScalesEffect'];
    if (FLAT_SIZE_KEYS.has(key)) {
      effectMode = 'flatSize';
      strengthScalesEffect = false;
    } else if (PERCENT_SIZE_KEYS.has(key)) {
      effectMode = 'scalePercent';
      strengthScalesEffect = true;
    }

    const effectValuePerProc = perProc === 'value' ? value : perProc === 'uniformMean' ? value / 2 : undefined;

    return {
      category,
      effectBaseValue: value,
      ...(effectValuePerProc !== undefined ? { effectValuePerProc } : {}),
      ...(effectUnit ? { effectUnit } : {}),
      ...(effectSuffix != null ? { effectSuffix } : {}),
      ...(effectLabel ? { effectLabel } : {}),
      ...(effectMode ? { effectMode } : {}),
      ...(strengthScalesEffect !== undefined ? { strengthScalesEffect } : {}),
    };
  }

  // Granters (RainDance included) carry only `grantedMutations`; valued in coins from the garden.
  const granted = baseParameters['grantedMutations'];
  if (Array.isArray(granted) && granted.length > 0) {
    return { category: 'misc', effectUnit: 'coins' };
  }

  return { category: trigger === 'hatchEgg' ? 'eggGrowth' : 'misc' };
}

function buildCatalogLookupCache(): CatalogLookupCache | null {
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

  // Ids before names: the name "Egg Growth Boost II" (EggGrowthBoostII_NEW) compacts
  // to the id of EggGrowthBoostII, and the first key registered wins.
  for (const abilityId of abilityIds) {
    addCatalogKey(abilityId, abilityId);
  }
  for (const abilityId of abilityIds) {
    const name = getAbilityDef(abilityId)?.name;
    if (typeof name === 'string' && name.trim().length > 0) {
      addCatalogKey(name, abilityId);
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
  const parameterMetadata = resolveCatalogParameterMetadata(trigger, baseParameters);
  const requiredWeather = normalizeCatalogRequiredWeather(baseParameters['requiredWeather']);
  const metadata = getMetadataLookup().byId.get(abilityId);
  const definition: AbilityDefinition = {
    id: abilityId,
    name: typeof catalogEntry.name === 'string' && catalogEntry.name.trim().length > 0 ? catalogEntry.name : abilityId,
    category: parameterMetadata.category,
    trigger,
    rollPeriodMinutes: 1,
    ...(metadata && metadata.aliases.length > 0 ? { aliases: metadata.aliases } : {}),
    ...(metadata?.notes ? { notes: metadata.notes } : {}),
    ...(parameterMetadata.effectUnit ? { effectUnit: parameterMetadata.effectUnit } : {}),
    ...(parameterMetadata.effectLabel ? { effectLabel: parameterMetadata.effectLabel } : {}),
    ...(parameterMetadata.effectBaseValue != null ? { effectBaseValue: parameterMetadata.effectBaseValue } : {}),
    ...(parameterMetadata.effectValuePerProc != null ? { effectValuePerProc: parameterMetadata.effectValuePerProc } : {}),
    ...(parameterMetadata.effectSuffix != null ? { effectSuffix: parameterMetadata.effectSuffix } : {}),
    ...(parameterMetadata.effectMode ? { effectMode: parameterMetadata.effectMode } : {}),
    ...(parameterMetadata.strengthScalesEffect !== undefined ? { strengthScalesEffect: parameterMetadata.strengthScalesEffect } : {}),
    ...(requiredWeather ? { requiredWeather } : {}),
  };

  if (typeof catalogEntry.baseProbability === 'number' && Number.isFinite(catalogEntry.baseProbability)) {
    definition.baseProbability = catalogEntry.baseProbability;
  }

  return attachWeatherConstraint(raw, definition);
}

// Catalog absent (abilities not captured) ⇒ null: callers surface loading/unknown.
export function getAbilityDefinition(raw: string | null | undefined): AbilityDefinition | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const cache = buildCatalogLookupCache();
  if (!cache) return null;

  const { byAlias } = getMetadataLookup();
  for (const key of buildLookupCandidates(trimmed)) {
    const abilityId = cache.byKey.get(key) ?? byAlias.get(key)?.id;
    if (!abilityId) continue;
    const definition = buildDefinitionFromCatalog(abilityId, trimmed);
    if (definition) return definition;
  }
  return null;
}

export function getAllAbilityDefinitions(): AbilityDefinition[] {
  const definitions: AbilityDefinition[] = [];
  for (const abilityId of getAllAbilities()) {
    const definition = buildDefinitionFromCatalog(abilityId, abilityId);
    if (definition) definitions.push(definition);
  }
  return definitions;
}
