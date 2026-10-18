import { describe, expect, it } from 'vitest';
import type { Node3 } from '../types';
import { PLAN_CARD, PLAN_OTHER, PLAN_TILE, WalkPlan } from './walkPlan';

const node = (): Node3 => ({}) as Node3;

describe('WalkPlan (perf Task 13)', () => {
  it('knows the kind of a child only while the same node sits at that index', () => {
    const p = new WalkPlan<string>();
    const a = node(), b = node();
    expect(p.kindAt(0, a)).toBe(-1);
    p.set(0, a, PLAN_CARD, null);
    p.set(1, b, PLAN_TILE, 'rec-b');
    p.end(2);
    expect([p.kindAt(0, a), p.kindAt(1, b), p.rec(1)]).toEqual([PLAN_CARD, PLAN_TILE, 'rec-b']);
    // b moved down one slot (a child inserted before it): unknown there until classified again.
    expect(p.kindAt(2, b)).toBe(-1);
    expect(p.kindAt(0, b)).toBe(-1);
  });

  it('a re-set slot takes the new kind and drops the old record', () => {
    const p = new WalkPlan<string>();
    const a = node();
    p.set(0, a, PLAN_TILE, 'r');
    p.set(0, a, PLAN_OTHER, null);
    expect([p.kindAt(0, a), p.rec(0)]).toEqual([PLAN_OTHER, null]);
  });

  it('end() lets go of the nodes past World\'s end; reset() of every node', () => {
    const p = new WalkPlan<string>();
    const kids = Array.from({ length: 100 }, node);
    kids.forEach((n, i) => p.set(i, n, PLAN_TILE, `r${i}`));
    p.end(100);
    p.end(40);
    expect(p.size()).toBe(40);
    expect([p.kindAt(39, kids[39]!), p.kindAt(40, kids[40]!), p.rec(40)]).toEqual([PLAN_TILE, -1, null]);
    p.reset();
    expect([p.size(), p.kindAt(0, kids[0]!), p.rec(0)]).toEqual([0, -1, null]);
  });

  it('grows past its first capacity', () => {
    const p = new WalkPlan<null>();
    const kids = Array.from({ length: 5000 }, node);
    kids.forEach((n, i) => p.set(i, n, i % 3, null));
    p.end(kids.length);
    expect(kids.every((n, i) => p.kindAt(i, n) === i % 3)).toBe(true);
  });
});
