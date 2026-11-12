import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerScopedLayout, PlayerScopedSpec } from './playerScoped';
import type { StatsState } from './statsMerge';

const captured: { spec: PlayerScopedSpec<StatsState> | null; layout: PlayerScopedLayout<StatsState> | null } = { spec: null, layout: null };
let ready = false;
const handle = {
  start: vi.fn(),
  stop: vi.fn(),
  write: vi.fn((_value: StatsState) => true),
  read: vi.fn(),
  isReady: vi.fn(() => ready),
  scopedKey: vi.fn(() => (ready ? 'quinoa:stats:v1.p1' : null)),
};
const createPlayerScoped = vi.fn((spec: PlayerScopedSpec<StatsState>, layout: PlayerScopedLayout<StatsState>) => {
  captured.spec = spec;
  captured.layout = layout;
  return handle;
});
const weatherUnsub = vi.fn();
const timerStop = vi.fn();
const onWeatherSnapshot = vi.fn(() => weatherUnsub);

vi.mock('./playerScoped', () => ({ createPlayerScoped }));
vi.mock('./weatherHub', () => ({
  startWeatherHub: vi.fn(),
  getWeatherSnapshot: () => ({ kind: 'sunny', timestamp: 1 }),
  onWeatherSnapshot,
}));
vi.mock('../utils/scheduling/timerManager', () => ({ visibleInterval: vi.fn(() => timerStop) }));

const stats = await import('./stats');
const { createDefaultStatsState } = await import('./statsMerge');

function saved(hatched: number): StatsState {
  const s = createDefaultStatsState(1);
  s.pets.totalHatched = hatched;
  s.weather.timeByKind = { sunny: 500 };
  return s;
}

function bind(value: StatsState): void {
  ready = true;
  captured.spec?.onReady(value, 'p1');
}

describe('stats store on the player-scoped helper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    stats.stopStatsStore();
    ready = false;
    vi.clearAllMocks();
    stats.initializeStatsStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts one handle on the stats key and stops idempotently', () => {
    stats.initializeStatsStore();
    expect(createPlayerScoped).toHaveBeenCalledTimes(1);
    expect(handle.start).toHaveBeenCalledTimes(1);
    expect(captured.layout?.parts).toEqual(['quinoa:stats:v1']);
    expect(captured.layout?.join([null])).toBeUndefined();
    stats.stopStatsStore();
    stats.stopStatsStore();
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });

  it('replays record calls made before the bind onto the player copy and writes it', () => {
    stats.recordPetHatch('gold', 5);
    stats.recordFeedEvent('Bee', 6);
    vi.runAllTimers();
    expect(handle.write).not.toHaveBeenCalled();
    bind(saved(10));
    const s = stats.getStatsSnapshot();
    expect(s.pets.totalHatched).toBe(11);
    expect(s.pets.hatchedByRarity.gold).toBe(1);
    expect(s.feed.totalFeeds).toBe(1);
    expect(s.weather.timeByKind).toEqual({ sunny: 500 });
    expect(handle.write).toHaveBeenCalledTimes(1);
    stats.recordPetHatch('normal', 7);
    expect(stats.getStatsSnapshot().pets.totalHatched).toBe(12);
  });

  it('does not write on a plain bind; attaches weather once, at the bind', () => {
    expect(onWeatherSnapshot).not.toHaveBeenCalled();
    bind(saved(3));
    bind(saved(4));
    expect(onWeatherSnapshot).toHaveBeenCalledTimes(1);
    expect(handle.write).not.toHaveBeenCalled();
    expect(stats.getStatsSnapshot().pets.totalHatched).toBe(4);
  });

  it('stop flushes a pending save and later records do not restart the store', () => {
    bind(saved(3));
    stats.recordPetHatch('normal', 9);
    expect(handle.write).not.toHaveBeenCalled();
    stats.stopStatsStore();
    expect(handle.write).toHaveBeenCalledTimes(1);
    expect(weatherUnsub).toHaveBeenCalledTimes(1);
    expect(timerStop).toHaveBeenCalledTimes(1);
    stats.recordPetHatch('normal', 10);
    expect(createPlayerScoped).toHaveBeenCalledTimes(1);
  });

  it('gives each fallback bind a fresh state', () => {
    const fallback = captured.spec!.fallback;
    bind(fallback);
    stats.recordPetHatch('normal', 1);
    expect(fallback.pets.totalHatched).toBe(0);
  });
});
