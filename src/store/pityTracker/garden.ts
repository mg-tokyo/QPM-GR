// Growth-mutation origin per garden slot. A natural (or forced) Gold/Rainbow is on the
// slot from the moment it spawns; anything that appears on an existing slot later was
// granted (pet ability, potion) and sits outside Bad Luck Protection.

import { GROWTH_PITY_THRESHOLDS } from '../../catalogs/pityThresholds';

export type SlotOrigin = 'natural' | 'granted' | 'none' | 'unknown';

export interface SlotRecord {
  species: string;
  startTime: number;
  mutation: string | null;
  origin: SlotOrigin;
}

/** `${tile}:${slotId}` → record */
export type SlotMap = Record<string, SlotRecord>;

export interface LiveSlot {
  species: string;
  startTime: number;
  mutation: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Rarest growth mutation present (Rainbow outranks Gold on the shared roll). */
export function growthMutationOf(mutations: unknown): string | null {
  if (!Array.isArray(mutations)) return null;
  const present = new Set(mutations.filter((m): m is string => typeof m === 'string'));
  const byRarity = Object.keys(GROWTH_PITY_THRESHOLDS)
    .sort((a, b) => (GROWTH_PITY_THRESHOLDS[b] ?? 0) - (GROWTH_PITY_THRESHOLDS[a] ?? 0));
  for (const id of byRarity) {
    if (present.has(id)) return id;
  }
  return null;
}

export function readGardenSlots(myData: Record<string, unknown>): Map<string, LiveSlot> {
  const out = new Map<string, LiveSlot>();
  const garden = asRecord(myData.garden);
  const tiles = garden?.tileObjects;
  if (!tiles || typeof tiles !== 'object') return out;
  const entries: Array<[string, unknown]> = Array.isArray(tiles)
    ? tiles.map((tile, idx) => [String(idx), tile] as [string, unknown])
    : Object.entries(tiles as Record<string, unknown>);
  for (const [tileKey, rawTile] of entries) {
    const tile = asRecord(rawTile);
    if (!tile || !Array.isArray(tile.slots)) continue;
    tile.slots.forEach((rawSlot, idx) => {
      const slot = asRecord(rawSlot);
      const species = slot && typeof slot.species === 'string' ? slot.species : null;
      const startTime = slot && typeof slot.startTime === 'number' ? slot.startTime : null;
      if (!slot || !species || startTime === null) return;
      const slotId = typeof slot.slotId === 'number' ? slot.slotId : idx;
      out.set(`${tileKey}:${slotId}`, { species, startTime, mutation: growthMutationOf(slot.mutations) });
    });
  }
  return out;
}

export interface GardenDiff {
  next: SlotMap;
  /** Slots that vanished or regrew since `prev` — harvested, or destroyed. */
  gone: SlotRecord[];
}

/**
 * `seeding` marks the first snapshot after start: spawns seen then have an unknown
 * origin when already mutated, and nothing is reported as gone.
 */
export function diffGardenSlots(prev: SlotMap, current: Map<string, LiveSlot>, seeding: boolean): GardenDiff {
  const next: SlotMap = {};
  const gone: SlotRecord[] = [];
  for (const [key, live] of current) {
    const old = prev[key];
    if (!old || old.startTime !== live.startTime) {
      if (old && !seeding) gone.push(old);
      let origin: SlotOrigin = 'none';
      if (live.mutation) origin = seeding && !old ? 'unknown' : 'natural';
      next[key] = { species: live.species, startTime: live.startTime, mutation: live.mutation, origin };
      continue;
    }
    if (live.mutation && live.mutation !== old.mutation) {
      next[key] = { ...old, mutation: live.mutation, origin: 'granted' };
    } else {
      next[key] = old;
    }
  }
  if (!seeding) {
    for (const [key, old] of Object.entries(prev)) {
      if (!current.has(key)) gone.push(old);
    }
  }
  return { next, gone };
}
