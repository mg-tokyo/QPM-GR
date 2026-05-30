import { TURTLE_COMPOSITE_WEIGHTS } from '../constants';
import { getRuntimeConfig } from '../runtime';
import type {
  CollectedPet,
  FamilyCompetitionPool,
  FamilyCompetitionResult,
  FamilyRankSnapshot,
  OptimizerCompareSnapshot,
  OptimizerConfig,
  TurtleCompositeCandidate,
  TurtleCompositeSnapshot,
} from '../types';
import {
  computeNormalizedRankUtility,
  getCompetitionMutationScore,
  getMaxStrengthValue,
} from './common';

function compareFamilyCompetitionEntries(
  a: FamilyCompetitionPool['ranked'][number],
  b: FamilyCompetitionPool['ranked'][number],
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  if (b.highestTier !== a.highestTier) return b.highestTier - a.highestTier;
  if (b.familyScore !== a.familyScore) return b.familyScore - a.familyScore;

  const aMaxStrength = getMaxStrengthValue(a.pet);
  const bMaxStrength = getMaxStrengthValue(b.pet);
  if (bMaxStrength !== aMaxStrength) return bMaxStrength - aMaxStrength;
  if (b.pet.strength !== a.pet.strength) return b.pet.strength - a.pet.strength;

  const aMutation = getCompetitionMutationScore(a.pet, cfg);
  const bMutation = getCompetitionMutationScore(b.pet, cfg);
  if (bMutation !== aMutation) return bMutation - aMutation;

  return a.pet.id.localeCompare(b.pet.id);
}

export function createFamilyCompetitionPools(
  pets: CollectedPet[],
  compareByPetId: Map<string, OptimizerCompareSnapshot>,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): Map<string, FamilyCompetitionPool> {
  const pools = new Map<string, FamilyCompetitionPool>();

  for (const pet of pets) {
    const compare = compareByPetId.get(pet.id);
    if (!compare || compare.reviewCount > 0 || compare.families.size === 0) continue;

    for (const family of compare.families.values()) {
      if (!pools.has(family.familyKey)) {
        pools.set(family.familyKey, {
          familyKey: family.familyKey,
          familyLabel: family.familyLabel,
          broadRoleFamilyKey: family.broadRoleFamilyKey,
          broadRoleFamilyLabel: family.broadRoleFamilyLabel,
          ranked: [],
          rankByPetId: new Map<string, number>(),
        });
      }

      pools.get(family.familyKey)?.ranked.push({
        pet,
        familyKey: family.familyKey,
        familyLabel: family.familyLabel,
        broadRoleFamilyKey: family.broadRoleFamilyKey,
        broadRoleFamilyLabel: family.broadRoleFamilyLabel,
        highestTier: family.highestTier,
        familyScore: family.familyScore,
      });
    }
  }

  for (const pool of pools.values()) {
    pool.ranked.sort((a, b) => compareFamilyCompetitionEntries(a, b, cfg));
    pool.ranked.forEach((entry, index) => {
      pool.rankByPetId.set(entry.pet.id, index);
    });
  }

  return pools;
}

export function buildTurtleCompositeSnapshotMap(
  pets: CollectedPet[],
  familyPools: Map<string, FamilyCompetitionPool>,
): Map<string, TurtleCompositeSnapshot> {
  const turtleCandidates: TurtleCompositeCandidate[] = [];

  for (const pet of pets) {
    if ((pet.species ?? '').toLowerCase() !== 'turtle') continue;

    let coverage = 0;
    let weightedScoreSum = 0;

    for (const weightedFamily of TURTLE_COMPOSITE_WEIGHTS) {
      let bestUtility: number | null = null;

      for (const pool of familyPools.values()) {
        if (pool.broadRoleFamilyKey !== weightedFamily.familyKey) continue;
        const rankIndex = pool.rankByPetId.get(pet.id);
        if (rankIndex == null) continue;
        const utility = computeNormalizedRankUtility(rankIndex, pool.ranked.length);
        if (bestUtility == null || utility > bestUtility) {
          bestUtility = utility;
        }
      }

      if (bestUtility == null) continue;
      coverage += 1;
      weightedScoreSum += bestUtility * weightedFamily.weight;
    }

    if (coverage === 0) continue;
    turtleCandidates.push({
      pet,
      coverage,
      compositeScore: weightedScoreSum,
      weightedScoreSum,
    });
  }

  turtleCandidates.sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;

    const bMax = getMaxStrengthValue(b.pet);
    const aMax = getMaxStrengthValue(a.pet);
    if (bMax !== aMax) return bMax - aMax;
    if (b.pet.strength !== a.pet.strength) return b.pet.strength - a.pet.strength;
    return a.pet.id.localeCompare(b.pet.id);
  });

  const byPetId = new Map<string, TurtleCompositeSnapshot>();
  turtleCandidates.forEach((candidate, index) => {
    const compositeRank = index + 1;
    byPetId.set(candidate.pet.id, {
      coverage: candidate.coverage,
      compositeScore: candidate.weightedScoreSum,
      compositeRank,
      eligible: candidate.coverage >= 3 && compositeRank <= 3,
    });
  });

  return byPetId;
}

export function collectFamilyCompetitionResults(
  petId: string,
  compareSnapshot: OptimizerCompareSnapshot | undefined,
  familyPools: Map<string, FamilyCompetitionPool>,
): FamilyCompetitionResult[] {
  if (!compareSnapshot || compareSnapshot.families.size === 0) return [];

  const results: FamilyCompetitionResult[] = [];

  for (const family of compareSnapshot.families.values()) {
    const pool = familyPools.get(family.familyKey);
    if (!pool) continue;

    const rank = pool.rankByPetId.get(petId);
    if (rank == null) continue;

    results.push({
      familyKey: family.familyKey,
      familyLabel: family.familyLabel,
      broadRoleFamilyKey: family.broadRoleFamilyKey,
      broadRoleFamilyLabel: family.broadRoleFamilyLabel,
      rank,
      totalCompetitors: pool.ranked.length,
      highestTier: family.highestTier,
      familyScore: family.familyScore,
      betterEntries: pool.ranked.slice(0, rank),
    });
  }

  return results;
}

export function toFamilyRankSnapshots(results: FamilyCompetitionResult[]): FamilyRankSnapshot[] {
  return results
    .slice()
    .sort((a, b) => a.rank - b.rank || a.familyLabel.localeCompare(b.familyLabel))
    .map((result) => ({
      familyKey: result.familyKey,
      familyLabel: result.familyLabel,
      broadRoleFamilyKey: result.broadRoleFamilyKey,
      broadRoleFamilyLabel: result.broadRoleFamilyLabel,
      rank: result.rank + 1,
      totalCompetitors: result.totalCompetitors,
      highestTier: result.highestTier,
      familyScore: result.familyScore,
    }));
}
