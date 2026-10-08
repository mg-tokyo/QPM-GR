import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import { ObsPoint, PixiNode } from '../__test__/fakePixi';
import { PersistTable, dualStateWorks } from './persist';

// One 3D frame as the frame runner drives it: pre (apply), the render, post (finish).
function frame(t: PersistTable, n: number, place: Array<[PixiNode, number, number, number]>): void {
  t.begin(n);
  for (const [nd, x, y, s] of place) t.apply(nd.node, x, y, s, s);
  for (const [nd] of place) nd.render();
  t.finish();
}

describe('dualStateWorks (install self-test)', () => {
  it('passes on PIXI 8 Container internals', () => {
    expect(dualStateWorks(PixiNode)).toBe(true);
  });

  it('fails on a missing class, a node without the internals, or a constructor that throws', () => {
    expect(dualStateWorks(undefined)).toBe(false);
    expect(dualStateWorks(FakeNode)).toBe(false);
    expect(dualStateWorks(class { constructor() { throw new Error('no'); } })).toBe(false);
  });

  it('fails when the change tick is not the local-transform cache key, or an equal write notifies', () => {
    class NoRecompute extends PixiNode { override updateLocalTransform(): void { /* cached forever */ } }
    class Noisy extends PixiNode {
      constructor() { super(); (this as { _position: ObsPoint })._position = new AlwaysNotify(this, 0, 0); }
    }
    class AlwaysNotify extends ObsPoint {
      constructor(private readonly o: { _onUpdate(p?: unknown): void }, x: number, y: number) { super(o, x, y); }
      override set(x = 0, y = x): this { this._x = x; this._y = y; this.o._onUpdate(this); return this; }
    }
    expect(dualStateWorks(NoRecompute)).toBe(false);
    expect(dualStateWorks(Noisy)).toBe(false);
  });
});

describe('PersistTable (perf Task 3: dual state for tile views)', () => {
  it('between frames the fields and local walks read 2D, while the render cache keeps 3D', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    expect(t.apply(a.node, 640, 300, 0.5, 0.5)).toBe(true);
    a.render();
    t.finish();
    expect(a.fields()).toEqual([100, 200, 1, 1]);
    expect(a.drawn()).toEqual([640, 300, 0.5, 0.5]);
    expect(a.didChange).toBe(false);
    a.updateLocalTransform();
    expect([a.localTransform.tx, a.localTransform.ty, a.localTransform.a]).toEqual([100, 200, 1]);
    expect(t.base(a.node)).toEqual({ x: 100, y: 200, sx: 1, sy: 1 });
  });

  it('a still frame writes nothing: no _onUpdate, no walk, the same 3D drawn', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    frame(t, 1, [[a, 640, 300, 0.5]]);
    const updates = a.updates, walks = a.walks;
    frame(t, 2, [[a, 640, 300, 0.5]]);
    frame(t, 3, [[a, 640, 300, 0.5]]);
    expect([a.updates, a.walks]).toEqual([updates, walks]);
    expect(a.drawn()).toEqual([640, 300, 0.5, 0.5]);
    expect(t.stats()).toMatchObject({ held: 1, silent: 2, gameWrites: 0 });
  });

  it('a moved camera re-walks the node once with the new 3D', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    frame(t, 1, [[a, 640, 300, 0.5]]);
    const walks = a.walks;
    frame(t, 2, [[a, 650, 300, 0.5]]);
    expect(a.walks).toBe(walks + 1);
    expect(a.drawn()).toEqual([650, 300, 0.5, 0.5]);
    expect(a.fields()).toEqual([100, 200, 1, 1]);
  });

  it('a game write between frames becomes the new base, and the node is drawn from it', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    frame(t, 1, [[a, 640, 300, 0.5]]);
    a.position.set(120, 200);
    t.begin(2);
    expect(t.base(a.node)).toEqual({ x: 120, y: 200, sx: 1, sy: 1 });
    t.apply(a.node, 660, 300, 0.5, 0.5);
    expect(t.base(a.node)).toEqual({ x: 120, y: 200, sx: 1, sy: 1 });
    a.render();
    t.finish();
    expect(a.fields()).toEqual([120, 200, 1, 1]);
    expect(a.drawn()).toEqual([660, 300, 0.5, 0.5]);
    expect(t.stats().gameWrites).toBe(1);
  });

  it('any _onUpdate between frames (an alpha flip) skips the silent put-back but still draws the 3D value', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    frame(t, 1, [[a, 640, 300, 0.5]]);
    a._onUpdate();
    frame(t, 2, [[a, 640, 300, 0.5]]);
    expect(a.drawn()).toEqual([640, 300, 0.5, 0.5]);
    expect(a.fields()).toEqual([100, 200, 1, 1]);
  });

  it('a node that left the drawn set is released on that frame: woken, so the next render draws its 2D base', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1), b = new PixiNode(300, 400, 2);
    frame(t, 1, [[a, 640, 300, 0.5], [b, 700, 310, 1]]);
    t.stats();
    frame(t, 2, [[a, 640, 300, 0.5]]);
    expect(b.didChange).toBe(true);
    b.render();
    expect(b.drawn()).toEqual([300, 400, 2, 2]);
    expect(t.base(b.node)).toBeNull();
    expect(t.stats()).toMatchObject({ held: 1, restores: 1 });
    // Back in view later: drawn from its 2D base like a first placement.
    frame(t, 3, [[a, 640, 300, 0.5], [b, 710, 310, 1]]);
    expect(b.drawn()).toEqual([710, 310, 1, 1]);
    expect(b.fields()).toEqual([300, 400, 2, 2]);
  });

  it('release mid-frame puts the base back and wakes the node', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    frame(t, 1, [[a, 640, 300, 0.5]]);
    t.begin(2);
    t.apply(a.node, 650, 300, 0.5, 0.5);
    t.release(a.node);
    expect(a.fields()).toEqual([100, 200, 1, 1]);
    a.render();
    expect(a.drawn()).toEqual([100, 200, 1, 1]);
    t.finish();
    expect(a.fields()).toEqual([100, 200, 1, 1]);
    expect(t.stats().held).toBe(0);
  });

  it('releaseAll between frames wakes every held node; the next render draws 2D everywhere', () => {
    const t = new PersistTable(true);
    const nodes = [new PixiNode(100, 200, 1), new PixiNode(300, 400, 2), new PixiNode(500, 600, 3)];
    frame(t, 1, nodes.map((n, i): [PixiNode, number, number, number] => [n, 600 + i, 300, 0.5]));
    frame(t, 2, nodes.map((n, i): [PixiNode, number, number, number] => [n, 600 + i, 300, 0.5]));
    t.releaseAll();
    t.releaseAll();
    for (const n of nodes) { n.render(); expect(n.drawn()).toEqual(n.fields()); }
    expect(nodes.map((n) => n.fields()[0])).toEqual([100, 300, 500]);
    expect(t.stats()).toMatchObject({ held: 0 });
  });

  it('releaseAll while a frame is pending restores the base of nodes applied this frame', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    frame(t, 1, [[a, 640, 300, 0.5]]);
    t.begin(2);
    t.apply(a.node, 640, 300, 0.5, 0.5);
    t.releaseAll();
    t.finish();
    a.render();
    expect(a.fields()).toEqual([100, 200, 1, 1]);
    expect(a.drawn()).toEqual([100, 200, 1, 1]);
  });

  it('applied twice in a frame, or after a frame that never finished: the base stays the 2D one', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    t.begin(1);
    t.apply(a.node, 640, 300, 0.5, 0.5);
    t.apply(a.node, 641, 300, 0.5, 0.5);
    t.begin(2);
    t.apply(a.node, 642, 300, 0.5, 0.5);
    expect(t.base(a.node)).toEqual({ x: 100, y: 200, sx: 1, sy: 1 });
    a.render();
    t.finish();
    expect(a.fields()).toEqual([100, 200, 1, 1]);
    expect(a.drawn()).toEqual([642, 300, 0.5, 0.5]);
    expect(t.stats().held).toBe(1);
  });

  it('a destroyed node is never written', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1), b = new PixiNode(300, 400, 2);
    t.begin(1);
    t.apply(a.node, 640, 300, 0.5, 0.5);
    t.apply(b.node, 700, 300, 0.5, 0.5);
    a.destroy();
    t.finish();
    expect(a.fields()).toEqual([640, 300, 0.5, 0.5]);
    b.destroy();
    const updates = b.updates;
    t.releaseAll();
    expect(b.updates).toBe(updates);
    expect(b.fields()).toEqual([300, 400, 2, 2]);
  });

  it('disabled (the self-test failed): writes nothing and holds nothing, so the caller sets and restores as before', () => {
    const t = new PersistTable(false);
    const a = new PixiNode(100, 200, 1);
    t.begin(1);
    expect(t.apply(a.node, 640, 300, 0.5, 0.5)).toBe(false);
    t.finish();
    expect(a.fields()).toEqual([100, 200, 1, 1]);
    expect(t.stats()).toMatchObject({ enabled: false, held: 0 });
  });

  // One still frame that keeps the given nodes instead of placing them (perf Task 4).
  const keptFrame = (t: PersistTable, n: number, keep: PixiNode[], render: PixiNode[] = keep): boolean[] => {
    t.begin(n);
    const r = keep.map((nd) => t.keep(nd.node));
    for (const nd of render) nd.render();
    t.finish();
    return r;
  };

  it('keep: a node held last frame that nothing wrote is held again with no write, no walk, and 3D in its fields for the frame', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    frame(t, 1, [[a, 640, 300, 0.5]]);
    const updates = a.updates, walks = a.walks;
    t.begin(2);
    expect(t.keep(a.node)).toBe(true);
    expect(a.fields()).toEqual([640, 300, 0.5, 0.5]);
    a.render();
    t.finish();
    expect(a.fields()).toEqual([100, 200, 1, 1]);
    expect(keptFrame(t, 3, [a])).toEqual([true]);
    expect([a.updates, a.walks]).toEqual([updates, walks]);
    expect(a.drawn()).toEqual([640, 300, 0.5, 0.5]);
    expect(t.stats()).toMatchObject({ held: 1, gameWrites: 0, restores: 0 });
  });

  it('keep refuses a node written since (a game write, an alpha flip): apply takes the new base as before', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1), b = new PixiNode(300, 400, 1);
    frame(t, 1, [[a, 640, 300, 0.5], [b, 700, 300, 0.5]]);
    a.position.set(120, 200);
    b._onUpdate();
    t.begin(2);
    expect([t.keep(a.node), t.keep(b.node)]).toEqual([false, false]);
    t.apply(a.node, 660, 300, 0.5, 0.5);
    t.apply(b.node, 700, 300, 0.5, 0.5);
    a.render(); b.render();
    t.finish();
    expect(a.fields()).toEqual([120, 200, 1, 1]);
    expect(a.drawn()).toEqual([660, 300, 0.5, 0.5]);
    expect(b.drawn()).toEqual([700, 300, 0.5, 0.5]);
  });

  it('keep refuses a node never held, released, destroyed, or held while disabled', () => {
    const t = new PersistTable(true);
    const fresh = new PixiNode(1, 2, 1), gone = new PixiNode(3, 4, 1), dead = new PixiNode(5, 6, 1), kept = new PixiNode(7, 8, 1);
    frame(t, 1, [[gone, 640, 300, 0.5], [dead, 650, 300, 0.5], [kept, 660, 300, 0.5]]);
    frame(t, 2, [[dead, 650, 300, 0.5], [kept, 660, 300, 0.5]]);
    dead.destroy();
    expect(keptFrame(t, 3, [fresh, gone, dead, kept])).toEqual([false, false, false, true]);
    t.setEnabled(false);
    t.begin(4);
    expect(t.keep(kept.node)).toBe(false);
  });

  it('a node neither kept nor applied this frame is released, kept ones stay held', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1), b = new PixiNode(300, 400, 1);
    frame(t, 1, [[a, 640, 300, 0.5], [b, 700, 300, 0.5]]);
    t.stats();
    keptFrame(t, 2, [a], [a, b]);
    expect(b.didChange).toBe(true);
    expect(t.base(b.node)).toBeNull();
    expect(t.stats()).toMatchObject({ held: 1, restores: 1 });
    t.releaseAll();
    a.render();
    expect(a.drawn()).toEqual([100, 200, 1, 1]);
  });

  it('releaseAll while a kept frame is pending puts the base back', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    frame(t, 1, [[a, 640, 300, 0.5]]);
    t.begin(2);
    t.keep(a.node);
    t.releaseAll();
    t.finish();
    a.render();
    expect(a.fields()).toEqual([100, 200, 1, 1]);
    expect(a.drawn()).toEqual([100, 200, 1, 1]);
  });

  it('turned off live (debug lever): everything held is released first', () => {
    const t = new PersistTable(true);
    const a = new PixiNode(100, 200, 1);
    frame(t, 1, [[a, 640, 300, 0.5]]);
    expect(t.setEnabled(false)).toBe(false);
    a.render();
    expect(a.drawn()).toEqual([100, 200, 1, 1]);
    t.begin(2);
    expect(t.apply(a.node, 640, 300, 0.5, 0.5)).toBe(false);
    expect(t.setEnabled(true)).toBe(true);
    expect(new PersistTable(false).setEnabled(true)).toBe(false);
  });
});
