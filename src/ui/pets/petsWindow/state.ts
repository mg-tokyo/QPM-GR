// Persistence helpers for petsWindow UI state.

import { storage } from '../../../utils/storage';
import type { CompareUiState, PetTeamsUiState } from './types';
import { PET_TEAMS_UI_STATE_KEY } from './constants';

export function loadPetTeamsUiState(): PetTeamsUiState {
  const raw = storage.get<PetTeamsUiState>(PET_TEAMS_UI_STATE_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

export function saveCompareUiState(patch: Partial<CompareUiState>): void {
  const state = loadPetTeamsUiState();
  const nextCompare: CompareUiState = {
    ...(state.compare ?? {}),
    ...patch,
  };
  storage.set(PET_TEAMS_UI_STATE_KEY, {
    ...state,
    compare: nextCompare,
  });
}

export function saveCompareAbilityForPair(pairKey: string, abilityId: string): void {
  if (!pairKey) return;
  const state = loadPetTeamsUiState();
  const currentCompare = state.compare ?? {};
  const currentMap = currentCompare.abilityByPair ?? {};
  storage.set(PET_TEAMS_UI_STATE_KEY, {
    ...state,
    compare: {
      ...currentCompare,
      abilityByPair: {
        ...currentMap,
        [pairKey]: abilityId,
      },
    },
  });
}

export function getCompareAbilityForPair(pairKey: string): string | null {
  if (!pairKey) return null;
  const state = loadPetTeamsUiState();
  const ability = state.compare?.abilityByPair?.[pairKey];
  return typeof ability === 'string' ? ability : null;
}
