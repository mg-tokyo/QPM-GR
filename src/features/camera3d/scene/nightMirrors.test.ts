import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { DrawnEntry } from '../frame/drawn';
import type { FrameCtx } from '../frame/frame';
import { makeBasis, project, type CamParams } from '../math/camera';
import { createNightMirrors, standRowOf } from './nightMirrors';

const D = Math.PI / 180;
const W = 1280, H = 656;

function ctxFor(drawn: DrawnEntry[], p: Partial<CamParams> = {}, exactKeys = false) {
  const params: CamParams = { yaw: 30 * D, pitch: 35 * D, dist: 1600, fov: 55 * D, lookH: 120, yOff: 0, near: 40, far: 31000, ...p };
  const zs = new Map<object, number>();
  const ov = {
    put: (_k: string, n: object, v: number) => { zs.set(n, v); },
    drop: (_k: string, n: object) => { zs.delete(n); },
    gameValue: (k: string, n: object) => (n as Record<string, unknown>)[k],
  };
  const saved: object[] = [];
  const ctx = {
    params, basis: makeBasis(params, 6000, 6000, W, H), out: [0, 0, 0], exactKeys, ov,
    saves: { save: (n: object) => { saved.push(n); } }, drawn: { entries: drawn, len: drawn.length },
  } as unknown as FrameCtx;
  return { ctx, zs, saved };
}

const entry = (x: number, y: number, px: number, py: number, mm: number): DrawnEntry =>
  ({ node: new FakeNode().node, x, y, sx: 1, sy: 1, px, py, mm, held: false });

describe('standRowOf', () => {
  it('is the next tile-centre row at or below a point', () => {
    expect(standRowOf(3098)).toBe(3200);
    expect(standRowOf(3200)).toBe(3200);
    expect(standRowOf(3201)).toBe(3456);
  });
});

describe('camera-mirror layers in 3D (game 1634 NightLight / NightAnnotation)', () => {
  it('draws the mirror untransformed and a thought bubble anchor on its pet card', () => {
    const anchor = new FakeNode(5000, 5350);
    anchor.zIndex = 53500009;
    const mirror = new FakeNode(-6849, -7844, 1.5, [anchor]);
    const { ctx, zs, saved } = ctxFor([entry(1, 1, 0, 0, 1), entry(5000, 5350, 640, 300, 0.7)]);
    createNightMirrors([mirror.node]).pre(ctx);
    expect([mirror.x, mirror.y, mirror.scale.x]).toEqual([0, 0, 1]);
    expect([anchor.x, anchor.y]).toEqual([640, 300]);
    expect(anchor.scale.x).toBeCloseTo(0.7);
    expect(zs.get(anchor)).toBeCloseTo(0.7);
    expect(saved).toContain(mirror);
    expect(saved).toContain(anchor);
  });

  it('hides an anchor whose pet was not drawn', () => {
    const anchor = new FakeNode(5000, 5350);
    anchor.zIndex = 53500009;
    const { ctx } = ctxFor([]);
    createNightMirrors([new FakeNode(0, 0, 1, [anchor]).node]).pre(ctx);
    expect(anchor.scale.x).toBe(0);
  });

  it('stands a floating light on the tile below it, exact straight down', () => {
    const glow = new FakeNode(6000, 5950).withTexture(64, 64, 0.5);
    const fireflies = new FakeNode(0, 0, 1, [glow]);
    // The s = 0 view is the 2D one: north up (yaw 0), straight down.
    const { ctx } = ctxFor([], { yaw: 0, pitch: 90 * D }, true);
    createNightMirrors([new FakeNode(-10, -10, 2, [fireflies]).node]).pre(ctx);
    const o = [0, 0, 0];
    project(ctx.basis, 6000, 0, 5950, o);
    expect(glow.x).toBeCloseTo(o[0]!, 6);
    expect(glow.y).toBeCloseTo(o[1]!, 6);
    expect(glow.scale.x).toBeCloseTo(ctx.basis.fpx / o[2]!, 9);
  });

  it('tilted, lifts a light by its height above that tile', () => {
    const glow = new FakeNode(6000, 5950).withTexture(64, 64, 0.5);
    const { ctx } = ctxFor([], { yaw: 0, pitch: 20 * D });
    createNightMirrors([new FakeNode(0, 0, 1, [glow]).node]).pre(ctx);
    const o = [0, 0, 0];
    project(ctx.basis, 6000, 0, standRowOf(5950), o);
    const mm = ctx.basis.fpx / o[2]!;
    expect(glow.y).toBeCloseTo(o[1]! - (standRowOf(5950) - 5950) * mm, 6);
  });

  it('skips hidden nodes and an absent mirror list', () => {
    const glow = new FakeNode(6000, 5950).withTexture(64, 64, 0.5);
    glow.visible = false;
    const { ctx } = ctxFor([]);
    createNightMirrors([new FakeNode(0, 0, 1, [glow]).node]).pre(ctx);
    expect([glow.x, glow.y]).toEqual([6000, 5950]);
    expect(() => createNightMirrors(null).pre(ctx)).not.toThrow();
  });
});
