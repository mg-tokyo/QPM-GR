import {
  buildPetCompareProfile,
  captureProgressionStage,
  createValuationContext,
  getOptimizerAbilityFamilyInfo,
  getOptimizerBroadRoleFamilyKey,
  type ComparePetInput,
  type OptimizerAbilityFamilyInfo,
  type ProgressionStageSnapshot,
} from '../../compare';
import {
  GOLD_INTERACTION_MULTIPLIER_CAP,
  GOLD_TIME_UPLIFT_DECAYED,
  GOLD_TIME_UPLIFT_EARLY,
  MAX_TIME_UPLIFT_STR_EQ,
  RAINBOW_TIME_UPLIFT_BASE,
  TIME_FAMILY_KEYS,
} from '../constants';
import { getGoldAdjustedValue } from '../scoring';
import { getRuntimeConfig } from '../runtime';
import type {
  CollectedPet,
  OptimizerCompareSnapshot,
  OptimizerConfig,
  TimeFamilySynergyContext,
} from '../types';
import {
  getScoringStrength,
  isGoldQualifiedPet,
  isRainbowQualifiedPet,
} from './common';

export function toCompareInput(pet: CollectedPet, preferMaxStrength = false): ComparePetInput {
  return {
    id: pet.id,
    species: pet.species ?? 'Unknown',
    strength: preferMaxStrength ? (pet.maxStrength ?? pet.strength) : pet.strength,
    targetScale: pet.targetScale,
    abilities: pet.abilityIds,
    mutations: pet.mutations,
  };
}

export function resolveOptimizerFamilyInfo(
  abilityId: string,
  fallbackName: string,
): OptimizerAbilityFamilyInfo | null {
  const info = getOptimizerAbilityFamilyInfo(abilityId, fallbackName);
  if (!info || info.hidden) return null;
  return info;
}

function getAbilityTierValue(abilityId: string): number {
  const match = abilityId.match(/(IV|III|II|I)(?:_NEW)?$/i);
  const tier = match && match[1] ? match[1].toUpperCase() : null;
  if (tier === 'IV') return 4;
  if (tier === 'III') return 3;
  if (tier === 'II') return 2;
  if (tier === 'I') return 1;
  return 0;
}

function isTimeFamily(familyKey: string): boolean {
  return TIME_FAMILY_KEYS.has(familyKey);
}

export function buildTimeFamilySynergyContext(pet: CollectedPet): TimeFamilySynergyContext {
  const familyKeys = new Set<string>();
  for (const abilityId of pet.abilityIds) {
    const familyKey = getOptimizerBroadRoleFamilyKey(abilityId).trim().toLowerCase();
    if (isTimeFamily(familyKey)) {
      familyKeys.add(familyKey);
    }
  }

  const hasPlant = familyKeys.has('plantgrowthboost');
  const hasEgg = familyKeys.has('egggrowthboost');
  const hasRestore = familyKeys.has('hungerrestore');
  const hasHungerSlow = familyKeys.has('hungerboost');
  const coverage = familyKeys.size;

  return {
    coverage,
    hasPlant,
    hasEgg,
    hasRestore,
    hasHungerSlow,
    hasPlantOrEgg: hasPlant || hasEgg,
  };
}

function getRainbowTimeUpliftStrEquivalent(
  pet: CollectedPet,
  stage: ProgressionStageSnapshot,
  synergy: TimeFamilySynergyContext,
): number {
  if (!isRainbowQualifiedPet(pet)) return 0;

  const base = RAINBOW_TIME_UPLIFT_BASE[stage.stage];
  let multiplier = 1 + 0.12 * Math.max(0, synergy.coverage - 1);
  if (synergy.hasRestore && synergy.hasPlantOrEgg) multiplier += 0.08;
  if (synergy.hasPlant && synergy.hasEgg) multiplier += 0.05;
  if ((pet.species ?? '').toLowerCase() === 'turtle') multiplier *= 1.05;

  return Math.min(MAX_TIME_UPLIFT_STR_EQ, base * multiplier);
}

function getGoldTimeUpliftStrEquivalent(
  pet: CollectedPet,
  stage: ProgressionStageSnapshot,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  if (!isGoldQualifiedPet(pet)) return 0;

  const shouldDecay = stage.stage !== 'early' || stage.signals.rainbowGranterPetCount >= 3;
  const base = shouldDecay ? GOLD_TIME_UPLIFT_DECAYED : GOLD_TIME_UPLIFT_EARLY;
  const synergy = buildTimeFamilySynergyContext(pet);
  const multiplier = Math.min(
    GOLD_INTERACTION_MULTIPLIER_CAP,
    1 + 0.08 * Math.max(0, synergy.coverage - 1),
  );
  return getGoldAdjustedValue(base * multiplier, cfg);
}

function getTimeFamilyUpliftStrEquivalent(
  pet: CollectedPet,
  stage: ProgressionStageSnapshot,
  synergy: TimeFamilySynergyContext,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  if (isRainbowQualifiedPet(pet)) {
    return getRainbowTimeUpliftStrEquivalent(pet, stage, synergy);
  }
  return getGoldTimeUpliftStrEquivalent(pet, stage, cfg);
}

function applyTimeFamilyScoreUplift(
  familyScore: number,
  scoringStrength: number,
  upliftStrEquivalent: number,
): number {
  if (familyScore <= 0 || upliftStrEquivalent <= 0) return familyScore;
  const scorePerStr = familyScore / Math.max(1, scoringStrength);
  return familyScore + (upliftStrEquivalent * scorePerStr);
}

function getAdjustedFamilyScore(
  pet: CollectedPet,
  familyKey: string,
  broadRoleFamilyKey: string,
  familyScore: number,
  stage: ProgressionStageSnapshot,
  synergy: TimeFamilySynergyContext,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  let adjustedScore = familyScore;
  if (isTimeFamily(broadRoleFamilyKey)) {
    const upliftStrEquivalent = getTimeFamilyUpliftStrEquivalent(pet, stage, synergy, cfg);
    adjustedScore = applyTimeFamilyScoreUplift(adjustedScore, getScoringStrength(pet), upliftStrEquivalent);
  }
  if (familyKey === 'goldgranter') {
    adjustedScore = getGoldAdjustedValue(adjustedScore, cfg);
  }
  return adjustedScore;
}

export function createCompareSnapshotMap(
  pets: CollectedPet[],
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): { stage: ProgressionStageSnapshot; byPetId: Map<string, OptimizerCompareSnapshot> } {
  const stage = captureProgressionStage(pets.map((pet) => toCompareInput(pet, false)));
  const valuationContext = createValuationContext();
  const byPetId = new Map<string, OptimizerCompareSnapshot>();

  for (const pet of pets) {
    const profile = buildPetCompareProfile(toCompareInput(pet, true), stage, valuationContext);
    const synergy = buildTimeFamilySynergyContext(pet);
    const groups = profile.abilities
      .filter((entry) => !entry.isIgnored && !entry.isReview)
      .filter((entry) => !!resolveOptimizerFamilyInfo(entry.abilityId, entry.name))
      .map((entry) => entry.group)
      .filter((group, index, all) => all.indexOf(group) === index)
      .sort();

    const families = new Map<string, {
      familyKey: string;
      familyLabel: string;
      broadRoleFamilyKey: string;
      broadRoleFamilyLabel: string;
      highestTier: number;
      familyScore: number;
    }>();

    for (const entry of profile.abilities) {
      if (entry.isIgnored || entry.isReview) continue;
      const familyInfo = resolveOptimizerFamilyInfo(entry.abilityId, entry.name);
      if (!familyInfo) continue;

      const tierValue = getAbilityTierValue(entry.abilityId);
      const baseFamilyScore = Number.isFinite(entry.scoreValue) ? entry.scoreValue : 0;
      const familyScore = getAdjustedFamilyScore(
        pet,
        familyInfo.exactFamilyKey,
        familyInfo.broadRoleFamilyKey,
        baseFamilyScore,
        stage,
        synergy,
        cfg,
      );
      const existing = families.get(familyInfo.exactFamilyKey);

      if (
        !existing
        || tierValue > existing.highestTier
        || (tierValue === existing.highestTier && familyScore > existing.familyScore)
      ) {
        families.set(familyInfo.exactFamilyKey, {
          familyKey: familyInfo.exactFamilyKey,
          familyLabel: familyInfo.exactFamilyLabel,
          broadRoleFamilyKey: familyInfo.broadRoleFamilyKey,
          broadRoleFamilyLabel: familyInfo.broadRoleFamilyLabel,
          highestTier: tierValue,
          familyScore,
        });
      }
    }

    byPetId.set(pet.id, {
      score: profile.score,
      reviewCount: profile.reviewCount,
      groups: groups.length > 0 ? groups : ['isolated'],
      families,
      slotEfficiencyFamilies: new Map(),
    });
  }

  return { stage, byPetId };
}
