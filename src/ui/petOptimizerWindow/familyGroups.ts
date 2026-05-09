import { getOptimizerAbilityFamilyInfo } from '../../features/petCompareEngine';
import { normalizeAbilityName } from '../../utils/petCardRenderer';
import { t } from '../../i18n';
import type { FamilyAbilityGroup, FamilyPetEntry } from './types';
import type { PetComparison } from '../../features/petOptimizer';

const TIER_VALUE_BY_LABEL: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };

function extractTierLabel(value: string): string | null {
  const match = String(value ?? '').match(/(IV|III|II|I)(?:_NEW)?$/i);
  return match && match[1] ? match[1].toUpperCase() : null;
}

function toTierValue(tierLabel: string | null): number {
  if (!tierLabel) return 0;
  return TIER_VALUE_BY_LABEL[tierLabel] ?? 0;
}

function toTierLabelFromValue(value: number): string | null {
  if (value === 4) return 'IV';
  if (value === 3) return 'III';
  if (value === 2) return 'II';
  if (value === 1) return 'I';
  return null;
}

function stripTierSuffix(label: string): string {
  return label.trim().replace(/\s+(IV|III|II|I)$/i, '').replace(/\s+[1-4]$/i, '').trim();
}

function resolveOptimizerFamilyInfo(abilityId: string, fallbackAbility: string) {
  const info = getOptimizerAbilityFamilyInfo(abilityId, fallbackAbility);
  return info && !info.hidden ? info : null;
}

function resolveFamilyKey(abilityId: string, fallbackAbility: string): string {
  const info = resolveOptimizerFamilyInfo(abilityId, fallbackAbility);
  const base = info?.exactFamilyKey || abilityId || fallbackAbility;
  return base.trim().toLowerCase();
}

function resolveFamilyLabel(abilityId: string, fallbackAbility: string): string {
  const info = resolveOptimizerFamilyInfo(abilityId, fallbackAbility);
  const fromId = info?.exactFamilyLabel || normalizeAbilityName(abilityId);
  const fromName = stripTierSuffix(normalizeAbilityName(fallbackAbility || abilityId));
  return (fromName || fromId || fallbackAbility || abilityId).trim();
}

export function toOrdinal(value: number): string {
  const abs = Math.abs(Math.trunc(value));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;
  const mod10 = abs % 10;
  if (mod10 === 1) return `${abs}st`;
  if (mod10 === 2) return `${abs}nd`;
  if (mod10 === 3) return `${abs}rd`;
  return `${abs}th`;
}

function compareFamilyPetEntries(a: FamilyPetEntry, b: FamilyPetEntry): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (b.tierValue !== a.tierValue) return b.tierValue - a.tierValue;

  const aMax = a.comparison.pet.maxStrength || a.comparison.pet.strength || 0;
  const bMax = b.comparison.pet.maxStrength || b.comparison.pet.strength || 0;
  if (bMax !== aMax) return bMax - aMax;

  const strDiff = (b.comparison.pet.strength || 0) - (a.comparison.pet.strength || 0);
  if (strDiff !== 0) return strDiff;
  return a.comparison.pet.id.localeCompare(b.comparison.pet.id);
}

function compareDisplayFamilyEntries(a: FamilyPetEntry, b: FamilyPetEntry): number {
  if (a.rank !== b.rank) return a.rank - b.rank;

  const aScore = a.familyScore ?? Number.NEGATIVE_INFINITY;
  const bScore = b.familyScore ?? Number.NEGATIVE_INFINITY;
  if (bScore !== aScore) return bScore - aScore;

  return compareFamilyPetEntries(a, b);
}

export function getComparisonIdentityKey(comparison: PetComparison): string {
  const itemId = comparison.pet.itemId?.trim();
  if (itemId) return `item:${itemId}`;
  const petId = comparison.pet.id?.trim();
  if (petId) return `pet:${petId}`;
  return `fallback:${comparison.pet.location}:${comparison.pet.slotIndex}:${comparison.pet.species ?? ''}:${comparison.pet.name ?? ''}`;
}

function toRankedFamilyPetEntries(comparison: PetComparison): FamilyPetEntry[] {
  const rankedFamilies = Array.isArray(comparison.familyRanks) ? comparison.familyRanks : [];
  return rankedFamilies.map((ranked) => {
    const tierValue = Number.isFinite(ranked.highestTier) ? ranked.highestTier : 0;
    const tierLabel = toTierLabelFromValue(tierValue);
    const representativeAbilityName = ranked.familyLabel || ranked.familyKey;

    return {
      comparison,
      familyKey: ranked.familyKey,
      familyLabel: ranked.familyLabel,
      rank: ranked.rank,
      totalCompetitors: Number.isFinite(ranked.totalCompetitors) ? ranked.totalCompetitors : null,
      familyScore: Number.isFinite(ranked.familyScore) ? ranked.familyScore : null,
      tierValue,
      tierLabel,
      representativeAbilityName,
    };
  });
}

function toFallbackFamilyPetEntries(comparison: PetComparison): FamilyPetEntry[] {
  const petFamilies = new Map<string, FamilyPetEntry>();
  const maxLen = Math.max(comparison.pet.abilityIds.length, comparison.pet.abilities.length);

  for (let i = 0; i < maxLen; i += 1) {
    const abilityId = comparison.pet.abilityIds[i] ?? comparison.pet.abilities[i] ?? '';
    if (!abilityId) continue;
    const abilityName = comparison.pet.abilities[i] ?? abilityId;
    if (!resolveOptimizerFamilyInfo(abilityId, abilityName)) continue;

    const familyKey = resolveFamilyKey(abilityId, abilityName);
    if (!familyKey) continue;

    const tierLabel = extractTierLabel(abilityId) ?? extractTierLabel(abilityName);
    const tierValue = toTierValue(tierLabel);
    const existing = petFamilies.get(familyKey);

    if (!existing || tierValue > existing.tierValue) {
      petFamilies.set(familyKey, {
        comparison,
        familyKey,
        familyLabel: resolveFamilyLabel(abilityId, abilityName),
        rank: Number.MAX_SAFE_INTEGER,
        totalCompetitors: null,
        familyScore: null,
        tierValue,
        tierLabel,
        representativeAbilityName: abilityName,
      });
    }
  }

  return [...petFamilies.values()];
}

function createUnclassifiedFamilyEntry(comparison: PetComparison): FamilyPetEntry {
  return {
    comparison,
    familyKey: 'unclassified',
    familyLabel: t('feature.petOptimizer.unclassified'),
    rank: Number.MAX_SAFE_INTEGER,
    totalCompetitors: null,
    familyScore: null,
    tierValue: 0,
    tierLabel: null,
    representativeAbilityName: t('feature.petOptimizer.unclassified'),
  };
}

function getDisplayFamilyEntries(comparison: PetComparison): FamilyPetEntry[] {
  const rankedEntries = toRankedFamilyPetEntries(comparison);

  if (comparison.status === 'sell') {
    if (comparison.decisionFamilyKey) {
      const matchedDecisionEntry = rankedEntries
        .filter((entry) => entry.familyKey === comparison.decisionFamilyKey)
        .sort(compareDisplayFamilyEntries)
        .slice(0, 1);
      if (matchedDecisionEntry.length > 0) return matchedDecisionEntry;
    }

    if (rankedEntries.length > 0) {
      return rankedEntries.slice().sort(compareDisplayFamilyEntries).slice(0, 1);
    }
  } else if (comparison.status === 'keep' && rankedEntries.length > 0) {
    return rankedEntries;
  } else if (rankedEntries.length > 0) {
    return rankedEntries.slice().sort(compareDisplayFamilyEntries).slice(0, 1);
  }

  const fallbackEntries = toFallbackFamilyPetEntries(comparison).sort(compareDisplayFamilyEntries);
  if (fallbackEntries.length > 0) {
    return comparison.status === 'keep' ? fallbackEntries : fallbackEntries.slice(0, 1);
  }

  return [createUnclassifiedFamilyEntry(comparison)];
}

function getTeamFamilyEntries(comparison: PetComparison): FamilyPetEntry[] {
  const rankedEntries = toRankedFamilyPetEntries(comparison);

  if (comparison.status === 'sell') {
    if (comparison.decisionFamilyKey) {
      return rankedEntries.filter((entry) => entry.familyKey === comparison.decisionFamilyKey);
    }
    return rankedEntries.slice(0, 1);
  }

  if (rankedEntries.length > 0) {
    return rankedEntries;
  }

  return toFallbackFamilyPetEntries(comparison);
}

export function buildFamilyGroups(comparisons: PetComparison[]): Map<string, FamilyAbilityGroup> {
  const byFamily = new Map<string, FamilyAbilityGroup>();

  for (const comparison of comparisons) {
    const displayEntries = getDisplayFamilyEntries(comparison);

    for (const entry of displayEntries) {
      const existingGroup = byFamily.get(entry.familyKey);
      if (!existingGroup) {
        byFamily.set(entry.familyKey, {
          familyKey: entry.familyKey,
          familyLabel: entry.familyLabel,
          highestTierValue: entry.tierValue,
          highestTierLabel: entry.tierLabel,
          representativeAbilityName: entry.representativeAbilityName,
          pets: [entry],
        });
        continue;
      }

      const comparisonIdentityKey = getComparisonIdentityKey(comparison);
      if (!existingGroup.pets.some((petEntry) => getComparisonIdentityKey(petEntry.comparison) === comparisonIdentityKey)) {
        existingGroup.pets.push(entry);
      }
      if (entry.tierValue > existingGroup.highestTierValue) {
        existingGroup.highestTierValue = entry.tierValue;
        existingGroup.highestTierLabel = entry.tierLabel;
        existingGroup.representativeAbilityName = entry.representativeAbilityName;
      }
    }
  }

  for (const group of byFamily.values()) {
    group.pets.sort(compareDisplayFamilyEntries);
  }

  return byFamily;
}

/**
 * Merge families whose top-3 pets are exactly identical into a single group
 * with combined labels (e.g., "Dawn Boost / Dawnlit Granter").
 */
export function deduplicateFamilyGroups(
  groups: Map<string, FamilyAbilityGroup>,
): Map<string, FamilyAbilityGroup> {
  // Build a canonical key from the sorted top-3 pet identity keys
  const canonicalKeyOf = (group: FamilyAbilityGroup): string => {
    const topPets = group.pets.slice(0, 3);
    if (topPets.length === 0) return group.familyKey;
    return topPets.map((entry) => getComparisonIdentityKey(entry.comparison)).sort().join('|');
  };

  // Group families by their canonical top-3 key
  const byCanonical = new Map<string, FamilyAbilityGroup[]>();
  for (const group of groups.values()) {
    const key = canonicalKeyOf(group);
    let bucket = byCanonical.get(key);
    if (!bucket) {
      bucket = [];
      byCanonical.set(key, bucket);
    }
    bucket.push(group);
  }

  const merged = new Map<string, FamilyAbilityGroup>();
  for (const bucket of byCanonical.values()) {
    if (bucket.length === 1) {
      const group = bucket[0]!;
      merged.set(group.familyKey, group);
      continue;
    }

    // Merge duplicates: combine labels, keep highest tier, union pets
    const primary = bucket[0]!;
    const combinedLabels = bucket.map((g) => g.familyLabel);
    const mergedLabel = combinedLabels.join(' / ');
    const mergedKey = bucket.map((g) => g.familyKey).join('+');

    let bestTierValue = primary.highestTierValue;
    let bestTierLabel = primary.highestTierLabel;
    let bestRepresentative = primary.representativeAbilityName;

    const petMap = new Map<string, FamilyPetEntry>();
    for (const group of bucket) {
      if (group.highestTierValue > bestTierValue) {
        bestTierValue = group.highestTierValue;
        bestTierLabel = group.highestTierLabel;
        bestRepresentative = group.representativeAbilityName;
      }
      for (const entry of group.pets) {
        const petKey = getComparisonIdentityKey(entry.comparison);
        const existing = petMap.get(petKey);
        if (!existing || compareFamilyPetEntriesForDedup(entry, existing) < 0) {
          petMap.set(petKey, entry);
        }
      }
    }

    const mergedGroup: FamilyAbilityGroup = {
      familyKey: mergedKey,
      familyLabel: mergedLabel,
      highestTierValue: bestTierValue,
      highestTierLabel: bestTierLabel,
      representativeAbilityName: bestRepresentative,
      pets: [...petMap.values()].sort(compareDisplayFamilyEntries),
    };
    merged.set(mergedKey, mergedGroup);
  }

  return merged;
}

/** Compare for dedup: prefer better rank, then higher tier */
function compareFamilyPetEntriesForDedup(a: FamilyPetEntry, b: FamilyPetEntry): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return b.tierValue - a.tierValue;
}

export function sortFamilyGroups(groups: Map<string, FamilyAbilityGroup>): FamilyAbilityGroup[] {
  return [...groups.values()].sort((a, b) => {
    const aTop = a.pets[0];
    const bTop = b.pets[0];

    if (aTop && bTop && aTop.rank !== bTop.rank) return aTop.rank - bTop.rank;

    const aScore = aTop?.familyScore ?? Number.NEGATIVE_INFINITY;
    const bScore = bTop?.familyScore ?? Number.NEGATIVE_INFINITY;
    if (bScore !== aScore) return bScore - aScore;

    if (b.highestTierValue !== a.highestTierValue) return b.highestTierValue - a.highestTierValue;
    return a.familyLabel.localeCompare(b.familyLabel);
  });
}

export function getTopTeamCandidatesForFamily(
  group: FamilyAbilityGroup,
  comparisons: PetComparison[],
): PetComparison[] {
  const matchKeys = group.familyKey.includes('+')
    ? new Set(group.familyKey.split('+'))
    : null;
  const familyEntries = comparisons
    .flatMap((comparison) => getTeamFamilyEntries(comparison))
    .filter((entry) => matchKeys ? matchKeys.has(entry.familyKey) : entry.familyKey === group.familyKey)
    .sort(compareDisplayFamilyEntries);

  const candidates: PetComparison[] = [];
  const seenPetIds = new Set<string>();

  for (const entry of familyEntries) {
    const petId = getComparisonIdentityKey(entry.comparison);
    if (seenPetIds.has(petId)) continue;
    seenPetIds.add(petId);
    candidates.push(entry.comparison);
    if (candidates.length >= 3) break;
  }

  return candidates;
}
