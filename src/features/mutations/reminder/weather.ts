import type { WeatherSnapshot } from '../../../store/weatherHub';
import type { MutationWeatherWindow } from '../../../store/mutationSummary';
import { DetailedWeather } from '../../../utils/game/weatherDetection';
import type { PlantData, WeatherType } from './types';

export function mapSnapshotToWeather(snapshot: WeatherSnapshot): WeatherType {
  switch (snapshot.kind) {
    case 'rain':
      return 'rain';
    case 'snow':
      return 'snow';
    case 'dawn':
      return 'dawn';
    case 'amber':
      return 'amber';
    case 'sunny':
      return 'sunny';
    default:
      return snapshot.raw === 'weather' ? 'rain' : 'sunny';
  }
}

export function resolveWeatherDurationMs(weather: WeatherType): number | null {
  switch (weather) {
    case 'rain':
    case 'snow':
      return 5 * 60 * 1000;
    case 'dawn':
    case 'amber':
      return 10 * 60 * 1000;
    default:
      return null;
  }
}

export function deriveWeatherWindowFromSnapshot(
  weather: WeatherType,
  snapshot: WeatherSnapshot | null,
): MutationWeatherWindow | null {
  if (weather === 'sunny' || weather === 'unknown') {
    return null;
  }

  const durationMs = resolveWeatherDurationMs(weather);
  const startedAt = snapshot?.startedAt ?? snapshot?.timestamp ?? null;

  const expectedEndAt = snapshot?.expectedEndAt
    ?? (startedAt != null && durationMs != null ? startedAt + durationMs : null)
    ?? (durationMs != null ? Date.now() + durationMs : null);

  const remainingMs = expectedEndAt != null ? Math.max(0, expectedEndAt - Date.now()) : null;
  const normalizedDuration = expectedEndAt != null && startedAt != null
    ? Math.max(0, expectedEndAt - startedAt)
    : durationMs;

  return {
    weather,
    startedAt,
    expectedEndAt,
    durationMs: normalizedDuration,
    remainingMs,
  };
}

export function weatherTypeToDetailed(weather: WeatherType): DetailedWeather | null {
  switch (weather) {
    case 'rain':
      return 'rain';
    case 'snow':
      return 'snow';
    case 'dawn':
      return 'dawn';
    case 'amber':
      return 'amber';
    case 'thunderstorm':
      return 'thunderstorm';
    case 'sunny':
      return 'sunny';
    default:
      return null;
  }
}

export function getMutationMessage(plants: PlantData[], weather: WeatherType): string {
  const weatherEmoji = getWeatherEmoji(weather);
  const count = plants.length;

  const action = getMutationAction(weather);

  return `${weatherEmoji} ${weather.toUpperCase()}! Place ${count} plant${count > 1 ? 's' : ''} ${action}`;
}

export function getMutationAction(weather: WeatherType): string {
  switch (weather) {
    case 'rain':
      return 'to freeze (C→F)';
    case 'snow':
      return 'to freeze (W→F)';
    case 'dawn':
      return 'to get Dawnlit';
    case 'amber':
      return 'to get Amberlit';
    default:
      return 'for mutations';
  }
}

export function getWeatherEmoji(weather: WeatherType): string {
  switch (weather) {
    case 'rain':
      return '🌧️';
    case 'snow':
      return '❄️';
    case 'dawn':
      return '🌅';
    case 'amber':
      return '🌆';
    case 'sunny':
      return '☀️';
    default:
      return '❓';
  }
}
