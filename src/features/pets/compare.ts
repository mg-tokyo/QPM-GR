// src/features/petCompareEngine.ts
// Shared compare and progression engine for pet picker, manager compare, and optimizer decisions.

import {
  computeAbilityStats,
  computeEffectPerHour,
  getAbilityDefinition,
  type AbilityDefinition,
} from './data/petAbilities';
import { getAbilityDef } from '../../catalogs/gameCatalogs';
import {
  buildAbilityValuationContext,
  resolveDynamicAbilityEffect,
  type AbilityValuationContext,
} from './abilityValuation';
import { calculateMaxStrength } from '../../store/xpTracker';
import { getStatsSnapshot } from '../../store/stats';
import { getInventoryItems, type InventoryItem } from '../../store/inventory';
import { getGardenSnapshot } from '../garden/bridge';
import { getWeatherSnapshot } from '../../store/weatherHub';

export interface ComparePetInput {
  id: string;
  species: string;
  strength: number | null;
  targetScale: number | null;
  abilities: string[];
  mutations?: string[];
}

export type ProgressionStage = 'early' | 'mid' | 'late';

export interface ProgressionSignalSnapshot {
  rbwCount: number | null;
  rainbowGranterPetCount: number;
  petPowerBand: number | null;
  storage: {
    petHutch: number | null;
    seedSilo: number | null;
    decorShed: number | null;
  };
  celestial: {
    starweaver: number | null;
    moon: number | null;
    dawn: number | null;
  };
  eggs: number | null;
  coins: number | null;
}

export interface ProgressionStageSnapshot {
  stage: ProgressionStage;
  score: number;
  signals: ProgressionSignalSnapshot;
}

export type CompareAbilityGroup = 'per_hour' | 'sale' | 'hatch_dollar' | 'food' | 'hatch_trio' | 'isolated';
export type ActionBucketKey = 'harvest' | 'sell' | 'hatch';

export interface AbilityContribution {
  rawAbilityId: string;
  abilityId: string;
  name: string;
  definition: AbilityDefinition | null;
  group: CompareAbilityGroup;
  isAction: boolean;
  isReview: boolean;
  isIgnored: boolean;
  triggerLabel: string;
  actionBucket: ActionBucketKey | null;
  procsPerHour: number;
  chancePercent: number;
  impactPerHour: number;
  valuePerTrigger: number;
  expectedValuePerTrigger: number;
  expectedValuePerHour: number;
  scoreValue: number;
  unit: 'coins' | 'minutes' | 'xp' | 'none';
}

export interface ActionBucketSummary {
  key: ActionBucketKey;
  triggerLabel: string;
  combinedChancePercent: number;
  expectedValuePerTrigger: number;
  entries: AbilityContribution[];
}

export interface PetCompareProfile {
  petId: string;
  stage: ProgressionStage;
  score: number;
  reviewCount: number;
  abilities: AbilityContribution[];
  byAbilityId: Map<string, AbilityContribution>;
  totals: {
    coinsPerHour: number;
    plantMinutesPerHour: number;
    eggMinutesPerHour: number;
    xpPerHour: number;
  };
  actionBuckets: Record<ActionBucketKey, ActionBucketSummary>;
}

export interface TeamCompareProfile {
  stage: ProgressionStageSnapshot;
  pets: PetCompareProfile[];
  totals: {
    coinsPerHour: number;
    plantMinutesPerHour: number;
    eggMinutesPerHour: number;
    xpPerHour: number;
  };
  actionBuckets: Record<ActionBucketKey, ActionBucketSummary>;
  score: number;
}

export interface OptimizerAbilityFamilyInfo {
  exactFamilyKey: string;
  exactFamilyLabel: string;
  broadRoleFamilyKey: string;
  broadRoleFamilyLabel: string;
  hidden: boolean;
}

const FOOD_FAMILY_KEYS = new Set(['hungerrestore', 'hungerboost']);
const HATCH_DOLLAR_FAMILY_KEYS = new Set(['petrefund']);
const HATCH_TRIO_FAMILY_KEYS = new Set(['petmutationboost', 'petageboost', 'pethatchsizeboost', 'doublehatch']);
const ISOLATED_ABILITY_IDS = new Set(['Copycat', 'RainDance']);
const HATCH_MODIFIER_PARAM_KEYS = new Set(['mutationChanceIncreasePercentage']);
const CONTINUOUS_MODIFIER_PARAM_KEYS = new Set([
  'mutationChanceIncreasePercentage',
  'hungerRefundPercentage',
  'hungerRestorePercentage',
  'plantGrowthReductionMinutes',
  'eggGrowthTimeReductionMinutes',
]);
const OPTIMIZER_HIDDEN_FAMILY_KEYS = new Set(['dawnsustain', 'dawnbinderboost']);

/**
 * Abilities whose tiers represent functionally distinct roles (different seed pools)
 * rather than the same effect at different strengths.
 * When an ability is in this set, its exactFamilyKey preserves the tier suffix
 * so each tier competes independently in the optimizer.
 */
const TIER_INDEPENDENT_FAMILY_IDS = new Set([
  'SeedFinderI', 'SeedFinderII', 'SeedFinderIII', 'SeedFinderIV',
]);
const OPTIMIZER_BROAD_ROLE_LABELS: Record<string, string> = {
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

const ABILITY_BASE_TRIGGER_VALUE: Record<string, number> = {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getWorkingStrength(pet: ComparePetInput): number {
  if (Number.isFinite(pet.strength)) return Math.max(1, pet.strength ?? 1);
  const fallback = calculateMaxStrength(pet.targetScale, pet.species);
  if (Number.isFinite(fallback)) return Math.max(1, fallback ?? 1);
  return 100;
}

function getStrengthScaleFactor(strength: number): number {
  return Math.max(0.25, strength / 100);
}

function toFinitePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function isAbilityWeatherActive(definition: AbilityDefinition | null): boolean {
  if (!definition?.requiredWeather) return true;
  return getWeatherSnapshot().kind === definition.requiredWeather;
}

function resolveCatalogFamilyKey(abilityId: string): string | null {
  const catalogEntry = getAbilityDef(abilityId);
  if (!catalogEntry?.baseParameters || typeof catalogEntry.baseParameters !== 'object') {
    return null;
  }

  const params = catalogEntry.baseParameters as Record<string, unknown>;
  if (toFinitePositiveNumber(params['plantGrowthReductionMinutes']) != null) return 'plantgrowthboost';
  if (toFinitePositiveNumber(params['eggGrowthTimeReductionMinutes']) != null) return 'egggrowthboost';
  if (toFinitePositiveNumber(params['hungerRestorePercentage']) != null) return 'hungerrestore';
  if (toFinitePositiveNumber(params['hungerRefundPercentage']) != null) return 'hungerboost';
  if (toFinitePositiveNumber(params['scaleIncreasePercentage']) != null) return 'producescaleboost';
  if (toFinitePositiveNumber(params['baseMaxCoinsFindable']) != null) return 'coinfinder';
  if (toFinitePositiveNumber(params['bonusXp']) != null) {
    return catalogEntry.trigger === 'hatchEgg' ? 'petageboost' : 'petxpboost';
  }
  if (toFinitePositiveNumber(params['mutationChanceIncreasePercentage']) != null) {
    return catalogEntry.trigger === 'hatchEgg' ? 'petmutationboost' : 'producemutationboost';
  }
  if (toFinitePositiveNumber(params['maxStrengthIncreasePercentage']) != null) return 'pethatchsizeboost';
  if (toFinitePositiveNumber(params['cropSellPriceIncreasePercentage']) != null) {
    return catalogEntry.trigger === 'sellAllCrops' ? 'sellboost' : null;
  }
  return null;
}

function resolveCatalogScaledParameterValue(
  abilityId: string,
  strength: number,
): { value: number; sourceKey: string } | null {
  const catalogEntry = getAbilityDef(abilityId);
  if (!catalogEntry || !catalogEntry.baseParameters || typeof catalogEntry.baseParameters !== 'object') {
    return null;
  }

  const params = catalogEntry.baseParameters as Record<string, unknown>;
  const strengthScaleFactor = getStrengthScaleFactor(strength);

  const orderedKeys = [
    'mutationChanceIncreasePercentage',
    'cropSellPriceIncreasePercentage',
    'hungerRefundPercentage',
    'hungerRestorePercentage',
    'plantGrowthReductionMinutes',
    'eggGrowthTimeReductionMinutes',
    'scaleIncreasePercentage',
    'baseMaxCoinsFindable',
    'bonusXp',
    'maxStrengthIncreasePercentage',
  ] as const;

  for (const key of orderedKeys) {
    const raw = toFinitePositiveNumber(params[key]);
    if (raw == null) continue;
    return {
      value: raw * strengthScaleFactor,
      sourceKey: key,
    };
  }

  return null;
}

function hasCatalogBaseProbability(abilityId: string): boolean {
  const entry = getAbilityDef(abilityId);
  return typeof entry?.baseProbability === 'number' && Number.isFinite(entry.baseProbability);
}

function shouldTreatAsAlwaysOnAction(
  abilityId: string,
  definition: AbilityDefinition | null,
  parameterSourceKey: string | null,
): boolean {
  if (!definition || definition.trigger !== 'hatchEgg') return false;
  if (!parameterSourceKey || !HATCH_MODIFIER_PARAM_KEYS.has(parameterSourceKey)) return false;
  return !hasCatalogBaseProbability(abilityId);
}

function shouldTreatAsContinuousModifier(
  definition: AbilityDefinition | null,
  parameterSourceKey: string | null,
): boolean {
  if (!definition || definition.trigger !== 'continuous') return false;
  if (!parameterSourceKey) return false;
  return CONTINUOUS_MODIFIER_PARAM_KEYS.has(parameterSourceKey);
}

function normalizeAbilityId(rawAbilityId: string, definition: AbilityDefinition | null): string {
  return definition?.id ?? rawAbilityId;
}

function getActionBucket(definition: AbilityDefinition | null): ActionBucketKey | null {
  if (!definition) return null;
  if (definition.trigger === 'harvest') return 'harvest';
  if (definition.trigger === 'sellAllCrops' || definition.trigger === 'sellPet') return 'sell';
  if (definition.trigger === 'hatchEgg') return 'hatch';
  return null;
}

function getTriggerLabel(definition: AbilityDefinition | null): string {
  if (!definition) return 'Trigger';
  if (definition.trigger === 'harvest') return 'Harvest';
  if (definition.trigger === 'sellAllCrops') return 'Sell';
  if (definition.trigger === 'sellPet') return 'Sell';
  if (definition.trigger === 'hatchEgg') return 'Hatch';
  return 'Trigger';
}

function classifyAbilityGroup(abilityId: string, definition: AbilityDefinition | null): CompareAbilityGroup {
  if (!definition) return 'isolated';
  if (ISOLATED_ABILITY_IDS.has(abilityId)) return 'isolated';

  const familyKey = getAbilityFamilyKey(abilityId).trim().toLowerCase();
  if (FOOD_FAMILY_KEYS.has(familyKey)) return 'food';
  if (HATCH_DOLLAR_FAMILY_KEYS.has(familyKey)) return 'hatch_dollar';
  if (HATCH_TRIO_FAMILY_KEYS.has(familyKey)) return 'hatch_trio';

  if (definition.trigger === 'sellAllCrops' || definition.trigger === 'harvest') {
    return 'sale';
  }
  if (definition.trigger === 'sellPet') {
    return 'hatch_dollar';
  }
  if (definition.trigger === 'hatchEgg') {
    return 'hatch_trio';
  }
  return 'per_hour';
}

function isReviewAbility(rawAbilityId: string, abilityId: string, definition: AbilityDefinition | null): boolean {
  if (!definition) return true;
  // Any catalog-resolved definition is considered mapped/known.
  if (!abilityId || abilityId.trim().length === 0) return true;
  return rawAbilityId.trim().length === 0;
}

function isIgnoredAbility(abilityId: string): boolean {
  return abilityId === 'Copycat';
}

function resolveUnit(definition: AbilityDefinition | null): 'coins' | 'minutes' | 'xp' | 'none' {
  if (!definition) return 'none';
  if (definition.effectUnit === 'coins' || definition.category === 'coins') return 'coins';
  if (definition.effectUnit === 'minutes' || definition.category === 'plantGrowth' || definition.category === 'eggGrowth') return 'minutes';
  if (definition.effectUnit === 'xp' || definition.category === 'xp') return 'xp';
  return 'none';
}

function stageAdjustedStrengthBoostTierOne(stage: ProgressionStage): number {
  if (stage === 'early') return 0.85;
  if (stage === 'mid') return 0.55;
  return 0.25;
}

function resolveVirtualValuePerTrigger(abilityId: string, stage: ProgressionStage): number {
  if (abilityId === 'PetHatchSizeBoost') {
    return stageAdjustedStrengthBoostTierOne(stage);
  }
  return ABILITY_BASE_TRIGGER_VALUE[abilityId] ?? 0;
}

function resolveValuePerTrigger(
  abilityId: string,
  definition: AbilityDefinition | null,
  strength: number,
  valuationContext: AbilityValuationContext | null,
  stage: ProgressionStage,
): number {
  if (!definition) return 0;

  if (valuationContext) {
    const dynamic = resolveDynamicAbilityEffect(abilityId, valuationContext, strength);
    if (dynamic && Number.isFinite(dynamic.effectPerProc) && dynamic.effectPerProc > 0) {
      return dynamic.effectPerProc;
    }
  }

  const catalogScaled = resolveCatalogScaledParameterValue(abilityId, strength);
  if (catalogScaled && Number.isFinite(catalogScaled.value) && catalogScaled.value > 0) {
    return catalogScaled.value;
  }

  if (Number.isFinite(definition.effectValuePerProc) && (definition.effectValuePerProc ?? 0) > 0) {
    return Math.max(0, definition.effectValuePerProc ?? 0);
  }

  if (abilityId === 'PetHatchSizeBoostII') {
    return 1.0;
  }

  return resolveVirtualValuePerTrigger(abilityId, stage);
}

function toScoreValue(contribution: AbilityContribution): number {
  if (contribution.isIgnored || contribution.isReview) return 0;

  if (contribution.isAction) {
    if (contribution.expectedValuePerTrigger > 0) {
      return contribution.expectedValuePerTrigger;
    }
    if (contribution.valuePerTrigger > 0 && contribution.chancePercent <= 0) {
      // Hatch modifiers without proc chance are modeled as per-trigger effects.
      return contribution.valuePerTrigger;
    }
    if (contribution.valuePerTrigger > 0) {
      return contribution.valuePerTrigger * (contribution.chancePercent / 100);
    }
    return 0;
  }

  return contribution.impactPerHour > 0 ? contribution.impactPerHour : 0;
}

export function areAbilityGroupsComparable(a: CompareAbilityGroup, b: CompareAbilityGroup): boolean {
  if (a === b) return true;
  return (a === 'sale' && b === 'hatch_dollar') || (a === 'hatch_dollar' && b === 'sale');
}

export function areContributionsComparable(a: AbilityContribution, b: AbilityContribution): boolean {
  if (a.isIgnored || b.isIgnored) return false;
  if (a.isReview || b.isReview) return false;
  return areAbilityGroupsComparable(a.group, b.group);
}

export function getAbilityFamilyKey(abilityId: string): string {
  const normalizedAbilityId = getAbilityDefinition(abilityId)?.id ?? abilityId;
  const catalogFamilyKey = resolveCatalogFamilyKey(normalizedAbilityId);
  if (catalogFamilyKey) {
    return catalogFamilyKey;
  }

  return normalizedAbilityId
    .replace(/_NEW$/i, '')
    .replace(/(I{1,3}|IV)$/i, '');
}

function stripOptimizerAbilityFamilySuffix(value: string): string {
  if (TIER_INDEPENDENT_FAMILY_IDS.has(value)) {
    return value.replace(/_NEW$/i, '');
  }
  return value
    .replace(/_NEW$/i, '')
    .replace(/(I{1,3}|IV)$/i, '');
}

function normalizeOptimizerFamilyLabel(value: string, preserveTier = false): string {
  let result = value.trim();
  if (!preserveTier) {
    result = result
      .replace(/\s+(?:IV|III|II|I)$/i, '')
      .replace(/\s+[1-4]$/i, '');
  }
  return result.trim();
}

function resolveOptimizerBroadRoleFamilyLabel(
  broadRoleFamilyKey: string,
  exactFamilyLabel: string,
): string {
  return OPTIMIZER_BROAD_ROLE_LABELS[broadRoleFamilyKey] ?? exactFamilyLabel;
}

export function getOptimizerAbilityFamilyInfo(
  abilityId: string,
  fallbackName = '',
): OptimizerAbilityFamilyInfo | null {
  const fallback = fallbackName.trim();
  const rawAbilityId = abilityId.trim();
  if (!rawAbilityId && !fallback) return null;

  const definition = getAbilityDefinition(rawAbilityId || fallback);
  const normalizedAbilityId = (definition?.id ?? rawAbilityId ?? fallback).trim();
  if (!normalizedAbilityId) return null;

  const exactFamilyKey = stripOptimizerAbilityFamilySuffix(normalizedAbilityId).trim().toLowerCase();
  if (!exactFamilyKey) return null;

  const preserveTier = TIER_INDEPENDENT_FAMILY_IDS.has(normalizedAbilityId);
  const exactFamilyLabelSource = definition?.name ?? fallback ?? normalizedAbilityId;
  const exactFamilyLabel = normalizeOptimizerFamilyLabel(exactFamilyLabelSource, preserveTier)
    || exactFamilyLabelSource
    || normalizedAbilityId;
  const broadRoleFamilyKeyRaw = getAbilityFamilyKey(normalizedAbilityId).trim();
  const broadRoleFamilyKey = (broadRoleFamilyKeyRaw || exactFamilyKey).trim().toLowerCase();
  const broadRoleFamilyLabel = resolveOptimizerBroadRoleFamilyLabel(
    broadRoleFamilyKey,
    exactFamilyLabel,
  );

  return {
    exactFamilyKey,
    exactFamilyLabel,
    broadRoleFamilyKey,
    broadRoleFamilyLabel,
    hidden: OPTIMIZER_HIDDEN_FAMILY_KEYS.has(exactFamilyKey),
  };
}

export function getOptimizerCompetitionFamilyKey(abilityId: string, fallbackName = ''): string {
  return getOptimizerAbilityFamilyInfo(abilityId, fallbackName)?.exactFamilyKey ?? '';
}

export function getOptimizerCompetitionFamilyLabel(abilityId: string, fallbackName = ''): string {
  return getOptimizerAbilityFamilyInfo(abilityId, fallbackName)?.exactFamilyLabel ?? fallbackName ?? abilityId;
}

export function getOptimizerBroadRoleFamilyKey(abilityId: string, fallbackName = ''): string {
  return getOptimizerAbilityFamilyInfo(abilityId, fallbackName)?.broadRoleFamilyKey ?? '';
}

export function isOptimizerAbilityVisible(abilityId: string, fallbackName = ''): boolean {
  const info = getOptimizerAbilityFamilyInfo(abilityId, fallbackName);
  return !!info && !info.hidden;
}

export function buildPetCompareProfile(
  pet: ComparePetInput,
  stageSnapshot: ProgressionStageSnapshot,
  valuationContext: AbilityValuationContext | null = null,
): PetCompareProfile {
  const stage = stageSnapshot.stage;
  const strength = getWorkingStrength(pet);
  const abilities: AbilityContribution[] = [];
  const byAbilityId = new Map<string, AbilityContribution>();

  const totals = {
    coinsPerHour: 0,
    plantMinutesPerHour: 0,
    eggMinutesPerHour: 0,
    xpPerHour: 0,
  };

  for (const rawAbilityId of pet.abilities) {
    const definition = getAbilityDefinition(rawAbilityId);
    const abilityId = normalizeAbilityId(rawAbilityId, definition);
    const isReview = isReviewAbility(rawAbilityId, abilityId, definition);
    const isIgnored = isIgnoredAbility(abilityId);
    const group = classifyAbilityGroup(abilityId, definition);
    const triggerLabel = getTriggerLabel(definition);
    const actionBucket = getActionBucket(definition);
    const weatherActive = isAbilityWeatherActive(definition);

    const stats = definition && weatherActive ? computeAbilityStats(definition, strength) : null;
    const catalogScaled = weatherActive ? resolveCatalogScaledParameterValue(abilityId, strength) : null;
    const parameterSourceKey = catalogScaled?.sourceKey ?? null;
    const treatAsAlwaysOnAction = shouldTreatAsAlwaysOnAction(abilityId, definition, parameterSourceKey);
    const treatAsContinuousModifier = shouldTreatAsContinuousModifier(definition, parameterSourceKey);

    const chancePercent = stats ? clamp(stats.chancePerMinute, 0, 100) : 0;
    const procsPerHour = stats ? Math.max(0, stats.procsPerHour) : 0;

    const valuePerTrigger = weatherActive
      ? resolveValuePerTrigger(abilityId, definition, strength, valuationContext, stage)
      : 0;
    const expectedValuePerTrigger = treatAsAlwaysOnAction
      ? valuePerTrigger
      : valuePerTrigger * (chancePercent / 100);
    const expectedValuePerHour = expectedValuePerTrigger * procsPerHour;

    let impactPerHour = 0;
    if (definition && !actionBucket) {
      if (valuePerTrigger > 0) {
        if (procsPerHour > 0) {
          impactPerHour = valuePerTrigger * procsPerHour;
        } else if (treatAsContinuousModifier) {
          // Passive modifiers without proc probability still contribute continuously.
          impactPerHour = valuePerTrigger;
        }
      } else if (stats) {
        impactPerHour = computeEffectPerHour(definition, stats, strength);
      }
    }

    if (definition && !actionBucket) {
      if (definition.category === 'coins' || definition.effectUnit === 'coins') {
        totals.coinsPerHour += Math.max(0, impactPerHour);
      } else if (definition.category === 'plantGrowth') {
        totals.plantMinutesPerHour += Math.max(0, impactPerHour);
      } else if (definition.category === 'eggGrowth') {
        totals.eggMinutesPerHour += Math.max(0, impactPerHour);
      } else if (definition.category === 'xp' || definition.effectUnit === 'xp') {
        totals.xpPerHour += Math.max(0, impactPerHour);
      }
    }

    const contribution: AbilityContribution = {
      rawAbilityId,
      abilityId,
      name: definition?.name ?? rawAbilityId,
      definition,
      group,
      isAction: !!actionBucket,
      isReview,
      isIgnored,
      triggerLabel,
      actionBucket,
      procsPerHour,
      chancePercent,
      impactPerHour,
      valuePerTrigger,
      expectedValuePerTrigger,
      expectedValuePerHour,
      scoreValue: 0,
      unit: resolveUnit(definition),
    };

    contribution.scoreValue = toScoreValue(contribution);
    abilities.push(contribution);

    if (!byAbilityId.has(abilityId)) {
      byAbilityId.set(abilityId, contribution);
    }
  }

  const actionBuckets: Record<ActionBucketKey, ActionBucketSummary> = {
    harvest: summarizeActionBucket('harvest', abilities.filter((entry) => entry.actionBucket === 'harvest')),
    sell: summarizeActionBucket('sell', abilities.filter((entry) => entry.actionBucket === 'sell')),
    hatch: summarizeActionBucket('hatch', abilities.filter((entry) => entry.actionBucket === 'hatch')),
  };

  const reviewCount = abilities.filter((entry) => entry.isReview).length;
  const score = abilities
    .filter((entry) => !entry.isIgnored && !entry.isReview)
    .reduce((sum, entry) => sum + entry.scoreValue, 0) + (strength * 0.25);

  return {
    petId: pet.id,
    stage,
    score,
    reviewCount,
    abilities,
    byAbilityId,
    totals,
    actionBuckets,
  };
}

function summarizeActionBucket(key: ActionBucketKey, entries: AbilityContribution[]): ActionBucketSummary {
  let chanceRemaining = 1;
  let expectedValuePerTrigger = 0;

  for (const entry of entries) {
    const chance = clamp(entry.chancePercent / 100, 0, 1);
    chanceRemaining *= 1 - chance;
    expectedValuePerTrigger += entry.expectedValuePerTrigger;
  }

  return {
    key,
    triggerLabel: key === 'harvest' ? 'Harvest' : key === 'sell' ? 'Sell' : 'Hatch',
    combinedChancePercent: entries.length > 0 ? (1 - chanceRemaining) * 100 : 0,
    expectedValuePerTrigger,
    entries,
  };
}

function combineActionBuckets(summaries: ActionBucketSummary[]): ActionBucketSummary {
  let chanceRemaining = 1;
  let expectedValuePerTrigger = 0;
  const entries: AbilityContribution[] = [];

  for (const summary of summaries) {
    const chance = clamp(summary.combinedChancePercent / 100, 0, 1);
    chanceRemaining *= 1 - chance;
    expectedValuePerTrigger += summary.expectedValuePerTrigger;
    entries.push(...summary.entries);
  }

  const key = summaries[0]?.key ?? 'harvest';
  const label = summaries[0]?.triggerLabel ?? (key === 'harvest' ? 'Harvest' : key === 'sell' ? 'Sell' : 'Hatch');

  return {
    key,
    triggerLabel: label,
    combinedChancePercent: summaries.length > 0 ? (1 - chanceRemaining) * 100 : 0,
    expectedValuePerTrigger,
    entries,
  };
}

export function buildTeamCompareProfile(
  pets: Array<ComparePetInput | null>,
  stageSnapshot: ProgressionStageSnapshot,
  valuationContext: AbilityValuationContext | null = null,
): TeamCompareProfile {
  const profiles = pets
    .filter((pet): pet is ComparePetInput => !!pet)
    .map((pet) => buildPetCompareProfile(pet, stageSnapshot, valuationContext));

  const totals = {
    coinsPerHour: profiles.reduce((sum, profile) => sum + profile.totals.coinsPerHour, 0),
    plantMinutesPerHour: profiles.reduce((sum, profile) => sum + profile.totals.plantMinutesPerHour, 0),
    eggMinutesPerHour: profiles.reduce((sum, profile) => sum + profile.totals.eggMinutesPerHour, 0),
    xpPerHour: profiles.reduce((sum, profile) => sum + profile.totals.xpPerHour, 0),
  };

  const actionBuckets: Record<ActionBucketKey, ActionBucketSummary> = {
    harvest: combineActionBuckets(profiles.map((profile) => profile.actionBuckets.harvest)),
    sell: combineActionBuckets(profiles.map((profile) => profile.actionBuckets.sell)),
    hatch: combineActionBuckets(profiles.map((profile) => profile.actionBuckets.hatch)),
  };

  return {
    stage: stageSnapshot,
    pets: profiles,
    totals,
    actionBuckets,
    score: profiles.reduce((sum, profile) => sum + profile.score, 0),
  };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseCoinsValue(raw: unknown): number | null {
  const direct = parseNumber(raw);
  if (direct != null) return Math.max(0, Math.floor(direct));

  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const candidates = [
    record.coins,
    record.count,
    record.value,
    record.amount,
    record.balance,
    record.current,
    (record.data as Record<string, unknown> | undefined)?.coins,
    (record.player as Record<string, unknown> | undefined)?.coins,
    (record.state as Record<string, unknown> | undefined)?.coins,
  ];

  for (const candidate of candidates) {
    const parsed = parseCoinsValue(candidate);
    if (parsed != null) return parsed;
  }

  return null;
}

function findStorageRecord(storageEntries: unknown[], keys: string[]): Record<string, unknown> | null {
  for (const entry of storageEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const values = [record.decorId, record.type, record.id, record.storageId, record.name]
      .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''));
    if (values.some((value) => keys.some((key) => value.includes(key)))) {
      return record;
    }
  }
  return null;
}

function scoreStorageSignal(value: number | null): number | null {
  if (value == null) return null;
  if (value <= 0) return 0.2;
  if (value <= 1) return 0.6;
  return 1.0;
}

function scoreCountBand(value: number | null): number | null {
  if (value == null) return null;
  if (value <= 0) return 0.2;
  if (value <= 2) return 0.6;
  return 1.0;
}

function scoreRbwBand(value: number | null): number | null {
  if (value == null) return null;
  if (value <= 2) return 0.2;
  if (value <= 4) return 0.6;
  return 1.0;
}

function scoreEggBand(value: number | null): number | null {
  if (value == null) return null;
  if (value < 1000) return 0.2;
  if (value < 6000) return 0.6;
  return 1.0;
}

function scoreCoinBand(value: number | null): number | null {
  if (value == null) return null;
  if (value < 10_000_000_000) return 0.2;
  if (value < 500_000_000_000) return 0.6;
  return 1.0;
}

function scoreRainbowGranterBand(value: number): number {
  if (value <= 0) return 0.2;
  if (value === 1) return 0.6;
  return 1.0;
}

function scorePetPowerBand(pets: ComparePetInput[]): number | null {
  if (!Array.isArray(pets) || pets.length === 0) return null;

  const strengths = pets
    .map((pet) => getWorkingStrength(pet))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a);

  if (strengths.length === 0) return null;

  const sample = strengths.slice(0, Math.min(6, strengths.length));
  const average = sample.reduce((sum, value) => sum + value, 0) / sample.length;

  if (average < 75) return 0.2;
  if (average < 88) return 0.6;
  return 1.0;
}

function weightedAverage(values: Array<{ weight: number; value: number | null }>): number | null {
  let weighted = 0;
  let totalWeight = 0;

  for (const entry of values) {
    if (entry.value == null) continue;
    weighted += entry.weight * entry.value;
    totalWeight += entry.weight;
  }

  if (totalWeight <= 0) return null;
  return weighted / totalWeight;
}

function countCelestialFromInventory(items: InventoryItem[]): { starweaver: number; moon: number; dawn: number } {
  const counts = { starweaver: 0, moon: 0, dawn: 0 };

  for (const item of items) {
    const labelCandidates = [item.species, item.name, item.displayName, (item as unknown as Record<string, unknown>).decorId, item.itemId]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());

    const quantity = Math.max(1, Math.floor(parseNumber(item.quantity) ?? parseNumber(item.count) ?? parseNumber(item.amount) ?? 1));

    if (labelCandidates.some((value) => value.includes('starweaver'))) {
      counts.starweaver += quantity;
    }
    if (labelCandidates.some((value) => value.includes('moonbinder') || value.includes('mooncelestial'))) {
      counts.moon += quantity;
    }
    if (labelCandidates.some((value) => value.includes('dawnbinder') || value.includes('dawncelestial'))) {
      counts.dawn += quantity;
    }
  }

  return counts;
}

function countCelestialFromGarden(): { starweaver: number; moon: number; dawn: number } {
  const counts = { starweaver: 0, moon: 0, dawn: 0 };
  const snapshot = getGardenSnapshot();
  if (!snapshot) return counts;

  const collections = [snapshot.tileObjects, snapshot.boardwalkTileObjects];
  for (const collection of collections) {
    if (!collection || typeof collection !== 'object') continue;
    for (const tile of Object.values(collection)) {
      if (!tile || typeof tile !== 'object') continue;
      const slots = (tile as Record<string, unknown>).slots;
      if (!Array.isArray(slots)) continue;

      for (const slot of slots) {
        if (!slot || typeof slot !== 'object') continue;
        const species = (slot as Record<string, unknown>).species;
        if (typeof species !== 'string') continue;
        const normalized = species.toLowerCase();

        if (normalized.includes('starweaver')) counts.starweaver += 1;
        if (normalized.includes('moonbinder') || normalized.includes('mooncelestial')) counts.moon += 1;
        if (normalized.includes('dawnbinder') || normalized.includes('dawncelestial')) counts.dawn += 1;
      }
    }
  }

  return counts;
}

function resolveStorageSignals(items: InventoryItem[]): { petHutch: number | null; seedSilo: number | null; decorShed: number | null } {
  const result = {
    petHutch: null as number | null,
    seedSilo: null as number | null,
    decorShed: null as number | null,
  };

  const pageData = (window as unknown as Record<string, unknown>).myData as Record<string, unknown> | undefined;
  const storageEntries = Array.isArray((pageData?.inventory as Record<string, unknown> | undefined)?.storages)
    ? ((pageData?.inventory as Record<string, unknown>).storages as unknown[])
    : [];

  const extractStorageValue = (record: Record<string, unknown> | null): number | null => {
    if (!record) return null;

    const candidates = [
      record.level,
      record.tier,
      record.stage,
      record.upgradeLevel,
      record.capacity,
      record.maxSlots,
      record.maxItems,
      Array.isArray(record.items) ? record.items.length : null,
    ];

    for (const candidate of candidates) {
      const parsed = parseNumber(candidate);
      if (parsed != null && parsed >= 0) {
        return parsed;
      }
    }

    return 1;
  };

  result.petHutch = extractStorageValue(findStorageRecord(storageEntries, ['pethutch', 'pet_hutch', 'hutch']));
  result.seedSilo = extractStorageValue(findStorageRecord(storageEntries, ['seedsilo', 'seed_silo', 'silo']));
  result.decorShed = extractStorageValue(findStorageRecord(storageEntries, ['decorshed', 'decor_shed', 'shed']));

  // Fallback hints from inventory if storage records are unavailable.
  for (const item of items) {
    const candidates = [(item as unknown as Record<string, unknown>).decorId, item.itemId, item.species, item.name, item.displayName]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());

    const quantity = parseNumber(item.quantity) ?? parseNumber(item.count) ?? parseNumber(item.amount) ?? 0;

    if (result.petHutch == null && candidates.some((value) => value.includes('pethutch') || value.includes('pet hutch'))) {
      result.petHutch = quantity > 0 ? quantity : 1;
    }
    if (result.seedSilo == null && candidates.some((value) => value.includes('seedsilo') || value.includes('seed silo'))) {
      result.seedSilo = quantity > 0 ? quantity : 1;
    }
    if (result.decorShed == null && candidates.some((value) => value.includes('decorshed') || value.includes('decor shed'))) {
      result.decorShed = quantity > 0 ? quantity : 1;
    }
  }

  return result;
}

function resolveCoinSignal(): number | null {
  const pageData = (window as unknown as Record<string, unknown>).myData;
  return parseCoinsValue(pageData);
}

export function captureProgressionSignals(pets: ComparePetInput[] = []): ProgressionSignalSnapshot {
  let eggs: number | null = null;
  let rbwCountFromStats: number | null = null;

  try {
    const stats = getStatsSnapshot();
    eggs = Number.isFinite(stats.pets.totalHatched) ? Math.max(0, Math.floor(stats.pets.totalHatched)) : null;
    const rainbow = Number.isFinite(stats.pets.hatchedByRarity.rainbow)
      ? Math.max(0, Math.floor(stats.pets.hatchedByRarity.rainbow))
      : null;
    rbwCountFromStats = rainbow;
  } catch {
    eggs = null;
    rbwCountFromStats = null;
  }

  const rbwCountFromPets = pets.reduce((sum, pet) => {
    const mutations = Array.isArray(pet.mutations) ? pet.mutations : [];
    return sum + (mutations.some((mutation) => /rainbow/i.test(mutation)) ? 1 : 0);
  }, 0);
  const rainbowGranterPetCount = pets.reduce((sum, pet) => {
    const abilities = Array.isArray(pet.abilities) ? pet.abilities : [];
    return sum + (abilities.some((ability) => ability === 'RainbowGranter') ? 1 : 0);
  }, 0);

  const items = getInventoryItems();
  const storageSignals = resolveStorageSignals(items);

  const celestialInventory = countCelestialFromInventory(items);
  const celestialGarden = countCelestialFromGarden();

  const celestial = {
    starweaver: celestialInventory.starweaver + celestialGarden.starweaver,
    moon: celestialInventory.moon + celestialGarden.moon,
    dawn: celestialInventory.dawn + celestialGarden.dawn,
  };

  const rbwMerged = Math.max(rbwCountFromStats ?? 0, rbwCountFromPets);

  return {
    rbwCount: Number.isFinite(rbwMerged) ? rbwMerged : null,
    rainbowGranterPetCount,
    petPowerBand: scorePetPowerBand(pets),
    storage: storageSignals,
    celestial,
    eggs,
    coins: resolveCoinSignal(),
  };
}

export function evaluateProgressionStage(signals: ProgressionSignalSnapshot): ProgressionStageSnapshot {
  const storageScore = weightedAverage([
    { weight: 0.35, value: scoreStorageSignal(signals.storage.petHutch) },
    { weight: 0.5, value: scoreStorageSignal(signals.storage.seedSilo) },
    { weight: 0.15, value: scoreStorageSignal(signals.storage.decorShed) },
  ]);

  const celestialScore = weightedAverage([
    { weight: 0.25, value: scoreCountBand(signals.celestial.starweaver) },
    { weight: 0.35, value: scoreCountBand(signals.celestial.moon) },
    { weight: 0.4, value: scoreCountBand(signals.celestial.dawn) },
  ]);

  const totalScore = weightedAverage([
    { weight: 18, value: scoreRbwBand(signals.rbwCount) },
    { weight: 18, value: scoreEggBand(signals.eggs) },
    { weight: 16, value: storageScore },
    { weight: 10, value: celestialScore },
    { weight: 10, value: scoreCoinBand(signals.coins) },
    { weight: 14, value: signals.petPowerBand },
    { weight: 14, value: scoreRainbowGranterBand(signals.rainbowGranterPetCount) },
  ]);

  const score = Math.round(((totalScore ?? 0) * 100) * 100) / 100;

  let stage: ProgressionStage = 'early';
  if (score >= 75) {
    stage = 'late';
  } else if (score >= 42) {
    stage = 'mid';
  }

  return {
    stage,
    score,
    signals,
  };
}

export function captureProgressionStage(pets: ComparePetInput[] = []): ProgressionStageSnapshot {
  const signals = captureProgressionSignals(pets);
  return evaluateProgressionStage(signals);
}

export function createValuationContext(): AbilityValuationContext | null {
  try {
    return buildAbilityValuationContext();
  } catch {
    return null;
  }
}


