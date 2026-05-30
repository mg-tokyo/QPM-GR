// src/ui/shopRestockAlerts/weatherAlertProcessor.ts
// Bridges weatherHub snapshots to the alert system for tracked weather types.

import { onWeatherSnapshot, type WeatherSnapshot } from '../../../store/weatherHub';
import { storage } from '../../../utils/storage';
import { TRACKED_KEY } from './types';
import { upsertAlert, removeAlert } from './alertDom';
import { activeAlerts } from './alertState';

const WEATHER_TRACKED_PREFIX = 'weather:';
const REMOVAL_DELAY_MS = 3_000;

let stopWeatherSub: (() => void) | null = null;
let lastWeatherKind: string | null = null;
const pendingRemovals = new Map<string, number>();

function loadWeatherTrackedSet(): Set<string> {
  const saved = storage.get<string[] | null>(TRACKED_KEY, null);
  if (!Array.isArray(saved)) return new Set();
  const weatherKeys = new Set<string>();
  for (const key of saved) {
    if (key.startsWith(WEATHER_TRACKED_PREFIX)) {
      weatherKeys.add(key);
    }
  }
  return weatherKeys;
}

function weatherIdToAlertKey(weatherId: string): string {
  return `weather:${weatherId}`;
}

function weatherKindMatchesId(kind: string, weatherId: string): boolean {
  return kind.toLowerCase() === weatherId.toLowerCase();
}

function getWeatherLabel(weatherId: string): string {
  // Convert camelCase to spaced: AmberMoon → Amber Moon
  return weatherId.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function handleWeatherChange(snapshot: WeatherSnapshot): void {
  const tracked = loadWeatherTrackedSet();
  if (tracked.size === 0) return;

  const currentKind = snapshot.kind;
  const isWeather = snapshot.raw === 'weather' && currentKind !== 'unknown' && currentKind !== 'sunny';

  for (const trackedKey of tracked) {
    // trackedKey is like "weather:Dawn"
    const weatherId = trackedKey.slice(WEATHER_TRACKED_PREFIX.length);
    const alertKey = weatherIdToAlertKey(weatherId);
    const matches = isWeather && weatherKindMatchesId(currentKind, weatherId);

    if (matches) {
      // Cancel pending removal if weather came back
      const pendingTimer = pendingRemovals.get(alertKey);
      if (pendingTimer != null) {
        clearTimeout(pendingTimer);
        pendingRemovals.delete(alertKey);
      }

      const durationMs = snapshot.expectedEndAt
        ? Math.max(0, snapshot.expectedEndAt - Date.now())
        : 0;

      upsertAlert({
        key: alertKey,
        shopType: 'weather',
        itemId: weatherId,
        stockCycleId: snapshot.startedAt ? `weather:${snapshot.startedAt}` : null,
        label: getWeatherLabel(weatherId),
        quantity: 1,
        priceCoins: null,
        isWeatherAlert: true,
        weatherDurationMs: durationMs,
      });
    } else if (activeAlerts.has(alertKey) && !pendingRemovals.has(alertKey)) {
      // Weather changed away — remove after brief delay
      const timer = window.setTimeout(() => {
        pendingRemovals.delete(alertKey);
        removeAlert(alertKey);
      }, REMOVAL_DELAY_MS);
      pendingRemovals.set(alertKey, timer);
    }
  }

  lastWeatherKind = currentKind;
}

export function startWeatherAlertProcessor(): void {
  if (stopWeatherSub) return;
  lastWeatherKind = null;
  stopWeatherSub = onWeatherSnapshot((snapshot) => {
    handleWeatherChange(snapshot);
  }, true);
}

export function stopWeatherAlertProcessor(): void {
  if (stopWeatherSub) {
    stopWeatherSub();
    stopWeatherSub = null;
  }
  lastWeatherKind = null;
  for (const timer of pendingRemovals.values()) {
    clearTimeout(timer);
  }
  pendingRemovals.clear();
}
