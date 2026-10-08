import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { LiftEntry, ScreenMap } from '../frame/drawn';
import type { Node3, XY } from '../types';
import { collectLeafHits, type LeafHit } from './leafHits';

// A plant tile at (5000, 4000): a body sprite on the (0,0) chain and a produce slot at (0, 150) whose art (200 × 100,
// anchor y 0.88) spans World y 4062–4162 in 2D.
function scene() {
  const world = new FakeNode();
  const body = new FakeNode().withTexture(300, 300, 1);
  const fruit = new FakeNode().withTexture(200, 100, 0.88);
  const slot = new FakeNode(0, 150, 1, [fruit]);
  const tile = world.addChild(new FakeNode(5000, 4000, 1, [new FakeNode(0, 0, 1, [body, slot])]));
  // The card draws (5000, 4000) at screen (500, 300), half size; the lifted slot stands on its own ground point.
  const card: ScreenMap = { x: 5000, y: 4000, px: 500, py: 300, mm: 0.5 };
  const lift: LiftEntry = { node: slot.node, owner: tile.node, x: 5000, y: 4162, px: 520, py: 420, mm: 0.4 };
  return { world, tile, body, fruit, slot, card, lift };
}

const run = (s: ReturnType<typeof scene>, cx: number, cy: number, lifts: (n: Node3) => LiftEntry | null, skip: (n: Node3) => boolean = () => false): LeafHit[] => {
  const acc: LeafHit[] = [];
  collectLeafHits(s.tile.node, s.card, cx, cy, s.world.node, lifts, skip, acc, [] as XY[]);
  return acc;
};

describe('collectLeafHits', () => {
  it('hits a leaf through its card map and reports the cursor\'s 2D World point on it', () => {
    const s = scene();
    const hits = run(s, 500, 290, () => null);
    expect(hits.map((h) => h.leaf)).toEqual([s.body.node]);
    expect([hits[0]!.wx, hits[0]!.wy]).toEqual([5000, 3980]);
    expect(hits[0]!.map).toBe(s.card);
  });

  it('reads a lifted unit through its own map: the fruit is hit where it is drawn (A I6)', () => {
    const s = scene();
    const lifts = (n: Node3): LiftEntry | null => (n === s.slot.node ? s.lift : null);
    // Screen (520, 400) is on the fruit as drawn lifted; through the card map it is World (5040, 4200), below its art.
    expect(run(s, 520, 400, () => null)).toEqual([]);
    const hits = run(s, 520, 400, lifts);
    expect(hits.length).toBe(1);
    expect(hits[0]!.leaf).toBe(s.fruit.node);
    expect(hits[0]!.map).toBe(s.lift);
    expect(hits[0]!.wx).toBeCloseTo(5000, 9);
    expect(hits[0]!.wy).toBeCloseTo(4112, 9);
  });

  it('keeps the entity\'s child order when both a lifted unit and the card are under the cursor', () => {
    const s = scene();
    // Make the lifted fruit draw over the body's area: same screen spot hits both, each through its own map.
    const lift: LiftEntry = { ...s.lift, px: 500, py: 290 + 0.4 * 50 };
    const hits = run(s, 500, 290, (n) => (n === s.slot.node ? lift : null));
    expect(hits.map((h) => h.leaf)).toEqual([s.fruit.node, s.body.node]);
  });

  it('skips a lifted unit that is not drawn (behind the lens: mm 0) instead of reading it through the card', () => {
    const s = scene();
    // Screen (500, 375) is on the fruit through the card map (World 5000, 4150).
    expect(run(s, 500, 375, () => null).map((h) => h.leaf)).toEqual([s.fruit.node]);
    const gone: LiftEntry = { ...s.lift, mm: 0 };
    expect(run(s, 500, 375, (n) => (n === s.slot.node ? gone : null))).toEqual([]);
  });

  it('skips hidden, transparent and skipped subtrees', () => {
    const s = scene();
    s.body.visible = false;
    expect(run(s, 500, 290, () => null)).toEqual([]);
    s.body.visible = true;
    s.body.alpha = 0;
    expect(run(s, 500, 290, () => null)).toEqual([]);
    s.body.alpha = 1;
    expect(run(s, 500, 290, () => null, (n) => n === s.body.node)).toEqual([]);
  });
});
