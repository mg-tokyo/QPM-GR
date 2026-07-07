import {
  GRANTER_ANCHOR_PENALTY_CAP,
  HATCH_TRIO_BROAD_ROLE_KEYS,
  SLOT_BONUS_CAP,
  SLOT_SUPPORT_WEIGHTS,
  TIME_FAMILY_KEYS,
} from '../constants';
import type { ProgressionStageSnapshot } from '../../compare';
import { getGoldAdjustedValue } from '../scoring';
import { getRuntimeConfig } from '../runtime';
import type {
  CollectedPet,
  FamilyCompetitionPool,
  FamilyCompetitionResult,
  OptimizerCompareSnapshot,
  OptimizerConfig,
  SlotEfficiencyBonusSummary,
  SlotEfficiencyFamilySummary,
  SlotEfficiencyStandingEntry,
  TurtleCompositeSnapshot,
} from '../types';
import {
  clampUnit,
  computeNormalizedRankUtility,
  getCompetitionMutationScore,
  getMaxStrengthValue,
  hasGoldGranterAbility,
  hasRainbowGranterAbility,
  isMutationGranterFamily,
} from './common';
import { buildTimeFamilySynergyContext } from './snapshot';

function getGoldSlotEfficiencyFactor(stage: ProgressionStageSnapshot): number {
  let factor = stage.stage === 'early' ? 1.0 : stage.stage === 'mid' ? 0.4 : 0.1;
  if (stage.signals.rainbowGranterPetCount >= 3) {
    factor = Math.min(factor, 0.1);
  }
  return factor;
}

function getNormalizedSpecialistStanding(
  rankIndex: number,
  totalCompetitors: number,
  specialistScore: number,
  leaderScore: number,
): number {
  const rankUtility = computeNormalizedRankUtility(rankIndex, totalCompetitors);
  const scoreRatio = leaderScore > 0
    ? clampUnit(specialistScore / leaderScore)
    : rankUtility;
  return clampUnit((rankUtility * 0.65) + (scoreRatio * 0.35));
}

function isMeaningfulSupportFamily(
  family: SlotEfficiencyStandingEntry['family'],
  normalizedStanding: number,
): boolean {
  if (family.familyScore <= 0) return false;
  return family.highestTier >= 2 || normalizedStanding >= 0.55 || isMutationGranterFamily(family.broadRoleFamilyKey);
}

function compressSupportStanding(standing: number): number {
  return 0.3 + 0.7 * standing;
}

function compareStandingEntries(a: SlotEfficiencyStandingEntry, b: SlotEfficiencyStandingEntry): number {
  if (b.adjustedStanding !== a.adjustedStanding) return b.adjustedStanding - a.adjustedStanding;
  if (b.family.highestTier !== a.family.highestTier) return b.family.highestTier - a.family.highestTier;
  if (b.family.familyScore !== a.family.familyScore) return b.family.familyScore - a.family.familyScore;
  return a.family.familyLabel.localeCompare(b.family.familyLabel);
}

function getGoldSlotEfficiencyStandingFactor(
  pet: CollectedPet,
  stage: ProgressionStageSnapshot,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  if (!hasGoldGranterAbility(pet) || hasRainbowGranterAbility(pet)) {
    return 1;
  }
  return getGoldAdjustedValue(getGoldSlotEfficiencyFactor(stage), cfg);
}

function buildSupportCandidatesByBroadRole(
  adjustedFamilyStandings: SlotEfficiencyStandingEntry[],
  anchor: SlotEfficiencyStandingEntry,
): SlotEfficiencyStandingEntry[] {
  const bestByBroadRole = new Map<string, SlotEfficiencyStandingEntry>();
  const anchorIsColorGranter = anchor.family.broadRoleFamilyKey === 'rainbowgranter'
    || anchor.family.broadRoleFamilyKey === 'goldgranter';

  for (const entry of adjustedFamilyStandings) {
    if (entry.family.familyKey === anchor.family.familyKey) continue;
    if (entry.family.broadRoleFamilyKey === anchor.family.broadRoleFamilyKey) continue;
    if (anchorIsColorGranter && isMutationGranterFamily(entry.family.broadRoleFamilyKey)) continue;
    if (anchorIsColorGranter && entry.family.broadRoleFamilyKey === 'produceeater') continue;

    // Hatch-trio abilities (pethatchsizeboost, petmutationboost, petageboost, doublehatch) only
    // support each other — they must not boost continuous/per-hour anchors (e.g. petxpboost) and
    // vice versa. Without this guard, Max Strength Boost II (tier 2) trivially passes
    // isMeaningfulSupportFamily and inflates XP Boost slot-efficiency scores.
    const anchorIsHatchTrio = HATCH_TRIO_BROAD_ROLE_KEYS.has(anchor.family.broadRoleFamilyKey);
    const entryIsHatchTrio = HATCH_TRIO_BROAD_ROLE_KEYS.has(entry.family.broadRoleFamilyKey);
    if (anchorIsHatchTrio !== entryIsHatchTrio) continue;

    // Synergy gate: only recognized ecosystem pairings (mutation/crop/coinfinder) count as support.
    if (!anchorIsHatchTrio) {
      const anchorKey = anchor.family.broadRoleFamilyKey;
      const supportKey = entry.family.broadRoleFamilyKey;
      const anchorIsMutationEco = isMutationGranterFamily(anchorKey) || anchorKey === 'producemutationboost';
      const anchorIsCropEco = TIME_FAMILY_KEYS.has(anchorKey) || anchorKey === 'producescaleboost';
      const supportIsMutationEco = isMutationGranterFamily(supportKey) || supportKey === 'producemutationboost';
      const supportIsCropEco = TIME_FAMILY_KEYS.has(supportKey) || supportKey === 'producescaleboost';
      const supportIsCoinFinder = supportKey === 'coinfinder';

      const hasSynergy = (anchorIsMutationEco && (supportIsCropEco || supportIsCoinFinder))
        || (anchorIsCropEco && (supportIsCropEco || supportIsMutationEco || supportIsCoinFinder));
      if (!hasSynergy) continue;
    }

    if (!isMeaningfulSupportFamily(entry.family, entry.adjustedStanding)) continue;

    const existing = bestByBroadRole.get(entry.family.broadRoleFamilyKey);
    if (!existing || compareStandingEntries(entry, existing) < 0) {
      bestByBroadRole.set(entry.family.broadRoleFamilyKey, entry);
    }
  }

  return [...bestByBroadRole.values()]
    .sort(compareStandingEntries)
    .slice(0, SLOT_SUPPORT_WEIGHTS.length);
}

function hasSnapshotFamilyBroadRole(compareSnapshot: OptimizerCompareSnapshot, broadRoleFamilyKey: string): boolean {
  return [...compareSnapshot.families.values()].some((family) => family.broadRoleFamilyKey === broadRoleFamilyKey);
}

function hasSnapshotSeedFinderFamily(compareSnapshot: OptimizerCompareSnapshot): boolean {
  return [...compareSnapshot.families.values()].some((family) => family.broadRoleFamilyKey === 'seedfinder');
}

export function populateSlotEfficiencySnapshots(
  pets: CollectedPet[],
  compareByPetId: Map<string, OptimizerCompareSnapshot>,
  familyPools: Map<string, FamilyCompetitionPool>,
  turtleCompositeByPetId: Map<string, TurtleCompositeSnapshot>,
  stage: ProgressionStageSnapshot,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): void {
  const petsById = new Map(pets.map((pet) => [pet.id, pet] as const));

  for (const [petId, compareSnapshot] of compareByPetId.entries()) {
    compareSnapshot.slotEfficiencyFamilies.clear();
    if (compareSnapshot.reviewCount > 0 || compareSnapshot.families.size === 0) continue;

    const pet = petsById.get(petId);
    if (!pet) continue;

    const familyStandings = [...compareSnapshot.families.values()]
      .map((family) => {
        const pool = familyPools.get(family.familyKey);
        const rankIndex = pool?.rankByPetId.get(petId);
        if (!pool || rankIndex == null) return null;
        const leaderScore = pool.ranked[0]?.familyScore ?? family.familyScore;
        return {
          family,
          normalizedStanding: getNormalizedSpecialistStanding(
            rankIndex,
            pool.ranked.length,
            family.familyScore,
            leaderScore,
          ),
          adjustedStanding: 0,
        };
      })
      .filter((entry): entry is SlotEfficiencyStandingEntry => !!entry);

    if (familyStandings.length === 0) continue;

    const timeSynergy = buildTimeFamilySynergyContext(pet);
    const turtleComposite = turtleCompositeByPetId.get(pet.id);
    const goldStandingFactor = getGoldSlotEfficiencyStandingFactor(pet, stage, cfg);

    const adjustedFamilyStandings = familyStandings
      .map((entry) => ({
        ...entry,
        adjustedStanding: entry.family.broadRoleFamilyKey === 'goldgranter'
          ? entry.normalizedStanding * goldStandingFactor
          : entry.normalizedStanding,
      }))
      .sort(compareStandingEntries);

    for (const anchor of adjustedFamilyStandings) {
      const anchorIsColorGranter = anchor.family.broadRoleFamilyKey === 'rainbowgranter'
        || anchor.family.broadRoleFamilyKey === 'goldgranter';
      const supportCandidates = buildSupportCandidatesByBroadRole(adjustedFamilyStandings, anchor);

      const supportFamilies = supportCandidates.map((entry, index) => ({
        familyKey: entry.family.familyKey,
        familyLabel: entry.family.familyLabel,
        broadRoleFamilyKey: entry.family.broadRoleFamilyKey,
        broadRoleFamilyLabel: entry.family.broadRoleFamilyLabel,
        value: compressSupportStanding(entry.adjustedStanding),
        weight: SLOT_SUPPORT_WEIGHTS[index] ?? 0,
      }));

      const supportValue = supportFamilies.reduce((sum, entry) => sum + (entry.value * entry.weight), 0);

      const bonuses: SlotEfficiencyBonusSummary[] = [];
      let positiveBonusTotal = 0;
      let penaltyTotal = 0;
      const addBonus = (label: string, value: number): void => {
        if (value <= 0 || positiveBonusTotal >= SLOT_BONUS_CAP) return;
        const applied = Math.min(SLOT_BONUS_CAP - positiveBonusTotal, value);
        if (applied <= 0) return;
        bonuses.push({ label, value: applied });
        positiveBonusTotal += applied;
      };
      const addPenalty = (label: string, value: number): void => {
        if (value >= 0 || Math.abs(penaltyTotal) >= GRANTER_ANCHOR_PENALTY_CAP) return;
        const remaining = GRANTER_ANCHOR_PENALTY_CAP - Math.abs(penaltyTotal);
        const applied = Math.max(-remaining, value);
        if (applied >= 0) return;
        bonuses.push({ label, value: applied });
        penaltyTotal += applied;
      };

      const strongSupportCount = supportFamilies.length;
      const allMeaningfulFamilies = [anchor, ...supportCandidates];
      const meaningfulFamilyCount = allMeaningfulFamilies.length;
      const hasFoodSustain = allMeaningfulFamilies.some((entry) =>
        entry.family.broadRoleFamilyKey === 'hungerrestore' || entry.family.broadRoleFamilyKey === 'hungerboost');
      const hasPlantSupport = allMeaningfulFamilies.some((entry) => entry.family.broadRoleFamilyKey === 'plantgrowthboost');
      const hasEggSupport = allMeaningfulFamilies.some((entry) => entry.family.broadRoleFamilyKey === 'egggrowthboost');
      const hasMutationGranter = allMeaningfulFamilies.some((entry) => isMutationGranterFamily(entry.family.broadRoleFamilyKey));

      if (hasMutationGranter && strongSupportCount >= 1) {
        const mutationBonus = anchorIsColorGranter
          ? (strongSupportCount >= 2 ? 0.04 : 0.02)
          : (strongSupportCount >= 2 ? 0.10 : 0.06);
        const scaledBonus = allMeaningfulFamilies.some((entry) => entry.family.broadRoleFamilyKey === 'goldgranter')
          && !allMeaningfulFamilies.some((entry) => entry.family.broadRoleFamilyKey === 'rainbowgranter')
          ? mutationBonus * goldStandingFactor
          : mutationBonus;
        addBonus(
          anchorIsColorGranter
            ? (
                strongSupportCount >= 2
                  ? 'Color granter anchor + 2 support families'
                  : 'Color granter anchor + support family'
              )
            : (
                strongSupportCount >= 2
                  ? 'Mutation granter + 2 strong support families'
                  : 'Mutation granter + strong support family'
              ),
          scaledBonus,
        );
      }

      if (hasFoodSustain && (hasPlantSupport || hasEggSupport)) {
        addBonus('Food sustain + growth support', 0.04);
      }

      if (hasPlantSupport && hasEggSupport) {
        addBonus('Plant + egg growth pairing', 0.03);
      }

      if ((pet.species ?? '').toLowerCase() === 'turtle' && timeSynergy.coverage >= 2) {
        addBonus('Turtle multi-time-family utility', 0.03);
      }

      if (turtleComposite && turtleComposite.coverage >= 2) {
        addBonus('Turtle composite utility', Math.min(0.03, turtleComposite.compositeScore * 0.04));
      }

      if (pet.hasRainbow && meaningfulFamilyCount >= 2) {
        addBonus('Rainbow mutation on multi-role pet', 0.03);
      }

      if (anchor.family.broadRoleFamilyKey === 'rainbowgranter' || anchor.family.broadRoleFamilyKey === 'goldgranter') {
        if (hasSnapshotFamilyBroadRole(compareSnapshot, 'produceeater')) {
          addPenalty('Produce Eater penalty on mutation-granter anchor', -0.03);
        }
        if (hasSnapshotSeedFinderFamily(compareSnapshot)) {
          addPenalty('Seed Finder penalty on mutation-granter anchor', -0.02);
        }
      }

      const totalBonus = positiveBonusTotal + penaltyTotal;
      let finalScore = anchor.adjustedStanding + supportValue + totalBonus;

      // When dislike gold is on, penalize gold pets competing in non-gold pools.
      // The gold granter anchor already has its own standing reduction; this ensures
      // the pet's OTHER abilities don't sneak it into non-gold teams.
      if (goldStandingFactor < 1 && anchor.family.broadRoleFamilyKey !== 'goldgranter') {
        finalScore *= goldStandingFactor;
      }
      compareSnapshot.slotEfficiencyFamilies.set(anchor.family.familyKey, {
        familyKey: anchor.family.familyKey,
        familyLabel: anchor.family.familyLabel,
        broadRoleFamilyKey: anchor.family.broadRoleFamilyKey,
        broadRoleFamilyLabel: anchor.family.broadRoleFamilyLabel,
        highestTier: anchor.family.highestTier,
        specialistScore: anchor.family.familyScore,
        baseValue: anchor.adjustedStanding,
        supportFamilies,
        bonuses,
        totalBonus,
        finalScore,
      });
    }
  }
}

function compareSlotEfficiencyCompetitionEntries(
  a: FamilyCompetitionPool['ranked'][number],
  b: FamilyCompetitionPool['ranked'][number],
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): number {
  if (b.familyScore !== a.familyScore) return b.familyScore - a.familyScore;
  if (b.highestTier !== a.highestTier) return b.highestTier - a.highestTier;

  const aMaxStrength = getMaxStrengthValue(a.pet);
  const bMaxStrength = getMaxStrengthValue(b.pet);
  if (bMaxStrength !== aMaxStrength) return bMaxStrength - aMaxStrength;
  if (b.pet.strength !== a.pet.strength) return b.pet.strength - a.pet.strength;

  const aMutation = getCompetitionMutationScore(a.pet, cfg);
  const bMutation = getCompetitionMutationScore(b.pet, cfg);
  if (bMutation !== aMutation) return bMutation - aMutation;

  return a.pet.id.localeCompare(b.pet.id);
}

export function createSlotEfficiencyCompetitionPools(
  pets: CollectedPet[],
  compareByPetId: Map<string, OptimizerCompareSnapshot>,
  cfg: Pick<OptimizerConfig, 'dislikeGold'> = getRuntimeConfig(),
): Map<string, FamilyCompetitionPool> {
  const pools = new Map<string, FamilyCompetitionPool>();

  for (const pet of pets) {
    const compare = compareByPetId.get(pet.id);
    if (!compare || compare.reviewCount > 0 || compare.slotEfficiencyFamilies.size === 0) continue;

    for (const family of compare.slotEfficiencyFamilies.values()) {
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
        familyScore: family.finalScore,
      });
    }
  }

  for (const pool of pools.values()) {
    pool.ranked.sort((a, b) => compareSlotEfficiencyCompetitionEntries(a, b, cfg));
    pool.ranked.forEach((entry, index) => {
      pool.rankByPetId.set(entry.pet.id, index);
    });
  }

  return pools;
}

export function collectSlotEfficiencyCompetitionResults(
  petId: string,
  compareSnapshot: OptimizerCompareSnapshot | undefined,
  familyPools: Map<string, FamilyCompetitionPool>,
): FamilyCompetitionResult[] {
  if (!compareSnapshot || compareSnapshot.slotEfficiencyFamilies.size === 0) return [];

  const results: FamilyCompetitionResult[] = [];

  for (const family of compareSnapshot.slotEfficiencyFamilies.values()) {
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
      familyScore: family.finalScore,
      betterEntries: pool.ranked.slice(0, rank),
    });
  }

  return results;
}

export function toSlotEfficiencyFamilySummaries(
  compareSnapshot: OptimizerCompareSnapshot | undefined,
): SlotEfficiencyFamilySummary[] {
  if (!compareSnapshot) return [];

  return [...compareSnapshot.slotEfficiencyFamilies.values()]
    .slice()
    .sort((a, b) => b.finalScore - a.finalScore || a.familyLabel.localeCompare(b.familyLabel))
    .map((entry) => ({
      familyKey: entry.familyKey,
      familyLabel: entry.familyLabel,
      broadRoleFamilyKey: entry.broadRoleFamilyKey,
      broadRoleFamilyLabel: entry.broadRoleFamilyLabel,
      baseValue: entry.baseValue,
      supportFamilies: entry.supportFamilies.map((support) => ({ ...support })),
      bonuses: entry.bonuses.map((bonus) => ({ ...bonus })),
      totalBonus: entry.totalBonus,
      finalScore: entry.finalScore,
    }));
}
