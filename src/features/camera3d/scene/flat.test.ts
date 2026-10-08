import { describe, expect, it } from 'vitest';
import { cullOf } from '../__test__/cullOf';
import { FakeMatrix } from '../__test__/fakeMatrix';
import { FakeNode } from '../__test__/fakeNode';
import { mayShow } from '../frame/cull';
import { RING_PX, type FrameCtx } from '../frame/frame';
import { groundRay, makeBasis, type CamParams } from '../math/camera';
import { BUILDING_DECAL_Z, MARKER_Z } from '../math/depth';
import type { Mat, Node3 } from '../types';
import type { AreaTileSink } from './areaMarks';
import { createFlatPlacer, groundAffine, placeFlat } from './flat';

const D = Math.PI / 180;
const W = 1280, H = 656;

// Override fake: the game's value lives on the node, ours in the map (pin: kept until dropped).
function fakeOv() {
  const over = new Map<string, Map<object, unknown>>();
  const slot = (k: string) => { let m = over.get(k); if (!m) { m = new Map(); over.set(k, m); } return m; };
  return {
    put(k: string, n: object, v: unknown) { slot(k).set(n, v); },
    drop(k: string, n: object) { slot(k).delete(n); },
    gameValue: (k: string, n: object) => (n as Record<string, unknown>)[k],
    raw: (k: string, n: object) => (slot(k).has(n) ? slot(k).get(n) : (n as Record<string, unknown>)[k]),
    has: (k: string, n: object) => slot(k).has(n),
  };
}

function ctxFor(world: FakeNode, p: Partial<CamParams> = {}, exactKeys = false) {
  const params: CamParams = { yaw: 0, pitch: 30 * D, dist: 1600, fov: 50 * D, lookH: 0, yOff: 0, near: 40, far: 31000, ...p };
  const ov = fakeOv();
  const basis = makeBasis(params, 6000, 6000, W, H);
  const ctx = {
    params, basis, out: [0, 0, 0], W, H, cull: cullOf(basis, params, W, H, undefined, RING_PX), exactKeys, tilt: exactKeys ? 0 : 1,
    frameNo: 1, ov, saves: { save: () => undefined }, caps: { scene: { world: world.node }, classes: { Matrix: FakeMatrix } },
  } as unknown as FrameCtx;
  return { ctx, ov };
}

function recordingSink(accept = true) {
  const calls: Array<{ n: Node3; alpha: number; z: number | undefined; w2: Mat }> = [];
  const sink: AreaTileSink = { add: (_c, n, w2, alpha, z) => { calls.push({ n, alpha, z, w2 }); return accept; } };
  return { sink, calls };
}

describe('groundAffine (A V3)', () => {
  it('refuses a fit whose sample point is past the near plane, although the centre is in front', () => {
    const world = new FakeNode();
    // Looking west: one step east (+x) is one step closer to the lens.
    const { ctx } = ctxFor(world, { yaw: -90 * D });
    const b = ctx.basis, cp = Math.cos(ctx.params.pitch);
    const depth = (x: number): number => (x - b.C[0]) * b.F[0] + (0 - b.C[1]) * b.F[1];
    const cx = b.C[0] + (60 - (0 - b.C[1]) * b.F[1]) / b.F[0];
    expect(depth(cx)).toBeCloseTo(60, 6);
    expect(depth(cx + 64)).toBeCloseTo(60 - 64 * cp, 6);
    expect(groundAffine(ctx, cx, b.C[2])).toBeNull();
    expect(groundAffine(ctx, cx - 200, b.C[2])).not.toBeNull();
  });
});

describe('createFlatPlacer', () => {
  function scene() {
    const world = new FakeNode();
    const group = world.addChild(Object.assign(new FakeNode(), { alpha: 0.8 }));
    const rug = group.addChild(Object.assign(new FakeNode(6000, 5600).withTexture(248, 145, 0), { alpha: 0.5 }));
    return { world, group, rug };
  }

  it('tilted: hands a quad to the perspective sink in its band and pins the node hidden', () => {
    const { world, group, rug } = scene();
    const { sink, calls } = recordingSink();
    const { ctx, ov } = ctxFor(world);
    const flat = createFlatPlacer(sink);
    expect(flat.place(ctx, rug.node, rug.x, rug.y, BUILDING_DECAL_Z, 300)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.z).toBe(BUILDING_DECAL_Z);
    expect(calls[0]!.alpha).toBeCloseTo(0.4, 9);
    expect(calls[0]!.w2).toBe(group.localTransform);
    expect(ov.raw('visible', rug)).toBe(false);
    expect(rug.lastSet).toBeNull();
  });

  it('a World child gets the identity as its parent matrix', () => {
    const world = new FakeNode();
    const dot = world.addChild(new FakeNode(6100, 5700).withTexture(40, 40, 0.5));
    const { sink, calls } = recordingSink();
    createFlatPlacer(sink).place(ctxFor(world).ctx, dot.node, dot.x, dot.y, MARKER_Z, 300);
    const m = calls[0]!.w2;
    expect([m.a, m.b, m.c, m.d, m.tx, m.ty]).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('straight down (s = 0): back on the exact affine, with the hide pin dropped', () => {
    const { world, rug } = scene();
    const { sink, calls } = recordingSink();
    const flat = createFlatPlacer(sink);
    const tilted = ctxFor(world);
    flat.place(tilted.ctx, rug.node, rug.x, rug.y, BUILDING_DECAL_Z, 300);
    const down = { ...ctxFor(world, { pitch: 90 * D }, true).ctx, ov: tilted.ov } as unknown as FrameCtx;
    expect(flat.place(down, rug.node, rug.x, rug.y, BUILDING_DECAL_Z, 300)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(tilted.ov.has('visible', rug)).toBe(false);
    expect(rug.lastSet).not.toBeNull();
  });

  it('draws nothing for a node the game hides (its own flag or an ancestor\'s), and keeps a meshed node pinned', () => {
    const { world, group, rug } = scene();
    const { sink, calls } = recordingSink();
    const { ctx, ov } = ctxFor(world);
    const flat = createFlatPlacer(sink);
    flat.place(ctx, rug.node, rug.x, rug.y, BUILDING_DECAL_Z, 300);
    group.visible = false;
    expect(flat.place({ ...ctx, frameNo: 2 } as FrameCtx, rug.node, rug.x, rug.y, BUILDING_DECAL_Z, 300)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(ov.raw('visible', rug)).toBe(false);
    expect(rug.lastSet).toBeNull();
  });

  it('a hide pin dropped behind its back (a detached node pruned, A R4) is put back on the next frame', () => {
    const { world, rug } = scene();
    const { sink } = recordingSink();
    const { ctx, ov } = ctxFor(world);
    const flat = createFlatPlacer(sink);
    flat.place(ctx, rug.node, rug.x, rug.y, BUILDING_DECAL_Z, 300);
    ov.drop('visible', rug);
    expect(flat.place({ ...ctx, frameNo: 2 } as FrameCtx, rug.node, rug.x, rug.y, BUILDING_DECAL_Z, 300)).toBe(false);
    expect(ov.raw('visible', rug)).toBe(false);
  });

  it('a quad the sink declines keeps the affine path', () => {
    const { world, rug } = scene();
    const { sink } = recordingSink(false);
    const { ctx, ov } = ctxFor(world);
    expect(createFlatPlacer(sink).place(ctx, rug.node, rug.x, rug.y, BUILDING_DECAL_Z, 300)).toBe(true);
    expect(ov.has('visible', rug)).toBe(false);
    expect(rug.lastSet).not.toBeNull();
  });
});

describe('placeFlat: laid every frame, so culled against the screen as it is (perf Task 5)', () => {
  it('a decal whose centre is off screen but whose art reaches into it is laid; one out of reach is hidden', () => {
    const world = new FakeNode();
    const { ctx, ov } = ctxFor(world, { pitch: 90 * D }, true);
    const b = ctx.basis;
    // Straight down: world x maps to screen x at fpx / depth px per world px.
    const k = b.fpx / (b.C[1] - 0), pastRight = 6000 + (W / 2 + 100) / k;
    const near = world.addChild(new FakeNode(pastRight, 6000).withTexture(40, 40, 0.5));
    expect(placeFlat(ctx, near.node, pastRight, 6000, 200 / k)).toBe(true);
    expect(placeFlat(ctx, near.node, pastRight, 6000, 50 / k)).toBe(false);
    expect(ov.raw('visible', near)).toBe(false);
  });

  it('a decal by the side edge of a wide lens is laid while its disc reaches the screen: the reach is a sphere', () => {
    const world = new FakeNode();
    const { ctx } = ctxFor(world, { pitch: 2 * D, dist: 1, fov: 100 * D, lookH: 170 });
    const b = ctx.basis;
    // A ground point just inside the right edge, then the decal's centre 0.8 r out along that face's ground normal.
    const P = groundRay(b, W - 2, H * 0.6)!;
    const tR = (W - b.cx0) / b.fpx;
    const nx0 = b.R[0] - tR * b.F[0], nz0 = b.R[2] - tR * b.F[2], nl = Math.hypot(nx0, nz0);
    const r = 400, cx = P.x + (nx0 / nl) * 0.8 * r, cy = P.y + (nz0 / nl) * 0.8 * r;
    const A = groundAffine(ctx, cx, cy)!;
    // A billboard's half size of r (the old call) rules it out at this lens: the face normal is 2.5× a unit.
    expect(mayShow(ctx.cull, A.sx, A.sy, A.cz, r, r, r)).toBe(false);
    const rug = world.addChild(new FakeNode(cx, cy).withTexture(40, 40, 0.5));
    expect(placeFlat(ctx, rug.node, cx, cy, r)).toBe(true);
  });

  it('a marker (reach Infinity: a tap route can span the map) is never culled by its position', () => {
    const world = new FakeNode();
    const { ctx } = ctxFor(world, { pitch: 90 * D }, true);
    const far = world.addChild(new FakeNode(30000, 6000).withTexture(40, 40, 0.5));
    expect(placeFlat(ctx, far.node, 30000, 6000, Infinity)).toBe(true);
  });
});
