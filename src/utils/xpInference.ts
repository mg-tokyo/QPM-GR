import { getPetCatalog, areCatalogsReady } from '../catalogs/gameCatalogs';

/**
 * Calculate XP per level for a pet species from catalog's hoursToMature
 * Formula: Active pets get 3600 XP/hour
 * Total XP = 3600 × hoursToMature
 * XP per level = Total XP / 30
 */
export function inferXpPerLevel(species: string): number | null {
  if (!areCatalogsReady()) return null;

  const petCatalog = getPetCatalog();
  if (!petCatalog) return null;

  const petEntry = petCatalog[species];
  if (!petEntry) return null;

  const hoursToMature = petEntry.hoursToMature;
  if (typeof hoursToMature !== 'number' || hoursToMature <= 0) {
    return null;
  }

  const totalXp = 3600 * hoursToMature;
  const xpPerLevel = totalXp / 30;

  return Math.floor(xpPerLevel);
}

export function getAllPetXpEstimates(): Record<string, number> {
  const estimates: Record<string, number> = {};

  if (!areCatalogsReady()) return estimates;

  const petCatalog = getPetCatalog();
  if (!petCatalog) return estimates;

  for (const species of Object.keys(petCatalog)) {
    const xp = inferXpPerLevel(species);
    if (xp !== null) {
      estimates[species] = xp;
    }
  }

  return estimates;
}
