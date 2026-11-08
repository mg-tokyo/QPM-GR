import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let ready = true;
let serverTime: unknown = null;

vi.mock('../core/gameState', () => ({
  isGameStateReady: () => ready,
  readSync: vi.fn((key: string) => (key === 'serverTime' ? serverTime : null)),
}));

import { __resetServerClock, getServerNowMs } from './serverClock';

const T0 = 1_794_116_408_000;

describe('serverClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    ready = true;
    serverTime = null;
    __resetServerClock();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('returns null before the tree has delivered a clock', () => {
    expect(getServerNowMs()).toBeNull();
    ready = false;
    serverTime = T0 + 500;
    expect(getServerNowMs()).toBeNull();
  });

  it('applies the offset and advances with local time between reads', () => {
    serverTime = T0 + 400;
    expect(getServerNowMs()).toBe(T0 + 400);
    vi.advanceTimersByTime(250);
    expect(getServerNowMs()).toBe(T0 + 650);
  });

  it('keeps the largest offset when a later read is a stale tick', () => {
    serverTime = T0 + 600;
    getServerNowMs();
    vi.advanceTimersByTime(900);
    expect(getServerNowMs()).toBe(T0 + 1500);
  });

  it('raises the offset when a later read is further ahead', () => {
    serverTime = T0 + 100;
    getServerNowMs();
    vi.advanceTimersByTime(1000);
    serverTime = T0 + 1620;
    expect(getServerNowMs()).toBe(T0 + 1620);
  });

  it('re-bases to a smaller offset after 30 s without a new maximum', () => {
    serverTime = T0 + 5000;
    getServerNowMs();
    vi.advanceTimersByTime(30_001);
    serverTime = T0 + 30_001 + 300;
    expect(getServerNowMs()).toBe(T0 + 30_001 + 300);
  });

  it('keeps the cached estimate when the clock becomes unavailable', () => {
    serverTime = T0 + 400;
    getServerNowMs();
    serverTime = null;
    vi.advanceTimersByTime(100);
    expect(getServerNowMs()).toBe(T0 + 500);
    ready = false;
    expect(getServerNowMs()).toBe(T0 + 500);
  });
});
