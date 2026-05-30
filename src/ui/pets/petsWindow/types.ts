// Shared types for the petsWindow subfolder.

import type { CompareStage } from '../../../features/pets/data/petCompareRules';
import type { PooledPet } from '../../../types/petTeams';

export interface CompareUiState {
  selectedTeamAId?: string;
  selectedTeamBId?: string;
  abilityByPair?: Record<string, string>;
}

export interface PetTeamsUiState {
  compare?: CompareUiState;
}

export interface ManagerState {
  selectedTeamId: string | null;
  searchTerm: string;
  selectTeam: (teamId: string | null) => void;
  cleanups: Array<() => void>;
  /** External hook called after every editor re-render (e.g., for discovery rescan). */
  onEditorRender?: () => void;
}

export interface ComparePanelHandle {
  root: HTMLElement;
  setPair: (teamAId: string | null, teamBId: string | null) => void;
  refresh: () => void;
}

export interface CompareStateChange {
  visible: boolean;
  stage: CompareStage | null;
}

/** Shared context object passed between renderTeamList and renderEditor. */
export interface ManagerContext {
  state: ManagerState;
  petPool: PooledPet[];
  compareOpen: boolean;
  compareTeamAId: string | null;
  compareTeamBId: string | null;
  dragTeamId: string | null;
  teamsContainer: HTMLElement;
  editor: HTMLElement;
  comparePanel: ComparePanelHandle;
  normalizeComparePair(): void;
  renderTeamList(): void;
  renderEditor(): void;
}
