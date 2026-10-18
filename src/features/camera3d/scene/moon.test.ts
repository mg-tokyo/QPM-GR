import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { FrameCtx } from '../frame/frame';
import { makeBasis, project, type CamParams } from '../math/camera';
import { SKY_Z } from '../math/depth';
import type { MoonSystemLike, Node3 } from '../types';
import { ringAngle } from './horizon';
import { createMoon, skyPoint } from './moon';

const D = Math.PI / 180;
const W = 1280, H = 656;
const params = (p: Partial<CamParams> = {}): CamParams => ({ yaw: 0, pitch: 10 * D, dist: 1600, fov: 55 * D, lookH: 120, yOff: 0, near: 40, far: 31000, ...p });

function ctxFor(p: CamParams, exactKeys = false) {
  const zs = new Map<object, number>();
  const ov = { put: (_k: string, n: object, v: number) => { zs.set(n, v); }, drop: (_k: string, n: object) => { zs.delete(n); } };
  const ctx = { params: p, basis: makeBasis(p, 5000, 5500, W, H), out: [0, 0, 0], exactKeys, ov, saves: { save: () => undefined } } as unknown as FrameCtx;
  return { ctx, zs };
}

describe('ringAngle (RING_FS inverted)', () => {
  it('puts the ring row on the horizon and a quarter turn of art straight up', () => {
    expect(ringAngle(2384, 2384, 1536).el).toBe(0);
    expect(ringAngle(2384 - (8 * 1536) / 4, 2384, 1536).el).toBeCloseTo(Math.PI / 2, 12);
    expect(ringAngle(0, 0, 1536).radPerPx).toBeCloseTo((2 * Math.PI) / (8 * 1536), 15);
  });
});

describe('skyPoint', () => {
  it('draws the horizon due north at the screen centre line when looking level north', () => {
    const b = makeBasis(params({ pitch: 0 }), 0, 0, W, H), out = [0, 0, 0];
    expect(skyPoint(b, { el: 0, radPerPx: 1e-3 }, out)).toBe(true);
    expect(out[0]).toBeCloseTo(b.cx0, 9);
    expect(out[1]).toBeCloseTo(b.cy0, 9);
    expect(out[2]).toBeCloseTo(b.fpx * 1e-3, 12);
    expect(skyPoint(b, { el: 0.2, radPerPx: 1e-3 }, out) && out[1]! < b.cy0).toBe(true);
  });

  it('is behind a camera looking south', () => {
    expect(skyPoint(makeBasis(params({ yaw: 180 * D, pitch: 0 }), 0, 0, W, H), { el: 0.3, radPerPx: 1e-3 }, [0, 0, 0])).toBe(false);
  });
});

function moonSystem() {
  const container = new FakeNode(12928, 1152);
  let seen: unknown = null;
  const sys = { container: container.node, draw(c: { viewport: unknown }): unknown { seen = c.viewport; return undefined; } };
  return { sys, container, seen: () => seen };
}

describe('the moon in the 3D sky (game 1634)', () => {
  it('is skipped by the World walk and laid on the sky ring due north, under every card', () => {
    const { sys, container } = moonSystem();
    const skip = new WeakSet<Node3>();
    const pass = createMoon(sys as unknown as MoonSystemLike, skip, { cols: 101, rows: 60 }, () => ({ el: 0.3, radPerPx: 4e-4 }));
    expect(skip.has(container.node)).toBe(true);
    const { ctx, zs } = ctxFor(params());
    pass.pre(ctx);
    const out = [0, 0, 0];
    skyPoint(ctx.basis, { el: 0.3, radPerPx: 4e-4 }, out);
    expect([container.x, container.y]).toEqual([out[0], out[1]]);
    expect(container.scale.x).toBeCloseTo(out[2]!, 12);
    expect(zs.get(container)).toBe(SKY_Z);
  });

  it('tilted, lets the game draw it against the whole map, and unwraps on exit', () => {
    const { sys, seen } = moonSystem();
    const draw = sys.draw;
    const pass = createMoon(sys as unknown as MoonSystemLike, new WeakSet(), { cols: 101, rows: 60 }, () => null);
    pass.pre(ctxFor(params()).ctx);
    sys.draw({ viewport: { minTileX: 0, minTileY: 1, maxTileX: 44, maxTileY: 28 } });
    expect(seen()).toEqual({ minTileX: 0, minTileY: 0, maxTileX: 100, maxTileY: 59 });
    pass.drop();
    expect(sys.draw).toBe(draw);
  });

  it('straight down, stands where 2D draws it and keeps the game viewport', () => {
    const { sys, container, seen } = moonSystem();
    const pass = createMoon(sys as unknown as MoonSystemLike, new WeakSet(), { cols: 101, rows: 60 }, () => null);
    const { ctx, zs } = ctxFor(params({ pitch: 90 * D }), true);
    pass.pre(ctx);
    const vp = { minTileX: 0, minTileY: 1, maxTileX: 44, maxTileY: 28 };
    sys.draw({ viewport: vp });
    expect(seen()).toBe(vp);
    const o = [0, 0, 0];
    project(ctx.basis, 12928, 0, 1152, o);
    expect(container.x).toBeCloseTo(o[0]!, 6);
    expect(container.y).toBeCloseTo(o[1]!, 6);
    expect(zs.has(container)).toBe(false);
  });

  it('hides the moon while the sky ring has no strip', () => {
    const { sys, container } = moonSystem();
    createMoon(sys as unknown as MoonSystemLike, new WeakSet(), { cols: 101, rows: 60 }, () => null).pre(ctxFor(params()).ctx);
    expect(container.scale.x).toBe(0);
  });
});
