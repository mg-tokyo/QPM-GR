import type { GardenSnapshot } from './bridge';
import { isRecord } from '../../utils/typeGuards';

export interface WalkedSlot {
  /** `g:<dirtTileIdx>` or `b:<boardwalkTileIdx>`, the keys `setStatsHubTileOverride` takes. */
  tileKey: string;
  /** The game's `slotId`; the array position only when the slot has none (array order ≠ slotId). */
  slotId: number;
  startTime: number;
  species: string;
  mutations: string[];
  size: number | null;
}

const TILE_MAPS = [['tileObjects', 'g'], ['boardwalkTileObjects', 'b']] as const;

export function walkPlantSlots(snapshot: GardenSnapshot): WalkedSlot[] {
  if (!snapshot) return [];
  const out: WalkedSlot[] = [];
  for (const [field, prefix] of TILE_MAPS) {
    const tiles = snapshot[field];
    if (!isRecord(tiles)) continue;
    for (const [key, tile] of Object.entries(tiles)) {
      if (!isRecord(tile) || tile.objectType !== 'plant' || !Array.isArray(tile.slots)) continue;
      tile.slots.forEach((slot: unknown, position: number) => {
        if (!isRecord(slot) || typeof slot.species !== 'string' || typeof slot.startTime !== 'number') return;
        out.push({
          tileKey: `${prefix}:${key}`,
          slotId: typeof slot.slotId === 'number' ? slot.slotId : position,
          startTime: slot.startTime,
          species: slot.species,
          mutations: Array.isArray(slot.mutations)
            ? slot.mutations.filter((m: unknown): m is string => typeof m === 'string')
            : [],
          size: typeof slot.size === 'number' ? slot.size : null,
        });
      });
    }
  }
  return out;
}
