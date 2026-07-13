import { getGardenSnapshot, getMapSnapshot } from '../bridge';
import { collectMutationKeys } from './mutationKeys';

/**
 * Extract all unique mutations from all slots in a tile
 * Mutations are stored per-slot in the slots array, not at the tile level
 */
export function getTileMutations(tileData: any): string[] {
  if (!tileData?.slots || !Array.isArray(tileData.slots)) {
    return [];
  }

  const allMutations = new Set<string>();

  for (const slot of tileData.slots) {
    collectMutationKeys(slot?.mutations, allMutations);
    collectMutationKeys(slot?.mutation, allMutations);
  }

  return Array.from(allMutations);
}

/**
 * Whether a tile matches any species in the filter set.
 * Checks the tile-level species AND every slot's species: rare variants
 * (FourLeafClover, PurpleDaisy, SnowdropDouble, VariegatedCattail) and
 * override slots (ThunderCelestialShroomPlant) live in slot.species while
 * tile.species stays the base plant — a tile-level check alone never matches them.
 */
export function tileMatchesSpecies(tileData: any, speciesKeysToShow: Set<string>): boolean {
  if (speciesKeysToShow.has(tileData?.species)) return true;
  const slots = tileData?.slots;
  if (!Array.isArray(slots)) return false;
  return slots.some((slot: any) => typeof slot?.species === 'string' && speciesKeysToShow.has(slot.species));
}

/**
 * Get growth state of a plant tile
 * Returns 'growing' if plant hasn't matured yet, 'mature' if it has
 */
export function getGrowthState(tileData: any): 'growing' | 'mature' | null {
  if (!tileData) return null;

  // Check if it's a plant (eggs don't have growth states in the same way)
  if (tileData.objectType !== 'plant') return null;

  const now = Date.now();
  const maturedAt = tileData.maturedAt;

  if (!maturedAt) return null;

  return now < maturedAt ? 'growing' : 'mature';
}

/**
 * Get garden tile data for PIXI coordinates using the map's coordinate system
 *
 * How it works:
 * 1. Convert PIXI coords (x, y) to globalIdx using formula: x + y * cols
 * 2. Use map.globalTileIdxToDirtTile[globalIdx] to get the local dirt tile index
 * 3. Access snapshot.tileObjects[localIdx] to get the actual tile data
 * 4. Same for boardwalk tiles
 */
export function getGardenTileData(x: number, y: number): any {
  const snapshot = getGardenSnapshot();
  const map = getMapSnapshot();

  if (!snapshot || !map) return null;

  // Convert PIXI coordinates to global tile index
  // CRITICAL: Formula is x + y * cols, NOT y * cols + x
  const globalIdx = x + y * map.cols;

  // Check dirt tiles (garden tiles)
  const dirtMapping = map.globalTileIdxToDirtTile?.[globalIdx];
  if (dirtMapping) {
    const localIdx = dirtMapping.dirtTileIdx;
    const tileData = snapshot.tileObjects?.[localIdx];
    if (tileData) return tileData;
  }

  // Check boardwalk tiles
  const boardwalkMapping = map.globalTileIdxToBoardwalk?.[globalIdx];
  if (boardwalkMapping) {
    const localIdx = boardwalkMapping.boardwalkTileIdx;
    const tileData = snapshot.boardwalkTileObjects?.[localIdx];
    if (tileData) return tileData;
  }

  return null;
}
