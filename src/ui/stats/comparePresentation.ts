// src/ui/comparePresentation.ts
// Shared compare presentation adapter built on top of petCompareEngine.

import type { PooledPet } from '../../types/petTeams';
import {
  buildPetCompareProfile,
  getAbilityFamilyKey,
  type AbilityContribution,
  type ProgressionSignalSnapshot,
  type ProgressionStageSnapshot,
} from '../../features/pets/compare';
import type { AbilityValuationContext } from '../../features/pets/abilityValuation';
import {
  areCompareGroupsCompatible,
  getCompareGroupLabel,
  getCompareMetricLabel,
  type CompareGroupId,
  type CompareStage,
} from '../../features/pets/data/petCompareRules';

export interface CompareSideMetrics {
  hasData: boolean;
  abilityId: string | null;
  abilityName: string;
  metricLabel: string;
  valuePerProc: string;
  impactPerHour: string;
  procsPerHour: string;
  triggerPercent: string;
  rawValuePerProc: number;
  rawImpactPerHour: number;
  rawProcsPerHour: number;
  rawTriggerPercent: number;
}

export interface CompareLedgerRow {
  id: 'value_per_proc' | 'impact_per_hour' | 'procs_per_hour' | 'trigger_percent';
  label: string;
  a: string;
  b: string;
  winner: 'a' | 'b' | 'tie' | 'review';
}

export interface CompareCardViewModel {
  verdict: 'a' | 'b' | 'tie' | 'review';
  groupId: CompareGroupId;
  reviewOnly: boolean;
  stageBadge: string;
  tieBreakRef: string;
  sideA: CompareSideMetrics;
  sideB: CompareSideMetrics;
  ledgerRows: CompareLedgerRow[];
}

interface ContributionCompareSnapshot {
  abilityId: string;
  abilityName: string;
  groupId: CompareGroupId;
  unit: AbilityContribution['unit'];
  isAction: boolean;
  reviewOnly: boolean;
  triggerLabel: string;
  triggerPercent: number;
  procsPerHour: number;
  valuePerProc: number;
  expectedValuePerTrigger: number;
  impactPerHour: number;
  primaryValue: number;
  tieBreakerValue: number;
  metricLabel: string;
}

interface CompareFormattingOptions {
  compactNumbers: boolean;
}

const EMPTY_SIGNALS: ProgressionSignalSnapshot = {
  rbwCount: null,
  rainbowGranterPetCount: 0,
  petPowerBand: null,
  storage: {
    petHutch: null,
    seedSilo: null,
    decorShed: null,
  },
  celestial: {
    starweaver: null,
    moon: null,
    dawn: null,
  },
  eggs: null,
  coins: null,
};

function toStageSnapshot(stage: CompareStage): ProgressionStageSnapshot {
  return {
    stage,
    score: 0,
    signals: EMPTY_SIGNALS,
  };
}

function toCompareInput(pet: PooledPet): {
  id: string;
  species: string;
  strength: number | null;
  targetScale: number | null;
  abilities: string[];
  mutations: string[];
} {
  return {
    id: pet.id,
    species: pet.species,
    strength: pet.strength,
    targetScale: pet.targetScale,
    abilities: pet.abilities,
    mutations: pet.mutations,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatPercent(value: number, compact = false): string {
  const n = clamp(value, 0, 100);
  if (compact) {
    if (n < 0.1) return `${n.toFixed(2)}%`;
    if (n < 1) return `${n.toFixed(1)}%`;
    return `${n.toFixed(1).replace(/\.0$/, '')}%`;
  }

  if (n < 0.1) return `${n.toFixed(3)}%`;
  if (n < 1) return `${n.toFixed(2)}%`;
  if (n < 10) return `${n.toFixed(1)}%`;
  return `${n.toFixed(1).replace(/\.0$/, '')}%`;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const toUnit = (divisor: number, suffix: string): string => {
    const compact = abs / divisor;
    const fixed = compact.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return `${sign}${fixed}${suffix}`;
  };

  if (abs >= 1e12) return toUnit(1e12, 'T');
  if (abs >= 1e9) return toUnit(1e9, 'B');
  if (abs >= 1e6) return toUnit(1e6, 'M');
  if (abs >= 1e3) return toUnit(1e3, 'k');
  return `${sign}${Math.round(abs)}`;
}

function formatMinutes(value: number, compact = false): string {
  if (!Number.isFinite(value) || value <= 0) return compact ? '0m' : '0min';
  const totalMinutes = Math.max(1, Math.round(value));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (compact) {
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
  }

  if (hours > 0 && minutes > 0) return `${hours}hr ${minutes}min`;
  if (hours > 0) return `${hours}hr`;
  return `${minutes}min`;
}

function formatValue(
  value: number,
  unit: AbilityContribution['unit'],
  suffix: 'proc' | 'trigger' | 'hour',
  compact = false,
): string {
  if (!Number.isFinite(value) || value <= 0) return '0';

  if (unit === 'coins') {
    const base = formatCompactNumber(Math.max(0, value));
    return suffix === 'hour' ? `${base}` : `${base}`;
  }

  if (unit === 'minutes') {
    const base = formatMinutes(value, compact);
    return suffix === 'hour' ? `${base}/hr` : `${base}/${suffix}`;
  }

  if (unit === 'xp') {
    const base = formatCompactNumber(Math.max(0, value));
    return suffix === 'hour' ? `${base} xp/hr` : `${base} xp/${suffix}`;
  }

  if (Math.abs(value) >= 1000) {
    const base = formatCompactNumber(value);
    return suffix === 'hour' ? `${base}/hr` : `${base}/${suffix}`;
  }

  const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return suffix === 'hour' ? `${rounded}/hr` : `${rounded}/${suffix}`;
}

function getPrimaryValue(entry: AbilityContribution): number {
  if (entry.isAction) {
    return Math.max(0, entry.expectedValuePerTrigger);
  }
  return Math.max(0, entry.impactPerHour);
}

function getTieValue(entry: AbilityContribution): number {
  if (entry.isAction) {
    return Math.max(0, entry.chancePercent);
  }
  return Math.max(0, entry.procsPerHour);
}

function normalizeAbilityFilter(filter: string): string {
  const normalized = filter.trim().toLowerCase();
  return normalized.startsWith('family:') ? normalized.slice('family:'.length) : normalized;
}

function normalizeAbilityId(value: string): string {
  return value.trim().toLowerCase();
}

function resolveEntryFamily(entry: AbilityContribution): string {
  const abilityId = normalizeAbilityId(entry.abilityId);
  return normalizeAbilityId(getAbilityFamilyKey(abilityId));
}

function isExactAbilityMatch(entry: AbilityContribution, abilityId: string): boolean {
  const normalized = normalizeAbilityId(abilityId);
  return normalizeAbilityId(entry.abilityId) === normalized || normalizeAbilityId(entry.rawAbilityId) === normalized;
}

function isFamilyMatch(entry: AbilityContribution, familyId: string): boolean {
  if (!familyId) return false;
  return resolveEntryFamily(entry) === familyId;
}

function compareEntries(
  a: AbilityContribution,
  b: AbilityContribution,
  preferredAbilityId: string | null = null,
): number {
  if (preferredAbilityId) {
    const aExact = isExactAbilityMatch(a, preferredAbilityId);
    const bExact = isExactAbilityMatch(b, preferredAbilityId);
    if (aExact !== bExact) return aExact ? -1 : 1;
  }

  if (a.isReview !== b.isReview) return a.isReview ? 1 : -1;
  if (a.isIgnored !== b.isIgnored) return a.isIgnored ? 1 : -1;

  const pa = getPrimaryValue(a);
  const pb = getPrimaryValue(b);
  if (pb !== pa) return pb - pa;

  const ta = getTieValue(a);
  const tb = getTieValue(b);
  if (tb !== ta) return tb - ta;

  return a.abilityId.localeCompare(b.abilityId);
}

function chooseBestContribution(
  entries: AbilityContribution[],
  candidates: AbilityContribution[],
  preferredAbilityId: string | null = null,
  allowFallback = true,
): AbilityContribution | null {
  const list = candidates.length > 0 ? candidates : (allowFallback ? entries : []);
  if (!list.length) return null;

  const sorted = [...list].sort((a, b) => compareEntries(a, b, preferredAbilityId));
  return sorted[0] ?? null;
}

function pairComparable(a: AbilityContribution, b: AbilityContribution): boolean {
  return !a.isReview && !a.isIgnored && !b.isReview && !b.isIgnored && areCompareGroupsCompatible(a.group, b.group);
}

function comparePairRank(
  pairA: [AbilityContribution, AbilityContribution],
  pairB: [AbilityContribution, AbilityContribution],
): number {
  const [a1, a2] = pairA;
  const [b1, b2] = pairB;

  const aComparable = pairComparable(a1, a2);
  const bComparable = pairComparable(b1, b2);
  if (aComparable !== bComparable) return aComparable ? -1 : 1;

  const aPrimary = getPrimaryValue(a1) + getPrimaryValue(a2);
  const bPrimary = getPrimaryValue(b1) + getPrimaryValue(b2);
  if (bPrimary !== aPrimary) return bPrimary - aPrimary;

  const aTie = getTieValue(a1) + getTieValue(a2);
  const bTie = getTieValue(b1) + getTieValue(b2);
  if (bTie !== aTie) return bTie - aTie;

  const aKey = `${a1.abilityId}|${a2.abilityId}`;
  const bKey = `${b1.abilityId}|${b2.abilityId}`;
  return aKey.localeCompare(bKey);
}

function pickBestExactPair(
  entriesA: AbilityContribution[],
  entriesB: AbilityContribution[],
): [AbilityContribution, AbilityContribution] | null {
  const idsA = new Set(entriesA.map((entry) => normalizeAbilityId(entry.abilityId)));
  const sharedIds = new Set<string>();
  for (const entry of entriesB) {
    const id = normalizeAbilityId(entry.abilityId);
    if (idsA.has(id)) sharedIds.add(id);
  }
  if (sharedIds.size === 0) return null;

  const pairs: Array<[AbilityContribution, AbilityContribution]> = [];
  for (const sharedId of sharedIds) {
    const aCandidates = entriesA.filter((entry) => normalizeAbilityId(entry.abilityId) === sharedId);
    const bCandidates = entriesB.filter((entry) => normalizeAbilityId(entry.abilityId) === sharedId);
    const bestA = chooseBestContribution(entriesA, aCandidates, sharedId, false);
    const bestB = chooseBestContribution(entriesB, bCandidates, sharedId, false);
    if (bestA && bestB) pairs.push([bestA, bestB]);
  }

  if (pairs.length === 0) return null;
  return pairs.sort(comparePairRank)[0] ?? null;
}

function pickBestFamilyPair(
  entriesA: AbilityContribution[],
  entriesB: AbilityContribution[],
): [AbilityContribution, AbilityContribution] | null {
  const familiesA = new Set(entriesA.map((entry) => resolveEntryFamily(entry)).filter(Boolean));
  const sharedFamilies = new Set<string>();
  for (const entry of entriesB) {
    const family = resolveEntryFamily(entry);
    if (family && familiesA.has(family)) sharedFamilies.add(family);
  }
  if (sharedFamilies.size === 0) return null;

  const pairs: Array<[AbilityContribution, AbilityContribution]> = [];
  for (const family of sharedFamilies) {
    const aCandidates = entriesA.filter((entry) => isFamilyMatch(entry, family));
    const bCandidates = entriesB.filter((entry) => isFamilyMatch(entry, family));
    const bestA = chooseBestContribution(entriesA, aCandidates, null, false);
    const bestB = chooseBestContribution(entriesB, bCandidates, null, false);
    if (bestA && bestB) pairs.push([bestA, bestB]);
  }

  if (pairs.length === 0) return null;
  return pairs.sort(comparePairRank)[0] ?? null;
}

function pickBestComparableGroupPair(
  entriesA: AbilityContribution[],
  entriesB: AbilityContribution[],
): [AbilityContribution, AbilityContribution] | null {
  const pairs: Array<[AbilityContribution, AbilityContribution]> = [];
  for (const left of entriesA) {
    for (const right of entriesB) {
      if (!pairComparable(left, right)) continue;
      pairs.push([left, right]);
    }
  }
  if (pairs.length === 0) return null;
  return pairs.sort(comparePairRank)[0] ?? null;
}

function selectCompareContributions(
  entriesA: AbilityContribution[],
  entriesB: AbilityContribution[],
  abilityFilter: string,
): { left: AbilityContribution | null; right: AbilityContribution | null } {
  const normalizedFilter = normalizeAbilityFilter(abilityFilter);

  if (normalizedFilter !== 'all') {
    const filterFamily = normalizeAbilityId(getAbilityFamilyKey(normalizedFilter));
    const aFamily = entriesA.filter((entry) => isFamilyMatch(entry, filterFamily));
    const bFamily = entriesB.filter((entry) => isFamilyMatch(entry, filterFamily));

    return {
      left: chooseBestContribution(entriesA, aFamily, normalizedFilter, false),
      right: chooseBestContribution(entriesB, bFamily, normalizedFilter, false),
    };
  }

  const exactPair = pickBestExactPair(entriesA, entriesB);
  if (exactPair) return { left: exactPair[0], right: exactPair[1] };

  const familyPair = pickBestFamilyPair(entriesA, entriesB);
  if (familyPair) return { left: familyPair[0], right: familyPair[1] };

  const groupPair = pickBestComparableGroupPair(entriesA, entriesB);
  if (groupPair) return { left: groupPair[0], right: groupPair[1] };

  return {
    left: chooseBestContribution(entriesA, entriesA),
    right: chooseBestContribution(entriesB, entriesB),
  };
}

function toSnapshot(entry: AbilityContribution | null): ContributionCompareSnapshot | null {
  if (!entry) return null;
  return {
    abilityId: entry.abilityId,
    abilityName: entry.name,
    groupId: entry.group,
    unit: entry.unit,
    isAction: entry.isAction,
    reviewOnly: entry.isReview || entry.isIgnored,
    triggerLabel: entry.triggerLabel,
    triggerPercent: entry.chancePercent,
    procsPerHour: entry.procsPerHour,
    valuePerProc: entry.valuePerTrigger,
    expectedValuePerTrigger: entry.expectedValuePerTrigger,
    impactPerHour: entry.impactPerHour,
    primaryValue: getPrimaryValue(entry),
    tieBreakerValue: getTieValue(entry),
    metricLabel: getCompareMetricLabel(entry.group, entry.isAction),
  };
}

function toSideMetrics(snapshot: ContributionCompareSnapshot | null, format: CompareFormattingOptions): CompareSideMetrics {
  if (!snapshot) {
    return {
      hasData: false,
      abilityId: null,
      abilityName: 'No comparable ability',
      metricLabel: 'Metric',
      valuePerProc: '—',
      impactPerHour: '—',
      procsPerHour: '—',
      triggerPercent: '—',
      rawValuePerProc: 0,
      rawImpactPerHour: 0,
      rawProcsPerHour: 0,
      rawTriggerPercent: 0,
    };
  }

  const inferredUnit = inferUnit(snapshot);
  const valuePerProc = snapshot.isAction
    ? formatValue(snapshot.valuePerProc, inferredUnit, 'trigger', format.compactNumbers)
    : formatValue(snapshot.valuePerProc, inferredUnit, 'proc', format.compactNumbers);

  const impactPerHour = snapshot.isAction
    ? formatValue(snapshot.expectedValuePerTrigger, inferredUnit, 'trigger', format.compactNumbers)
    : formatValue(snapshot.impactPerHour, inferredUnit, 'hour', format.compactNumbers);

  const procsPerHour = snapshot.isAction ? '—' : `${snapshot.procsPerHour.toFixed(1)}`;

  return {
    hasData: true,
    abilityId: snapshot.abilityId,
    abilityName: snapshot.abilityName,
    metricLabel: snapshot.metricLabel,
    valuePerProc,
    impactPerHour,
    procsPerHour,
    triggerPercent: formatPercent(snapshot.triggerPercent, format.compactNumbers),
    rawValuePerProc: snapshot.valuePerProc,
    rawImpactPerHour: snapshot.isAction ? snapshot.expectedValuePerTrigger : snapshot.impactPerHour,
    rawProcsPerHour: snapshot.isAction ? 0 : snapshot.procsPerHour,
    rawTriggerPercent: snapshot.triggerPercent,
  };
}

function inferUnit(snapshot: ContributionCompareSnapshot): AbilityContribution['unit'] {
  if (snapshot.unit && snapshot.unit !== 'none') return snapshot.unit;
  if (snapshot.groupId === 'food') return 'minutes';
  if (snapshot.groupId === 'sale' || snapshot.groupId === 'hatch_dollar' || snapshot.groupId === 'per_hour') return 'coins';
  if (snapshot.metricLabel.includes('$')) return 'coins';
  if (snapshot.metricLabel.includes('xp')) return 'xp';
  if (snapshot.metricLabel.includes('saved')) return 'minutes';
  if (snapshot.groupId === 'hatch_trio') return 'none';
  return 'none';
}

function pickRowWinner(a: number, b: number, comparable: boolean): 'a' | 'b' | 'tie' | 'review' {
  if (!comparable) return 'review';
  if (a > b) return 'a';
  if (b > a) return 'b';
  return 'tie';
}

export function buildCompareCardViewModel(params: {
  petA: PooledPet | null;
  petB: PooledPet | null;
  abilityFilter: string;
  valuationContext: AbilityValuationContext | null;
  stage: CompareStage;
  poolForRank: PooledPet[];
  compactNumbers?: boolean;
}): CompareCardViewModel | null {
  const { petA, petB, abilityFilter, valuationContext, stage, compactNumbers = false } = params;
  const stageSnapshot = toStageSnapshot(stage);

  const profileA = petA ? buildPetCompareProfile(toCompareInput(petA), stageSnapshot, valuationContext) : null;
  const profileB = petB ? buildPetCompareProfile(toCompareInput(petB), stageSnapshot, valuationContext) : null;
  const selected = selectCompareContributions(
    profileA?.abilities ?? [],
    profileB?.abilities ?? [],
    abilityFilter,
  );

  const snapA = toSnapshot(selected.left);
  const snapB = toSnapshot(selected.right);

  if (!snapA && !snapB) return null;
  const active = snapA ?? snapB;
  if (!active) return null;

  const comparable = !!(
    snapA &&
    snapB &&
    !snapA.reviewOnly &&
    !snapB.reviewOnly &&
    areCompareGroupsCompatible(snapA.groupId, snapB.groupId)
  );

  let verdict: 'a' | 'b' | 'tie' | 'review' = 'review';
  if (comparable && snapA && snapB) {
    if (snapA.primaryValue > snapB.primaryValue) verdict = 'a';
    else if (snapB.primaryValue > snapA.primaryValue) verdict = 'b';
    else if (snapA.tieBreakerValue > snapB.tieBreakerValue) verdict = 'a';
    else if (snapB.tieBreakerValue > snapA.tieBreakerValue) verdict = 'b';
    else verdict = 'tie';
  }

  const sideA = toSideMetrics(snapA, { compactNumbers });
  const sideB = toSideMetrics(snapB, { compactNumbers });
  const isActionCompare = !!((snapA?.isAction ?? false) || (snapB?.isAction ?? false));

  const ledgerRows: CompareLedgerRow[] = isActionCompare
    ? [
        {
          id: 'value_per_proc',
          label: 'Value/Trigger',
          a: sideA.valuePerProc,
          b: sideB.valuePerProc,
          winner: pickRowWinner(sideA.rawValuePerProc, sideB.rawValuePerProc, comparable),
        },
        {
          id: 'impact_per_hour',
          label: 'Expected/Trigger',
          a: sideA.impactPerHour,
          b: sideB.impactPerHour,
          winner: pickRowWinner(sideA.rawImpactPerHour, sideB.rawImpactPerHour, comparable),
        },
        {
          id: 'trigger_percent',
          label: 'Chance/Min',
          a: sideA.triggerPercent,
          b: sideB.triggerPercent,
          winner: pickRowWinner(sideA.rawTriggerPercent, sideB.rawTriggerPercent, comparable),
        },
      ]
    : [
        {
          id: 'value_per_proc',
          label: 'Value/Proc',
          a: sideA.valuePerProc,
          b: sideB.valuePerProc,
          winner: pickRowWinner(sideA.rawValuePerProc, sideB.rawValuePerProc, comparable),
        },
        {
          id: 'impact_per_hour',
          label: 'Impact/Hr',
          a: sideA.impactPerHour,
          b: sideB.impactPerHour,
          winner: pickRowWinner(sideA.rawImpactPerHour, sideB.rawImpactPerHour, comparable),
        },
        {
          id: 'procs_per_hour',
          label: 'Rate/Hr',
          a: sideA.procsPerHour,
          b: sideB.procsPerHour,
          winner: pickRowWinner(sideA.rawProcsPerHour, sideB.rawProcsPerHour, comparable),
        },
        {
          id: 'trigger_percent',
          label: 'Chance/Min',
          a: sideA.triggerPercent,
          b: sideB.triggerPercent,
          winner: pickRowWinner(sideA.rawTriggerPercent, sideB.rawTriggerPercent, comparable),
        },
      ];

  return {
    verdict,
    groupId: active.groupId,
    reviewOnly: !comparable,
    stageBadge: stage.toUpperCase(),
    tieBreakRef: `${getCompareGroupLabel(active.groupId)} • primary > tie`,
    sideA,
    sideB,
    ledgerRows,
  };
}

