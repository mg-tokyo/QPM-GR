// Garden tiles as fruit slots and the "can this fruit still take it" counting shared by the
// Stats Hub "Remaining" and the mutation ETA (ALR-5).

import type { GardenSnapshot } from './bridge';
import { lookupMaxScale } from '../../utils/game/plantScales';
import { normalizeSpeciesKey } from '../../utils/helpers';
import { resolveMutation } from '../../utils/game/cropMultipliers';
import { filterCompatibleMutations } from '../../utils/mutationCompatibility';

export interface SlotEntry {
  species: string;
  mutations: string[];
  endTime: number | null;
  fruitCount: number;
  /** In-garden targetScale (becomes scale at harvest). Defaults to 1 if absent. */
  targetScale: number;
  /** Species-specific maximum scale (from slot data, catalog lookup, or 2.0 fallback). */
  maxScale: number;
  /** Size percent 50–100, where 100 = max size (targetScale >= maxScale for this species). */
  sizePercent: number;
}

export interface TileEntry {
  tileKey: string;
  plantedAt: number | null;
  slots: SlotEntry[];
}

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

/** Total fruit count across slots */
export function tileFruitCount(tile: TileEntry): number {
  return tile.slots.reduce((s, slot) => s + slot.fruitCount, 0);
}

/**
 * Alias-aware comparison: 'Dawnbound' matches 'Dawncharged', 'Amberlit' matches 'Ambershine', etc.
 */
export function mutsMatch(a: string, b: string): boolean {
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const defA = resolveMutation(a);
  const defB = resolveMutation(b);
  return !!(defA && defB && defA.name === defB.name);
}

/**
 * Returns true if at least one slot in the tile can receive at least one of the selected mutations.
 * Used to determine whether a tile belongs in "Remaining" vs "Complete/N/A".
 */
export function isTileActionable(tile: TileEntry, selected: string[]): boolean {
  if (selected.length === 0) return false;
  return tile.slots.some((slot) => {
    const slotMissing = selected.filter((sel) => !slot.mutations.some((m) => mutsMatch(m, sel)));
    return filterCompatibleMutations(slot.mutations, slotMissing).length > 0;
  });
}

/**
 * Sum of fruitCount across all slots that can still receive at least one selected mutation.
 * For multi-harvest crops (e.g. Moonbinder with 3 pods), each actionable pod contributes its
 * fruitCount rather than the whole tile counting as 1.
 */
export function countActionableFruits(tiles: TileEntry[], selected: string[]): number {
  if (selected.length === 0) return tiles.reduce((s, t) => s + tileFruitCount(t), 0);
  let total = 0;
  for (const tile of tiles) {
    for (const slot of tile.slots) {
      const slotMissing = selected.filter((sel) => !slot.mutations.some((m) => mutsMatch(m, sel)));
      if (filterCompatibleMutations(slot.mutations, slotMissing).length > 0) {
        total += slot.fruitCount;
      }
    }
  }
  return total;
}

/** Fruitcount of slots that haven't yet reached max size. */
export function countMaxSizeRemainingFruits(tiles: TileEntry[]): number {
  return tiles.reduce(
    (s, t) => s + t.slots.reduce((ss, sl) => ss + (sl.sizePercent < 100 ? sl.fruitCount : 0), 0),
    0,
  );
}
