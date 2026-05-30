// src/data/petTimeToMature.ts
// Time-to-mature helpers — reads from the live petCatalog.
// All values come from the game's runtime data; no hardcoded species lists.

import { getPetHoursToMature, areCatalogsReady } from '../../../catalogs/gameCatalogs';

/**
 * Get time to mature for a pet species in hours.
 * Returns null if the catalog is not yet loaded or the species is unknown.
 */
export function getTimeToMature(species: string | null): number | null {
  if (!species || !areCatalogsReady()) return null;
  return getPetHoursToMature(species);
}

/**
 * Get time to mature for a pet species in seconds.
 */
export function getTimeToMatureSeconds(species: string | null): number | null {
  const hours = getTimeToMature(species);
  return hours != null ? hours * 3600 : null;
}
