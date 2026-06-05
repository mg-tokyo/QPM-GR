import {
  COMPARE_GROUP_FILTER_OPTIONS,
} from '../data/petCompareRules';
import {
  getOptimizerCompetitionFamilyKey,
  type CompareAbilityGroup,
} from '../compare';
import { ANALYSIS_CACHE_TTL_MS } from './constants';
import { collectAllPets, dedupeCollectedPets } from './collection';
import { analyzePet } from './decision';
import { createCompareSnapshotMap } from './ranking/snapshot';
import {
  buildTurtleCompositeSnapshotMap,
  createFamilyCompetitionPools,
} from './ranking/specialist';
import {
  createSlotEfficiencyCompetitionPools,
  populateSlotEfficiencySnapshots,
} from './ranking/slotEfficiency';
import {
  getCachedOptimizerAnalysis,
  getOptimizerAnalysisTimestamp,
  getOptimizerConfig,
  notifyAnalysisUpdateListeners,
  setCachedOptimizerAnalysis,
} from './runtime';
import { calculatePetScore } from './scoring';
import type {
  CollectedPet,
  FamilyRankSnapshot,
  OptimizerAnalysis,
  OptimizerConfig,
  PetComparison,
  PetStatus,
  RecommendationMode,
} from './types';

export async function analyzePetsAsync(
  pets: CollectedPet[],
  onProgress?: (percent: number) => void,
  cfg: OptimizerConfig = getOptimizerConfig(),
): Promise<OptimizerAnalysis> {
  const uniquePets = dedupeCollectedPets(pets);
  const comparisons: PetComparison[] = [];
  const chunkSize = 10;

  const petScores = new Map<string, ReturnType<typeof calculatePetScore>>();
  for (const pet of uniquePets) {
    petScores.set(pet.id, calculatePetScore(pet, cfg));
  }

  const compareSnapshots = createCompareSnapshotMap(uniquePets, cfg);
  const specialistPools = createFamilyCompetitionPools(uniquePets, compareSnapshots.byPetId, cfg);
  const turtleCompositeByPetId = buildTurtleCompositeSnapshotMap(uniquePets, specialistPools);
  populateSlotEfficiencySnapshots(
    uniquePets,
    compareSnapshots.byPetId,
    specialistPools,
    turtleCompositeByPetId,
    compareSnapshots.stage,
    cfg,
  );
  const slotEfficiencyPools = createSlotEfficiencyCompetitionPools(uniquePets, compareSnapshots.byPetId, cfg);

  for (let i = 0; i < uniquePets.length; i += chunkSize) {
    const chunk = uniquePets.slice(i, i + chunkSize);
    for (const pet of chunk) {
      const score = petScores.get(pet.id);
      if (!score) continue;
      const comparison = analyzePet(
        pet,
        score,
        uniquePets,
        specialistPools,
        slotEfficiencyPools,
        compareSnapshots.byPetId,
        turtleCompositeByPetId,
        cfg,
      );
      comparisons.push(comparison);
    }

    if (onProgress) {
      onProgress(Math.min(100, Math.round(((i + chunkSize) / uniquePets.length) * 100)));
    }

    if (i + chunkSize < uniquePets.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const keep = comparisons.filter((comparison) => comparison.status === 'keep');
  const sell = comparisons.filter((comparison) => comparison.status === 'sell');
  const review = comparisons.filter((comparison) => comparison.status === 'review');

  const strategyPets = new Map<CompareAbilityGroup, PetComparison[]>();
  for (const option of COMPARE_GROUP_FILTER_OPTIONS) {
    const filtered = comparisons.filter((comparison) => {
      const snapshot = compareSnapshots.byPetId.get(comparison.pet.id);
      return !!snapshot?.groups.includes(option.id);
    });
    strategyPets.set(option.id, filtered);
  }

  return {
    allPets: uniquePets,
    comparisons,
    activeMode: cfg.recommendationMode,
    keep,
    sell,
    review,
    strategyPets,
    totalPets: uniquePets.length,
    activePets: uniquePets.filter((pet) => pet.location === 'active').length,
    inventoryPets: uniquePets.filter((pet) => pet.location === 'inventory').length,
    hutchPets: uniquePets.filter((pet) => pet.location === 'hutch').length,
    sellCount: sell.length,
    reviewCount: review.length,
  };
}

export function analyzePets(
  pets: CollectedPet[],
  cfg: OptimizerConfig = getOptimizerConfig(),
): OptimizerAnalysis {
  const uniquePets = dedupeCollectedPets(pets);
  const comparisons: PetComparison[] = [];

  const petScores = new Map<string, ReturnType<typeof calculatePetScore>>();
  for (const pet of uniquePets) {
    petScores.set(pet.id, calculatePetScore(pet, cfg));
  }

  const compareSnapshots = createCompareSnapshotMap(uniquePets, cfg);
  const specialistPools = createFamilyCompetitionPools(uniquePets, compareSnapshots.byPetId, cfg);
  const turtleCompositeByPetId = buildTurtleCompositeSnapshotMap(uniquePets, specialistPools);
  populateSlotEfficiencySnapshots(
    uniquePets,
    compareSnapshots.byPetId,
    specialistPools,
    turtleCompositeByPetId,
    compareSnapshots.stage,
    cfg,
  );
  const slotEfficiencyPools = createSlotEfficiencyCompetitionPools(uniquePets, compareSnapshots.byPetId, cfg);

  for (const pet of uniquePets) {
    const score = petScores.get(pet.id);
    if (!score) continue;
    const comparison = analyzePet(
      pet,
      score,
      uniquePets,
      specialistPools,
      slotEfficiencyPools,
      compareSnapshots.byPetId,
      turtleCompositeByPetId,
      cfg,
    );
    comparisons.push(comparison);
  }

  const keep = comparisons.filter((comparison) => comparison.status === 'keep');
  const sell = comparisons.filter((comparison) => comparison.status === 'sell');
  const review = comparisons.filter((comparison) => comparison.status === 'review');

  const strategyPets = new Map<CompareAbilityGroup, PetComparison[]>();
  for (const option of COMPARE_GROUP_FILTER_OPTIONS) {
    const filtered = comparisons.filter((comparison) => {
      const snapshot = compareSnapshots.byPetId.get(comparison.pet.id);
      return !!snapshot?.groups.includes(option.id);
    });
    strategyPets.set(option.id, filtered);
  }

  return {
    allPets: uniquePets,
    comparisons,
    activeMode: cfg.recommendationMode,
    keep,
    sell,
    review,
    strategyPets,
    totalPets: uniquePets.length,
    activePets: uniquePets.filter((pet) => pet.location === 'active').length,
    inventoryPets: uniquePets.filter((pet) => pet.location === 'inventory').length,
    hutchPets: uniquePets.filter((pet) => pet.location === 'hutch').length,
    sellCount: sell.length,
    reviewCount: review.length,
  };
}

export async function getOptimizerAnalysis(
  forceRefresh = false,
  onProgress?: (percent: number) => void,
): Promise<OptimizerAnalysis> {
  const now = Date.now();
  const cfg = getOptimizerConfig();
  const cached = getCachedOptimizerAnalysis();

  if (!forceRefresh && cached && cached.activeMode === cfg.recommendationMode && now - getOptimizerAnalysisTimestamp() < ANALYSIS_CACHE_TTL_MS) {
    return cached;
  }

  const pets = await collectAllPets();
  const analysis = await analyzePetsAsync(pets, onProgress, cfg);
  setCachedOptimizerAnalysis(analysis, now);
  notifyAnalysisUpdateListeners(analysis);
  return analysis;
}

function normalizeDebugFamilyKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const familyKey = getOptimizerCompetitionFamilyKey(trimmed).trim().toLowerCase();
  return familyKey || trimmed.toLowerCase();
}

function serializeCollectedPet(pet: CollectedPet): Record<string, unknown> {
  return {
    id: pet.id,
    itemId: pet.itemId,
    name: pet.name,
    species: pet.species,
    location: pet.location,
    slotIndex: pet.slotIndex,
    strength: pet.strength,
    maxStrength: pet.maxStrength,
    targetScale: pet.targetScale,
    abilities: [...pet.abilities],
    abilityIds: [...pet.abilityIds],
    mutations: [...pet.mutations],
    hasGold: pet.hasGold,
    hasRainbow: pet.hasRainbow,
  };
}

function serializeComparison(comparison: PetComparison): Record<string, unknown> {
  return {
    pet: serializeCollectedPet(comparison.pet),
    status: comparison.status,
    reason: comparison.reason,
    decisionMode: comparison.decisionMode ?? null,
    decisionFamilyKey: comparison.decisionFamilyKey ?? null,
    decisionFamilyLabel: comparison.decisionFamilyLabel ?? null,
    betterAlternatives: comparison.betterAlternatives.map((pet) => serializeCollectedPet(pet)),
    topFamilies: comparison.topFamilies ? [...comparison.topFamilies] : [],
    score: {
      total: comparison.score.total,
      granterBonus: comparison.score.granterBonus,
      granterType: comparison.score.granterType,
      breakdown: { ...comparison.score.breakdown },
    },
    specialistFamilyRanks: comparison.specialistFamilyRanks?.map((rank) => ({ ...rank })) ?? [],
    slotEfficiencyFamilyRanks: comparison.slotEfficiencyFamilyRanks?.map((rank) => ({ ...rank })) ?? [],
    slotEfficiencySummaries: comparison.slotEfficiencySummaries?.map((summary) => ({
      familyKey: summary.familyKey,
      familyLabel: summary.familyLabel,
      broadRoleFamilyKey: summary.broadRoleFamilyKey,
      broadRoleFamilyLabel: summary.broadRoleFamilyLabel,
      baseValue: summary.baseValue,
      totalBonus: summary.totalBonus,
      finalScore: summary.finalScore,
      supportFamilies: summary.supportFamilies.map((support) => ({ ...support })),
      bonuses: summary.bonuses.map((bonus) => ({ ...bonus })),
    })) ?? [],
    turtleComposite: comparison.turtleComposite ? { ...comparison.turtleComposite } : null,
  };
}

async function getOptimizerAnalysisForMode(mode?: RecommendationMode): Promise<OptimizerAnalysis> {
  if (!mode) {
    return getOptimizerAnalysis();
  }

  const cfg = getOptimizerConfig();
  cfg.recommendationMode = mode;
  const pets = await collectAllPets();
  return analyzePetsAsync(pets, undefined, cfg);
}

export async function getOptimizerDebugSnapshot(mode?: RecommendationMode): Promise<Record<string, unknown>> {
  const analysis = await getOptimizerAnalysisForMode(mode);
  return {
    activeMode: analysis.activeMode,
    summary: {
      totalPets: analysis.totalPets,
      keep: analysis.keep.length,
      sell: analysis.sellCount,
      review: analysis.reviewCount,
      activePets: analysis.activePets,
      inventoryPets: analysis.inventoryPets,
      hutchPets: analysis.hutchPets,
    },
    comparisons: analysis.comparisons.map((comparison) => serializeComparison(comparison)),
  };
}

export async function getOptimizerDebugFamily(
  familyKeyOrAbility: string,
  mode?: RecommendationMode,
): Promise<Record<string, unknown>> {
  const analysis = await getOptimizerAnalysisForMode(mode);
  const familyKey = normalizeDebugFamilyKey(familyKeyOrAbility);
  const rankKey = analysis.activeMode === 'specialist'
    ? 'specialistFamilyRanks'
    : 'slotEfficiencyFamilyRanks';

  const entries: Array<{
    pet: Record<string, unknown>;
    status: PetStatus;
    reason: string;
    rank: FamilyRankSnapshot;
    slotEfficiencySummary: {
      familyKey: string;
      familyLabel: string;
      broadRoleFamilyKey: string;
      broadRoleFamilyLabel: string;
      baseValue: number;
      totalBonus: number;
      finalScore: number;
      supportFamilies: Array<{
        familyKey: string;
        familyLabel: string;
        broadRoleFamilyKey: string;
        broadRoleFamilyLabel: string;
        value: number;
        weight: number;
      }>;
      bonuses: Array<{ label: string; value: number }>;
    } | null;
  }> = [];

  for (const comparison of analysis.comparisons) {
    const ranks = rankKey === 'specialistFamilyRanks'
      ? (comparison.specialistFamilyRanks ?? [])
      : (comparison.slotEfficiencyFamilyRanks ?? []);
    const matchedRank = ranks.find((rank) => rank.familyKey === familyKey);
    if (!matchedRank) continue;

    const matchedSummary = comparison.slotEfficiencySummaries?.find((summary) => summary.familyKey === familyKey) ?? null;
    entries.push({
      pet: serializeCollectedPet(comparison.pet),
      status: comparison.status,
      reason: comparison.reason,
      rank: { ...matchedRank },
      slotEfficiencySummary: matchedSummary ? {
        familyKey: matchedSummary.familyKey,
        familyLabel: matchedSummary.familyLabel,
        broadRoleFamilyKey: matchedSummary.broadRoleFamilyKey,
        broadRoleFamilyLabel: matchedSummary.broadRoleFamilyLabel,
        baseValue: matchedSummary.baseValue,
        totalBonus: matchedSummary.totalBonus,
        finalScore: matchedSummary.finalScore,
        supportFamilies: matchedSummary.supportFamilies.map((support) => ({ ...support })),
        bonuses: matchedSummary.bonuses.map((bonus) => ({ ...bonus })),
      } : null,
    });
  }

  entries.sort((a, b) => a.rank.rank - b.rank.rank);
  return {
    activeMode: analysis.activeMode,
    familyKey,
    familyLabel: entries[0]?.rank.familyLabel ?? null,
    broadRoleFamilyKey: entries[0]?.rank.broadRoleFamilyKey ?? null,
    broadRoleFamilyLabel: entries[0]?.rank.broadRoleFamilyLabel ?? null,
    entries,
  };
}

export async function getOptimizerDebugExplain(
  petIdOrName: string,
  mode?: RecommendationMode,
): Promise<Record<string, unknown> | null> {
  const needle = petIdOrName.trim().toLowerCase();
  if (!needle) return null;

  const analysis = await getOptimizerAnalysisForMode(mode);
  const comparison = analysis.comparisons.find((entry) => {
    const petName = (entry.pet.name ?? '').trim().toLowerCase();
    const species = (entry.pet.species ?? '').trim().toLowerCase();
    return entry.pet.id.toLowerCase() === needle
      || entry.pet.itemId.toLowerCase() === needle
      || petName === needle
      || species === needle
      || `${species} ${petName}`.trim() === needle;
  });

  return comparison ? serializeComparison(comparison) : null;
}
