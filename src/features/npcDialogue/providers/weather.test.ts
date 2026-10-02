import { beforeEach, describe, expect, it, vi } from 'vitest';

const { refs } = vi.hoisted(() => ({
  refs: { weather: null as string | null, forecast: [] as unknown[] },
}));

vi.mock('../../../core/gameState', () => ({
  readSync: (key: string) => (key === 'weather' ? refs.weather : key === 'quinoaData' ? { weatherForecast: refs.forecast } : null),
}));
vi.mock('../../../catalogs/gameCatalogs', () => ({
  getWeatherDef: (id: string) => (id === 'Sunny' ? { name: 'Sunny', mutator: null } : { name: id, mutator: { mutation: 'Wet' } }),
}));
vi.mock('../../garden/bridge', () => ({ getGardenSnapshot: () => null }));
vi.mock('../../pets/cropBoostTracker', () => ({ formatTimeEstimate: (m: number) => `${Math.round(m)}m` }));
vi.mock('../bubbleIcons', () => ({ mutationSlot: (m: string) => ({ mutation: m }) }));
vi.mock('./voiceText', () => ({ voiced: (_base: string, _voice: string, p?: Record<string, unknown>) => `${String(p?.weather)} in ${String(p?.eta)} <0/>` }));

import { forecastUrgency, weatherProvider } from './weather';

describe('weatherProvider', () => {
  beforeEach(() => {
    refs.weather = null;
    refs.forecast = [];
  });

  it('skips a forecast weather without a mutation so relevance and line agree', () => {
    const now = 1_000_000;
    refs.forecast = [
      { groupId: 'Sun', weatherId: 'Sunny', startsAtMs: now + 5 * 60000, endsAtMs: now + 10 * 60000 },
      { groupId: 'Hydro', weatherId: 'Rain', startsAtMs: now + 9 * 60000, endsAtMs: now + 19 * 60000 },
    ];
    expect(weatherProvider.relevance(now)).toBe(forecastUrgency(9 * 60000));
    expect(weatherProvider.line('neutral', now)?.message).toBe('Rain in 9m <0/>');
  });

  it('is irrelevant when only non-mutating weather is forecast', () => {
    const now = 1_000_000;
    refs.forecast = [{ groupId: 'Sun', weatherId: 'Sunny', startsAtMs: now + 5 * 60000, endsAtMs: now + 10 * 60000 }];
    expect(weatherProvider.relevance(now)).toBeNull();
  });
});
