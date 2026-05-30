// src/ui/petPickerModal/abilityFilter.ts
// Ability filter logic for the pet picker modal.

import { captureProgressionStage, getOptimizerAbilityFamilyInfo, type ComparePetInput } from '../../../features/pets/compare';
import type { CompareStage } from '../../../features/pets/data/petCompareRules';
import type { PooledPet } from '../../../types/petTeams';
import type { AbilityFilterMode, GroupedAbilityOption } from './types';
import { getAbilityCanonicalId, getAbilityDisplayName, stripTierSuffix } from './helpers';

// ---------------------------------------------------------------------------
// Ability filter value builders
// ---------------------------------------------------------------------------

function buildAbilityFilterSelectionValue(
  abilityId: string,
  displayName: string,
  mode: AbilityFilterMode = 'picker',
): { value: string; label: string } {
  const info = getOptimizerAbilityFamilyInfo(abilityId, displayName);
  const fallbackKey = abilityId
    .replace(/_NEW$/i, '')
    .replace(/(?:I{1,3}|IV)$/i, '')
    .trim()
    .toLowerCase();
  const familyKey = (info?.exactFamilyKey ?? fallbackKey ?? abilityId.toLowerCase()).trim().toLowerCase();
  const familyLabel = (info?.exactFamilyLabel ?? stripTierSuffix(displayName) ?? displayName ?? abilityId).trim();

  return {
    value: mode === 'compare' ? familyKey : `family:${familyKey}`,
    label: familyLabel || abilityId,
  };
}

export function resolveSavedAbilityFilter(
  rawValue: string | null | undefined,
  selectionMap: Map<string, Set<string>>,
  mode: AbilityFilterMode = 'picker',
): string {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) return 'all';
  if (selectionMap.has(value)) return value;

  const canonicalId = getAbilityCanonicalId(value);
  if (!canonicalId) return 'all';
  const displayName = getAbilityDisplayName(value);
  const family = buildAbilityFilterSelectionValue(canonicalId, displayName, mode);
  return selectionMap.has(family.value) ? family.value : 'all';
}

export function petMatchesAbilityFilter(
  pet: PooledPet,
  selectedValue: string,
  selectionMap: Map<string, Set<string>>,
): boolean {
  if (selectedValue === 'all') return true;
  const allowedIds = selectionMap.get(selectedValue);
  if (!allowedIds || allowedIds.size === 0) return false;

  return pet.abilities.some((abilityId) => {
    const canonicalId = getAbilityCanonicalId(abilityId);
    return canonicalId.length > 0 && allowedIds.has(canonicalId);
  });
}

export function buildAbilityFilterOptions(
  pets: PooledPet[],
  sel: HTMLSelectElement,
  selectionMap: Map<string, Set<string>>,
): void {
  selectionMap.clear();
  const abilityIds = pets.flatMap((pet) => pet.abilities);
  const grouped = buildGroupedAbilityGroups(abilityIds, 'picker');

  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'All Abilities';
  sel.appendChild(allOpt);

  for (const group of grouped) {
    selectionMap.set(group.value, group.abilityIds);
    const opt = document.createElement('option');
    opt.value = group.value;
    opt.textContent = group.label;
    sel.appendChild(opt);
  }
}

export function buildGroupedAbilityGroups(
  abilityIds: string[],
  mode: AbilityFilterMode,
): GroupedAbilityOption[] {
  const grouped = new Map<string, GroupedAbilityOption>();

  for (const rawAbilityId of abilityIds) {
    const canonicalId = getAbilityCanonicalId(rawAbilityId);
    if (!canonicalId) continue;

    const displayName = getAbilityDisplayName(rawAbilityId);
    const family = buildAbilityFilterSelectionValue(canonicalId, displayName, mode);
    const existing = grouped.get(family.value);
    if (existing) {
      existing.abilityIds.add(canonicalId);
      continue;
    }

    grouped.set(family.value, {
      value: family.value,
      label: family.label,
      abilityIds: new Set<string>([canonicalId]),
    });
  }

  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Compare stage helpers
// ---------------------------------------------------------------------------

function toCompareInput(pet: PooledPet): ComparePetInput {
  return {
    id: pet.id,
    species: pet.species,
    strength: pet.strength,
    targetScale: pet.targetScale,
    abilities: pet.abilities,
    mutations: pet.mutations,
  };
}

export function derivePickerCompareStage(pets: PooledPet[]): CompareStage {
  const stage = captureProgressionStage(pets.map((pet) => toCompareInput(pet)));
  return stage.stage;
}

// ---------------------------------------------------------------------------
// Species helpers
// ---------------------------------------------------------------------------

export function getUniqueSpecies(pets: PooledPet[]): string[] {
  const species = new Set<string>();
  for (const pet of pets) {
    if (pet.species) species.add(pet.species);
  }
  return [...species].sort((a, b) => a.localeCompare(b));
}
