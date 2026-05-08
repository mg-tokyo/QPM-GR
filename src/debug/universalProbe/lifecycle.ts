import { createStableIdTracker } from './stableIds';
import type { ProbeClickReport, ProbeScanResult } from './types';

export interface ProbeLifecycleState {
  stableIds: ReturnType<typeof createStableIdTracker>;
  last: ProbeScanResult | null;
  history: ProbeScanResult[];
  lastClickReport: ProbeClickReport | null;
  overlayEnabled: boolean;
  overlayRoot: HTMLElement | null;
  pickCancel: (() => void) | null;
  watchCancel: (() => void) | null;
}

export function createProbeState(): ProbeLifecycleState {
  return {
    stableIds: createStableIdTracker(),
    last: null,
    history: [],
    lastClickReport: null,
    overlayEnabled: false,
    overlayRoot: null,
    pickCancel: null,
    watchCancel: null,
  };
}

export function storeProbeResult(state: ProbeLifecycleState, result: ProbeScanResult, maxHistory = 30): void {
  state.last = result;
  state.history.unshift(result);
  if (state.history.length > maxHistory) state.history.length = maxHistory;
}

export function stopProbeState(state: ProbeLifecycleState): void {
  if (state.pickCancel) state.pickCancel();
  if (state.watchCancel) state.watchCancel();
  state.pickCancel = null;
  state.watchCancel = null;
  state.lastClickReport = null;
}
