// src/features/chargedAbilities/footprintScan.ts
// Resolve crop slots inside the player's 3×3 footprint and find the best 3×3
// patch in the garden for a given ability. Uses the canonical position →
// global tile idx → dirt/boardwalk → tileObjects lookup (mirrors
// src/features/garden/filters.ts:341-368).

import { getGardenSnapshot, getMapSnapshot } from '../garden/bridge';
import { getTilesInChebyshevRadius, type TilePosition } from '../garden/tileRadius';
import { readAtomValueSync } from '../../core/atomRegistry';
import type { AbilityProjection, PlantSlotMinimal, ProjectedGain } from './abilities/types';

interface FootprintResult {
  slots: PlantSlotMinimal[];
  totalGain: ProjectedGain;
}

interface PatchCandidate extends FootprintResult {
  center: TilePosition;
}

function readSlot(raw: unknown): PlantSlotMinimal | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const species = typeof s.species === 'string' ? s.species : null;
  if (!species) return null;
  const mutations = Array.isArray(s.mutations)
    ? s.mutations.filter((m): m is string => typeof m === 'string')
    : [];
  const targetScale = typeof s.targetScale === 'number' ? s.targetScale : 1;
  const endTime = typeof s.endTime === 'number' ? s.endTime : 0;
  return { species, mutations, targetScale, endTime };
}

function slotsFromTile(tileRaw: unknown): PlantSlotMinimal[] {
  if (!tileRaw || typeof tileRaw !== 'object') return [];
  const tile = tileRaw as Record<string, unknown>;
  if (tile.objectType !== 'plant') return [];
  const slots = tile.slots;
  if (!Array.isArray(slots)) return [];
  const out: PlantSlotMinimal[] = [];
  for (const raw of slots) {
    const slot = readSlot(raw);
    if (slot) out.push(slot);
  }
  return out;
}

function tileAt(x: number, y: number): PlantSlotMinimal[] {
  const garden = getGardenSnapshot();
  const map = getMapSnapshot();
  if (!garden || !map || typeof map.cols !== 'number' || typeof map.rows !== 'number') return [];
  if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return [];

  const globalIdx = x + y * map.cols;
  const dirtMapping = map.globalTileIdxToDirtTile?.[globalIdx];
  const boardwalkMapping = map.globalTileIdxToBoardwalk?.[globalIdx];

  const out: PlantSlotMinimal[] = [];

  if (dirtMapping?.dirtTileIdx != null && garden.tileObjects) {
    const tile = garden.tileObjects[String(dirtMapping.dirtTileIdx)];
    out.push(...slotsFromTile(tile));
  }
  if (boardwalkMapping?.boardwalkTileIdx != null && garden.boardwalkTileObjects) {
    const tile = garden.boardwalkTileObjects[String(boardwalkMapping.boardwalkTileIdx)];
    out.push(...slotsFromTile(tile));
  }

  return out;
}

export function getQualifyingCropsInFootprint(
  playerPos: TilePosition,
  radius: number,
  ability: AbilityProjection,
): FootprintResult {
  const tiles = getTilesInChebyshevRadius(playerPos, radius);
  const slots: PlantSlotMinimal[] = [];
  let coin = 0;
  let capsule = 0;
  for (const t of tiles) {
    for (const slot of tileAt(t.x, t.y)) {
      if (!ability.applies(slot)) continue;
      slots.push(slot);
      const gain = ability.projectGain(slot);
      coin += gain.coin;
      capsule += gain.capsule;
    }
  }
  return { slots, totalGain: { coin, capsule } };
}

/**
 * Walk every plant in the garden once and total qualifying slots + projected
 * gain for a single ability. Iterates `tileObjects` entries directly rather
 * than (x, y) coordinates so multi-tile plants (e.g. clover patches that
 * occupy several grid cells but share a single tileObject) are only counted
 * once.
 */
export function scanGardenForAbility(ability: AbilityProjection): FootprintResult {
  const garden = getGardenSnapshot();
  const slots: PlantSlotMinimal[] = [];
  let coin = 0;
  let capsule = 0;
  if (!garden) return { slots, totalGain: { coin, capsule } };

  const visit = (tileMap: unknown): void => {
    if (!tileMap || typeof tileMap !== 'object') return;
    for (const tileRaw of Object.values(tileMap as Record<string, unknown>)) {
      for (const slot of slotsFromTile(tileRaw)) {
        if (!ability.applies(slot)) continue;
        slots.push(slot);
        const gain = ability.projectGain(slot);
        coin += gain.coin;
        capsule += gain.capsule;
      }
    }
  };

  visit((garden as { tileObjects?: unknown }).tileObjects);
  visit((garden as { boardwalkTileObjects?: unknown }).boardwalkTileObjects);

  return { slots, totalGain: { coin, capsule } };
}

export function findBestPatchForAbility(
  ability: AbilityProjection,
  radius: number,
): PatchCandidate | null {
  const map = getMapSnapshot();
  if (!map || typeof map.cols !== 'number' || typeof map.rows !== 'number') return null;

  // Hard gate on the player's own garden slot. Every tile in
  // `globalTileIdxToDirtTile`/Boardwalk carries `userSlotIdx`; only ours
  // belong to OUR garden. Without this constraint the search can pick a
  // centre in another player's plot ("go 22 tiles NE" pointing outside the
  // navigable area). If `myUserSlotIdx` hasn't resolved yet we return null
  // so callers hide the direction/optimality UI rather than show wrong data.
  const mySlot = readAtomValueSync('myUserSlotIdx');
  if (mySlot == null) return null;

  let best: PatchCandidate | null = null;
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const globalIdx = x + y * map.cols;
      const dirt = map.globalTileIdxToDirtTile?.[globalIdx];
      const boardwalk = map.globalTileIdxToBoardwalk?.[globalIdx];
      if (dirt?.userSlotIdx !== mySlot && boardwalk?.userSlotIdx !== mySlot) continue;

      const res = getQualifyingCropsInFootprint({ x, y }, radius, ability);
      const score = ability.yieldKind === 'coin' ? res.totalGain.coin : res.totalGain.capsule;
      const bestScore = best
        ? (ability.yieldKind === 'coin' ? best.totalGain.coin : best.totalGain.capsule)
        : -1;
      if (score > bestScore) {
        best = { center: { x, y }, slots: res.slots, totalGain: res.totalGain };
      }
    }
  }
  return best;
}
