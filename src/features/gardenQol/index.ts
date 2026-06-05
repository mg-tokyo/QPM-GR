// src/features/gardenQol/index.ts
// Public API for garden QOL features (insta-harvest, aries hold).

import { startAriesHold, stopAriesHold } from './ariesHold';
import { startInstaAction, stopInstaAction } from './instaAction';
import { startInstaHarvest, stopInstaHarvest } from './instaHarvest';

let running = false;

export function startGardenQol(): void {
  if (running) return;
  running = true;
  // ariesHold registers BEFORE instaAction/instaHarvest so its capture-phase
  // listener can track held state before they may stopImmediatePropagation.
  startAriesHold();
  startInstaAction();
  startInstaHarvest();
}

export function stopGardenQol(): void {
  if (!running) return;
  running = false;
  stopAriesHold();
  stopInstaAction();
  stopInstaHarvest();
}

export { getGardenQolConfig, updateGardenQolConfig } from './state';
export type { GardenQolConfig, HoldContexts } from './types';
