import type { WeatherSnapshot } from '../../../store/weatherHub';
import type { MutationConfig, WeatherType } from './types';

/** Mutable module state shared across the reminder submodules (live holder object). */
export const reminderState = {
  config: {
    enabled: true,
    showNotifications: true,
    highlightPlants: true,
  } as MutationConfig,
  statusUpdateCallback: null as ((status: string) => void) | null,
  currentWeather: 'unknown' as WeatherType,
  lastWeather: 'unknown' as WeatherType,
  weatherUnsubscribe: null as (() => void) | null,
  latestWeatherSnapshot: null as WeatherSnapshot | null,
  pendingWeatherNotification: null as { weather: WeatherType; plantCount: number } | null,
  isSimulatingWeather: false, // Flag to prevent auto-detection from overriding simulated weather
  currentWeatherForHighlights: 'unknown' as WeatherType, // Track which weather the current highlights are for
  highlightedPlantIds: new Set<string>(), // Track which plants are currently highlighted (by ID)
  inventoryObserverStarted: false,
  _simEndTimer: null as ReturnType<typeof setTimeout> | null,
  _highlightTimer: null as ReturnType<typeof setTimeout> | null,
  _checkTimer: null as ReturnType<typeof setTimeout> | null,
  inventoryAccessFailureLogged: false,
  inventoryLookupStatsLogged: false,
  inventoryDebugSamples: 0,
  sharedAtomsFailureLogged: false,
  slotMutationDebugSamples: 0,
};

export function updateStatus(status: string): void {
  if (reminderState.statusUpdateCallback) {
    reminderState.statusUpdateCallback(status);
  }
}
