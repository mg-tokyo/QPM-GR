// Pure line model for the forecast widget (ALR-3.3): game forecast + current weather + day-cycle clock.
import { getNightWindowAt, nextNightfall } from '../../catalogs/logic/dayCycleClock';
import type { DayCycleClock } from '../../catalogs/logic/dayCycleClock';
import type { WeatherDefSafe } from '../../utils/game/catalogHelpers';
import type { WeatherForecastEntry, WeatherWindow } from '../../types/gameAtoms';

export type ForecastLineKind = 'weather' | 'hidden' | 'night';

export interface ForecastLine {
  key: string;
  kind: ForecastLineKind;
  label: string | null;      // weather name; null for hidden events (labelled by group) and night
  weatherId: string | null;  // null for hidden events and night
  groupId: string | null;
  spriteKey: string | null;
  active: boolean;           // running now: atMs is its end, else its start
  atMs: number | null;       // null: day cycle not parsed yet
}

export interface ForecastInput {
  forecast: readonly WeatherForecastEntry[] | null;
  weather: string | null;
  window: WeatherWindow | null;
  nowMs: number;
  clock: DayCycleClock | null;
  weatherDef: (weatherId: string) => WeatherDefSafe | null;
}

type UpcomingInput = Pick<ForecastInput, 'forecast' | 'weather' | 'window' | 'nowMs' | 'weatherDef'>;

function activeGroupOf({ weather, window, nowMs, weatherDef }: UpcomingInput): string | null {
  return weather && window && nowMs < window.endsAtMs ? weatherDef(weather)?.groupId ?? null : null;
}

/** Forecast entries still ahead, in time order, without the running event. */
export function upcomingEntries(input: UpcomingInput, activeGroup = activeGroupOf(input)): WeatherForecastEntry[] {
  const { forecast, window, nowMs } = input;
  // Live 2022: while Thunderstorm ran 09:25–09:35 the Hydro entry already named the next event (Frost 10:15),
  // so only an entry overlapping the running window is the running event itself.
  const isRunning = (entry: WeatherForecastEntry): boolean =>
    window !== null && activeGroup !== null && entry.groupId === activeGroup && entry.startsAtMs < window.endsAtMs;
  return [...(forecast ?? [])]
    .sort((a, b) => a.startsAtMs - b.startsAtMs)
    .filter((entry) => entry.endsAtMs > nowMs && !isRunning(entry));
}

/** A not-running entry as a line; a null weatherId is a hidden event of its group, a null groupId comes from the catalog. */
export function forecastEntryLine(
  weatherId: string | null,
  groupId: string | null,
  atMs: number,
  weatherDef: (weatherId: string) => WeatherDefSafe | null,
): ForecastLine {
  const def = weatherId ? weatherDef(weatherId) : null;
  const group = groupId ?? def?.groupId ?? null;
  return {
    key: `group:${group ?? ''}`, kind: weatherId ? 'weather' : 'hidden',
    label: weatherId ? def?.name ?? weatherId : null, weatherId, groupId: group,
    spriteKey: def?.spriteKey ?? null, active: false, atMs,
  };
}

export function buildForecastLines(input: ForecastInput): ForecastLine[] {
  const { weather, window, nowMs, clock, weatherDef } = input;
  const lines: ForecastLine[] = [];
  const activeGroup = activeGroupOf(input);
  if (weather && window && nowMs < window.endsAtMs) {
    const def = weatherDef(weather);
    lines.push({
      key: `active:${activeGroup ?? weather}`, kind: 'weather', label: def?.name ?? weather, weatherId: weather,
      groupId: activeGroup, spriteKey: def?.spriteKey ?? null, active: true, atMs: window.endsAtMs,
    });
  }
  const seen = new Set<string>();
  for (const entry of upcomingEntries(input, activeGroup)) {
    if (seen.has(entry.groupId)) continue;
    seen.add(entry.groupId);
    lines.push(forecastEntryLine(entry.weatherId, entry.groupId, entry.startsAtMs, weatherDef));
  }
  const night = getNightWindowAt(nowMs, clock);
  lines.push({
    key: 'night', kind: 'night', label: null, weatherId: null, groupId: null, spriteKey: null,
    active: night !== null, atMs: night ? night.endsAtMs : nextNightfall(nowMs, clock),
  });
  return lines;
}

export interface WeatherLook {
  mutation: string;
  color: string | null;     // solid catalog colour; null when the badge has none (a gradient is no tint)
  iconKey: string | null;
}

/** Weather → its catalog `mutator.mutation` → that mutation's badge colour and icon. */
export function weatherLook(
  def: WeatherDefSafe | null,
  badgeOf: (mutation: string) => { color?: string; iconKey?: string } | undefined,
): WeatherLook | null {
  const mutation = def?.mutation;
  if (!mutation) return null;
  const badge = badgeOf(mutation);
  return { mutation, color: badge?.color ?? null, iconKey: badge?.iconKey ?? null };
}

/** Changes only when a line's identity or target changes, not as time passes. */
export function forecastLinesSignature(lines: readonly ForecastLine[]): string {
  return lines.map((l) => `${l.key}|${l.kind}|${l.label ?? ''}|${l.spriteKey ?? ''}|${l.active ? 1 : 0}|${l.atMs ?? ''}`).join(';');
}

export interface WeatherHistoryEvent {
  weatherId: string;
  startsAtMs: number;
}

// weather_events holds one row per 5-min snapshot, clear sky included (live 2026-11-13: Sunny every 5 min,
// Thunderstorm at 09:25 and 09:30 UTC for one event). Rows of one weather this close together are one event.
const SNAPSHOT_GAP_MS = 6 * 60 * 1000;

/** Newest-first snapshot rows → newest-first events; drops weathers the catalog puts in no group (clear sky). */
export function collapseWeatherHistory(
  rows: readonly { weatherId: string; timestamp: number }[],
  weatherDef: (weatherId: string) => WeatherDefSafe | null,
  max: number,
): WeatherHistoryEvent[] {
  const events: WeatherHistoryEvent[] = [];
  let prevId: string | null = null;
  let prevTs = 0;
  for (const row of [...rows].sort((a, b) => b.timestamp - a.timestamp)) {
    const def = weatherDef(row.weatherId);
    if (def && def.groupId === null) { prevId = null; continue; }
    const last = events[events.length - 1];
    if (last && prevId === row.weatherId && prevTs - row.timestamp <= SNAPSHOT_GAP_MS) last.startsAtMs = row.timestamp;
    else if (events.length < max) events.push({ weatherId: row.weatherId, startsAtMs: row.timestamp });
    else break;
    prevId = row.weatherId;
    prevTs = row.timestamp;
  }
  return events;
}
