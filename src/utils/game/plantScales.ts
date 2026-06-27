import { areCatalogsReady, getCropMaxScale, getAllPlantSpecies } from '../../catalogs/gameCatalogs';

export function lookupMaxScale(normalizedKey: string): number | null {
  if (!areCatalogsReady()) return null;
  const pascalKey = normalizedKey.charAt(0).toUpperCase() + normalizedKey.slice(1);
  return getCropMaxScale(pascalKey);
}

export function getKnownPlantKeys(): string[] {
  return getAllPlantSpecies().map(k => k.toLowerCase());
}
