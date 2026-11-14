// src/ui/statsHubWindow/tileHelpers.ts
// Tile extraction and analysis utilities for the Garden tab.

import { getPlantSpecies } from '../../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../../utils/game/cropMultipliers';
import type { TileEntry } from './types';

export { extractTiles, tileFruitCount } from '../../../features/garden/gardenTiles';

/** Representative species for a tile (first slot's species) */
export function tileSpecies(tile: TileEntry): string {
  return tile.slots[0]?.species ?? 'Unknown';
}

/** Distinct species across all slots — rare variants (PurpleDaisy, SnowdropDouble, …)
 *  live in slot.species and differ from the representative/base species. */
export function tileAllSpecies(tile: TileEntry): string[] {
  const out = new Set<string>();
  for (const slot of tile.slots) out.add(slot.species);
  return Array.from(out);
}

/** Whether any slot on the tile grows one of the given species. */
export function tileHasAnySpecies(tile: TileEntry, species: ReadonlySet<string>): boolean {
  return tile.slots.some(slot => species.has(slot.species));
}

/** Base sell price for a species, or 0 when unknown. */
export function speciesBasePrice(species: string): number {
  try {
    const spec = getPlantSpecies(species);
    return typeof spec?.crop?.baseSellPrice === 'number' ? spec.crop.baseSellPrice : 0;
  } catch { return 0; }
}

/** Union of all mutations across all slots of a tile */
export function tileMutations(tile: TileEntry): string[] {
  const all = new Set<string>();
  for (const slot of tile.slots) {
    for (const m of slot.mutations) all.add(m);
  }
  return Array.from(all);
}

/** Current sell value of a tile — per-slot base price, so rare-variant slots
 *  (e.g. a PurpleDaisy in a Daisy patch) are priced as their own species. */
export function tileValue(tile: TileEntry): number {
  try {
    return tile.slots.reduce((sum, slot) => {
      const base = speciesBasePrice(slot.species);
      if (base <= 0) return sum;
      return sum + Math.round(base * slot.targetScale * computeMutationMultiplier(slot.mutations).totalMultiplier);
    }, 0);
  } catch { return 0; }
}

/**
 * Convert a list of TileEntry objects to global tile keys.
 * Used to drive the per-tile garden highlight override.
 */
export function tilesToKeys(tiles: TileEntry[]): string[] {
  return tiles.map(t => t.tileKey);
}
