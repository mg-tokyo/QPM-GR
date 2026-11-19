import { describe, expect, it, vi } from 'vitest';
import type { DayCycleClock } from '../../catalogs/logic/dayCycleClock';
import type { WeatherDefSafe } from '../../utils/game/catalogHelpers';

vi.mock('../../catalogs/logic/dayCycleCatalog', () => ({ getDayCycle: () => ({ stages: null, stageOrder: null }) }));

const { getDayCycleClock } = await import('../../catalogs/logic/dayCycleClock');
const { buildForecastLines, collapseWeatherHistory, forecastLinesSignature, upcomingEntries, weatherLook } = await import('./model');

const clock = getDayCycleClock({
  stages: [{ id: 'day', minutes: 210 }, { id: 'sunset', minutes: 10 }, { id: 'midnight', minutes: 10 }, { id: 'sunrise', minutes: 10 }],
  stageOrder: ['sunrise', 'day', 'sunset', 'midnight'],
  nocturnalBonus: null, chanceCapPerMinute: null, crystalModifiers: null,
}) as DayCycleClock;

const DEFS: Record<string, WeatherDefSafe> = {
  Rain: { id: 'Rain', name: 'Rain', groupId: 'Hydro', spriteKey: 'sprite/ui/RainIcon', mutation: 'Wet' },
  Dawn: { id: 'Dawn', name: 'Dawn', groupId: 'Lunar', spriteKey: 'sprite/ui/DawnIcon', mutation: 'Dawnlit' },
};
const weatherDef = (id: string): WeatherDefSafe | null => DEFS[id] ?? null;
const utc = (hms: string): number => Date.parse(`2026-11-13T${hms}Z`);

// Live build 2022 shapes (ALR-3.1 row).
const RAIN = { groupId: 'Hydro', weatherId: 'Rain', startsAtMs: utc('08:45:00'), endsAtMs: utc('08:55:00') };
const LUNAR = { groupId: 'Lunar', weatherId: null, startsAtMs: utc('12:00:00'), endsAtMs: utc('12:10:00') };

describe('buildForecastLines', () => {
  it('clear skies: one line per group in time order, hidden lunar entry unnamed, then nightfall', () => {
    const lines = buildForecastLines({ forecast: [LUNAR, RAIN], weather: null, window: null, nowMs: utc('08:15:00'), clock, weatherDef });
    expect(lines.map((l) => [l.kind, l.label, l.groupId, l.active, new Date(l.atMs ?? 0).toISOString().slice(11, 16)])).toEqual([
      ['weather', 'Rain', 'Hydro', false, '08:45'],
      ['hidden', null, 'Lunar', false, '12:00'],
      ['night', null, null, false, '11:40'],
    ]);
    expect(lines[0]?.spriteKey).toBe('sprite/ui/RainIcon');
  });

  it('active weather counts to its end and its group still shows the next event', () => {
    const lines = buildForecastLines({
      forecast: [RAIN, LUNAR], weather: 'Dawn', window: { startsAtMs: utc('08:00:00'), endsAtMs: utc('08:10:00') },
      nowMs: utc('08:00:20'), clock, weatherDef,
    });
    expect(lines.map((l) => [l.key, l.label, l.active])).toEqual([
      ['active:Lunar', 'Dawn', true], ['group:Hydro', 'Rain', false], ['group:Lunar', null, false], ['night', null, true],
    ]);
    // Dawn opens in darkness: sunrise is still night until 08:10 (beta dayNight.ts:10-11,73-76).
    expect(lines[3]?.atMs).toBe(utc('08:10:00'));
    expect(lines[0]?.atMs).toBe(utc('08:10:00'));
  });

  it('skips a forecast entry that is the running event itself', () => {
    const running = { groupId: 'Hydro', weatherId: 'Rain', startsAtMs: utc('08:45:00'), endsAtMs: utc('08:55:00') };
    const lines = buildForecastLines({
      forecast: [running], weather: 'Rain', window: { startsAtMs: utc('08:45:00'), endsAtMs: utc('08:55:00') },
      nowMs: utc('08:50:00'), clock, weatherDef,
    });
    expect(lines.map((l) => l.key)).toEqual(['active:Hydro', 'night']);
  });

  it('upcomingEntries lists every future entry in time order, without the running one', () => {
    const running = { groupId: 'Hydro', weatherId: 'Rain', startsAtMs: utc('08:45:00'), endsAtMs: utc('08:55:00') };
    const later = { groupId: 'Hydro', weatherId: 'Frost', startsAtMs: utc('09:30:00'), endsAtMs: utc('09:40:00') };
    const past = { groupId: 'Hydro', weatherId: 'Hail', startsAtMs: utc('07:00:00'), endsAtMs: utc('07:10:00') };
    const ids = upcomingEntries({
      forecast: [LUNAR, later, running, past], weather: 'Rain', window: { startsAtMs: utc('08:45:00'), endsAtMs: utc('08:55:00') },
      nowMs: utc('08:50:00'), weatherDef,
    }).map((e) => e.weatherId ?? e.groupId);
    expect(ids).toEqual(['Frost', 'Lunar']);
  });

  it('collapseWeatherHistory merges 5-min snapshots into events and drops clear sky', () => {
    const defs = (id: string): WeatherDefSafe | null => (id === 'Sunny' ? { id, name: 'Sunny', groupId: null, spriteKey: null, mutation: null } : DEFS[id] ?? null);
    // Live 2026-11-13 shape: newest first, Sunny rows between events.
    const rows = [
      { weatherId: 'Sunny', timestamp: utc('09:40:00') },
      { weatherId: 'Rain', timestamp: utc('09:30:00') },
      { weatherId: 'Rain', timestamp: utc('09:25:00') },
      { weatherId: 'Sunny', timestamp: utc('09:20:00') },
      { weatherId: 'Rain', timestamp: utc('09:15:00') },
      { weatherId: 'Dawn', timestamp: utc('08:05:00') },
      { weatherId: 'Dawn', timestamp: utc('08:00:00') },
    ];
    expect(collapseWeatherHistory(rows, defs, 10)).toEqual([
      { weatherId: 'Rain', startsAtMs: utc('09:25:00') },
      { weatherId: 'Rain', startsAtMs: utc('09:15:00') },
      { weatherId: 'Dawn', startsAtMs: utc('08:00:00') },
    ]);
    expect(collapseWeatherHistory(rows, defs, 2).map((e) => e.startsAtMs)).toEqual([utc('09:25:00'), utc('09:15:00')]);
  });

  it('at night the night line is active until the end of sunrise', () => {
    const lines = buildForecastLines({ forecast: [], weather: null, window: null, nowMs: utc('11:45:00'), clock, weatherDef });
    expect(lines).toEqual([{ key: 'night', kind: 'night', label: null, weatherId: null, groupId: null, spriteKey: null, active: true, atMs: utc('12:10:00') }]);
  });

  it('drops past entries, keeps the first per group, and falls back to ids before the catalog loads', () => {
    const lines = buildForecastLines({
      forecast: [{ ...RAIN, startsAtMs: utc('07:00:00'), endsAtMs: utc('07:10:00') }, { ...RAIN, weatherId: 'Hail' }, { ...RAIN, startsAtMs: utc('09:30:00') }],
      weather: null, window: null, nowMs: utc('08:01:00'), clock: null, weatherDef,
    });
    expect(lines.map((l) => [l.label, l.spriteKey, l.atMs])).toEqual([['Hail', null, utc('08:45:00')], [null, null, null]]);
  });

  it('signature ignores time passing but tracks target changes', () => {
    const at = (now: string): string => forecastLinesSignature(buildForecastLines({ forecast: [RAIN], weather: null, window: null, nowMs: utc(now), clock, weatherDef }));
    expect(at('08:01:00')).toBe(at('08:02:00'));
    expect(at('08:01:00')).not.toBe(at('08:56:00'));
  });
});

describe('weatherLook', () => {
  const badges: Record<string, { color?: string; iconKey?: string }> = {
    Wet: { color: 'wet-colour', iconKey: 'sprite/ui/MutationWet' },
    Rainbowish: { iconKey: 'sprite/ui/MutationRainbow' },
  };
  const badgeOf = (m: string): { color?: string; iconKey?: string } | undefined => badges[m];

  it('weather → mutator.mutation → badge colour and icon', () => {
    expect(weatherLook(DEFS.Rain ?? null, badgeOf)).toEqual({ mutation: 'Wet', color: 'wet-colour', iconKey: 'sprite/ui/MutationWet' });
  });

  it('no mutator (clear sky) or no def → no tint', () => {
    expect(weatherLook({ id: 'Sunny', name: 'Sunny', groupId: null, spriteKey: null, mutation: null }, badgeOf)).toBeNull();
    expect(weatherLook(null, badgeOf)).toBeNull();
  });

  it('a badge without a solid colour keeps the mutation but gives no colour', () => {
    const def = { id: 'X', name: 'X', groupId: 'Hydro', spriteKey: null, mutation: 'Rainbowish' };
    expect(weatherLook(def, badgeOf)).toEqual({ mutation: 'Rainbowish', color: null, iconKey: 'sprite/ui/MutationRainbow' });
    expect(weatherLook({ ...def, mutation: 'Unknown' }, badgeOf)).toEqual({ mutation: 'Unknown', color: null, iconKey: null });
  });
});
