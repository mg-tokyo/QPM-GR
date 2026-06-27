import { parseAtlasKey } from '../../../features/standalone/textureSwapper';
import { getCatalogs } from '../../../catalogs/gameCatalogs';

export type SpriteListItem = { key: string; displayId: string };

const RARITY_ORDER: Record<string, number> = {
  Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4, Mythic: 5, Mythical: 5,
};

// Suffixes the family-root extractor strips iteratively. ORDER MATTERS:
// longer/compound suffixes must come FIRST so e.g. "PlatformTopmostLayer"
// is matched before its tail "TopmostLayer". Conservative list — only
// includes tokens that are never the tail of a real catalog species:
//   - Plant/Crop/TallPlant/Seed/Egg (life-stage/family)
//   - Active/Lit/Sideways/Backwards (states)
//   - Platform / *Layer (Celestial sub-pieces)
//   - Sprout/Baby (life-stage)
// "Tree" and "Fruit" are intentionally NOT in this list — PineTree,
// DragonFruit, PassionFruit are real catalog species names.
const FAMILY_SUFFIXES_LONGEST_FIRST = [
  'PlatformTopmostLayer',
  'PlatformBottomLayer',
  'TopmostLayer',
  'BottomLayer',
  'TallPlant',
  'Plant', 'Crop', 'Seed', 'Egg',
  'Active', 'Lit', 'Sideways', 'Backwards',
  'Platform',
  'Sprout', 'Baby',
] as const;

// Sort order for the OUTERMOST stripped suffix (i.e. the first one taken
// off the id when reducing toward the family root). 0 = base form sorts
// at the top of its family cluster.
const SUFFIX_ORDER: Record<string, number> = {
  '': 0,
  Seed: 1,
  Plant: 2,
  TallPlant: 3,
  Crop: 4,
  Active: 5,
  Lit: 6,
  Platform: 7,
  PlatformTopmostLayer: 8,
  PlatformBottomLayer: 9,
  TopmostLayer: 10,
  BottomLayer: 11,
  Sideways: 12,
  Backwards: 13,
  Sprout: 14,
  Baby: 15,
  Egg: 16,
};

/**
 * Iteratively peel known suffixes off an id to find the family root.
 * Returns the root plus the chain of suffixes stripped (outermost first).
 */
function getFamilyRoot(id: string): { root: string; suffixes: string[] } {
  const suffixes: string[] = [];
  let cur = id;
  for (let i = 0; i < 5; i++) {
    let matched: string | null = null;
    for (const sfx of FAMILY_SUFFIXES_LONGEST_FIRST) {
      if (cur.endsWith(sfx) && cur.length > sfx.length) {
        matched = sfx;
        break;
      }
    }
    if (!matched) break;
    suffixes.push(matched);
    cur = cur.slice(0, cur.length - matched.length);
  }
  return { root: cur, suffixes };
}

function plantSpeciesOf(item: SpriteListItem): string {
  const { id } = parseAtlasKey(item.key);
  return getFamilyRoot(id).root;
}

function variantOrder(item: SpriteListItem): number {
  const { id } = parseAtlasKey(item.key);
  const { suffixes } = getFamilyRoot(id);
  if (suffixes.length === 0) return SUFFIX_ORDER[''] ?? 0;
  const outermost = suffixes[0]!;
  return SUFFIX_ORDER[outermost] ?? 99;
}

function plantRarity(species: string): number {
  const entry = getCatalogs().plantCatalog?.[species];
  const r = (entry?.crop?.rarity ?? entry?.plant?.rarity ?? 'Common') as string;
  return RARITY_ORDER[r] ?? RARITY_ORDER['Common']!;
}

function plantCropPrice(species: string): number {
  const entry = getCatalogs().plantCatalog?.[species];
  const p = entry?.crop?.baseSellPrice;
  return typeof p === 'number' && Number.isFinite(p) ? p : Number.POSITIVE_INFINITY;
}

let petToEgg: Map<string, string> | null = null;
function ensurePetEggMap(): Map<string, string> {
  if (petToEgg) return petToEgg;
  const map = new Map<string, string>();
  const eggCatalog = getCatalogs().eggCatalog;
  if (!eggCatalog) return map;
  for (const [eggId, entry] of Object.entries(eggCatalog)) {
    const weights = (entry as { faunaSpawnWeights?: unknown }).faunaSpawnWeights;
    if (!weights) continue;
    const pairs: Array<[string, number]> = [];
    if (Array.isArray(weights)) {
      for (const w of weights) {
        if (w && typeof w === 'object' && typeof (w as { species?: unknown }).species === 'string') {
          const sp = (w as { species: string }).species;
          const wt = typeof (w as { weight?: unknown }).weight === 'number' ? (w as { weight: number }).weight : 0;
          pairs.push([sp, wt]);
        }
      }
    } else if (typeof weights === 'object') {
      for (const [sp, wt] of Object.entries(weights as Record<string, unknown>)) {
        pairs.push([sp, typeof wt === 'number' ? wt : 0]);
      }
    }
    pairs.sort((a, b) => b[1] - a[1]);
    for (const [sp] of pairs) {
      if (!map.has(sp)) map.set(sp, eggId);
    }
  }
  petToEgg = map;
  return map;
}

function eggPrice(eggId: string | undefined): number {
  if (!eggId) return Number.POSITIVE_INFINITY;
  const entry = getCatalogs().eggCatalog?.[eggId] as { coinPrice?: number; creditPrice?: number; magicDustPrice?: number } | undefined;
  if (!entry) return Number.POSITIVE_INFINITY;
  if (typeof entry.coinPrice === 'number' && Number.isFinite(entry.coinPrice)) return entry.coinPrice;
  if (typeof entry.creditPrice === 'number' && Number.isFinite(entry.creditPrice)) return entry.creditPrice;
  if (typeof entry.magicDustPrice === 'number' && Number.isFinite(entry.magicDustPrice)) return entry.magicDustPrice;
  return Number.POSITIVE_INFINITY;
}

function decorPrice(id: string): number {
  const entry = getCatalogs().decorCatalog?.[id] as { price?: number; coinPrice?: number } | undefined;
  const p = entry?.coinPrice ?? entry?.price;
  return typeof p === 'number' && Number.isFinite(p) ? p : Number.POSITIVE_INFINITY;
}

export function sortSpriteList(
  category: 'plants-merged' | 'pets' | 'seeds' | 'items' | 'decor',
  items: SpriteListItem[],
): SpriteListItem[] {
  const copy = items.slice();
  switch (category) {
    case 'plants-merged':
    case 'seeds': {
      copy.sort((a, b) => {
        const sa = plantSpeciesOf(a);
        const sb = plantSpeciesOf(b);
        const ra = plantRarity(sa);
        const rb = plantRarity(sb);
        if (ra !== rb) return ra - rb;
        const pa = plantCropPrice(sa);
        const pb = plantCropPrice(sb);
        if (pa !== pb) return pa - pb;
        if (sa !== sb) return sa.localeCompare(sb);
        return variantOrder(a) - variantOrder(b);
      });
      return copy;
    }
    case 'pets': {
      const map = ensurePetEggMap();
      copy.sort((a, b) => {
        const { id: ida } = parseAtlasKey(a.key);
        const { id: idb } = parseAtlasKey(b.key);
        const ea = map.get(ida);
        const eb = map.get(idb);
        const pa = eggPrice(ea);
        const pb = eggPrice(eb);
        if (pa !== pb) return pa - pb;
        return ida.localeCompare(idb);
      });
      return copy;
    }
    case 'decor': {
      copy.sort((a, b) => {
        const { id: ida } = parseAtlasKey(a.key);
        const { id: idb } = parseAtlasKey(b.key);
        const pa = decorPrice(ida);
        const pb = decorPrice(idb);
        if (pa !== pb) return pa - pb;
        return ida.localeCompare(idb);
      });
      return copy;
    }
    case 'items':
    default:
      return copy;
  }
}
