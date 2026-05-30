import { getGoldPreferenceFactor } from '../scoring';
import { getRuntimeConfig } from '../runtime';
import type { CollectedPet, OptimizerConfig } from '../types';

export function getMaxStrengthValue(pet: CollectedPet): number {
  return pet.maxStrength ?? pet.strength;
}

export function getScoringStrength(pet: CollectedPet): number {
  return getMaxStrengthValue(pet);
}

export function hasRainbowGranterAbility(pet: CollectedPet): boolean {
  return pet.abilityIds.includes('RainbowGranter');
}

export function hasGoldGranterAbility(pet: CollectedPet): boolean {
  return pet.abilityIds.includes('GoldGranter');
}

export function isRainbowQualifiedPet(pet: CollectedPet): boolean {
  return pet.hasRainbow || hasRainbowGranterAbility(pet);
}

export function isGoldQualifiedPet(pet: CollectedPet): boolean {
  return pet.hasGold || hasGoldGranterAbility(pet);
}

export function getCompetitionMutationScore(
  pet: CollectedPet,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  if (pet.hasRainbow) return 3;
  if (pet.hasGold) return 1 + getGoldPreferenceFactor(cfg);
  return 1;
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function computeNormalizedRankUtility(rankIndex: number, totalCompetitors: number): number {
  if (totalCompetitors <= 1) return 1;
  const normalized = rankIndex / Math.max(1, totalCompetitors - 1);
  return Math.max(0, 1 - normalized);
}

export function isMutationGranterFamily(familyKey: string): boolean {
  return familyKey.endsWith('granter');
}
