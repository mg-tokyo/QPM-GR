import { onGardenSnapshot } from '../bridge';
import { walkPlantSlots } from '../slotWalk';
import { createMutationGainDiffer, type MutationGain } from './diff';
import { onMutationGains, startMutationGainAlarm, stopMutationGainAlarm } from './alarm';

export type { MutationGain } from './diff';
export { createMutationGainDiffer } from './diff';
export { getMutationGainAlarmState, getWatchedMutations, MUTATION_GAIN_ROW, mutationColor, mutationIcon, setWatchedMutations } from './alarm';
export { getMutationPickerSections, type PickerSection } from './picker';

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
  startMutationGainAlarm();
  unsubscribe = onGardenSnapshot((snapshot) => {
    // A null garden is a gap in the feed, not an empty garden; keep the baseline across it.
    if (!snapshot) return;
    const gains = differ.step(walkPlantSlots(snapshot));
    steps += 1;
    if (gains.length === 0) return;
    last = { at: Date.now(), gains };
    onMutationGains(gains);
  });
}

export function stopMutationGainTracker(): void {
  unsubscribe?.();
  unsubscribe = null;
  stopMutationGainAlarm();
  differ.reset();
  steps = 0;
  last = null;
}

export function getMutationGainDebugState(): MutationGainDebugState {
  return { running: unsubscribe !== null, steps, last };
}
