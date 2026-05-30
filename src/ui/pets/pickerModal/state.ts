// src/ui/petPickerModal/state.ts
// Module-level mutable state and persistence helpers for the pet picker modal.

import { storage } from '../../../utils/storage';
import { PET_TEAMS_UI_STATE_KEY, SORT_MIGRATION_KEY } from './constants';
import type { PickerState, PickerFilterState, PetTeamsUiState } from './types';

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

export let activeState: PickerState | null = null;

export function setActiveState(state: PickerState | null): void {
  activeState = state;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadPetTeamsUiState(): PetTeamsUiState {
  const raw = storage.get<PetTeamsUiState>(PET_TEAMS_UI_STATE_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

export function getSavedPickerFilters(teamId?: string): PickerFilterState | null {
  migrateDefaultSort();
  if (!teamId) return null;
  const state = loadPetTeamsUiState();
  const saved = state.pickerByTeam?.[teamId];
  return saved && typeof saved === 'object' ? saved : null;
}

export function savePickerFilters(teamId: string | undefined, filters: PickerFilterState): void {
  if (!teamId) return;
  const state = loadPetTeamsUiState();
  const byTeam = state.pickerByTeam ?? {};
  storage.set(PET_TEAMS_UI_STATE_KEY, {
    ...state,
    pickerByTeam: {
      ...byTeam,
      [teamId]: filters,
    },
  });
}

// ---------------------------------------------------------------------------
// One-time migration: change default sort from str-desc → species-tier
// ---------------------------------------------------------------------------

let sortMigrationDone = false;

function migrateDefaultSort(): void {
  if (sortMigrationDone) return;
  sortMigrationDone = true;
  if (storage.get<boolean>(SORT_MIGRATION_KEY, false)) return;
  const state = loadPetTeamsUiState();
  const byTeam = state.pickerByTeam;
  if (byTeam) {
    let changed = false;
    for (const teamId of Object.keys(byTeam)) {
      const filters = byTeam[teamId];
      if (filters && filters.sort === 'str-desc') {
        filters.sort = 'species-tier';
        changed = true;
      }
    }
    if (changed) {
      storage.set(PET_TEAMS_UI_STATE_KEY, state);
    }
  }
  storage.set(SORT_MIGRATION_KEY, true);
}
