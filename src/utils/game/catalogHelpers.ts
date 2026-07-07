/** Catalog access wrappers with consistent fallbacks when catalogs aren't ready. */

import {
  getAllPlantSpecies,
  getAllPetSpecies,
  getAllMutations,
  getAllAbilities,
  getPlantSpecies,
  getPetSpecies,
  getMutation,
  getAbilityDef,
  areCatalogsReady,
  waitForCatalogs,
  getFloraBlueprint,
  getSlotOffsets,
  isMultiHarvest,
  getCropMaxScale,
  getCosmeticCatalog,
  getCosmeticsByType,
  getCosmeticByFilename,
  isCosmeticOwned,
  isCosmeticAvailable,
} from '../../catalogs/gameCatalogs';
import type { FloraBlueprint, SlotOffset } from '../../catalogs/gameCatalogs';
import type { CosmeticCatalogEntry } from '../../catalogs/types';

export { areCatalogsReady, waitForCatalogs };

export function getPlantSpeciesSafe(): string[] {
  return areCatalogsReady() ? getAllPlantSpecies() : [];
}

export function getPetSpeciesSafe(): string[] {
  return areCatalogsReady() ? getAllPetSpecies() : [];
}

export function getMutationsSafe(): string[] {
  return areCatalogsReady() ? getAllMutations() : [];
}

export function getAbilitiesSafe(): string[] {
  return areCatalogsReady() ? getAllAbilities() : [];
}

export function getPlantSafe(species: string) {
  return areCatalogsReady() ? getPlantSpecies(species) : null;
}

export function getPetSafe(species: string) {
  return areCatalogsReady() ? getPetSpecies(species) : null;
}

export function isValidPlantSpecies(species: string): boolean {
  return getPlantSpeciesSafe().includes(species);
}

export function isValidPetSpecies(species: string): boolean {
  return getPetSpeciesSafe().includes(species);
}

export function isValidMutation(mutationId: string): boolean {
  return getMutationsSafe().includes(mutationId);
}

export function isValidAbility(abilityId: string): boolean {
  return getAbilitiesSafe().includes(abilityId);
}

export function getAbilityName(abilityId: string): string {
  if (!areCatalogsReady()) return abilityId;
  const def = getAbilityDef(abilityId);
  return def?.name || abilityId;
}

export function getMutationName(mutationId: string): string {
  if (!areCatalogsReady()) return mutationId;
  const def = getMutation(mutationId);
  return def?.name || mutationId;
}

export function getFloraBlueprintSafe(species: string): FloraBlueprint | null {
  return areCatalogsReady() ? getFloraBlueprint(species) : null;
}

export function getSlotOffsetsSafe(species: string): ReadonlyArray<SlotOffset> | null {
  return areCatalogsReady() ? getSlotOffsets(species) : null;
}

export function isMultiHarvestSafe(species: string): boolean {
  return areCatalogsReady() ? isMultiHarvest(species) : false;
}

export function getCropMaxScaleSafe(species: string): number | null {
  return areCatalogsReady() ? getCropMaxScale(species) : null;
}

export function getCosmeticItemsSafe(slotType?: string): CosmeticCatalogEntry[] {
  if (!areCatalogsReady()) return [];
  return slotType ? getCosmeticsByType(slotType) : (getCosmeticCatalog() ?? []);
}

export function getCosmeticByFilenameSafe(filename: string): CosmeticCatalogEntry | undefined {
  if (!areCatalogsReady()) return undefined;
  return getCosmeticByFilename(filename);
}

export function isCosmeticOwnedSafe(filename: string): boolean | null {
  return isCosmeticOwned(filename);
}

export function isCosmeticAvailableSafe(filename: string, availability: string): boolean | null {
  return isCosmeticAvailable(filename, availability);
}
