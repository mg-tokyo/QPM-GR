import { onGardenSnapshot } from '../bridge';
import { walkPlantSlots } from '../slotWalk';
import { createMutationGainDiffer, type MutationGain } from './diff';

export type { MutationGain } from './diff';
export { createMutationGainDiffer } from './diff';

export interface MutationGainDebugState {
  running: boolean;
  steps: number;
  /** The most recent step that found gains; null until one does. */
  last: { at: number; gains: MutationGain[] } | null;
}

const differ = createMutationGainDiffer();
let unsubscribe: (() => void) | null = null;
let steps = 0;
let last: MutationGainDebugState['last'] = null;

export function startMutationGainTracker(): void {
  if (unsubscribe) return;
  unsubscribe = onGardenSnapshot((snapshot) => {
    // A null garden is a gap in the feed, not an empty garden; keep the baseline across it.
    if (!snapshot) return;
    const gains = differ.step(walkPlantSlots(snapshot));
    steps += 1;
    if (gains.length > 0) last = { at: Date.now(), gains };
  });
}

export function stopMutationGainTracker(): void {
  unsubscribe?.();
  unsubscribe = null;
  differ.reset();
  steps = 0;
  last = null;
}

export function getMutationGainDebugState(): MutationGainDebugState {
  return { running: unsubscribe !== null, steps, last };
}
