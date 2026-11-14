// This-session weather log (ALR-3.4): weather that ran and ended since the page loaded, newest first.
import type { WeatherWindow } from '../../types/gameAtoms';

export interface WeatherLogEntry {
  weatherId: string;
  startsAtMs: number;
  endsAtMs: number;
}

export interface WeatherLogState {
  current: { weatherId: string; startsAtMs: number; endsAtMs: number | null } | null;
  past: readonly WeatherLogEntry[];
}

export const WEATHER_LOG_MAX = 20;
export const EMPTY_WEATHER_LOG: WeatherLogState = { current: null, past: [] };

// `weather` and `weatherWindow` update separately, so a new weather can briefly sit beside the old window.
function liveWindow(window: WeatherWindow | null, nowMs: number): WeatherWindow | null {
  return window && window.endsAtMs > nowMs && window.startsAtMs <= nowMs ? window : null;
}

export function stepWeatherLog(state: WeatherLogState, weather: string | null, window: WeatherWindow | null, nowMs: number): WeatherLogState {
  const { current } = state;
  const win = liveWindow(window, nowMs);
  if (current && current.weatherId === weather) {
    if (!win || (win.startsAtMs === current.startsAtMs && win.endsAtMs === current.endsAtMs)) return state;
    return { ...state, current: { weatherId: current.weatherId, startsAtMs: win.startsAtMs, endsAtMs: win.endsAtMs } };
  }
  let past = state.past;
  if (current) {
    const ended = { weatherId: current.weatherId, startsAtMs: current.startsAtMs, endsAtMs: Math.min(current.endsAtMs ?? nowMs, nowMs) };
    past = [ended, ...past].slice(0, WEATHER_LOG_MAX);
  }
  const next = weather ? { weatherId: weather, startsAtMs: win?.startsAtMs ?? nowMs, endsAtMs: win?.endsAtMs ?? null } : null;
  return { current: next, past };
}
