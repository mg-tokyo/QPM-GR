import { type GardenSnapshot, getGardenSnapshot } from '../../garden/bridge';
import { type ActivePetInfo, getActivePetInfos } from '../../../store/pets';
import { DEFAULT_CONFIG } from './constants';
import { warnFeature } from './_diagnostics';
import type { TurtleResolvedConfig, TurtleTimerChannel, TurtleTimerState, TurtleTimerStatus } from './types';

// Live holder objects — mutated in place so cross-module reads stay dynamic.
export const config: TurtleResolvedConfig = { ...DEFAULT_CONFIG };

export const latest: { garden: GardenSnapshot; pets: ActivePetInfo[] } = {
  garden: getGardenSnapshot(),
  pets: getActivePetInfos(),
};

export const listeners = new Set<(state: TurtleTimerState) => void>();

export function createEmptyChannel(status: TurtleTimerStatus = 'no-data'): TurtleTimerChannel {
  return {
    status,
    trackedSlots: 0,
    growingSlots: 0,
    maturedSlots: 0,
    contributions: [],
    expectedMinutesRemoved: null,
    effectiveRate: null,
    naturalMsRemaining: null,
    adjustedMsRemaining: null,
    minutesSaved: null,
    focusSlot: null,
  };
}

export function createInitialState(): TurtleTimerState {
  return {
    enabled: config.enabled,
    now: Date.now(),
    includeBoardwalk: config.includeBoardwalk,
    focus: config.focus,
    focusTargetKey: null,
    focusTargetAvailable: false,
    eggFocus: config.eggFocus,
    eggFocusTargetKey: null,
    eggFocusTargetAvailable: false,
    minActiveHungerPct: config.minActiveHungerPct,
    fallbackTargetScale: config.fallbackTargetScale,
    availableTurtles: 0,
    hungerFilteredCount: 0,
    turtlesMissingStats: 0,
    plant: createEmptyChannel(),
    plantTargets: [],
    egg: createEmptyChannel(),
    eggTargets: [],
    support: {
      restoreCount: 0,
      restoreActiveCount: 0,
      slowCount: 0,
      slowActiveCount: 0,
      restorePctTotal: 0,
      restorePctActive: 0,
      restorePctPerHourTotal: 0,
      restorePctPerHourActive: 0,
      restoreTriggersPerHourTotal: 0,
      restoreTriggersPerHourActive: 0,
      slowPctTotal: 0,
      slowPctActive: 0,
      entries: [],
    },
  };
}

let state: TurtleTimerState = createInitialState();

export function getState(): TurtleTimerState {
  return state;
}

export function resetState(): void {
  state = createInitialState();
}

export function publish(next: TurtleTimerState): void {
  state = next;
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      warnFeature('QPM-FEATURE-004', { what: 'listener:publish' }, error);
    }
  }
}
