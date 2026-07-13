import { log } from '../../../utils/logger';
import { storage } from '../../../utils/storage';
import type { ActivePetInfo } from '../../../store/pets';
import { MANUAL_OVERRIDES_STORAGE_KEY } from './constants';
import { recalculateTimerState } from './recompute';
import type { ManualOverridesStorage, PetManualOverride } from './types';

let manualOverrides: ManualOverridesStorage = {};

export function loadManualOverrides(): void {
  try {
    const stored = storage.get<ManualOverridesStorage | null>(MANUAL_OVERRIDES_STORAGE_KEY, null);
    if (stored && typeof stored === 'object') {
      manualOverrides = stored;
    }
  } catch (error) {
    log('⚠️ Failed to load manual pet overrides', error);
  }
}

function saveManualOverrides(): void {
  try {
    storage.set(MANUAL_OVERRIDES_STORAGE_KEY, manualOverrides);
  } catch (error) {
    log('⚠️ Failed to save manual pet overrides', error);
  }
}

function getPetKey(pet: ActivePetInfo): string {
  if (pet.petId) return `pet:${pet.petId}`;
  if (pet.species) return `${pet.species}:${pet.slotIndex}`;
  return `slot:${pet.slotIndex}`;
}

export function getManualOverride(pet: ActivePetInfo): PetManualOverride | null {
  const key = getPetKey(pet);
  return manualOverrides[key] ?? null;
}

export function setManualOverride(pet: ActivePetInfo, override: PetManualOverride): void {
  const key = getPetKey(pet);
  if (!manualOverrides[key]) {
    manualOverrides[key] = {};
  }
  Object.assign(manualOverrides[key]!, override);
  saveManualOverrides();
  recalculateTimerState();
}

export function clearManualOverride(pet: ActivePetInfo, field?: 'xp' | 'targetScale' | 'strength'): void {
  const key = getPetKey(pet);
  if (!manualOverrides[key]) return;

  if (field) {
    delete manualOverrides[key]![field];
    if (Object.keys(manualOverrides[key]!).length === 0) {
      delete manualOverrides[key];
    }
  } else {
    delete manualOverrides[key];
  }

  saveManualOverrides();
  recalculateTimerState();
}
