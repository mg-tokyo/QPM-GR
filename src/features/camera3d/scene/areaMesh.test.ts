import { describe, expect, it } from 'vitest';
import { FakeMatrix } from '../__test__/fakeMatrix';
import { FakeNode } from '../__test__/fakeNode';
import type { FrameCtx } from '../frame/frame';
import { makeBasis } from '../math/camera';
import { AREA_MARK_Z } from '../math/depth';
import type { Caps, Mat } from '../types';
import { createAreaMesh, writeQuadColor, writeTileQuad } from './areaMesh';

// Live 1381 ward tile: orig 256, trimmed to 242 px at (7, 7).
const UVS = { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.2, x2: 0.3, y2: 0.4, x3: 0.1, y3: 0.4 };
const tex = (source: object) => ({ orig: { width: 256, height: 256 }, trim: { x: 7, y: 7, width: 242, height: 242 }, uvs: UVS, source });
const round = (a: Float32Array): number[] => [...a].map((v) => +v.toFixed(3));

describe('writeTileQuad', () => {
  it("puts a sprite's trimmed art rect at its 2D world corners, with the texture uvs", () => {
    const pos = new Float32Array(8), uv = new Float32Array(8);
    const changed = writeTileQuad(new FakeMatrix(1, 0, 0, 1, 256, 0), new FakeMatrix(1, 0, 0, 1, 5000, 4000), tex({}), 0.5, 0.5, pos, uv, 0);
    expect(changed).toBe(true);
    expect([...pos]).toEqual([5135, 3879, 5377, 3879, 5377, 4121, 5135, 4121]);
    expect(round(uv)).toEqual([0.1, 0.2, 0.3, 0.2, 0.3, 0.4, 0.1, 0.4]);
  });

  it('reports a change only when a corner moved', () => {
    const pos = new Float32Array(16), uv = new Float32Array(16);
    const W2 = new FakeMatrix(2, 0, 0, 2, 100, 0);
    const t = { orig: { width: 256, height: 256 }, uvs: UVS };
    expect(writeTileQuad(new FakeMatrix(), W2, t, 0.5, 0.5, pos, uv, 1)).toBe(true);
    expect([...pos.slice(8, 10)]).toEqual([-156, -256]);
    expect(writeTileQuad(new FakeMatrix(), W2, t, 0.5, 0.5, pos, uv, 1)).toBe(false);
    expect(writeTileQuad(new FakeMatrix(1, 0, 0, 1, 1, 0), W2, t, 0.5, 0.5, pos, uv, 1)).toBe(true);
  });
});

describe('writeQuadColor', () => {
  it('premultiplies the tint by alpha on all four corners', () => {
    const col = new Float32Array(16);
    expect(writeQuadColor(0xff8000, 0.5, col, 0)).toBe(true);
    expect(round(col.slice(0, 4))).toEqual([0.5, 0.251, 0, 0.5]);
    expect(round(col.slice(12, 16))).toEqual([0.5, 0.251, 0, 0.5]);
    expect(writeQuadColor(0xff8000, 0.5, col, 0)).toBe(false);
  });
});

function fakeCaps(world: FakeNode) {
  const updates: string[] = [];
  class Geometry {
    destroyed = false;
    getBuffer(name: string) { return { update: () => { updates.push(name); } }; }
    destroy() { this.destroyed = true; }
  }
  class Shader { resources: Record<string, unknown>; constructor(o: { resources: Record<string, unknown> }) { this.resources = o.resources; } destroy() { /* fake */ } }
  class Mesh extends FakeNode { eventMode = 'auto'; geometry: unknown; constructor(o: { geometry: unknown }) { super(); this.geometry = o.geometry; } }
  class UniformGroup { uniforms: Record<string, unknown>; constructor(u: Record<string, { value: unknown }>) { this.uniforms = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.value])); } update() { /* fake */ } }
  const caps = {
    scene: { world: world.node },
    // literal-list-justified: test fake of the PIXI class table (same shape as the tagged table in capabilities.ts)
    classes: { Geometry, Shader, Mesh, UniformGroup, GlProgram: class {}, Texture: { WHITE: {} } },
  } as unknown as Caps;
  return { caps, updates };
}

function ctxAt(frameNo: number): FrameCtx {
  const params = { yaw: 0, pitch: (30 * Math.PI) / 180, dist: 1600, fov: 1, lookH: 0, yOff: 0, near: 40, far: 9000 };
  return { frameNo, params, basis: makeBasis(params, 5000, 4000, 1000, 600) } as unknown as FrameCtx;
}

const tile = (source: object, x: number) => Object.assign(new FakeNode(x, 0), { texture: tex(source), anchor: { x: 0.5, y: 0.5 }, tint: 0xffffff });

describe('createAreaMesh', () => {
  it('collects quads per texture source, uploads only on change and parks the leftovers', () => {
    const world = new FakeNode();
    const { caps, updates } = fakeCaps(world);
    const mesh = createAreaMesh(caps, new WeakSet());
    const W2 = new FakeMatrix(1, 0, 0, 1, 5000, 4000) as unknown as Mat;
    const srcA = { style: {} }, srcB = { style: {} };
    const a = tile(srcA, 256), b = tile(srcA, 512), c = tile(srcB, 0);
    for (const s of [a, b, c]) expect(mesh.add(ctxAt(1), s.node, W2, 1)).toBe(true);
    mesh.pre(ctxAt(1));
    expect(world.children.map((n) => [n.label, n.zIndex])).toEqual([['qpm3d-area', AREA_MARK_Z], ['qpm3d-area', AREA_MARK_Z]]);
    expect(mesh.stats?.()).toMatchObject({ quads: 3, batches: 2 });
    expect(updates.filter((u) => u === 'aPosition')).toHaveLength(2);
    for (const s of [a, b, c]) mesh.add(ctxAt(2), s.node, W2, 1);
    mesh.pre(ctxAt(2));
    expect(updates.filter((u) => u === 'aPosition')).toHaveLength(2);
    mesh.add(ctxAt(3), a.node, W2, 1);
    mesh.pre(ctxAt(3));
    expect(mesh.stats?.()).toMatchObject({ quads: 1 });
    expect(updates.filter((u) => u === 'aPosition')).toHaveLength(4);
    mesh.drop();
    expect(world.children).toHaveLength(0);
  });

  it('declines a fifth texture source and a sprite without texture uvs', () => {
    const world = new FakeNode();
    const mesh = createAreaMesh(fakeCaps(world).caps, new WeakSet());
    const W2 = new FakeMatrix() as unknown as Mat;
    for (let i = 0; i < 4; i++) expect(mesh.add(ctxAt(1), tile({ style: {} }, 0).node, W2, 1)).toBe(true);
    expect(mesh.add(ctxAt(1), tile({ style: {} }, 0).node, W2, 1)).toBe(false);
    const bare = Object.assign(new FakeNode(), { texture: { orig: { width: 256, height: 256 }, source: {} }, anchor: { x: 0.5, y: 0.5 } });
    expect(mesh.add(ctxAt(1), bare.node, W2, 1)).toBe(false);
  });
});
