// src/ui/statsHubWindow/tileHelpers.ts
// Tile extraction and analysis utilities for the Garden tab.

import type { GardenSnapshot } from '../../../features/garden/bridge';
import { getPlantSpecies } from '../../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../../utils/cropMultipliers';
import { lookupMaxScale } from '../../../utils/plantScales';
import { normalizeSpeciesKey } from '../../../utils/helpers';
import type { SlotEntry, TileEntry } from './types';

export function extractTiles(snapshot: GardenSnapshot): TileEntry[] {
  if (!snapshot) return [];
  const tiles: TileEntry[] = [];
  const collections: Array<[Record<string, unknown> | undefined, string]> = [
    [snapshot.tileObjects as Record<string, unknown> | undefined, 'g'],
    [snapshot.boardwalkTileObjects as Record<string, unknown> | undefined, 'b'],
  ];

  for (const [col, prefix] of collections) {
    if (!col || typeof col !== 'object') continue;
    for (const [tileKey, rawTile] of Object.entries(col)) {
      if (!rawTile || typeof rawTile !== 'object') continue;
      const tile = rawTile as Record<string, unknown>;
      if (tile.objectType !== 'plant') continue;

      const plantedAt = typeof tile.plantedAt === 'number' ? tile.plantedAt : null;
      const rawSlots = Array.isArray(tile.slots) ? tile.slots : [];
      const slots: SlotEntry[] = [];

      if (rawSlots.length === 0) {
        // Simple tile without slots array
        const species = typeof tile.species === 'string' ? tile.species : null;
        if (species) {
          const mutationsRaw = Array.isArray(tile.mutations) ? tile.mutations : [];
          const mutations = (mutationsRaw as unknown[]).filter((v): v is string => typeof v === 'string');
          const endTime = typeof tile.maturedAt === 'number' ? tile.maturedAt :
                         typeof tile.endTime === 'number' ? tile.endTime : null;
          slots.push({ species, mutations, endTime, fruitCount: 1, targetScale: 1, maxScale: 2.0, sizePercent: 50 });
        }
      } else {
        for (const rawSlot of rawSlots) {
          if (!rawSlot || typeof rawSlot !== 'object') continue;
          const slot = rawSlot as Record<string, unknown>;
          const species = typeof slot.species === 'string' ? slot.species : null;
          if (!species) continue;
          const rawSlotMuts = Array.isArray(slot.mutations) ? slot.mutations : [];
          const rawTileMuts = Array.isArray(tile.mutations) ? tile.mutations : [];
          const mutationsRaw = rawSlotMuts.length > 0 ? rawSlotMuts : rawTileMuts;
          const mutations = (mutationsRaw as unknown[]).filter((v): v is string => typeof v === 'string');
          const endTimeRaw = slot.endTime ?? slot.readyAt ?? slot.harvestReadyAt;
          const endTime = typeof endTimeRaw === 'number' ? endTimeRaw :
                         (endTimeRaw != null ? Number(endTimeRaw) : null);
          // Fruit count for multi-harvest
          const fruitKeys = ['fruitCount','remainingFruitCount','remainingFruits','totalFruitCount','totalFruits','totalFruit'];
          let fruitCount = 1;
          for (const k of fruitKeys) {
            const v = Number(slot[k]);
            if (Number.isFinite(v) && v >= 1) { fruitCount = Math.min(v, 64); break; }
          }
          const targetScaleRaw = typeof slot.targetScale === 'number' ? slot.targetScale : 1;
          const targetScale = targetScaleRaw > 0 ? targetScaleRaw : 1;
          // Resolve maxScale: slot field → catalog lookup → hardcoded fallback
          const slotMaxScaleRaw = slot.maxScale ?? slot.targetMaxScale ?? slot.maxTargetScale;
          const slotMaxScale = typeof slotMaxScaleRaw === 'number' && slotMaxScaleRaw > 1 ? slotMaxScaleRaw : null;
          const catalogMaxScale = slotMaxScale ?? lookupMaxScale(normalizeSpeciesKey(species));
          const maxScale = catalogMaxScale !== null ? catalogMaxScale : 2.0;
          const clamped = Math.min(Math.max(targetScale, 1), maxScale);
          const ratio = maxScale > 1 ? (clamped - 1) / (maxScale - 1) : 1;
          const sizePercent = 50 + ratio * 50;
          slots.push({ species, mutations, endTime, fruitCount, targetScale, maxScale, sizePercent });
        }
      }

      if (slots.length > 0) {
        tiles.push({ tileKey: `${prefix}:${tileKey}`, plantedAt, slots });
      }
    }
  }
  return tiles;
}

/** Representative species for a tile (first slot's species) */
export function tileSpecies(tile: TileEntry): string {
  return tile.slots[0]?.species ?? 'Unknown';
}

/** Union of all mutations across all slots of a tile */
export function tileMutations(tile: TileEntry): string[] {
  const all = new Set<string>();
  for (const slot of tile.slots) {
    for (const m of slot.mutations) all.add(m);
  }
  return Array.from(all);
}

/** Total fruit count across slots */
export function tileFruitCount(tile: TileEntry): number {
  return tile.slots.reduce((s, slot) => s + slot.fruitCount, 0);
}

/** Current sell value of a tile (all slots × base × multiplier) */
export function tileValue(tile: TileEntry): number {
  try {
    const plantSpec = getPlantSpecies(tileSpecies(tile));
    const base = typeof plantSpec?.crop?.baseSellPrice === 'number' ? plantSpec.crop.baseSellPrice : 0;
    if (base <= 0) return 0;
    return tile.slots.reduce((sum, slot) => {
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
