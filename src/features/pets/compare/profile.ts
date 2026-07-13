import { computeAbilityStats, computeEffectPerHour, getAbilityDefinition } from '../data/petAbilities';
import { buildAbilityValuationContext, type AbilityValuationContext } from '../abilityValuation';
import { resolveCatalogScaledParameterValue } from './catalogParams';
import {
  clamp,
  classifyAbilityGroup,
  getActionBucket,
  getTriggerLabel,
  getWorkingStrength,
  isAbilityWeatherActive,
  isIgnoredAbility,
  isReviewAbility,
  normalizeAbilityId,
  resolveUnit,
  resolveValuePerTrigger,
  shouldTreatAsAlwaysOnAction,
  shouldTreatAsContinuousModifier,
  toScoreValue,
} from './scoring';
import type {
  AbilityContribution,
  ActionBucketKey,
  ActionBucketSummary,
  ComparePetInput,
  PetCompareProfile,
  ProgressionStageSnapshot,
  TeamCompareProfile,
} from './types';

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

export function createValuationContext(): AbilityValuationContext | null {
  try {
    return buildAbilityValuationContext();
  } catch {
    return null;
  }
}
