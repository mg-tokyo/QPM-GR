import type { AbilityDefinition } from '../data/petAbilities';
import { resolveDynamicAbilityEffect, type AbilityValuationContext } from '../abilityValuation';
import { calculateMaxStrength } from '../../../store/xpTracker';
import { getWeatherSnapshot } from '../../../store/weatherHub';
import {
  ABILITY_BASE_TRIGGER_VALUE,
  CONTINUOUS_MODIFIER_PARAM_KEYS,
  FOOD_FAMILY_KEYS,
  HATCH_DOLLAR_FAMILY_KEYS,
  HATCH_MODIFIER_PARAM_KEYS,
  HATCH_TRIO_FAMILY_KEYS,
  ISOLATED_ABILITY_IDS,
} from './constants';
import { hasCatalogBaseProbability, resolveCatalogScaledParameterValue } from './catalogParams';
import { getAbilityFamilyKey } from './families';
import type {
  AbilityContribution,
  ActionBucketKey,
  CompareAbilityGroup,
  ComparePetInput,
  ProgressionStage,
} from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getWorkingStrength(pet: ComparePetInput): number {
  if (Number.isFinite(pet.strength)) return Math.max(1, pet.strength ?? 1);
  const fallback = calculateMaxStrength(pet.targetScale, pet.species);
  if (Number.isFinite(fallback)) return Math.max(1, fallback ?? 1);
  return 100;
}

export function isAbilityWeatherActive(definition: AbilityDefinition | null): boolean {
  if (!definition?.requiredWeather) return true;
  return getWeatherSnapshot().kind === definition.requiredWeather;
}

export function shouldTreatAsAlwaysOnAction(
  abilityId: string,
  definition: AbilityDefinition | null,
  parameterSourceKey: string | null,
): boolean {
  if (!definition || definition.trigger !== 'hatchEgg') return false;
  if (!parameterSourceKey || !HATCH_MODIFIER_PARAM_KEYS.has(parameterSourceKey)) return false;
  return !hasCatalogBaseProbability(abilityId);
}

export function shouldTreatAsContinuousModifier(
  definition: AbilityDefinition | null,
  parameterSourceKey: string | null,
): boolean {
  if (!definition || definition.trigger !== 'continuous') return false;
  if (!parameterSourceKey) return false;
  return CONTINUOUS_MODIFIER_PARAM_KEYS.has(parameterSourceKey);
}

export function normalizeAbilityId(rawAbilityId: string, definition: AbilityDefinition | null): string {
  return definition?.id ?? rawAbilityId;
}

export function getActionBucket(definition: AbilityDefinition | null): ActionBucketKey | null {
  if (!definition) return null;
  if (definition.trigger === 'harvest') return 'harvest';
  if (definition.trigger === 'sellAllCrops' || definition.trigger === 'sellPet') return 'sell';
  if (definition.trigger === 'hatchEgg') return 'hatch';
  return null;
}

export function getTriggerLabel(definition: AbilityDefinition | null): string {
  if (!definition) return 'Trigger';
  if (definition.trigger === 'harvest') return 'Harvest';
  if (definition.trigger === 'sellAllCrops') return 'Sell';
  if (definition.trigger === 'sellPet') return 'Sell';
  if (definition.trigger === 'hatchEgg') return 'Hatch';
  return 'Trigger';
}

export function classifyAbilityGroup(abilityId: string, definition: AbilityDefinition | null): CompareAbilityGroup {
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

export function isReviewAbility(rawAbilityId: string, abilityId: string, definition: AbilityDefinition | null): boolean {
  if (!definition) return true;
  // Any catalog-resolved definition is considered mapped/known.
  if (!abilityId || abilityId.trim().length === 0) return true;
  return rawAbilityId.trim().length === 0;
}

export function isIgnoredAbility(abilityId: string): boolean {
  return abilityId === 'Copycat';
}

export function resolveUnit(definition: AbilityDefinition | null): 'coins' | 'minutes' | 'xp' | 'none' {
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

export function resolveValuePerTrigger(
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

export function toScoreValue(contribution: AbilityContribution): number {
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
