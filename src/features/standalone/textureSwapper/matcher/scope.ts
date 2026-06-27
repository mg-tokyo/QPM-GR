import { getActivePetInfos } from '../../../../store/pets';
import { lookupPetIdForRive } from '../petSlotRegistry';
import { log } from '../types';

interface AncestorHost {
  label?: string;
  name?: string;
  parent?: unknown;
}

// Regex for "Tile (x, y)" labels set by TileObjectContainerView
const TILE_LABEL_RE = /^Tile\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/;

// Regex for "Species slot-N" labels set by GrowingCropVisual
const SPECIES_SLOT_LABEL_RE = /^(\S+)\s+slot-(\d+)$/;

// Regex for "Pet: SpeciesName (uuid)" labels — PetView RiveSprite (beta confirmed)
const PET_LABEL_WITH_ID_RE = /^Pet:\s*(\S+)\s+\(([^)]+)\)$/;
// Regex for "Pet: SpeciesName" labels — PetVisual / PetView container (beta confirmed)
const PET_LABEL_RE = /^Pet:\s*(\S+)$/;

/**
 * Walk the sprite's parent chain looking for a container whose label matches
 * the game's tile label format `"Tile (x, y)"`. Returns `"x,y"` as the tile
 * key or null if no tile ancestor is found.
 */
export function extractTileKeyFromSprite(
  sprite: unknown,
  memo: WeakMap<object, string | null>,
  maxDepth = 18,
): string | null {
  if (!sprite || typeof sprite !== 'object') return null;
  const cached = memo.get(sprite);
  if (cached !== undefined) return cached;

  let cur: unknown = sprite;
  let depth = 0;
  let found: string | null = null;
  while (cur && typeof cur === 'object' && depth <= maxDepth) {
    const host = cur as AncestorHost;
    if (typeof host.label === 'string') {
      const m = TILE_LABEL_RE.exec(host.label);
      if (m) {
        found = `${m[1]},${m[2]}`;
        break;
      }
    }
    cur = host.parent;
    depth++;
  }

  memo.set(sprite, found);
  return found;
}

/**
 * Resolve which active pet slot (0, 1, 2) a sprite belongs to.
 * Tries multiple strategies:
 * 1. Rive registry (WeakMap populated during Rive patching)
 * 2. Ancestor label matching — pet species from active pets matched against
 *    ancestor labels (game labels like "PetName" or "Species slot-N")
 */
export function resolveSlotIndexForPetSprite(
  sprite: unknown,
  memo: WeakMap<object, 0 | 1 | 2 | null>,
): 0 | 1 | 2 | null {
  if (!sprite || typeof sprite !== 'object') return null;
  const cached = memo.get(sprite);
  if (cached !== undefined) return cached;

  const active = getActivePetInfos();

  // Path 1: Rive registry
  const riveId = lookupPetIdForRive(sprite);
  if (riveId) {
    const idx = active.findIndex((p) => p.petId === riveId);
    if (idx === 0 || idx === 1 || idx === 2) {
      memo.set(sprite, idx as 0 | 1 | 2);
      return idx as 0 | 1 | 2;
    }
  }

  // Path 2: Walk ancestors for pet labels.
  // Confirmed format (beta source PetVisual.ts / PetView.ts):
  //   "Pet: SpeciesName (uuid)" — RiveSprite variant, has petId for disambiguation
  //   "Pet: SpeciesName"        — Container variant
  const speciesSet = new Map<string, 0 | 1 | 2>();
  const petIdSet = new Map<string, 0 | 1 | 2>();
  for (let i = 0; i < active.length && i < 3; i++) {
    const pet = active[i];
    if (pet?.species) {
      speciesSet.set(pet.species.toLowerCase(), i as 0 | 1 | 2);
    }
    if (pet?.petId) {
      petIdSet.set(pet.petId, i as 0 | 1 | 2);
    }
  }

  if (speciesSet.size > 0) {
    let cur2: unknown = sprite;
    let d = 0;
    while (cur2 && typeof cur2 === 'object' && d <= 18) {
      const host = cur2 as AncestorHost;
      const label = host.label ?? '';
      if (typeof label === 'string' && label) {
        // "Pet: Species (uuid)" — most precise, disambiguates duplicate species
        const idMatch = PET_LABEL_WITH_ID_RE.exec(label);
        if (idMatch) {
          const byId = petIdSet.get(idMatch[2]!);
          if (byId !== undefined) {
            memo.set(sprite, byId);
            return byId;
          }
          const bySpecies = speciesSet.get(idMatch[1]!.toLowerCase());
          if (bySpecies !== undefined) {
            memo.set(sprite, bySpecies);
            return bySpecies;
          }
        }
        // "Pet: Species" — container label without uuid
        const petMatch = PET_LABEL_RE.exec(label);
        if (petMatch) {
          const idx = speciesSet.get(petMatch[1]!.toLowerCase());
          if (idx !== undefined) {
            memo.set(sprite, idx);
            return idx;
          }
        }
        // Exact species name as label (e.g. "MarbleKnight")
        const exactMatch = speciesSet.get(label.toLowerCase());
        if (exactMatch !== undefined) {
          memo.set(sprite, exactMatch);
          return exactMatch;
        }
      }
      cur2 = host.parent;
      d++;
    }
  }

  memo.set(sprite, null);
  return null;
}
