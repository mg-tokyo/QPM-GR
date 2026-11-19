/** Catalog access wrappers with consistent fallbacks when catalogs aren't ready. */

import {
  getAllPlantSpecies,
  getAllPetSpecies,
  getAllMutations,
  getAllAbilities,
  getPlantSpecies,
  getPetSpecies,
  getEggType,
  getItem,
  getMutation,
  getAbilityDef,
  areCatalogsReady,
  onCatalogsReady,
  waitForCatalogs,
  arePetAbilitiesCaptured,
  onPetAbilitiesCaptured,
  waitForPetAbilities,
  getFloraBlueprint,
  getSlotOffsets,
  isMultiHarvest,
  getCropMaxScale,
  getPetMaxScale,
  getCosmeticCatalog,
  getCosmeticsByType,
  getCosmeticByFilename,
  isCosmeticOwned,
  isCosmeticAvailable,
  getWeatherDef,
  getAllWeatherIds,
} from '../../catalogs/gameCatalogs';
import type { FloraBlueprint, SlotOffset } from '../../catalogs/gameCatalogs';
import type { CosmeticCatalogEntry } from '../../catalogs/types';
import { getPetRarity, getPetRarityRank } from '../../features/pets/data/petRarity';
import type { PetRarity } from '../../features/pets/data/petRarity';

export { areCatalogsReady, onCatalogsReady, waitForCatalogs, arePetAbilitiesCaptured, onPetAbilitiesCaptured, waitForPetAbilities };

export function getPetRaritySafe(species: string | null | undefined): PetRarity | null {
  try { return getPetRarity(species); } catch { return null; }
}

export function getPetRarityRankSafe(species: string | null | undefined): number {
  try { return getPetRarityRank(species); } catch { return 0; }
}

export function getEggSafe(eggId: string) {
  return areCatalogsReady() ? getEggType(eggId) : null;
}

export function getItemSafe(itemId: string) {
  return areCatalogsReady() ? getItem(itemId) : null;
}

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

export function getPetMaxScaleSafe(species: string): number | null {
  return areCatalogsReady() ? getPetMaxScale(species) : null;
}

export function getAbilityDescriptionSafe(abilityId: string): string | null {
  if (!areCatalogsReady()) return null;
  const desc = getAbilityDef(abilityId)?.description;
  return typeof desc === 'string' && desc.trim() ? desc : null;
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

/** The game's exclusivity family (e.g. "Hydro", "Lunar", "Growth"); null when unknown. */
export function getMutationGroupSafe(mutationId: string): string | null {
  if (!areCatalogsReady()) return null;
  const group = getMutation(mutationId)?.group;
  return typeof group === 'string' && group.length > 0 ? group : null;
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

export interface WeatherDefSafe {
  id: string;
  name: string;
  groupId: string | null;   // e.g., "Hydro", "Lunar"
  spriteKey: string | null;
  mutation: string | null;  // mutator.mutation, e.g. "Wet"; null for clear sky
}

/** The weather catalog loads apart from the main catalogs; null until it has this id. */
export function getWeatherDefSafe(weatherId: string): WeatherDefSafe | null {
  const def = getWeatherDef(weatherId);
  if (!def) return null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  const mutator = def.mutator && typeof def.mutator === 'object' ? (def.mutator as Record<string, unknown>) : null;
  return {
    id: weatherId, name: str(def.name) ?? weatherId, groupId: str(def.groupId),
    spriteKey: str(def.spriteId) ?? str(def.iconSpriteKey), mutation: str(mutator?.mutation),
  };
}

export function getAllWeatherDefsSafe(): WeatherDefSafe[] {
  return getAllWeatherIds()
    .map(getWeatherDefSafe)
    .filter((def): def is WeatherDefSafe => def !== null);
}

/** Every catalog weather in a group (e.g. both Lunar events), catalog order. */
export function getWeatherDefsInGroupSafe(groupId: string): WeatherDefSafe[] {
  return getAllWeatherDefsSafe().filter((def) => def.groupId === groupId);
}
