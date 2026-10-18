import { describe, expect, it } from 'vitest';
import { activityScore, createDirector, directorTiming, type Director } from './director';

const S = 1000;
const cfg = { minMs: 8 * S, maxMs: 30 * S, early: true, margin: 1.5 };

function burst(d: Director, id: string, at: number, n = 1): void {
  for (let i = 0; i < n; i++) d.observe({ id, at: at + i, kind: 'action' });
}

describe('directorTiming', () => {
  it('derives min from max: 8 s at 30 s', () => {
    expect(directorTiming(30)).toEqual({ minMs: 8000, maxMs: 30000 });
    expect(directorTiming(60)).toEqual({ minMs: 16000, maxMs: 60000 });
  });
});

describe('activityScore', () => {
  it('weights recent actions above old ones', () => {
    expect(activityScore([100 * S], null, 101 * S)).toBeGreaterThan(activityScore([80 * S], null, 101 * S));
    expect(activityScore([90 * S], null, 100 * S)).toBeCloseTo(0.5, 5);
  });

  it('adds a movement bonus that fades, and ignores actions past the window', () => {
    expect(activityScore([], 100 * S, 100 * S)).toBeCloseTo(0.5, 5);
    expect(activityScore([], 100 * S, 110 * S)).toBeLessThan(0.1);
    expect(activityScore([0], null, 61 * S)).toBe(0);
    expect(activityScore([], null, 0)).toBe(0);
  });
});

describe('createDirector', () => {
  it('picks the most active candidate at once when nobody is followed', () => {
    const d = createDirector(cfg);
    burst(d, 'b', 0, 3);
    burst(d, 'a', 0, 1);
    expect(d.tick(1 * S, null, ['a', 'b', 'c'])).toBe('b');
    expect(d.tick(1 * S, null, [])).toBeNull();
  });

  it('never returns an offline player (not a candidate), even the most active', () => {
    const d = createDirector(cfg);
    burst(d, 'gone', 0, 10);
    burst(d, 'a', 0, 1);
    expect(d.tick(1 * S, null, ['a', 'b'])).toBe('a');
    d.reset('a', 1 * S);
    expect(d.tick(40 * S, 'a', ['a', 'b'])).toBe('b');
  });

  it('replaces a followed player who left at once, without waiting for the dwell', () => {
    const d = createDirector(cfg);
    d.reset('a', 0);
    burst(d, 'b', 0);
    expect(d.tick(1 * S, 'a', ['b', 'c'])).toBe('b');
  });

  it('stays at least min, whatever the others do', () => {
    const d = createDirector(cfg);
    d.reset('a', 0);
    burst(d, 'b', 1 * S, 20);
    for (let t = 1 * S; t < 8 * S; t += 500) expect(d.tick(t, 'a', ['a', 'b'])).toBeNull();
    expect(d.tick(8 * S, 'a', ['a', 'b'])).toBe('b');
  });

  it('switches early after min only at 1.5x the current score', () => {
    const d = createDirector(cfg);
    d.reset('a', 0);
    burst(d, 'a', 9 * S, 4);
    burst(d, 'b', 9 * S, 4);
    expect(d.tick(9 * S + 10, 'a', ['a', 'b'])).toBeNull();
    burst(d, 'b', 9 * S + 20, 1);
    expect(d.tick(9 * S + 30, 'a', ['a', 'b'])).toBeNull();
    burst(d, 'b', 9 * S + 40, 2);
    expect(d.tick(9 * S + 50, 'a', ['a', 'b'])).toBe('b');
  });

  it('needs real activity for an early switch: a walk past an idle current player is not enough', () => {
    const d = createDirector(cfg);
    d.reset('a', 0);
    d.observe({ id: 'b', at: 9 * S, kind: 'move' });
    expect(d.tick(9 * S, 'a', ['a', 'b'])).toBeNull();
    burst(d, 'b', 10 * S);
    expect(d.tick(10 * S, 'a', ['a', 'b'])).toBe('b');
  });

  it('never switches early when early is off', () => {
    const d = createDirector({ ...cfg, early: false });
    d.reset('a', 0);
    burst(d, 'b', 9 * S, 10);
    expect(d.tick(10 * S, 'a', ['a', 'b'])).toBeNull();
    expect(d.tick(30 * S, 'a', ['a', 'b'])).toBe('b');
  });

  it('switches at max even when all are idle, round robin through the seats', () => {
    const d = createDirector(cfg);
    const seats = ['a', 'b', 'c'];
    let cur = 'a';
    let now = 0;
    d.reset(cur, now);
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      now += 30 * S;
      const pick = d.tick(now, cur, seats);
      expect(pick).not.toBeNull();
      cur = pick ?? cur;
      d.reset(cur, now);
      order.push(cur);
    }
    expect(order).toEqual(['b', 'c', 'a', 'b']);
  });

  it('at max prefers the busiest other player over the round robin', () => {
    const d = createDirector(cfg);
    d.reset('a', 0);
    burst(d, 'c', 25 * S);
    expect(d.tick(30 * S, 'a', ['a', 'b', 'c'])).toBe('c');
  });

  it('a tie is measured from the top score, never chained down through near-ties', () => {
    const d = createDirector(cfg);
    d.reset('c', 0);
    d.reset('b', 1 * S);
    d.reset('a', 2 * S);
    d.reset('x', 3 * S);
    const now = 33 * S;
    d.observe({ id: 'a', at: now, kind: 'action' });
    d.observe({ id: 'b', at: now - 589, kind: 'action' });
    d.observe({ id: 'c', at: now - 1203, kind: 'action' });
    expect(d.score('b', now)).toBeCloseTo(0.96, 2);
    expect(d.score('c', now)).toBeCloseTo(0.92, 2);
    expect(d.tick(now, 'x', ['x', 'a', 'b', 'c'])).toBe('b');
  });

  it('stays put at max when there is nobody else', () => {
    const d = createDirector(cfg);
    d.reset('a', 0);
    expect(d.tick(31 * S, 'a', ['a'])).toBeNull();
  });

  it('never ping-pongs under alternating bursts', () => {
    const d = createDirector(cfg);
    let cur = 'a';
    d.reset(cur, 0);
    const switches: number[] = [];
    for (let t = 0; t <= 120 * S; t += 100) {
      // a and b take turns: three actions every 5 s each, 2.5 s apart.
      if (t % (5 * S) === 0) burst(d, 'a', t, 3);
      if (t % (5 * S) === 2500) burst(d, 'b', t, 3);
      const pick = d.tick(t, cur, ['a', 'b']);
      if (pick) { cur = pick; d.reset(cur, t); switches.push(t); }
    }
    for (let i = 1; i < switches.length; i++) expect(switches[i]! - switches[i - 1]!).toBeGreaterThanOrEqual(cfg.minMs);
    // Comparable activity never clears the margin, so only the max dwell moves the camera.
    expect(switches).toEqual([30 * S, 60 * S, 90 * S, 120 * S]);
  });

  it('reset on a manual pick restarts the dwell on the new player', () => {
    const d = createDirector(cfg);
    d.reset('a', 0);
    burst(d, 'c', 19 * S, 5);
    d.reset('b', 20 * S);
    expect(d.tick(27 * S, 'b', ['a', 'b', 'c'])).toBeNull();
    expect(d.tick(28 * S, 'b', ['a', 'b', 'c'])).toBe('c');
  });

  it('a target changed without reset starts a fresh dwell', () => {
    const d = createDirector(cfg);
    d.reset('a', 0);
    burst(d, 'a', 9 * S, 5);
    expect(d.tick(10 * S, 'b', ['a', 'b'])).toBeNull();
    expect(d.tick(18 * S, 'b', ['a', 'b'])).toBe('a');
  });

  it('configure changes the timing from the next tick', () => {
    const d = createDirector(cfg);
    d.reset('a', 0);
    expect(d.tick(12 * S, 'a', ['a', 'b'])).toBeNull();
    d.configure({ ...cfg, ...directorTiming(10) });
    expect(d.tick(12 * S, 'a', ['a', 'b'])).toBe('b');
  });

  it('keeps a bounded history per player', () => {
    const d = createDirector(cfg);
    burst(d, 'a', 0, 500);
    expect(d.score('a', 1 * S)).toBeLessThanOrEqual(32);
    expect(d.score('a', 1 * S)).toBeGreaterThan(30);
    expect(d.score('nobody', 1 * S)).toBe(0);
  });
});
