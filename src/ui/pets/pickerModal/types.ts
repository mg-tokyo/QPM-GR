// src/ui/petPickerModal/types.ts
// Type definitions for the pet picker modal.

export interface PickerState {
  container: HTMLDivElement;
  overlay: HTMLDivElement;
  cleanups: Array<() => void>;
  onSelect: (petItemId: string) => void;
  onCancel: () => void;
}

export interface PickerFilterState {
  location: string;
  sort: string;
  tier: string;
  ability: string;
  compareAbility: string;
  species: string[];
}

export interface PetTeamsUiState {
  pickerByTeam?: Record<string, PickerFilterState>;
  compare?: {
    selectedTeamAId?: string;
    selectedTeamBId?: string;
    abilityByPair?: Record<string, string>;
  };
}

export type MutationTier = 'rainbow' | 'gold' | 'mutated' | 'none';

export type AbilityFilterMode = 'picker' | 'compare';

export interface GroupedAbilityOption {
  value: string;
  label: string;
  abilityIds: Set<string>;
}

export interface CompareAbilityStats {
  procsPerHour: number;
  impactPerHour: number;
  triggerChancePercent: number;
  valuePerProc: number;
  expectedValuePerTrigger: number;
  isEventTriggered: boolean;
  triggerLabel: string;
}

export interface OpenPickerOptions {
  teamId?: string;
  usedPetIds?: Set<string>;
  mode?: 'select' | 'compare_only';
  allowedItemIds?: Set<string>;
  startInCompareMode?: boolean;
  preselectedCompareItemIds?: string[];
  title?: string;
  onSelect: (petItemId: string) => void;
  onCancel?: () => void;
}
