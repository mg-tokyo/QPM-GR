import type { WalkedSlot } from '../slotWalk';
import type { Journal } from '../../journal/checker';

// Beta common/games/Quinoa/utils/cropSize.ts:14-25: MAX_CROP_SIZE = 100, isMaxCropSize = size >= MAX_CROP_SIZE.
export const MAX_CROP_SIZE = 100;
// Beta utils/journal.ts:35-40: the game logs this variant id when a crop at max size is logged.
export const MAX_WEIGHT_VARIANT = 'Max Weight';

export interface SizeEdge {
  tileKey: string;
  slotId: number;
  species: string;
  mutations: string[];
  size: number;
}

export interface CropMaxSizeFilter {
  unloggedJournal: boolean;
  species: readonly string[];
}

export const DEFAULT_CROP_MAX_SIZE_FILTER: CropMaxSizeFilter = { unloggedJournal: true, species: [] };

interface KnownSlot {
  startTime: number;
  species: string;
  size: number | null;
}

export interface SizeEdgeTracker {
  /** Slots that reached max since the previous step; the first step only records the baseline. */
  step(slots: readonly WalkedSlot[]): SizeEdge[];
  reset(): void;
}

const isMax = (size: number | null): size is number => size !== null && size >= MAX_CROP_SIZE;

/**
 * Same identity rule as mutationGain (tile + slotId; a later startTime or another species is a new
 * slot). A new slot already at max is an edge (PD1). A known slot whose size was unknown is not.
 */
export function createSizeEdgeTracker(): SizeEdgeTracker {
  let known: Map<string, KnownSlot> | null = null;

  return {
    step(slots) {
      const next = new Map<string, KnownSlot>();
      const edges: SizeEdge[] = [];
      for (const slot of slots) {
        const id = `${slot.tileKey}#${slot.slotId}`;
        const prev = known?.get(id);
        next.set(id, { startTime: slot.startTime, species: slot.species, size: slot.size });
        if (known === null || !isMax(slot.size)) continue;
        const sameSlot = prev !== undefined && slot.startTime <= prev.startTime && slot.species === prev.species;
        const crossed = sameSlot ? prev.size !== null && prev.size < MAX_CROP_SIZE : true;
        if (crossed) edges.push({ tileKey: slot.tileKey, slotId: slot.slotId, species: slot.species, mutations: [...slot.mutations], size: slot.size });
      }
      known = next;
      return edges;
    },
    reset() {
      known = null;
    },
  };
}

export function isMaxWeightLogged(journal: Journal, species: string): boolean {
  return journal.produce?.[species]?.variantsLogged?.some((v) => v.variant === MAX_WEIGHT_VARIANT) ?? false;
}

/** A species the player picked always qualifies; otherwise only an unlogged Max Weight does, when that mode is on. */
export function edgeQualifies(species: string, filter: CropMaxSizeFilter, journal: Journal | null): boolean {
  if (filter.species.includes(species)) return true;
  if (!filter.unloggedJournal || !journal) return false;
  return !isMaxWeightLogged(journal, species);
}
