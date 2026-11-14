import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayCycleData } from './dayCycleCatalog';

vi.mock('./dayCycleCatalog', () => ({ getDayCycle: (): DayCycleData => LIVE, onDayStageChange: () => () => {} }));

const LIVE: DayCycleData = {
  stages: [{ id: 'day', minutes: 210 }, { id: 'sunset', minutes: 10 }, { id: 'midnight', minutes: 10 }, { id: 'sunrise', minutes: 10 }],
  stageOrder: ['sunrise', 'day', 'sunset', 'midnight'],
  nocturnalBonus: null,
  chanceCapPerMinute: null,
  crystalModifiers: null,
};

const {
  getDayCycleClock, getDayStageWindowAt, getNightWindowAt, getNightfallDrift, nextDayStageStart, nextMidnight, nextNightfall,
  observeDayStage, onDayClockAnchorChange, stopDayClockDriftCheck,
} = await import('./dayCycleClock');

const utc = (iso: string): number => Date.parse(`2026-11-13T${iso}Z`);
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString().slice(11, 19));

describe('dayCycleClock', () => {
  it('lays the stages out in run order from in-game midnight', () => {
    expect(getDayCycleClock(LIVE)).toEqual({
      cycleMs: 240 * 60_000,
      stages: [
        { id: 'sunrise', startOffsetMs: 0, endOffsetMs: 600_000 },
        { id: 'day', startOffsetMs: 600_000, endOffsetMs: 13_200_000 },
        { id: 'sunset', startOffsetMs: 13_200_000, endOffsetMs: 13_800_000 },
        { id: 'midnight', startOffsetMs: 13_800_000, endOffsetMs: 14_400_000 },
      ],
      offsetMs: 0,
    });
  });

  it('gives nightfall at 03:40, 07:40, … UTC and midnight on the 4-hour marks', () => {
    expect(iso(nextNightfall(utc('00:00:00')))).toBe('03:40:00');
    expect(iso(nextNightfall(utc('03:39:59')))).toBe('03:40:00');
    expect(iso(nextNightfall(utc('05:00:00')))).toBe('07:40:00');
    expect(iso(nextNightfall(utc('23:00:00')))).toBe('23:40:00');
    expect(iso(nextMidnight(utc('03:41:00')))).toBe('04:00:00');
    expect(iso(nextMidnight(utc('04:00:00')))).toBe('08:00:00');
    expect(iso(nextDayStageStart('day', utc('04:05:00')))).toBe('04:10:00');
  });

  it('inside a night returns the next night, and the window names the current stage', () => {
    expect(iso(nextNightfall(utc('03:40:00')))).toBe('07:40:00');
    expect(iso(nextNightfall(utc('03:55:00')))).toBe('07:40:00');
    expect(iso(nextNightfall(utc('04:05:00')))).toBe('07:40:00');
    const win = getDayStageWindowAt(utc('03:55:00'));
    expect(win && { stage: win.stage, from: iso(win.startsAtMs), to: iso(win.endsAtMs) }).toEqual({ stage: 'midnight', from: '03:50:00', to: '04:00:00' });
    expect(getDayStageWindowAt(utc('04:00:00'))?.stage).toBe('sunrise');
    expect(getDayStageWindowAt(utc('12:00:00') - 1)?.stage).toBe('midnight');
  });

  it('gives the night window from nightfall to the end of sunrise', () => {
    const night = (at: string): [string | null, string | null] | null => {
      const w = getNightWindowAt(utc(at));
      return w ? [iso(w.startsAtMs), iso(w.endsAtMs)] : null;
    };
    expect(night('03:39:59')).toBeNull();
    expect(night('03:40:00')).toEqual(['03:40:00', '04:10:00']);
    expect(night('03:59:59')).toEqual(['03:40:00', '04:10:00']);
    expect(night('04:05:00')).toEqual(['03:40:00', '04:10:00']);
    expect(night('04:10:00')).toBeNull();
    expect(getNightWindowAt(0, null)).toBeNull();
  });

  it('follows changed minutes and an extra stage', () => {
    const data: DayCycleData = { ...LIVE, stages: [...(LIVE.stages ?? []), { id: 'dusk', minutes: 20 }], stageOrder: ['sunrise', 'day', 'dusk', 'sunset', 'midnight'] };
    const clock = getDayCycleClock(data);
    expect(clock?.cycleMs).toBe(260 * 60_000);
    expect(nextNightfall(0, clock)).toBe(240 * 60_000);
  });

  it('is null until minutes and order agree', () => {
    expect(getDayCycleClock({ ...LIVE, stageOrder: null })).toBeNull();
    expect(getDayCycleClock({ ...LIVE, stages: null })).toBeNull();
    expect(getDayCycleClock({ ...LIVE, stageOrder: ['sunrise', 'day', 'sunset', 'dusk'] })).toBeNull();
    expect(getDayCycleClock({ ...LIVE, stageOrder: ['sunrise', 'day', 'sunset'] })).toBeNull();
    expect(nextNightfall(0, null)).toBeNull();
    expect(nextMidnight(0, null)).toBeNull();
    expect(getDayStageWindowAt(0, null)).toBeNull();
    expect(nextDayStageStart('eclipse', 0)).toBeNull();
  });
});

describe('nightfall drift check (ALR-4.2)', () => {
  const SETTLED = 5 * 60_000;
  beforeEach(() => { stopDayClockDriftCheck(); });

  it('ignores the first value and anything that is not day → sunset', () => {
    observeDayStage('sunset', null, utc('03:40:00'), SETTLED);
    observeDayStage('sunset', 'midnight', utc('03:43:00'), SETTLED);
    observeDayStage('midnight', 'sunset', utc('03:50:00'), SETTLED);
    const d = getNightfallDrift();
    expect(d.lastObservedMs).toBeNull();
    expect(d.skipped.notFromPrevStage).toBe(1);
    expect(d.reanchors).toBe(0);
  });

  it('records an in-tolerance nightfall without re-anchoring', () => {
    observeDayStage('sunset', 'day', utc('07:40:20'), SETTLED);
    const d = getNightfallDrift();
    expect({ computed: iso(d.lastComputedMs), delta: d.deltaMs, reanchors: d.reanchors, offset: d.offsetMs })
      .toEqual({ computed: '07:40:00', delta: 20_000, reanchors: 0, offset: 0 });
  });

  it('re-anchors on a 3 min disagreement and shifts every later stage', () => {
    const anchored = vi.fn();
    const off = onDayClockAnchorChange(anchored);
    observeDayStage('sunset', 'day', utc('07:43:00'), SETTLED);
    off();
    const d = getNightfallDrift();
    expect({ delta: d.deltaMs, reanchors: d.reanchors, offset: d.offsetMs }).toEqual({ delta: 180_000, reanchors: 1, offset: 180_000 });
    expect(anchored).toHaveBeenCalledTimes(1);
    expect(iso(nextNightfall(utc('08:00:00')))).toBe('11:43:00');
    expect(iso(nextMidnight(utc('08:00:00')))).toBe('08:03:00');
    observeDayStage('sunset', 'day', utc('11:43:10'), SETTLED);
    expect(getNightfallDrift()).toMatchObject({ deltaMs: 10_000, reanchors: 1 });
  });

  it('matches an early observation to the nearest nightfall', () => {
    observeDayStage('sunset', 'day', utc('07:38:00'), SETTLED);
    expect(getNightfallDrift()).toMatchObject({ deltaMs: -120_000, reanchors: 1, offsetMs: -120_000 });
  });

  it('skips a change seen too soon after the tab became visible', () => {
    observeDayStage('sunset', 'day', utc('07:52:00'), 2_000);
    expect(getNightfallDrift()).toMatchObject({ lastObservedMs: null, reanchors: 0, skipped: { notSettled: 1 } });
  });

  it('stop clears the anchor', () => {
    observeDayStage('sunset', 'day', utc('07:43:00'), SETTLED);
    stopDayClockDriftCheck();
    expect(getNightfallDrift()).toMatchObject({ offsetMs: 0, reanchors: 0 });
    expect(iso(nextNightfall(utc('08:00:00')))).toBe('11:40:00');
  });
});
