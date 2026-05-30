import type {
  CollectedPet,
  OptimizerAnalysis,
  PetComparison,
} from '../../../features/pets/optimizer';

export interface WindowState {
  root: HTMLElement;
  summaryContainer: HTMLElement;
  filtersContainer: HTMLElement;
  navContainer: HTMLElement;
  resultsContainer: HTMLElement;
  currentAnalysis: OptimizerAnalysis | null;
}

export interface FamilyPetEntry {
  comparison: PetComparison;
  familyKey: string;
  familyLabel: string;
  rank: number;
  totalCompetitors: number | null;
  familyScore: number | null;
  tierValue: number;
  tierLabel: string | null;
  representativeAbilityName: string;
}

export interface FamilyAbilityGroup {
  familyKey: string;
  familyLabel: string;
  highestTierValue: number;
  highestTierLabel: string | null;
  representativeAbilityName: string;
  pets: FamilyPetEntry[];
}

export type StatusSectionId = 'review' | 'sell' | 'keep';

export interface SellModalPetEntry {
  pet: CollectedPet;
  status: string;
  checked: boolean;
  showCheckbox: boolean;
}
