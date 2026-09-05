import { startAriesHold, stopAriesHold } from './ariesHold';
import { startInstaAction, stopInstaAction } from './instaAction';
import { startInstaHarvest, stopInstaHarvest } from './instaHarvest';
import {
  startHarvestKindObserver,
  stopHarvestKindObserver,
  extractInitialKinds,
  setExtractorSnapshot,
  getSeedKinds,
  type ExtractedKind,
} from './holdHarvestKinds';

let running = false;

function mergeKinds(a: ExtractedKind[], b: ExtractedKind[]): ExtractedKind[] {
  const merged = new Map<string, ExtractedKind>();
  for (const k of a) merged.set(k.actionType, k);
  for (const k of b) merged.set(k.actionType, k);
  return Array.from(merged.values());
}

export function startGardenQol(): void {
  if (running) return;
  running = true;
  // Sync seed so the UI has the well-known kinds before the async scan runs;
  // extractor then merges anything else it finds. If the scan fails/returns
  // zero, the seed stays visible. Trigger path never uses this — see
  // instaHarvest.ts (action-atom classification).
  setExtractorSnapshot(getSeedKinds());
  void extractInitialKinds().then((r) => {
    if (r.kinds.length > 0) setExtractorSnapshot(mergeKinds(getSeedKinds(), r.kinds));
  }).catch(() => { /* seed remains */ });
  startHarvestKindObserver();
  // ariesHold registers BEFORE instaAction/instaHarvest so its capture-phase
  // listener can track held state before they may stopImmediatePropagation.
  startAriesHold();
  startInstaAction();
  startInstaHarvest();
}

export function stopGardenQol(): void {
  if (!running) return;
  running = false;
  stopHarvestKindObserver();
  stopAriesHold();
  stopInstaAction();
  stopInstaHarvest();
}

export { getGardenQolConfig, updateGardenQolConfig } from './state';
export type { GardenQolConfig, HoldContexts } from './types';
export {
  getKinds,
  getUserToggles,
  setEnabled,
  getEnabledActions,
  labelFor,
  type HarvestKind,
} from './holdHarvestKinds';
