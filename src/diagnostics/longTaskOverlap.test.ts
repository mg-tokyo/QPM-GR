import { describe, expect, it } from 'vitest';
import { createOverlap, formatLongTaskProblem, formatLongTaskSegment, overlapWithTasks, topShares } from './longTaskOverlap';

const task = (start: number, end: number) => ({ start, end });
const span = (name: string, start: number, end: number) => ({ name, start, end });

describe('overlapWithTasks', () => {
  it('counts a span fully inside a long task', () => {
    const o = overlapWithTasks([span('a', 110, 140)], [task(100, 200)]);
    expect(o.taskMs).toBe(100);
    expect(o.qpmMs).toBe(30);
    expect(o.byName.get('a')).toBe(30);
  });

  it('clips a span straddling either edge of the task', () => {
    const o = overlapWithTasks([span('a', 80, 120), span('b', 190, 230)], [task(100, 200)]);
    expect(o.qpmMs).toBe(30);
    expect(o.byName.get('a')).toBe(20);
    expect(o.byName.get('b')).toBe(10);
  });

  it('ignores spans outside every task', () => {
    const o = overlapWithTasks([span('a', 10, 50), span('b', 200, 260)], [task(100, 200)]);
    expect(o.taskMs).toBe(100);
    expect(o.qpmMs).toBe(0);
    expect(o.byName.size).toBe(0);
  });

  it('does not double count nested spans; the inner span owns its time', () => {
    const o = overlapWithTasks([span('outer', 100, 180), span('inner', 120, 150)], [task(100, 200)]);
    expect(o.qpmMs).toBe(80);
    expect(o.byName.get('inner')).toBe(30);
    expect(o.byName.get('outer')).toBe(50);
  });

  it('counts partially overlapping sibling spans once', () => {
    const o = overlapWithTasks([span('a', 100, 140), span('b', 130, 160)], [task(100, 200)]);
    expect(o.qpmMs).toBe(60);
    expect((o.byName.get('a') ?? 0) + (o.byName.get('b') ?? 0)).toBe(60);
  });

  it('merges overlapping tasks so total and QPM time are not double counted', () => {
    const o = overlapWithTasks([span('a', 140, 170)], [task(100, 160), task(150, 200)]);
    expect(o.taskMs).toBe(100);
    expect(o.qpmMs).toBe(30);
  });

  it('accumulates across calls into the same result', () => {
    const acc = createOverlap();
    overlapWithTasks([span('a', 100, 120)], [task(100, 150)], acc);
    overlapWithTasks([span('a', 300, 310), span('b', 310, 330)], [task(300, 400)], acc);
    expect(acc.taskMs).toBe(150);
    expect(acc.qpmMs).toBe(50);
    expect(acc.byName.get('a')).toBe(30);
    expect(acc.byName.get('b')).toBe(20);
  });

  it('skips empty and inverted spans', () => {
    const o = overlapWithTasks([span('a', 120, 120), span('b', 150, 140)], [task(100, 200)]);
    expect(o.qpmMs).toBe(0);
  });
});

describe('formatLongTaskSegment', () => {
  it('omits the qpm part when there were no long tasks', () => {
    expect(formatLongTaskSegment(0, 0, createOverlap())).toBe('longtasks 0/15s (max 0ms)');
  });

  it('shows a zero lower bound when QPM owned none of the long-task time', () => {
    const o = overlapWithTasks([], [task(0, 2100)]);
    expect(formatLongTaskSegment(21, 163, o)).toBe('longtasks 21/15s (max 163ms, qpm ≥0/2100ms)');
  });

  it('says how much long-task time the span ring no longer covered', () => {
    const o = overlapWithTasks([], [task(0, 2100)]);
    o.unseenMs = 300;
    expect(formatLongTaskSegment(21, 163, o)).toBe('longtasks 21/15s (max 163ms, qpm ≥0/2100ms, 300ms unseen)');
  });

  it('names the top two QPM spans by share', () => {
    const o = overlapWithTasks(
      [span('timers:busy', 0, 96), span('stateTree.event', 96, 114), span('dom.flush', 114, 120)],
      [task(0, 2100)],
    );
    expect(formatLongTaskSegment(21, 163, o))
      .toBe('longtasks 21/15s (max 163ms, qpm ≥120/2100ms [of qpm: timers:busy 80%, stateTree.event 15%])');
  });
});

describe('formatLongTaskProblem', () => {
  it('names the page as owner with a zero QPM share', () => {
    const o = overlapWithTasks([], [task(0, 1950)]);
    expect(formatLongTaskProblem(13, o)).toBe('page longtasks 13/15s (qpm ≥0%)');
  });

  it('adds the dominant QPM span when QPM owned some of the time', () => {
    const o = overlapWithTasks([span('timers:busy', 0, 900)], [task(0, 1800)]);
    expect(formatLongTaskProblem(15, o)).toBe('page longtasks 15/15s (qpm ≥50% [timers:busy])');
  });

  it('shows the max when the caller passes it (the single-task rule tripped)', () => {
    const o = overlapWithTasks([], [task(0, 700)]);
    expect(formatLongTaskProblem(2, o, 620)).toBe('page longtasks 2/15s, max 620ms (qpm ≥0%)');
  });
});

describe('topShares', () => {
  it('orders names by share of QPM long-task time and caps the list', () => {
    const o = overlapWithTasks(
      [span('a', 100, 180), span('b', 180, 195), span('c', 195, 200)],
      [task(100, 200)],
    );
    expect(topShares(o, 2)).toEqual([{ name: 'a', pct: 80 }, { name: 'b', pct: 15 }]);
  });

  it('drops names whose share rounds to 0%', () => {
    const o = overlapWithTasks([span('a', 100, 199.8), span('b', 199.8, 200)], [task(100, 200)]);
    expect(topShares(o, 2)).toEqual([{ name: 'a', pct: 100 }]);
  });

  it('is empty when QPM owned no long-task time', () => {
    expect(topShares(createOverlap(), 2)).toEqual([]);
  });
});
