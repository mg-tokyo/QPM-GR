// Derives per-proc coin impacts for abilities that depend on live garden state.

import { getGardenSnapshot, type GardenSnapshot } from '../garden/bridge';
import { shareGlobal } from '../../core/pageContext';
import { calculatePlantValue } from '../economy/valueCalculator';
import { computeMutationMultiplier } from '../../utils/game/cropMultipliers';
import { getMutationApplicationResult } from '../../utils/mutationCompatibility';
import { normalizeSpeciesKey } from '../../utils/helpers';
import { lookupMaxScale } from '../../utils/game/plantScales';
import { analyzeCropMutationPotential } from '../garden/cropMutationAnalytics';
import { isDebugGlobalsEnabled } from '../../utils/debugGlobals';
import { isRecord } from '../../utils/typeGuards';
import { getAbilityDef } from '../../catalogs/gameCatalogs';
import { getWeatherSnapshot } from '../../store/weatherHub';
import { getAbilityDefinition } from './data/petAbilities';
import { getFriendBonusMultiplier } from '../../store/friendBonus';
const MIN_SCALE = 1;
const MIN_PERCENT = 50;
const MAX_PERCENT = 100;
const FALLBACK_MAX_SCALE = 2;

/**
 * Maps known Granter ability IDs to the mutation name they grant.
 * Abilities NOT in this map use the ID prefix (e.g. "FrostGranter" → "Frost").
 */
const GRANTER_TO_MUTATION: Readonly<Record<string, string>> = {
  GoldGranter: 'Gold',
  RainbowGranter: 'Rainbow',
  SnowGranter: 'Frozen',
  FrostGranter: 'Frozen',
  AmberGranter: 'Amberlit',
  DawnGranter: 'Dawnlit',
  WetGranter: 'Wet',
  RainGranter: 'Wet',
};

/** Resolves granted mutation: catalog baseParameters.grantedMutations[0] → hardcoded table → strip "Granter" suffix. */
export function resolveGrantedMutationName(abilityId: string): string {
  const catalogEntry = getAbilityDef(abilityId);
  if (catalogEntry?.baseParameters) {
    const granted = catalogEntry.baseParameters['grantedMutations'];
    if (Array.isArray(granted) && granted.length > 0 && typeof granted[0] === 'string') {
      return granted[0];
    }
  }

  // Fallback table for renamed/aliased abilities missing from catalog.
  const fromTable = GRANTER_TO_MUTATION[abilityId];
  if (fromTable) return fromTable;

  return abilityId.replace(/Granter$/, '');
}

interface MatureCrop {
  species: string;
  scale: number;
  maxScale: number;
  sizePercent: number;
  mutations: string[];
  currentValue: number;
  hasColorMutation: boolean;
  fruitCount: number;
  isMature: boolean;
}

export interface AbilityValuationContext {
  crops: MatureCrop[];
  uncoloredCrops: MatureCrop[];
  uncoloredFruitSlots: number; // per-fruit slot count for Rainbow/Gold
  totalMatureValue: number;
  friendBonus: number;
}

export interface DynamicAbilityEffect {
  effectPerProc: number;
  detail: string;
}

function coercePositiveInteger(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const rounded = Math.floor(numeric);
  return rounded > 0 ? rounded : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getStrengthScaleFactor(strength: number | null | undefined): number {
  const normalizedStrength = typeof strength === 'number' && Number.isFinite(strength)
    ? Math.max(0, strength)
    : 100;
  return normalizedStrength / 100;
}

function normalizeWeatherRequirement(value: unknown): 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | 'thunderstorm' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'sunny') return 'sunny';
  if (normalized === 'rain') return 'rain';
  if (normalized === 'frost' || normalized === 'snow') return 'snow';
  if (normalized === 'dawn') return 'dawn';
  if (normalized === 'amber' || normalized === 'ambermoon') return 'amber';
  if (normalized === 'thunderstorm' || normalized === 'thunder') return 'thunderstorm';
  return null;
}

function getCurrentWeatherKind(): 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | 'thunderstorm' | 'unknown' {
  return getWeatherSnapshot().kind;
}

function isRequiredWeatherActive(requirement: 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | 'thunderstorm' | null): boolean {
  if (!requirement) return true;
  return getCurrentWeatherKind() === requirement;
}

function formatRequiredWeatherLabel(requirement: 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | 'thunderstorm' | null): string {
  switch (requirement) {
    case 'rain':
      return 'Rain';
    case 'snow':
      return 'Snow';
    case 'dawn':
      return 'Dawn';
    case 'amber':
      return 'Amber Moon';
    case 'thunderstorm':
      return 'Thunderstorm';
    case 'sunny':
      return 'Sunny';
    default:
      return 'the required weather';
  }
}

function resolveCatalogScaledParameter(
  abilityId: string,
  parameterKey: string,
  strength: number | null | undefined,
): number | null {
  const catalogEntry = getAbilityDef(abilityId);
  if (!catalogEntry?.baseParameters || typeof catalogEntry.baseParameters !== 'object') {
    return null;
  }

  const rawValue = toFiniteNumber(catalogEntry.baseParameters[parameterKey]);
  if (rawValue == null) return null;
  return rawValue * getStrengthScaleFactor(strength);
}

function resolveFruitCount(slot: Record<string, unknown>, allowMultiHarvest: boolean): number {
  if (!allowMultiHarvest) {
    return 1;
  }

  const preferredKeys = [
    'fruitCount',
    'remainingFruitCount',
    'remainingFruits',
    'totalFruitCount',
    'totalFruits',
    'totalFruit',
  ] as const;

  for (const key of preferredKeys) {
    if (key in slot) {
      const resolved = coercePositiveInteger(slot[key]);
      if (resolved != null) {
        return Math.min(resolved, 64);
      }
    }
  }

  const slotStatesRaw = slot.slotStates as unknown;
  if (Array.isArray(slotStatesRaw)) {
    const nonEmptyStates = slotStatesRaw.filter((state) => state != null);
    if (nonEmptyStates.length > 0) {
      return Math.min(nonEmptyStates.length, 64);
    }
  }

  const displayName =
    typeof slot.displayName === 'string'
      ? slot.displayName
      : typeof slot.name === 'string'
        ? slot.name
        : null;
  if (displayName) {
    const match = displayName.match(/\+(\d+)/);
    if (match) {
      const parsed = coercePositiveInteger(match[1]);
      if (parsed != null) {
        return Math.min(parsed, 64);
      }
    }
  }

  return 1;
}

function resolveSizeMetadata(scale: number, species: string, slot: Record<string, unknown>): { maxScale: number; sizePercent: number } {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : MIN_SCALE;

  const maxScaleSources = [slot.maxScale, slot.targetMaxScale, slot.maxTargetScale, slot.maximumScale, slot.max];
  const normalized = typeof species === 'string' ? normalizeSpeciesKey(species) : null;

  let resolvedMaxScale: number | null = null;
  for (const candidate of maxScaleSources) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > MIN_SCALE) {
      resolvedMaxScale = numeric;
      break;
    }
  }

  if ((resolvedMaxScale == null || resolvedMaxScale <= MIN_SCALE) && normalized) {
    const lookup = lookupMaxScale(normalized);
    if (lookup != null && Number.isFinite(lookup) && lookup > MIN_SCALE) {
      resolvedMaxScale = lookup;
    }
  }

  if (resolvedMaxScale == null || !Number.isFinite(resolvedMaxScale) || resolvedMaxScale <= MIN_SCALE) {
    resolvedMaxScale = FALLBACK_MAX_SCALE;
  }

  const clampedMax = Math.max(MIN_SCALE + 0.01, resolvedMaxScale);
  const clampedScale = Math.min(clampedMax, Math.max(MIN_SCALE, safeScale));
  const ratio = clampedMax > MIN_SCALE ? (clampedScale - MIN_SCALE) / (clampedMax - MIN_SCALE) : 0;
  const percent = MIN_PERCENT + ratio * (MAX_PERCENT - MIN_PERCENT);

  return {
    maxScale: clampedMax,
    sizePercent: Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(percent * 100) / 100)),
  };
}

function convertPercentToScale(percent: number, maxScale: number): number {
  const bounded = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, percent));
  const ratio = (bounded - MIN_PERCENT) / (MAX_PERCENT - MIN_PERCENT);
  const clampedMax = Math.max(MIN_SCALE + 0.01, Number.isFinite(maxScale) && maxScale > MIN_SCALE ? maxScale : FALLBACK_MAX_SCALE);
  return MIN_SCALE + ratio * (clampedMax - MIN_SCALE);
}

interface TileCollectionDescriptor {
  tiles: Record<string, unknown> | null | undefined;
  allowMultiHarvest: boolean;
}

function extractMatureCrops(snapshot: GardenSnapshot | null): MatureCrop[] {
  if (!snapshot) {
    return [];
  }

  const collections: TileCollectionDescriptor[] = [
    { tiles: snapshot.tileObjects as Record<string, unknown> | undefined, allowMultiHarvest: true },
    { tiles: snapshot.boardwalkTileObjects as Record<string, unknown> | undefined, allowMultiHarvest: true },
  ];

  const mature: MatureCrop[] = [];
  const now = Date.now();

  for (const { tiles: collection, allowMultiHarvest } of collections) {
    if (!collection || typeof collection !== 'object') continue;

    for (const tile of Object.values(collection)) {
      if (!isRecord(tile)) continue;
      if (tile.objectType !== 'plant') continue;

      const slots = tile.slots;
      if (!Array.isArray(slots)) continue;

      for (const slot of slots) {
        if (!isRecord(slot)) continue;
        const species = typeof slot.species === 'string' ? slot.species : null;
        if (!species) continue;

  const endTimeRaw = slot.endTime;
  const endTime = typeof endTimeRaw === 'number' ? endTimeRaw : Number(endTimeRaw);
  const isMature = Number.isFinite(endTime) ? endTime <= now : false;

        const scaleRaw = slot.targetScale ?? slot.scale ?? slot.plantScale;
        const scale = typeof scaleRaw === 'number' && Number.isFinite(scaleRaw) ? Math.max(MIN_SCALE, scaleRaw) : MIN_SCALE;

        const mutationsRaw = Array.isArray(slot.mutations) ? slot.mutations : [];
        const mutations: string[] = mutationsRaw
          .map((value) => (typeof value === 'string' ? value : null))
          .filter((value): value is string => !!value);

        const value = calculatePlantValue(species, scale, mutations, getFriendBonusMultiplier());
        if (!Number.isFinite(value) || value <= 0) continue;

        const breakdown = computeMutationMultiplier(mutations);
        const hasColor = breakdown.color?.definition?.name === 'Gold' || breakdown.color?.definition?.name === 'Rainbow';

        const { maxScale, sizePercent } = resolveSizeMetadata(scale, species, slot);
        const fruitCount = resolveFruitCount(slot, allowMultiHarvest);

        mature.push({
          species,
          scale,
          maxScale,
          sizePercent,
          mutations,
          currentValue: value,
          hasColorMutation: hasColor,
          fruitCount,
          isMature,
        });
      }
    }
  }

  return mature;
}

export function buildAbilityValuationContext(snapshot: GardenSnapshot | null = getGardenSnapshot()): AbilityValuationContext {
  const crops = extractMatureCrops(snapshot);
  const totalMatureValue = crops.reduce((sum, crop) => (crop.isMature ? sum + crop.currentValue * Math.max(1, crop.fruitCount) : sum), 0);

  // Uncolored = no Gold, no Rainbow. Other weather mutations remain eligible.
  const uncoloredCrops = crops.filter((crop) => {
    const hasGold = crop.mutations.includes('Gold');
    const hasRainbow = crop.mutations.includes('Rainbow');
    return !hasGold && !hasRainbow;
  });

  // Multi-harvest plants count as multiple targets for Rainbow/Gold.
  const uncoloredFruitSlots = uncoloredCrops.reduce((sum, crop) => sum + Math.max(1, crop.fruitCount), 0);

  return {
    crops,
    uncoloredCrops,
    uncoloredFruitSlots,
    totalMatureValue,
    friendBonus: getFriendBonusMultiplier(),
  };
}

function resolveCropScaleEffect(
  context: AbilityValuationContext,
  strength: number | null | undefined,
  basePercent: number | null,
  abilityId?: string,
): DynamicAbilityEffect | null {
  const effectPercent = basePercent != null
    ? (basePercent * getStrengthScaleFactor(strength))
    : (abilityId ? resolveCatalogScaledParameter(abilityId, 'scaleIncreasePercentage', strength) : null);
  if (effectPercent == null) {
    return null;
  }
  if (!context.crops.length || effectPercent <= 0) {
    return null;
  }

  const eligible = context.crops.filter((crop) => crop.sizePercent < MAX_PERCENT - 0.01 && Math.max(1, crop.fruitCount) > 0);
  if (!eligible.length) {
    return null;
  }

  let weightedDelta = 0;
  let weightedPercentApplied = 0;
  let totalWeight = 0;

  for (const crop of eligible) {
    const weight = Math.max(1, Math.floor(crop.fruitCount));
    const remainingPercent = Math.max(0, MAX_PERCENT - crop.sizePercent);
    if (remainingPercent <= 0) {
      continue;
    }

    const appliedPercent = Math.min(effectPercent, remainingPercent);
    if (appliedPercent <= 0) {
      continue;
    }

    const targetPercent = crop.sizePercent + appliedPercent;
    const newScale = convertPercentToScale(targetPercent, crop.maxScale);
    const currentScale = crop.scale > 0 ? crop.scale : MIN_SCALE;
    const scaleDelta = Math.max(0, newScale - currentScale);
    if (scaleDelta <= 0) {
      continue;
    }

    const valuePerScale = currentScale > 0 ? crop.currentValue / currentScale : 0;
    if (!Number.isFinite(valuePerScale) || valuePerScale <= 0) {
      continue;
    }

    const deltaValue = valuePerScale * scaleDelta;
    if (!Number.isFinite(deltaValue) || deltaValue <= 0) {
      continue;
    }

    totalWeight += weight;
    weightedDelta += deltaValue * weight;
    weightedPercentApplied += appliedPercent * weight;
  }

  if (weightedDelta <= 0 || totalWeight === 0) {
    return null;
  }

  const expectedDelta = weightedDelta / totalWeight;
  const averageGain = weightedPercentApplied / totalWeight;
  const impactedFruits = totalWeight;
  const detail = `Boosts ${impactedFruits} mature fruit${impactedFruits === 1 ? '' : 's'} by ~${averageGain.toFixed(2)}% size (friend bonus applied, weighted by fruit count).`;

  return {
    effectPerProc: expectedDelta,
    detail,
  };
}

function resolveColorGranterEffect(
  context: AbilityValuationContext,
  granted: 'Gold' | 'Rainbow',
): DynamicAbilityEffect | null {
  if (!context.uncoloredCrops.length) {
    return null;
  }

  let weightedDelta = 0;
  let totalWeight = 0;

  for (const crop of context.uncoloredCrops) {
    const weight = Math.max(1, Math.floor(crop.fruitCount));
    const mutations = [...crop.mutations, granted];
    const newValue = calculatePlantValue(crop.species, crop.scale, mutations, getFriendBonusMultiplier());
    const delta = newValue - crop.currentValue;
    if (Number.isFinite(delta) && delta > 0) {
      totalWeight += weight;
      weightedDelta += delta * weight;
    }
  }

  if (totalWeight === 0 || weightedDelta <= 0) {
    return null;
  }

  const averageDelta = weightedDelta / totalWeight;
  return {
    effectPerProc: averageDelta,
    detail: `Converts 1 random uncolored crop to ${granted}. ${context.uncoloredFruitSlots} eligible fruit slot${context.uncoloredFruitSlots === 1 ? '' : 's'} across ${context.uncoloredCrops.length} plant${context.uncoloredCrops.length === 1 ? '' : 's'} (friend bonus applied, weighted by fruit count).`,
  };
}

function resolveGranterEffect(
  context: AbilityValuationContext,
  mutationName: string,
): DynamicAbilityEffect | null {
  let weightedDelta = 0;
  let totalWeight = 0;
  let eligibleCount = 0;
  let fruitSlots = 0;

  for (const crop of context.crops) {
    const nextMutations = getMutationApplicationResult(crop.mutations, mutationName);
    if (!nextMutations) continue;

    const weight = Math.max(1, Math.floor(crop.fruitCount));
    fruitSlots += weight;
    eligibleCount += 1;
    const newValue = calculatePlantValue(
      crop.species,
      crop.scale,
      nextMutations,
      getFriendBonusMultiplier(),
    );
    const delta = newValue - crop.currentValue;
    if (Number.isFinite(delta) && delta > 0) {
      totalWeight += weight;
      weightedDelta += delta * weight;
    }
  }

  if (totalWeight === 0 || weightedDelta <= 0) return null;

  const averageDelta = weightedDelta / totalWeight;
  return {
    effectPerProc: averageDelta,
    detail: `Grants ${mutationName} to 1 eligible crop. ${eligibleCount} plant${eligibleCount === 1 ? '' : 's'} (${fruitSlots} fruit${fruitSlots === 1 ? '' : 's'}) eligible (friend bonus applied, weighted by fruit count).`,
  };
}

function resolveMatureFruitValueEffect(
  context: AbilityValuationContext,
  effectLabel: string,
): DynamicAbilityEffect | null {
  const eligible = context.crops.filter((crop) => crop.isMature && Math.max(1, crop.fruitCount) > 0);
  if (!eligible.length) return null;

  let weightedValue = 0;
  let totalWeight = 0;
  for (const crop of eligible) {
    const weight = Math.max(1, Math.floor(crop.fruitCount));
    if (!Number.isFinite(crop.currentValue) || crop.currentValue <= 0) continue;
    totalWeight += weight;
    weightedValue += crop.currentValue * weight;
  }
  if (totalWeight === 0 || weightedValue <= 0) return null;

  const averageValue = weightedValue / totalWeight;
  const fruitSlots = eligible.reduce((sum, crop) => sum + Math.max(1, Math.floor(crop.fruitCount)), 0);
  return {
    effectPerProc: averageValue,
    detail: `${effectLabel}. ${eligible.length} mature plant${eligible.length === 1 ? '' : 's'} (${fruitSlots} fruit${fruitSlots === 1 ? '' : 's'}) considered, weighted by fruit count.`,
  };
}

function resolveCatalogBackedDynamicEffect(
  abilityId: string,
  context: AbilityValuationContext,
  strength: number | null | undefined,
): DynamicAbilityEffect | null {
  const catalogEntry = getAbilityDef(abilityId);
  const baseParameters = catalogEntry?.baseParameters;
  if (!baseParameters || typeof baseParameters !== 'object') {
    return null;
  }

  const definition = getAbilityDefinition(abilityId);
  const requiredWeather = definition?.requiredWeather ?? normalizeWeatherRequirement(baseParameters['requiredWeather']);
  if (requiredWeather && !isRequiredWeatherActive(requiredWeather)) {
    return {
      effectPerProc: 0,
      detail: `Only active during ${formatRequiredWeatherLabel(requiredWeather)}.`,
    };
  }

  if (toFiniteNumber(baseParameters['scaleIncreasePercentage']) != null) {
    return resolveCropScaleEffect(context, strength, null, abilityId);
  }

  if (toFiniteNumber(baseParameters['mutationChanceIncreasePercentage']) != null) {
    return resolveCropMutationEffect(abilityId, strength);
  }

  return null;
}

export function resolveDynamicAbilityEffect(
  abilityId: string,
  context: AbilityValuationContext,
  strength: number | null | undefined,
): DynamicAbilityEffect | null {
  const catalogBacked = resolveCatalogBackedDynamicEffect(abilityId, context, strength);
  if (catalogBacked) {
    return catalogBacked;
  }

  switch (abilityId) {
    case 'ProduceScaleBoost':
      return resolveCropScaleEffect(context, strength, 6);
    case 'ProduceScaleBoostII':
      return resolveCropScaleEffect(context, strength, 10);
    case 'GoldGranter':
      return resolveColorGranterEffect(context, 'Gold');
    case 'RainbowGranter':
      return resolveColorGranterEffect(context, 'Rainbow');
    case 'DoubleHarvest':
      return resolveMatureFruitValueEffect(context, 'Duplicates 1 harvested fruit');
    case 'ProduceRefund':
      return resolveMatureFruitValueEffect(context, 'Refunds 1 sold crop');
    default:
      if (abilityId.endsWith('Granter')) {
        return resolveGranterEffect(context, resolveGrantedMutationName(abilityId));
      }
      return null;
  }
}

/**
 * Calculate the event-value uplift of weather mutation boost abilities.
 * These are passive modifiers to the active weather/lunar mutation chance,
 * not proc-based abilities.
 */
function resolveCropMutationEffect(
  abilityId: string,
  strength: number | null | undefined,
): DynamicAbilityEffect | null {
  const potential = analyzeCropMutationPotential();
  const definition = getAbilityDefinition(abilityId);
  const requiredWeather = definition?.requiredWeather ?? normalizeWeatherRequirement(
    getAbilityDef(abilityId)?.baseParameters?.['requiredWeather'],
  );

  if (requiredWeather && !isRequiredWeatherActive(requiredWeather)) {
    return {
      effectPerProc: 0,
      detail: `Only active during ${formatRequiredWeatherLabel(requiredWeather)}.`,
    };
  }

  if (!potential.weather || potential.eligibleCrops.length === 0 || potential.averageValueGain <= 0) {
    return {
      effectPerProc: 0,
      detail: 'No active weather/lunar event or no eligible crops. Mutations only proc during Rain, Snow, Dawn, or Amber Moon.',
    };
  }

  const addedChance = resolveCatalogScaledParameter(abilityId, 'mutationChanceIncreasePercentage', strength);
  if (addedChance == null || addedChance <= 0) {
    return null;
  }

  const weatherName = potential.weatherDisplayName ?? (
    potential.weather === 'rain' ? 'Rain' :
    potential.weather === 'snow' ? 'Snow' :
    potential.weather === 'dawn' ? 'Dawn' :
    'Amber Moon'
  );

  const mutationName = potential.grantedMutation ?? (
    potential.weather === 'rain' ? 'Wet' :
    potential.weather === 'snow' ? 'Chilled' :
    potential.weather === 'dawn' ? 'Dawnlit' :
    'Ambershine'
  );

  const effectiveChanceIncrease = Math.min(
    addedChance,
    Math.max(0, 100 - potential.baseMutationChance),
  );
  const additionalMutationsPerEvent = potential.eligibleCrops.length * (effectiveChanceIncrease / 100);
  const expectedTotalValue = additionalMutationsPerEvent * potential.averageValueGain;

  return {
    effectPerProc: expectedTotalValue,
    detail: `${weatherName} active (${potential.baseMutationChance.toFixed(1)}% base chance/crop). Adds ${effectiveChanceIncrease.toFixed(1)} percentage points for ${potential.eligibleCrops.length} eligible plant${potential.eligibleCrops.length === 1 ? '' : 's'} (${potential.eligibleFruits} fruit${potential.eligibleFruits === 1 ? '' : 's'}). Expected uplift: ${additionalMutationsPerEvent.toFixed(2)} extra ${mutationName} mutation${additionalMutationsPerEvent === 1 ? '' : 's'}/event, avg ${formatMutationCoin(potential.averageValueGain)}/mutation.`,
  };
}

function formatMutationCoin(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  } else {
    return value.toFixed(0);
  }
}

type AbilityDebugApi = {
  getContext: () => AbilityValuationContext;
  listUncolored: () => Array<
    Pick<MatureCrop, 'species' | 'fruitCount' | 'sizePercent' | 'mutations' | 'hasColorMutation' | 'isMature'> & {
      valuePerScale: number;
    }
  >;
  listAll: () => Array<
    Pick<MatureCrop, 'species' | 'fruitCount' | 'sizePercent' | 'mutations' | 'hasColorMutation' | 'isMature'> & {
      currentValue: number;
      maxScale: number;
    }
  >;
};

const abilityDebugApi: AbilityDebugApi = {
  getContext: () => buildAbilityValuationContext(),
  listUncolored: () => {
    const context = buildAbilityValuationContext();
    return context.uncoloredCrops.map((crop) => ({
      species: crop.species,
      fruitCount: Math.max(1, crop.fruitCount),
      sizePercent: crop.sizePercent,
      mutations: [...crop.mutations],
      hasColorMutation: crop.hasColorMutation,
      isMature: crop.isMature,
      valuePerScale: crop.scale > 0 ? crop.currentValue / crop.scale : crop.currentValue,
    }));
  },
  listAll: () => {
    const context = buildAbilityValuationContext();
    return context.crops.map((crop) => ({
      species: crop.species,
      fruitCount: Math.max(1, crop.fruitCount),
      sizePercent: crop.sizePercent,
      mutations: [...crop.mutations],
      hasColorMutation: crop.hasColorMutation,
      isMature: crop.isMature,
      currentValue: crop.currentValue,
      maxScale: crop.maxScale,
    }));
  },
};

if (isDebugGlobalsEnabled()) {
  shareGlobal('__qpmAbilityDebug', abilityDebugApi);
}
