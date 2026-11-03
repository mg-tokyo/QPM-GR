import { afterEach, describe, expect, it } from 'vitest';
import { getPerfSnapshot, recordProbeHalves, summarize } from './perfMonitor';
import { attributeLongTasks, setSpanRecording } from './perfSpans';
import { createOverlap } from './longTaskOverlap';

describe('perfMonitor.summarize', () => {
  it('returns zeros for an empty sample set', () => {
    expect(summarize([], 0)).toEqual({ p50: 0, p95: 0, max: 0 });
  });

  it('picks the top sample as p95 over 5 mixed samples (nearest-rank)', () => {
    const s = summarize([1, 2, 3, 4, 100], 5);
    expect(s.p50).toBe(3);
    expect(s.p95).toBe(100);
    expect(s.max).toBe(100);
  });

  it('is order-independent (sorts before picking)', () => {
    const s = summarize([100, 3, 2, 4, 1], 5);
    expect(s.p50).toBe(3);
    expect(s.p95).toBe(100);
    expect(s.max).toBe(100);
  });

  it('treats n < capacity correctly (ring not full)', () => {
    const buf = new Float64Array(256);
    buf[0] = 5; buf[1] = 10; buf[2] = 1;
    const s = summarize(buf, 3);
    expect(s.p50).toBe(5);
    expect(s.max).toBe(10);
  });
});

describe('perfMonitor.recordProbeHalves', () => {
  afterEach(() => setSpanRecording(false));

  it('samples the summed halves and leaves the gap between them unattributed', () => {
    setSpanRecording(true);
    const before = getPerfSnapshot().probes['camera3d.frame'].count;
    recordProbeHalves('camera3d.frame', 0, 2, 12, 14);
    expect(getPerfSnapshot().probes['camera3d.frame'].count).toBe(before + 1);
    const gap = attributeLongTasks([{ startTime: 3, duration: 8 }], createOverlap());
    expect(gap.qpmMs).toBe(0);
    const whole = attributeLongTasks([{ startTime: 0, duration: 14 }], createOverlap());
    expect(whole.byName.get('camera3d.frame')).toBe(4);
  });
});
