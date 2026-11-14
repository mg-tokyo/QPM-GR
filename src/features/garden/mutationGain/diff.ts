import type { WalkedSlot } from '../slotWalk';

export interface MutationGain {
  mutation: string;
  tileKey: string;
  slotId: number;
  species: string;
}

interface KnownSlot {
  startTime: number;
  species: string;
  mutations: ReadonlySet<string>;
}

export interface MutationGainDiffer {
  /** Gains since the previous step; the first step only records the baseline. */
  step(slots: readonly WalkedSlot[]): MutationGain[];
  reset(): void;
}

/**
 * Identity is tile + slotId (ALR-6 D1a). A later startTime is a harvest, regrowth or replant, so
 * the slot is new and its mutations are a silent baseline (PD2). Watering moves startTime
 * earlier on every slot of the plant, so an earlier startTime keeps the slot.
 */
export function createMutationGainDiffer(): MutationGainDiffer {
  let known: Map<string, KnownSlot> | null = null;

  return {
    step(slots) {
      const next = new Map<string, KnownSlot>();
      const gains: MutationGain[] = [];
      for (const slot of slots) {
        const id = `${slot.tileKey}#${slot.slotId}`;
        const prev = known?.get(id);
        const mutations = new Set(slot.mutations);
        next.set(id, { startTime: slot.startTime, species: slot.species, mutations });
        if (!prev || slot.startTime > prev.startTime || slot.species !== prev.species) continue;
        for (const mutation of mutations) {
          if (!prev.mutations.has(mutation)) {
            gains.push({ mutation, tileKey: slot.tileKey, slotId: slot.slotId, species: slot.species });
          }
        }
      }
      known = next;
      return gains;
    },
    reset() {
      known = null;
    },
  };
}
