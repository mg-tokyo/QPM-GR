import { parseAtlasKey } from '../../../features/standalone/textureSwapper';
import { getCatalogs } from '../../../catalogs/gameCatalogs';

const FAMILY_SUFFIXES = [
  'TallPlant', 'Plant', 'Crop', 'Seed',
  'Active', 'Sideways', 'Backwards', 'Lit',
  'Baby', 'Sprout',
] as const;

const SUFFIX_LABEL_MAP: Record<string, string> = {
  Plant: ' (plant)',
  TallPlant: ' (tall plant)',
  Crop: ' (crop)',
  Active: ' (active)',
  Sideways: ' (rotated)',
  Backwards: ' (rotated)',
  Lit: ' (lit)',
  Baby: ' (baby)',
  Sprout: ' (sprout)',
};

export function stripFamilySuffix(id: string): { speciesRoot: string; suffix: string | null } {
  for (const sfx of FAMILY_SUFFIXES) {
    if (id.endsWith(sfx) && id.length > sfx.length) {
      return { speciesRoot: id.slice(0, id.length - sfx.length), suffix: sfx };
    }
  }
  return { speciesRoot: id, suffix: null };
}

function splitCamelCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function displaySpriteName(spriteKey: string): string {
  const { category, id } = parseAtlasKey(spriteKey);
  const { speciesRoot, suffix } = stripFamilySuffix(id);
  const catalogs = getCatalogs();

  let base: string | undefined;
  if (category === 'plant' || category === 'tallplant' || category === 'crop' || category === 'seed') {
    base = catalogs.plantCatalog?.[speciesRoot]?.name;
  } else if (category === 'pet') {
    base = catalogs.petCatalog?.[speciesRoot]?.name;
  } else if (category === 'item') {
    base = catalogs.itemCatalog?.[id]?.name;
  } else if (category === 'decor') {
    base = catalogs.decorCatalog?.[id]?.name;
  }

  const out = base ?? titleCase(splitCamelCase(speciesRoot));
  if (suffix && SUFFIX_LABEL_MAP[suffix]) return `${out}${SUFFIX_LABEL_MAP[suffix]}`;
  return out;
}
