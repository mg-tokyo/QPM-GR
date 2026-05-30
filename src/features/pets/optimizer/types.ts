import type { CompareAbilityGroup } from '../compare';

export type PetLocation = 'active' | 'inventory' | 'hutch';
export type PetStatus = 'keep' | 'sell' | 'review';
export type RecommendationMode = 'specialist' | 'slot_efficiency';
export type OptimizerCompareFilter = CompareAbilityGroup | 'all';

export interface CollectedPet {
  id: string;
  /** Item UUID used for WS actions (StorePet, SellPet, etc.). For active pets this is slotId, not petId. */
  itemId: string;
  name: string | null;
  species: string | null;
  location: PetLocation;
  slotIndex: number;
  strength: number;
  maxStrength: number | null;
  targetScale: number | null;
  xp: number | null;
  level: number | null;
  abilities: string[];
  abilityIds: string[];
  mutations: string[];
  hasGold: boolean;
  hasRainbow: boolean;
  raw: unknown;
}

export interface PetScore {
  total: number;
  granterBonus: number;
  granterType: 'rainbow' | 'gold' | null;
  breakdown: {
    currentStrength: number;
    maxStrength: number;
    potential: number;
    abilityTier: number;
    abilityRarity: number;
    mutation: number;
  };
}

export interface FamilyRankSnapshot {
  familyKey: string;
  familyLabel: string;
  broadRoleFamilyKey: string;
  broadRoleFamilyLabel: string;
  rank: number;
  totalCompetitors: number;
  highestTier: number;
  familyScore: number;
}

export interface TurtleCompositeSnapshot {
  coverage: number;
  compositeScore: number;
  compositeRank: number;
  eligible: boolean;
}

export interface SlotEfficiencySupportSummary {
  familyKey: string;
  familyLabel: string;
  broadRoleFamilyKey: string;
  broadRoleFamilyLabel: string;
  value: number;
  weight: number;
}

export interface SlotEfficiencyBonusSummary {
  label: string;
  value: number;
}

export interface SlotEfficiencyFamilySummary {
  familyKey: string;
  familyLabel: string;
  broadRoleFamilyKey: string;
  broadRoleFamilyLabel: string;
  baseValue: number;
  supportFamilies: SlotEfficiencySupportSummary[];
  bonuses: SlotEfficiencyBonusSummary[];
  totalBonus: number;
  finalScore: number;
}

export interface PetComparison {
  pet: CollectedPet;
  score: PetScore;
  status: PetStatus;
  reason: string;
  betterAlternatives: CollectedPet[];
  decisionMode?: RecommendationMode | 'rule';
  decisionFamilyKey?: string;
  decisionFamilyLabel?: string;
  topFamilies?: string[];
  familyRanks?: FamilyRankSnapshot[];
  specialistFamilyRanks?: FamilyRankSnapshot[];
  slotEfficiencyFamilyRanks?: FamilyRankSnapshot[];
  slotEfficiencySummaries?: SlotEfficiencyFamilySummary[];
  turtleComposite?: TurtleCompositeSnapshot | undefined;
}

export interface OptimizerAnalysis {
  allPets: CollectedPet[];
  comparisons: PetComparison[];
  activeMode: RecommendationMode;
  keep: PetComparison[];
  sell: PetComparison[];
  review: PetComparison[];
  strategyPets: Map<CompareAbilityGroup, PetComparison[]>;
  totalPets: number;
  activePets: number;
  inventoryPets: number;
  hutchPets: number;
  sellCount: number;
  reviewCount: number;
}

export interface OptimizerConfig {
  selectedStrategy: OptimizerCompareFilter;
  recommendationMode: RecommendationMode;
  showReview: boolean;
  showSell: boolean;
  showAllKeeps: boolean;
  dislikeGold: boolean;
  showTop3Only: boolean;
  groupBySpecies: boolean;
  sortBy: 'strength' | 'maxStrength' | 'score' | 'location';
  sortDirection: 'asc' | 'desc';
  minStrengthThreshold: number;
  protectedPetIds: Set<string>;
  mutationProtection: 'both' | 'rainbow' | 'none';
  minMaxStrength: number;
  minTargetScale: number;
  minAbilityCount: 1 | 2 | 3;
  onlyRarePlus: boolean;
  markLowValueAbilities: boolean;
  prioritizeActivePets: boolean;
}

export interface OptimizerFamilySnapshot {
  familyKey: string;
  familyLabel: string;
  broadRoleFamilyKey: string;
  broadRoleFamilyLabel: string;
  highestTier: number;
  familyScore: number;
}

export interface FamilyCompetitionEntry {
  pet: CollectedPet;
  familyKey: string;
  familyLabel: string;
  broadRoleFamilyKey: string;
  broadRoleFamilyLabel: string;
  highestTier: number;
  familyScore: number;
}

export interface FamilyCompetitionPool {
  familyKey: string;
  familyLabel: string;
  broadRoleFamilyKey: string;
  broadRoleFamilyLabel: string;
  ranked: FamilyCompetitionEntry[];
  rankByPetId: Map<string, number>;
}

export interface FamilyCompetitionResult {
  familyKey: string;
  familyLabel: string;
  broadRoleFamilyKey: string;
  broadRoleFamilyLabel: string;
  rank: number;
  totalCompetitors: number;
  highestTier: number;
  familyScore: number;
  betterEntries: FamilyCompetitionEntry[];
}

export interface OptimizerSlotEfficiencyFamilySnapshot extends SlotEfficiencyFamilySummary {
  highestTier: number;
  specialistScore: number;
}

export interface SlotEfficiencyStandingEntry {
  family: OptimizerFamilySnapshot;
  normalizedStanding: number;
  adjustedStanding: number;
}

export interface TurtleCompositeCandidate {
  pet: CollectedPet;
  coverage: number;
  compositeScore: number;
  weightedScoreSum: number;
}

export interface TimeFamilySynergyContext {
  coverage: number;
  hasPlant: boolean;
  hasEgg: boolean;
  hasRestore: boolean;
  hasHungerSlow: boolean;
  hasPlantOrEgg: boolean;
}

export interface OptimizerCompareSnapshot {
  score: number;
  reviewCount: number;
  groups: CompareAbilityGroup[];
  families: Map<string, OptimizerFamilySnapshot>;
  slotEfficiencyFamilies: Map<string, OptimizerSlotEfficiencyFamilySnapshot>;
}
