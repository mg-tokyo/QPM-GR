// Egg-ready schedule (ALR-11.1): which eggs come due, batched, never for an egg first seen already due.
import type { GardenSnapshot } from '../bridge';
import { isRecord } from '../../../utils/typeGuards';

export interface EggEntry {
  /** `<tileKey>|<plantedAt>`: a re-planted tile is a new egg. */
  key: string;
  /** `g:<dirtTileIdx>` or `b:<boardwalkTileIdx>`, as in slotWalk.ts. */
  tileKey: string;
  eggId: string;
  plantedAt: number;
  maturedAt: number;
}

export type EggState = 'pending' | 'fired' | 'silent';

export interface EggScheduleStep {
  batch: EggEntry[];
  nextFireAt: number | null;
}

/** Eggs due this close to the one that woke the schedule join its batch. */
export const EGG_BATCH_WINDOW_MS = 2_000;

const TILE_MAPS = [['tileObjects', 'g'], ['boardwalkTileObjects', 'b']] as const;

export function walkEggs(snapshot: GardenSnapshot): EggEntry[] {
  if (!snapshot) return [];
  const out: EggEntry[] = [];
  for (const [field, prefix] of TILE_MAPS) {
    const tiles = snapshot[field];
    if (!isRecord(tiles)) continue;
    for (const [key, tile] of Object.entries(tiles)) {
      if (!isRecord(tile) || tile.objectType !== 'egg') continue;
      const { eggId, plantedAt, maturedAt } = tile;
      if (typeof eggId !== 'string' || typeof plantedAt !== 'number' || typeof maturedAt !== 'number') continue;
      const tileKey = `${prefix}:${key}`;
      out.push({ key: `${tileKey}|${plantedAt}`, tileKey, eggId, plantedAt, maturedAt });
    }
  }
  return out;
}

export function createEggSchedule(): {
  step(eggs: readonly EggEntry[], nowMs: number, leadMs: number): EggScheduleStep;
  entries(): Array<EggEntry & { state: EggState }>;
  reset(): void;
} {
  const known = new Map<string, { egg: EggEntry; state: EggState }>();

  function step(eggs: readonly EggEntry[], nowMs: number, leadMs: number): EggScheduleStep {
    const seen = new Set<string>();
    for (const egg of eggs) {
      seen.add(egg.key);
      const prev = known.get(egg.key);
      if (prev) prev.egg = egg;
      else known.set(egg.key, { egg, state: egg.maturedAt - leadMs <= nowMs ? 'silent' : 'pending' });
    }
    for (const key of Array.from(known.keys())) if (!seen.has(key)) known.delete(key);

    const pending = Array.from(known.values()).filter((e) => e.state === 'pending');
    const batch: EggEntry[] = [];
    if (pending.some((e) => e.egg.maturedAt - leadMs <= nowMs)) {
      for (const e of pending) {
        if (e.egg.maturedAt - leadMs > nowMs + EGG_BATCH_WINDOW_MS) continue;
        e.state = 'fired';
        batch.push(e.egg);
      }
    }
    let nextFireAt: number | null = null;
    for (const e of known.values()) {
      if (e.state !== 'pending') continue;
      const at = e.egg.maturedAt - leadMs;
      if (nextFireAt === null || at < nextFireAt) nextFireAt = at;
    }
    batch.sort((a, b) => a.maturedAt - b.maturedAt);
    return { batch, nextFireAt };
  }

  return {
    step,
    entries: () => Array.from(known.values(), (e) => ({ ...e.egg, state: e.state })),
    reset: () => { known.clear(); },
  };
}
