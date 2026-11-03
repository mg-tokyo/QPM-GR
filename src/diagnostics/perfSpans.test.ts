import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPAN_RING, attributeLongTasks, recordSpan, recordSpanEndingNow, setSpanRecording } from './perfSpans';
import { createOverlap } from './longTaskOverlap';

afterEach(() => { setSpanRecording(false); vi.restoreAllMocks(); });

describe('perfSpans', () => {
  it('records nothing while recording is off', () => {
    recordSpan('a', 100, 150);
    const o = attributeLongTasks([{ startTime: 100, duration: 100 }], createOverlap());
    expect(o.taskMs).toBe(100);
    expect(o.qpmMs).toBe(0);
  });

  it('attributes recorded spans to long-task entries', () => {
    setSpanRecording(true);
    recordSpan('a', 100, 150);
    recordSpan('b', 400, 420);
    const o = attributeLongTasks([{ startTime: 90, duration: 100 }], createOverlap());
    expect(o.qpmMs).toBe(50);
    expect(o.byName.get('a')).toBe(50);
    expect(o.byName.has('b')).toBe(false);
  });

  it('keeps the newest spans when the ring wraps', () => {
    setSpanRecording(true);
    for (let i = 0; i < SPAN_RING + 10; i++) recordSpan(`s${i}`, i * 10, i * 10 + 5);
    const oldest = attributeLongTasks([{ startTime: 0, duration: 50 }], createOverlap());
    expect(oldest.qpmMs).toBe(0);
    const last = SPAN_RING + 9;
    const newest = attributeLongTasks([{ startTime: last * 10, duration: 10 }], createOverlap());
    expect(newest.byName.get(`s${last}`)).toBe(5);
  });

  it('clears the ring when recording is switched off', () => {
    setSpanRecording(true);
    recordSpan('a', 100, 150);
    setSpanRecording(false);
    setSpanRecording(true);
    expect(attributeLongTasks([{ startTime: 100, duration: 100 }], createOverlap()).qpmMs).toBe(0);
  });

  it('reads no clock while recording is off', () => {
    const now = vi.spyOn(performance, 'now');
    recordSpanEndingNow('a', 5);
    expect(now).not.toHaveBeenCalled();
  });

  it('records a span ending at the current time', () => {
    setSpanRecording(true);
    vi.spyOn(performance, 'now').mockReturnValue(150);
    recordSpanEndingNow('a', 50);
    expect(attributeLongTasks([{ startTime: 100, duration: 100 }], createOverlap()).byName.get('a')).toBe(50);
  });

  it('counts long-task time older than the full ring as unseen, not as page time', () => {
    setSpanRecording(true);
    for (let i = 0; i < SPAN_RING; i++) recordSpan('s', 1000 + i, 1000.5 + i);
    const o = attributeLongTasks([{ startTime: 900, duration: 150 }], createOverlap());
    expect(o.unseenMs).toBe(100);
  });

  it('reports nothing unseen while the ring has not wrapped', () => {
    setSpanRecording(true);
    recordSpan('a', 1000, 1010);
    expect(attributeLongTasks([{ startTime: 0, duration: 100 }], createOverlap()).unseenMs).toBe(0);
  });
});
