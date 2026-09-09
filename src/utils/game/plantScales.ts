import { areCatalogsReady, getCropMaxScale, getAllPlantSpecies } from '../../catalogs/gameCatalogs';

export function lookupMaxScale(normalizedKey: string): number | null {
  if (!areCatalogsReady()) return null;
  const pascalKey = normalizedKey.charAt(0).toUpperCase() + normalizedKey.slice(1);
  return getCropMaxScale(pascalKey);
}

export function getKnownPlantKeys(): string[] {
  return getAllPlantSpecies().map(k => k.toLowerCase());
}

// v1118 slots carry `size` (integer 50-100) directly; pre-v1118 slots carry
// targetScale + maxScale. Read whichever is present; fall back to the ratio
// math so legacy captures still work.
export function getCropSizePercent(slot: unknown): number {
  if (!slot || typeof slot !== 'object') return 50;
  const s = slot as Record<string, unknown>;
  const sizeVal = s.size;
  if (typeof sizeVal === 'number' && Number.isFinite(sizeVal)) {
    return Math.max(50, Math.min(100, sizeVal));
  }
  const currentScale = toFinite(s.targetScale) ?? toFinite(s.scale) ?? toFinite(s.plantScale) ?? 1.0;
  const explicitMax = toFinite(s.maxScale) ?? toFinite(s.targetMaxScale);
  const speciesKey = typeof s.species === 'string' ? s.species.toLowerCase() : '';
  const maxScale = explicitMax ?? lookupMaxScale(speciesKey) ?? 2.0;
  const denom = Math.max(0.0001, maxScale - 1.0);
  const ratio = (currentScale - 1.0) / denom;
  return Math.max(50, Math.min(100, 50 + ratio * 50));
}

function toFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
