import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import { DrawnTable, FullSaves } from '../frame/drawn';
import { ROLL_SLICES, cullSlot, type FrameCtx } from '../frame/frame';
import { makeBasis, project } from '../math/camera';
import { createEntityPass, newPlacement, placeBillboard } from './entities';

const W = 1000, H = 600, k = 1.5, fov = (20 * Math.PI) / 180;

function topDownCtx(): FrameCtx {
  const fpx = H / 2 / Math.tan(fov / 2);
  const params = { yaw: 0, pitch: Math.PI / 2, dist: fpx / k, fov, lookH: 0, yOff: 0, near: 40, far: 9000 };
  // reCull false: placeBillboard keeps the game's visibility, so only raw() and put() are reached on `ov`.
  const ov = { put: () => undefined, drop: () => undefined, raw: () => true };
  return {
    basis: makeBasis(params, 5000, 4000, W, H), params, out: [0, 0, 0], ov, reCull: false, roll: -1, W, H,
    marginX: W * 0.75, marginTop: H * 0.75, drawn: new DrawnTable(), saves: new FullSaves(), dx: 0, dz: -1, frameNo: 1,
  } as unknown as FrameCtx;
}

describe('placeBillboard (art-row formula)', () => {
  it('straight down, every stand row puts the node exactly where 2D draws it', () => {
    for (const standY of [3900, 4100, 4500]) {
      const n = new FakeNode(5100, 3900).withTexture(100, 100, 1);
      n.anchor!.set(0.2, 1);
      const key = placeBillboard(topDownCtx(), n.node, { isTile: false, standY, depthY: standY, tiebreak: 0, artRow: true }, newPlacement());
      expect(key).not.toBeNull();
      expect(n.x).toBeCloseTo(W / 2 + k * (5100 - 5000), 6);
      expect(n.y).toBeCloseTo(H / 2 + k * (3900 - 4000), 6);
      expect(n.scale.x).toBeCloseTo(k, 9);
    }
  });

  it('tilted, a separate art row stands on the ground point and the placement keeps the shift', () => {
    const ctx = topDownCtx();
    const params = { ...ctx.params, pitch: (30 * Math.PI) / 180 };
    const tilted = { ...ctx, params, basis: makeBasis(params, 5000, 4000, W, H) } as FrameCtx;
    const n = new FakeNode(5100, 3900).withTexture(100, 100, 1);
    const lp = newPlacement();
    placeBillboard(tilted, n.node, { isTile: true, standY: 3900, artY: 4100, depthY: 3900, tiebreak: 0, artRow: true }, lp);
    const out = [0, 0, 0];
    project(tilted.basis, 5100, 0, 3900, out);
    const mm = tilted.basis.fpx / out[2]!;
    expect(n.y).toBeCloseTo(out[1]! - (4100 - 3900) * mm, 6);
    expect(lp.gdy).toBe(-200);
  });

  it('the entity pass visits the game children only and picks up a child added later', () => {
    const world = new FakeNode();
    const a = world.addChild(new FakeNode(5000, 4000)), qpm = world.addChild(new FakeNode(5100, 4000));
    const seen: unknown[] = [];
    const skip = new WeakSet<object>([qpm.node]);
    const pass = createEntityPass({ skip, buildings: null, layers: null, standRow: (_c: unknown, n: unknown, y: number) => { seen.push(n); return y; }, afterPlace: null, fade: null, placeMask: null } as never);
    const ctx = topDownCtx();
    const ov = { put: () => undefined, drop: () => undefined, raw: () => true, gameValue: () => 0 };
    const frame = { ...ctx, ov, reCull: true, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } } } as unknown as FrameCtx;
    pass.pre(frame);
    expect(seen).toEqual([a.node]);
    frame.drawn.restore(); // post() between frames
    const b = world.addChild(new FakeNode(5200, 4000));
    seen.length = 0;
    pass.pre(frame);
    expect(seen).toEqual([a.node, b.node]);
  });

  it('between full re-culls a hidden entity is re-decided only in its own rolling slice', () => {
    const world = new FakeNode();
    world.addChild(new FakeNode(5000, 4000));
    const b = world.addChild(new FakeNode(5200, 4000));
    const seen: unknown[] = [];
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: (_c: unknown, n: unknown, y: number) => { seen.push(n); return y; }, afterPlace: null, fade: null, placeMask: null } as never);
    const ov = { put: () => undefined, drop: () => undefined, raw: () => false, gameValue: () => 0 };
    const at = (roll: number): FrameCtx => ({ ...topDownCtx(), ov, roll, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } } }) as unknown as FrameCtx;
    pass.pre(at(-1));
    expect(seen).toEqual([]);
    pass.pre(at(cullSlot(5200, 4000) & (ROLL_SLICES - 1)));
    expect(seen).toEqual([b.node]);
  });

  it('a re-checked entity outside the view is culled before its stand row', () => {
    const world = new FakeNode();
    const near = world.addChild(new FakeNode(5100, 4000));
    world.addChild(new FakeNode(50000, 4000));
    const seen: unknown[] = [];
    const hidden: unknown[] = [];
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: (_c: unknown, n: unknown, y: number) => { seen.push(n); return y; }, afterPlace: null, fade: null, placeMask: null } as never);
    const ov = { put: (k: string, n: unknown, v: unknown) => { if (k === 'visible' && v === false) hidden.push(n); }, drop: () => undefined, raw: () => true, gameValue: () => 0 };
    pass.pre({ ...topDownCtx(), ov, reCull: true, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } } } as unknown as FrameCtx);
    expect(seen).toEqual([near.node]);
    expect(hidden).toHaveLength(1);
  });

  it('records the 2D transform so post() can restore it', () => {
    const ctx = topDownCtx();
    const n = new FakeNode(5100, 3900).withTexture(100, 100, 1);
    placeBillboard(ctx, n.node, { isTile: false, standY: 4100, depthY: 4100, tiebreak: 0, artRow: true }, newPlacement());
    ctx.drawn.restore();
    expect([n.x, n.y, n.scale.x]).toEqual([5100, 3900, 1]);
  });

  it('first person hands the avatar to the held handler, and hides it only when the handler declines', () => {
    const world = new FakeNode();
    const avatar = world.addChild(new FakeNode(5000, 4000));
    const puts: unknown[][] = [];
    const ov = { put: (...a: unknown[]) => { puts.push(a); }, drop: () => undefined, raw: () => true, gameValue: () => 0 };
    let accept = true;
    const calls: string[] = [];
    const held = {
      begin: () => { calls.push('begin'); }, firstPerson: () => { calls.push('fp'); return accept; },
      release: () => { calls.push('release'); }, drop: () => undefined, stats: () => ({}),
    };
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: null, afterPlace: null, fade: null, placeMask: null, held } as never);
    const frame = { ...topDownCtx(), ov, hideSelf: true, avatar: avatar.node, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } } } as unknown as FrameCtx;
    pass.pre(frame);
    expect(calls).toEqual(['begin', 'fp']);
    expect(puts).not.toContainEqual(['visible', avatar.node, false]);
    accept = false;
    pass.pre(frame);
    expect(puts).toContainEqual(['visible', avatar.node, false]);
  });
});
