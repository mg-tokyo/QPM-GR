import {
  GOLD_DISLIKE_FACTOR,
  HIGH_VALUE_ABILITIES,
  SPECIAL_ABILITY_SCORES,
  TIER_SCORES,
} from './constants';
import { getRuntimeConfig } from './runtime';
import type {
  CollectedPet,
  OptimizerConfig,
  PetScore,
} from './types';

const UNWANTED_MUTATION_ABILITIES = new Set(['ProduceEater', 'SeedFinderI']);

export function hasHighValueAbilities(pet: CollectedPet): boolean {
  return pet.abilityIds.some((abilityId) => HIGH_VALUE_ABILITIES.has(abilityId));
}

export function getGoldPreferenceFactor(
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  return cfg.dislikeGold ? GOLD_DISLIKE_FACTOR : 1;
}

export function getGoldAdjustedValue(
  value: number,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  return value * getGoldPreferenceFactor(cfg);
}

export function getGoldMutationContribution(
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  return Math.round(getGoldAdjustedValue(50, cfg));
}

function calculateAbilityTierScore(
  abilityIds: string[],
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  let total = 0;

  for (const abilityId of abilityIds) {
    if (abilityId in SPECIAL_ABILITY_SCORES) {
      const baseScore = SPECIAL_ABILITY_SCORES[abilityId];
      const score = abilityId === 'GoldGranter' && baseScore !== undefined
        ? getGoldAdjustedValue(baseScore, cfg)
        : baseScore;

      if (score !== undefined) {
        total += score;
        continue;
      }
    }

    const tierMatch = abilityId.match(/(I{1,3}|IV)$/);
    if (tierMatch && tierMatch[1]) {
      const tier = tierMatch[1];
      const tierScore = TIER_SCORES[tier];
      total += tierScore !== undefined ? tierScore : 25;
    } else {
      total += 50;
    }
  }

  return Math.min(300, total);
}

function calculateAbilityRarityScore(abilityIds: string[]): number {
  if (abilityIds.length === 3) return 100;
  if (abilityIds.length === 2) return 60;
  if (abilityIds.length === 1) return 30;
  return 0;
}

export function calculatePetScore(
  pet: CollectedPet,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): PetScore {
  const maxStrengthValue = pet.maxStrength ?? pet.strength;
  const breakdown = {
    currentStrength: Math.round(Math.max(0, pet.strength)),
    maxStrength: Math.round(Math.max(0, maxStrengthValue) * 3),
    potential: 0,
    abilityTier: 0,
    abilityRarity: 0,
    mutation: 0,
  };

  if (pet.maxStrength && pet.maxStrength > pet.strength) {
    const growthRoom = pet.maxStrength - pet.strength;
    breakdown.potential = Math.min(100, growthRoom * 3);
  }

  const abilitiesToScore = (pet.hasRainbow || pet.hasGold)
    ? pet.abilityIds.filter((abilityId) => !UNWANTED_MUTATION_ABILITIES.has(abilityId))
    : pet.abilityIds;

  breakdown.abilityTier = calculateAbilityTierScore(abilitiesToScore, cfg);
  breakdown.abilityRarity = calculateAbilityRarityScore(abilitiesToScore);

  if (pet.hasRainbow) {
    breakdown.mutation = 100;
  } else if (pet.hasGold) {
    breakdown.mutation = getGoldMutationContribution(cfg);
  }

  let granterBonus = 0;
  let granterType: 'rainbow' | 'gold' | null = null;

  if (pet.abilityIds.includes('RainbowGranter')) {
    granterBonus = SPECIAL_ABILITY_SCORES.RainbowGranter || 95;
    granterType = 'rainbow';
  } else if (pet.abilityIds.includes('GoldGranter')) {
    granterBonus = getGoldAdjustedValue(SPECIAL_ABILITY_SCORES.GoldGranter || 85, cfg);
    granterType = 'gold';
  }

  const total =
    breakdown.currentStrength +
    breakdown.maxStrength +
    breakdown.potential +
    breakdown.abilityTier +
    breakdown.abilityRarity +
    breakdown.mutation +
    granterBonus;

  return { total, breakdown, granterBonus, granterType };
}

export function extractTier(abilityId: string): string | null {
  const match = abilityId.match(/(IV|III|II|I)(?:_NEW)?$/i);
  return match && match[1] ? match[1].toUpperCase() : null;
}
