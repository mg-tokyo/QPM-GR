import { describe, expect, it, vi } from 'vitest';
import { cullOf } from '../__test__/cullOf';
import { FakeNode } from '../__test__/fakeNode';
import type { FrameCtx } from '../frame/frame';
import { makeBasis, type CamParams } from '../math/camera';
import { depthKeyAlong } from '../math/depth';
import type { Caps, Node3, UniformGroupLike } from '../types';
import type { Fader } from './fades';
import { SIDE_RETRY_MAX, createFences } from './fences';
import { SIDE_WALL_BACK, type SideDecorSource, type SideTile } from './sideDecor';
import type { TileScan } from './tileArt';

vi.mock('./tileArt', () => ({
  RECT: { STRIDE: 14, X: 2, Y: 3, W: 4, H: 5, ROTATE: 6, ALPHA: 13 },
  D8_MIRROR_H: 12,
  SCAN_RETRY_MS: 2000,
  FENCE_KEYS: { H: 'tile/WoodFence_Horizontal', V: 'tile/WoodFence_Vertical', T: 'tile/WoodFence_CornerT', R: 'tile/WoodFence_CornerTopRight' },
  artBaseRow: () => 150,
  subTexture: (_c: unknown, key: string, x: number, y: number, w: number, h: number) => ({
    key, orig: { width: w, height: h }, frame: { x, y, width: w, height: h }, source: { style: {} },
    uvs: { x0: 0, y0: 0, x1: 1, y1: 0, x2: 1, y2: 1, x3: 0, y3: 1 }, destroy: () => undefined,
  }),
}));
// Live v1847: WoodArch front art 296×376, anchor (0.5, 0.816) → ground row 307.
const ART: Record<string, unknown> = {
  'sprite/decor/WoodArch': { frame: { width: 296, height: 376 }, orig: { width: 296, height: 376 }, defaultAnchor: { x: 0.5, y: 0.816 } },
};
vi.mock('../../../sprite-v2/gameTextures', () => ({ getGameTexture: (k: string) => ART[k] ?? null }));

const D = Math.PI / 180;
const W = 1280, H = 656;
const CAM: UniformGroupLike = { uniforms: {}, update: () => undefined };
const EMPTY: TileScan = { pb: new Float32Array(0), len: 0, at: 0, sky: [], standing: [], fence: new Map(), keyAt: new Map(), missing: [] };
const fader: Fader = { factor: () => 1, isFading: () => false, prune: () => undefined, size: () => 0, drop: () => undefined };

function fakeCaps() {
  const world = new FakeNode();
  class Geometry { constructor(public o: { attributes: Record<string, { buffer: Float32Array }> }) {} destroy() { /* fake */ } }
  class Shader { constructor(public o: { resources: Record<string, unknown> }) {} destroy() { /* fake */ } }
  class Mesh extends FakeNode { geometry: { o: { attributes: Record<string, { buffer: Float32Array }> } }; constructor(o: { geometry: never }) { super(); this.geometry = o.geometry; } }
  const caps = {
    scene: { world: world.node },
    // literal-list-justified: test fake of the PIXI class table (same shape as fences.test.ts)
    classes: { Geometry, Shader, Mesh, GlProgram: class { destroy() { /* fake */ } }, Texture: { WHITE: { source: { style: {} } } }, MeshGeometry: null },
  } as unknown as Caps;
  return { caps, world };
}
type Quad = Node3 & { geometry: { o: { attributes: Record<string, { buffer: Float32Array }> } } };
const walls = (world: FakeNode) => world.children.filter((n) => n.label === 'qpm3d-fence') as unknown as Quad[];
const corners = (q: Quad) => [...q.geometry.o.attributes.aPosition!.buffer];

function ctxAt(target: { x: number; y: number }, yaw = 0, tilt = 1): FrameCtx {
  const params: CamParams = { yaw, pitch: 30 * D, dist: 1500, fov: 50 * D, lookH: 120, yOff: 0, near: 40, far: 31000 };
  const basis = makeBasis(params, target.x, target.y, W, H);
  return { params, basis, out: [0, 0, 0], W, H, cull: cullOf(basis, params, W, H), dx: Math.sin(yaw), dz: -Math.cos(yaw), tilt, exactKeys: tilt <= 0, reCull: true, roll: -1, frameNo: 1, now: 16 } as unknown as FrameCtx;
}

function source(list: SideTile[]): SideDecorSource & { set(l: SideTile[]): void } {
  let tiles = list, ver = 1;
  return { rescan: () => undefined, tiles: () => tiles, version: () => ver, isSide: () => false, wasSide: () => false, set(l) { tiles = l; ver++; } };
}
const arch = (cx: number, cz: number, flip = false): SideTile => ({ node: {} as Node3, cx, cz, art: 'sprite/decor/WoodArch', flip });

describe('createFences: turned decor walls', () => {
  it('stands the front art on the tile N-S line, up to its ground row, keyed back by SIDE_WALL_BACK', () => {
    const { caps, world } = fakeCaps();
    const pass = createFences(caps, new WeakSet(), fader, () => EMPTY, () => undefined, CAM, source([arch(5000, 5000)]));
    const ctx = ctxAt({ x: 5000, y: 5000 }, 90 * D, 0.5);
    pass.pre(ctx);
    const [q] = walls(world);
    expect(corners(q!)).toEqual([5000, 307, 4852, 5000, 307, 5148, 5000, 0, 5148, 5000, 0, 4852]);
    expect(q!.zIndex).toBe(depthKeyAlong(5000 * ctx.dx + 5000 * ctx.dz + SIDE_WALL_BACK, 0));
    expect(q!.alpha).toBe(0.5);
    expect(pass.stats?.()).toMatchObject({ walls: 1, side: 1 });
  });

  it('flip swaps the ends', () => {
    const { caps, world } = fakeCaps();
    const pass = createFences(caps, new WeakSet(), fader, () => EMPTY, () => undefined, CAM, source([arch(5000, 5000, true)]));
    pass.pre(ctxAt({ x: 5000, y: 5000 }, 90 * D));
    expect(corners(walls(world)[0]!)).toEqual([5000, 307, 5148, 5000, 307, 4852, 5000, 0, 4852, 5000, 0, 5148]);
  });

  it('rebuilds when the side version moves, and keeps the walls while it does not', () => {
    const { caps, world } = fakeCaps();
    const src = source([arch(5000, 5000)]);
    const pass = createFences(caps, new WeakSet(), fader, () => EMPTY, () => undefined, CAM, src);
    pass.pre(ctxAt({ x: 5000, y: 5000 }, 90 * D));
    const first = walls(world)[0];
    pass.pre(ctxAt({ x: 5000, y: 5000 }, 90 * D));
    expect(walls(world)[0]).toBe(first);
    src.set([arch(5000, 5000), arch(5256, 5000)]);
    pass.pre(ctxAt({ x: 5000, y: 5000 }, 90 * D));
    expect(walls(world)).toHaveLength(2);
    expect(walls(world)).not.toContain(first);
    expect(pass.warm?.({} as never, null)).toBe(false);
  });

  it('skips a tile whose art is not loaded yet and retries on a rolling re-cull, at most every SCAN_RETRY_MS', () => {
    const { caps, world } = fakeCaps();
    const pass = createFences(caps, new WeakSet(), fader, () => EMPTY, () => undefined, CAM, source([{ ...arch(5000, 5000), art: 'sprite/decor/Late' }]));
    const at = (now: number, roll: number) => ({ ...ctxAt({ x: 5000, y: 5000 }, 90 * D), reCull: false, roll, now }) as FrameCtx;
    pass.pre(at(16, -1));
    expect(walls(world)).toHaveLength(0);
    expect(pass.stats?.()).toMatchObject({ side: 0, sideMissing: 1 });
    ART['sprite/decor/Late'] = ART['sprite/decor/WoodArch'];
    pass.pre(at(32, 3));
    expect(walls(world)).toHaveLength(0);
    pass.pre(at(48, 0));
    expect(walls(world)).toHaveLength(1);
    expect(pass.stats?.()).toMatchObject({ side: 1, sideMissing: 0 });
    delete ART['sprite/decor/Late'];
  });

  it('names the tiles that got a wall: one without art or geometry keeps its card', () => {
    const { caps } = fakeCaps();
    const ok = arch(5000, 5000), late = { ...arch(5256, 5000), node: {} as Node3, art: 'sprite/decor/Nope' };
    ART['sprite/decor/Flat'] = { frame: { width: 100, height: 100 }, orig: { width: 100, height: 100 }, defaultAnchor: { x: 0.5, y: 0 } };
    const flat = { ...arch(5512, 5000), node: {} as Node3, art: 'sprite/decor/Flat' };
    try {
      const pass = createFences(caps, new WeakSet(), fader, () => EMPTY, () => undefined, CAM, source([ok, late, flat]));
      pass.pre(ctxAt({ x: 5000, y: 5000 }, 90 * D));
      expect([pass.hasWall(ok.node), pass.hasWall(late.node), pass.hasWall(flat.node)]).toEqual([true, false, false]);
      expect(pass.stats?.()).toMatchObject({ side: 1, sideMissing: 1, sideFailed: 1 });
    } finally { delete ART['sprite/decor/Flat']; }
  });

  it('reports the side walls it drew for picking: tile view, mesh, quad and panel; none hidden, out of view or faded out', () => {
    const { caps, world } = fakeCaps();
    const t = arch(5000, 5000);
    const pass = createFences(caps, new WeakSet(), fader, () => EMPTY, () => undefined, CAM, source([t]));
    pass.pre(ctxAt({ x: 5000, y: 5000 }, 90 * D));
    const [q] = walls(world);
    const [d] = pass.drawnSideWalls();
    expect(pass.drawnSideWalls()).toHaveLength(1);
    expect(d!.node).toBe(t.node);
    expect(d!.mesh).toBe(q);
    expect([d!.ax, d!.az, d!.bx, d!.bz, d!.h]).toEqual([5000, 4852, 5000, 5148, 307]);
    expect(d!.tex).toMatchObject({ key: 'sprite/decor/WoodArch', frame: { width: 296, height: 307 } });
    pass.pre({ ...ctxAt({ x: 5000, y: 5000 }, 90 * D, 0), frameNo: 2 } as FrameCtx);
    expect(pass.drawnSideWalls()).toEqual([]);
    pass.pre({ ...ctxAt({ x: 5000, y: 5000 }, 90 * D), frameNo: 3 } as FrameCtx);
    expect(pass.drawnSideWalls()).toHaveLength(1);
    pass.pre({ ...ctxAt({ x: 40000, y: 40000 }, 90 * D), frameNo: 4 } as FrameCtx);
    expect(pass.drawnSideWalls()).toEqual([]);
  });

  it('a rotated front-art frame keeps its card: no wall, counted as failed', () => {
    const { caps, world } = fakeCaps();
    ART['sprite/decor/Turned'] = { ...(ART['sprite/decor/WoodArch'] as object), rotate: 2 };
    try {
      const t = { ...arch(5000, 5000), art: 'sprite/decor/Turned' };
      const pass = createFences(caps, new WeakSet(), fader, () => EMPTY, () => undefined, CAM, source([t]));
      pass.pre(ctxAt({ x: 5000, y: 5000 }, 90 * D));
      expect(walls(world)).toHaveLength(0);
      expect(pass.hasWall(t.node)).toBe(false);
      expect(pass.stats?.()).toMatchObject({ side: 0, sideMissing: 0, sideFailed: 1 });
    } finally { delete ART['sprite/decor/Turned']; }
  });

  it('a rebuild on a rolling frame with a still camera checks every wall at once (no walls left hidden)', () => {
    const { caps, world } = fakeCaps();
    const src = source([arch(5000, 5000)]);
    const pass = createFences(caps, new WeakSet(), fader, () => EMPTY, () => undefined, CAM, src);
    pass.pre(ctxAt({ x: 5000, y: 5000 }, 90 * D));
    src.set([arch(5000, 5000), arch(5000, 5256), arch(5000, 4744)]);
    pass.pre({ ...ctxAt({ x: 5000, y: 5000 }, 90 * D), reCull: false, roll: 0, camStill: true, frameNo: 2 } as FrameCtx);
    expect(walls(world).map((q) => q.visible)).toEqual([true, true, true]);
  });

  it('gives up on art that never loads after SIDE_RETRY_MAX rebuilds', () => {
    const { caps } = fakeCaps();
    const pass = createFences(caps, new WeakSet(), fader, () => EMPTY, () => undefined, CAM, source([{ ...arch(5000, 5000), art: 'sprite/decor/Never' }]));
    for (let i = 0; i < SIDE_RETRY_MAX + 5; i++) pass.pre({ ...ctxAt({ x: 5000, y: 5000 }, 90 * D), reCull: false, roll: 0, now: 16 + i * 2100 } as FrameCtx);
    expect(pass.stats?.()).toMatchObject({ builds: 1 + SIDE_RETRY_MAX, sideMissing: 1 });
  });
});
