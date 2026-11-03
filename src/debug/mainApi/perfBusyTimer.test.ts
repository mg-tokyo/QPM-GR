import { describe, expect, it } from 'vitest';
import { busyTimerArgs } from './perfBusyTimer';

describe('busyTimerArgs', () => {
  it('keeps sane arguments unchanged', () => {
    expect(busyTimerArgs(120, 1000)).toEqual({ ms: 120, everyMs: 1000 });
  });

  it('caps a single busy-wait at 1000 ms', () => {
    expect(busyTimerArgs(60_000, 120_000).ms).toBe(1000);
  });

  it('leaves at least 250 ms free between busy-waits so stop() can run', () => {
    expect(busyTimerArgs(1000, 100)).toEqual({ ms: 1000, everyMs: 1250 });
  });

  it('falls back to the defaults for non-finite or non-positive input', () => {
    expect(busyTimerArgs(Number.NaN, Number.NaN)).toEqual({ ms: 120, everyMs: 1000 });
    expect(busyTimerArgs(-5, 0)).toEqual({ ms: 120, everyMs: 1000 });
  });
});
