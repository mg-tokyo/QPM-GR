// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

type GmRequest = { url: string; onload?: (res: { status: number; responseText: string }) => void };

describe('fetchRecentWeatherEvents', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('one request serves repeated calls (cache + in-flight), seconds become ms', async () => {
    const urls: string[] = [];
    vi.stubGlobal('GM_xmlhttpRequest', (req: GmRequest) => {
      urls.push(req.url);
      setTimeout(() => req.onload?.({ status: 200, responseText: JSON.stringify([
        { weather_id: 'Rain', timestamp: 1794562200000 },
        { weather_id: 'Frost', timestamp: 1794561900 },
        { weather_id: 7, timestamp: 1 },
      ]) }), 0);
    });
    const { fetchRecentWeatherEvents } = await import('./itemEventService');
    const [a, b] = await Promise.all([fetchRecentWeatherEvents(100), fetchRecentWeatherEvents(100)]);
    const c = await fetchRecentWeatherEvents(100);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('weather_events?select=weather_id,timestamp&order=timestamp.desc&limit=100');
    expect(a).toEqual([{ weatherId: 'Rain', timestamp: 1794562200000 }, { weatherId: 'Frost', timestamp: 1794561900000 }]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('a failed request resolves null and is not cached', async () => {
    let calls = 0;
    vi.stubGlobal('GM_xmlhttpRequest', (req: GmRequest) => {
      calls += 1;
      setTimeout(() => req.onload?.({ status: 500, responseText: '' }), 0);
    });
    const { fetchRecentWeatherEvents } = await import('./itemEventService');
    expect(await fetchRecentWeatherEvents(10)).toBeNull();
    expect(await fetchRecentWeatherEvents(10)).toBeNull();
    expect(calls).toBe(2);
  });
});
