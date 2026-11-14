import { describe, expect, it } from 'vitest';
import { EMPTY_WEATHER_LOG, WEATHER_LOG_MAX, stepWeatherLog, type WeatherLogState } from './weatherLog';

const utc = (hms: string): number => Date.parse(`2026-11-13T${hms}Z`);
const STORM = { startsAtMs: utc('09:25:00'), endsAtMs: utc('09:35:00') };

describe('stepWeatherLog', () => {
  it('logs a weather once it ends, with the window it ran in', () => {
    let s = stepWeatherLog(EMPTY_WEATHER_LOG, 'Thunderstorm', STORM, utc('09:30:00'));
    expect(s.past).toEqual([]);
    s = stepWeatherLog(s, null, STORM, utc('09:35:00'));
    expect(s).toEqual({ current: null, past: [{ weatherId: 'Thunderstorm', ...STORM }] });
  });

  it('a weather already running at load is logged from its window, not the load time', () => {
    let s = stepWeatherLog(EMPTY_WEATHER_LOG, 'Thunderstorm', STORM, utc('09:33:00'));
    s = stepWeatherLog(s, null, null, utc('09:35:01'));
    expect(s.past[0]).toEqual({ weatherId: 'Thunderstorm', ...STORM });
  });

  it('weather arriving before its window takes the window once it lands', () => {
    let s = stepWeatherLog(EMPTY_WEATHER_LOG, 'Rain', STORM, utc('09:36:00'));
    expect(s.current).toEqual({ weatherId: 'Rain', startsAtMs: utc('09:36:00'), endsAtMs: null });
    const rainWin = { startsAtMs: utc('09:36:00'), endsAtMs: utc('09:46:00') };
    s = stepWeatherLog(s, 'Rain', rainWin, utc('09:36:01'));
    expect(s.current).toEqual({ weatherId: 'Rain', ...rainWin });
  });

  it('a direct change logs the first weather and starts the second; unchanged input keeps the same state', () => {
    let s = stepWeatherLog(EMPTY_WEATHER_LOG, 'Rain', STORM, utc('09:30:00'));
    const same = stepWeatherLog(s, 'Rain', STORM, utc('09:31:00'));
    expect(same).toBe(s);
    s = stepWeatherLog(s, 'Frost', STORM, utc('09:32:00'));
    expect(s.past).toEqual([{ weatherId: 'Rain', startsAtMs: STORM.startsAtMs, endsAtMs: utc('09:32:00') }]);
    expect(s.current?.weatherId).toBe('Frost');
  });

  it('keeps the newest entries only', () => {
    let s: WeatherLogState = EMPTY_WEATHER_LOG;
    for (let i = 0; i < WEATHER_LOG_MAX + 5; i += 1) {
      s = stepWeatherLog(s, `W${i}`, null, i * 1000);
      s = stepWeatherLog(s, null, null, i * 1000 + 500);
    }
    expect(s.past).toHaveLength(WEATHER_LOG_MAX);
    expect(s.past[0]?.weatherId).toBe(`W${WEATHER_LOG_MAX + 4}`);
  });
});
