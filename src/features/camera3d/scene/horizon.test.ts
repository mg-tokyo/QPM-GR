import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { FrameCtx } from '../frame/frame';
import type { Overrides } from '../frame/overrides';
import { makeBasis } from '../math/camera';
import type { Caps } from '../types';
import type { BakeHooks, Floor } from './floor';
import { createHorizon } from './horizon';
import { RECT, type TileScan } from './tileArt';

interface Tex { source: { style: object }; destroyed: boolean; destroy(): void }
const newTex = (): Tex => ({ source: { style: {} }, destroyed: false, destroy() { this.destroyed = true; } });
const rect = (x: number, y: number, w: number, h: number): number[] => [0, 0, x, y, w, h, 0, 0, 0, 0, 1024, 1024, 1, 1];
// The live sky band (1419): Sky tiles, StarsTile 768, SkyTile 1536 ending at y 2560; then a grass tile.
const LIVE_SKY = [...rect(0, 0, 256, 256), ...rect(0, 0, 768, 768), ...rect(0, 1024, 1536, 1536), ...rect(0, 2560, 256, 256)];

function rig(pointsBuf: number[] = LIVE_SKY, skyRects = 3) {
  const WHITE = { source: { style: {} } };
  const baked: Tex[] = [];
  const frames: number[][] = [];
  const groups: Array<Record<string, unknown>> = [];
  let shader: { resources: Record<string, unknown> } | null = null;
  class Shader { resources: Record<string, unknown>; constructor(o: { resources: Record<string, unknown> }) { this.resources = o.resources; shader = this; } destroy() { /* fake */ } }
  class Mesh extends FakeNode { constructor() { super(); } }
  class UniformGroup { uniforms: Record<string, unknown>; constructor(u: Record<string, { value: unknown }>) { this.uniforms = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.value])); groups.push(this.uniforms); } update() { /* fake */ } }
  class Rectangle { constructor(...a: number[]) { frames.push(a); } }
  const ground = new FakeNode();
  const tilemap = ground.addChild(new FakeNode());
  const caps = {
    scene: {
      ground: ground.node, tilemap: tilemap.node, tileData: { pointsBuf, rects_count: 0 },
      renderer: {
        generateTexture: () => { const t = newTex(); baked.push(t); return t; },
        extract: { pixels: () => ({ pixels: new Uint8Array(16), width: 2, height: 2 }) },
      },
    },
    // literal-list-justified: test fake of the PIXI class table (same shape as the tagged table in capabilities.ts)
    classes: { Shader, Mesh, UniformGroup, GlProgram: class {}, Geometry: class { destroy() { /* fake */ } }, Rectangle, Texture: { WHITE } },
  } as unknown as Caps;
  const hooks: BakeHooks[] = [];
  let forced = 0;
  const floor = { addBakeHooks: (h: BakeHooks) => { hooks.push(h); }, forceRebake: () => { forced++; } } as unknown as Floor;
  const sky = Array.from({ length: skyRects }, (_, i) => i * RECT.STRIDE);
  const scanOf = (len: number): TileScan => ({ pb: pointsBuf, len, at: 0, sky: len < 0 ? [] : sky, standing: [], fence: new Map(), keyAt: new Map(), missing: [] });
  let scan = scanOf(-1);
  const drifts: string[] = [];
  const horizon = createHorizon(caps, floor, () => scan, { uniforms: {}, update: () => undefined }, (what) => { drifts.push(what); });
  const ring = ground.children.find((c) => c.label === 'qpm3d-ring')!;
  const ov = { raw: () => true, rawSet: () => undefined } as unknown as Overrides;
  const params = { yaw: 0, pitch: 0.5, dist: 1600, fov: 1, lookH: 0, yOff: 0, near: 40, far: 9000 };
  const ctx = { ov, W: 1000, H: 600, basis: makeBasis(params, 5000, 4000, 1000, 600) } as unknown as FrameCtx;
  const floorBake = (): void => { for (const h of hooks) { h.before(); h.after(); } };
  return {
    horizon, ctx, baked, hooks, floorBake, WHITE, ring, drifts, frames,
    ringUniforms: () => groups.find((g) => 'uH0' in g)!,
    forced: () => forced, sky: () => shader?.resources.uSkyTexture,
    resolve: () => { scan = scanOf(0); }, provisional: () => { scan = scanOf(-1); },
  };
}

describe('createHorizon freshness (A V7)', () => {
  it('waits for the tile textures, then bakes the strip and rebakes an early floor bake once, never again', () => {
    const r = rig();
    r.floorBake();
    r.horizon.pre(r.ctx);
    r.horizon.pre(r.ctx);
    expect(r.baked).toHaveLength(0);
    expect(r.ring.visible).toBe(false);
    expect(r.horizon.warm?.(r.ctx.ov, null)).toBe(false);
    r.resolve();
    r.horizon.pre(r.ctx);
    expect(r.baked).toHaveLength(1);
    expect(r.sky()).toBe(r.baked[0]!.source);
    expect(r.ring.visible).toBe(true);
    expect(r.forced()).toBe(1);
    r.floorBake();
    r.horizon.pre(r.ctx);
    r.horizon.pre(r.ctx);
    expect(r.baked).toHaveLength(1);
    expect(r.forced()).toBe(1);
  });

  it('a floor bake taken before the textures resolved still gets its rebake when the strip was already fine', () => {
    const r = rig();
    r.resolve();
    r.horizon.pre(r.ctx);
    r.provisional();
    r.floorBake();
    r.resolve();
    r.horizon.pre(r.ctx);
    expect(r.forced()).toBe(1);
    expect(r.baked).toHaveLength(1);
  });

  it('frees the strip with the floor bakes and bakes it again on the next 3D frame', () => {
    const r = rig();
    r.resolve();
    r.horizon.pre(r.ctx);
    for (const h of r.hooks) h.release?.();
    expect(r.baked[0]!.destroyed).toBe(true);
    expect(r.sky()).toBe(r.WHITE.source);
    expect(r.horizon.warm?.(r.ctx.ov, null)).toBe(true);
    expect(r.baked).toHaveLength(2);
    expect(r.sky()).toBe(r.baked[1]!.source);
  });
});

describe('createHorizon strip (A V8: derived from the sky band)', () => {
  it('bakes the live band (one 1536 px period, 2560 tall) and puts the horizon row 176 px above its bottom', () => {
    const r = rig();
    r.resolve();
    r.horizon.pre(r.ctx);
    expect(r.frames.at(-1)).toEqual([0, 0, 1536, 2560]);
    const u = r.ringUniforms();
    expect(Array.from(u.uStrip as Float32Array)).toEqual([1536, 2560]);
    expect(u.uH0).toBe(2384);
    expect(r.drifts).toEqual([]);
  });

  it('no sky band once the textures resolved: one drift report, no bake, the ring stays hidden', () => {
    const r = rig(rect(0, 2560, 256, 256), 0);
    r.horizon.pre(r.ctx);
    expect(r.drifts).toEqual([]);
    r.resolve();
    r.horizon.pre(r.ctx);
    r.horizon.pre(r.ctx);
    expect(r.horizon.warm?.(r.ctx.ov, null)).toBe(false);
    expect(r.drifts).toEqual(['horizon']);
    expect(r.baked).toHaveLength(0);
    expect(r.ring.visible).toBe(false);
  });
});
