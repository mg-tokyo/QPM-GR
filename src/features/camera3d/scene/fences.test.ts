import { describe, expect, it, vi } from 'vitest';
import { cullOf } from '../__test__/cullOf';
import { FakeNode } from '../__test__/fakeNode';
import { LEGACY_CULL } from '../constants';
import { legacyWallShow } from '../frame/cull';
import { RING_PX, type FrameCtx } from '../frame/frame';
import { makeBasis, project, type CamParams } from '../math/camera';
import { depthKey } from '../math/depth';
import type { Caps, Node3, UniformGroupLike } from '../types';
import type { Fader } from './fades';
import { createFences } from './fences';
import { IDLE_FRAMES } from './flipGate';
import type { TileScan } from './tileArt';
import { STRIP_VERTS, projectStrip, stripMayNeedPerspective, stripNeedsPerspective } from './wallGeom';

const BASE = 150;
// The panel art comes from the sprite system and a GPU base-row extract: stand-ins with the live fence frame (1411).
vi.mock('./tileArt', () => ({
  // The live rect layout (tileArt.ts RECT, D8_MIRROR_H).
  RECT: { STRIDE: 14, X: 2, Y: 3, W: 4, H: 5, ROTATE: 6, ALPHA: 13 },
  D8_MIRROR_H: 12,
  FENCE_KEYS: { H: 'tile/WoodFence_Horizontal', V: 'tile/WoodFence_Vertical', T: 'tile/WoodFence_CornerT', R: 'tile/WoodFence_CornerTopRight' },
  artBaseRow: () => 150,
  subTexture: (_c: unknown, _k: string, x: number, y: number, w: number, h: number) => ({
    orig: { width: w, height: h }, frame: { x, y, width: w, height: h }, source: { style: {} },
    uvs: { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.2, x2: 0.3, y2: 0.4, x3: 0.1, y3: 0.4 }, destroy: () => undefined,
  }),
}));

const D = Math.PI / 180;
const W = 1280, H = 656;

function fakeCaps(withMeshGeometry: boolean) {
  const world = new FakeNode();
  const destroyed: string[] = [];
  class Geometry { constructor(public o: { attributes: Record<string, { buffer: Float32Array }> }) {} getBuffer() { return { update: () => undefined }; } destroy() { destroyed.push('geometry'); } }
  class MeshGeometry {
    updates = 0;
    positions: Float32Array;
    constructor(o: { positions: Float32Array }) { this.positions = o.positions; }
    getBuffer() { return { update: () => { this.updates++; } }; }
    destroy() { destroyed.push('meshGeometry'); }
  }
  class Shader { constructor(public o: { resources: Record<string, unknown> }) {} destroy() { destroyed.push('shader'); } }
  class Mesh extends FakeNode { eventMode = 'auto'; geometry: unknown; shader: unknown; constructor(o: { geometry: unknown; shader?: unknown }) { super(); this.geometry = o.geometry; this.shader = o.shader ?? null; } override destroy() { super.destroy(); destroyed.push('mesh'); } }
  class UniformGroup { uniforms: Record<string, unknown>; constructor(u: Record<string, { value: unknown }>) { this.uniforms = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.value])); } update() { /* fake */ } }
  const caps = {
    scene: { world: world.node },
    // literal-list-justified: test fake of the PIXI class table (same shape as the tagged table in capabilities.ts)
    classes: { Geometry, Shader, Mesh, UniformGroup, GlProgram: class { destroy() { destroyed.push('program'); } }, Texture: { WHITE: { source: { style: {} } } }, MeshGeometry: withMeshGeometry ? MeshGeometry : null },
  } as unknown as Caps;
  return { caps, world, destroyed };
}

// One east-west wall on tile (19, 19): its ground line runs x 4864 → 5120 at y 4864 + 150. Each call returns the same
// scan, as passes.ts does (a new scan object rebuilds every wall).
const WALL_PB = new Float32Array(14);
WALL_PB[2] = 4864; WALL_PB[3] = 4864;
const WALL_SCAN: TileScan = { pb: WALL_PB, len: 14, at: 0, sky: [], standing: [0], fence: new Map([[0, 'H']]), keyAt: new Map(), missing: [] };
const CAM: UniformGroupLike = { uniforms: {}, update: () => undefined };
const scanWithWall = (): TileScan => WALL_SCAN;

function ctxAt(p: Partial<CamParams>, target: { x: number; y: number }, tilt = 1, frameNo = 1): FrameCtx {
  const params: CamParams = { yaw: 0, pitch: 30 * D, dist: 1500, fov: 50 * D, lookH: 120, yOff: 0, near: 40, far: 31000, ...p };
  return {
    params, basis: makeBasis(params, target.x, target.y, W, H), out: [0, 0, 0], W, H, cull: cullOf(makeBasis(params, target.x, target.y, W, H), params, W, H),
    dx: Math.sin(params.yaw), dz: -Math.cos(params.yaw), tilt, exactKeys: tilt <= 0, reCull: true, roll: -1, frameNo, now: frameNo * 16,
  } as unknown as FrameCtx;
}

const fader: Fader = { factor: () => 1, isFading: () => false, prune: () => undefined, size: () => 0, drop: () => undefined };
const meshes = (world: FakeNode) => world.children.filter((n) => n.label === 'qpm3d-fence') as unknown as Array<Node3 & { shader: unknown; geometry: { positions?: Float32Array; o?: { attributes: Record<string, { buffer: Float32Array }> } } }>;
const TP = { target: { x: 5000, y: 5600 }, p: {} };
const FP = { target: { x: 5000, y: 5100 }, p: { pitch: 10 * D, dist: 1, lookH: 170 } };

describe('createFences (polish Task 11, A V4)', () => {
  it('draws nothing at the 2D match (tilt 0): the fence cards stand in for the walls', () => {
    const { caps, world } = fakeCaps(true);
    const fades: number[] = [];
    const pass = createFences(caps, new WeakSet(), fader, scanWithWall, (t) => fades.push(t), CAM);
    pass.pre(ctxAt(TP.p, TP.target, 0));
    expect(meshes(world).every((m) => !m.visible)).toBe(true);
    expect(fades).toEqual([0]);
  });

  it('a wall away from the lens is one batched strip whose vertices are the exact projections, keyed and faded by tilt', () => {
    const { caps, world } = fakeCaps(true);
    const fades: number[] = [];
    const pass = createFences(caps, new WeakSet(), fader, scanWithWall, (t) => fades.push(t), CAM);
    const ctx = ctxAt(TP.p, TP.target, 0.5);
    pass.pre(ctx);
    const [strip] = meshes(world);
    expect(strip!.shader).toBeNull();
    expect(strip!.visible).toBe(true);
    expect(strip!.zIndex).toBe(depthKey(4992, 4864 + BASE, ctx.dx, ctx.dz, 0));
    expect(strip!.alpha).toBe(0.5);
    expect(fades).toEqual([0.5]);
    const o = [0, 0, 0];
    project(ctx.basis, 4864, BASE, 4864 + BASE, o);
    expect(strip!.geometry.positions![0]).toBeCloseTo(o[0]!, 2);
    expect(strip!.geometry.positions![1]).toBeCloseTo(o[1]!, 2);
    expect(pass.stats?.()).toMatchObject({ walls: 1, shown: 1, persp: 0 });
  });

  it('a wall at the lens switches to the perspective quad and back by scale alone: a visibility flip rebuilds World', () => {
    const { caps, world } = fakeCaps(true);
    const pass = createFences(caps, new WeakSet(), fader, scanWithWall, () => undefined, CAM);
    pass.pre(ctxAt(FP.p, FP.target, 1, 1));
    const [strip, quad] = meshes(world);
    expect([strip!.visible, strip!.scale.x, quad!.visible, quad!.scale.x]).toEqual([true, 0, true, 1]);
    expect(quad!.shader).not.toBeNull();
    expect([...quad!.geometry.o!.attributes.aPosition!.buffer]).toEqual([4864, BASE, 5014, 5120, BASE, 5014, 5120, 0, 5014, 4864, 0, 5014]);
    expect(pass.stats?.()).toMatchObject({ shown: 1, persp: 1 });
    let flips = 0;
    for (const m of [strip!, quad!]) {
      let v = m.visible;
      Object.defineProperty(m, 'visible', { configurable: true, get: () => v, set: (x: boolean) => { if (x !== v) flips++; v = x; } });
    }
    pass.pre(ctxAt(TP.p, TP.target, 1, 2));
    expect([strip!.scale.x, quad!.scale.x]).toEqual([1, 0]);
    expect(flips).toBe(0);
    expect(quad!.zIndex).toBe(strip!.zIndex);
    // A quad left idle is hidden after a while, so idle quads cost no draw call.
    for (let f = 3; f < 140; f++) pass.pre(ctxAt(TP.p, TP.target, 1, f));
    expect([strip!.visible, quad!.visible]).toEqual([true, false]);
    expect(flips).toBe(1);
  });

  it('puts an error-only switch off to a frame that rebuilds World anyway, for at most 8 frames', () => {
    // First person half a tile beside the wall's line, facing east along it; x0 is where the strip first asks for the quad.
    const side = { pitch: 10 * D, dist: 1, lookH: 170, yaw: 90 * D }, y = 4864 + BASE + 128;
    const wants = (x: number): boolean => {
      const pos = new Float32Array(STRIP_VERTS * 2), depth = new Float32Array(STRIP_VERTS);
      projectStrip(ctxAt(side, { x, y }).basis, { ax: 4864, az: 4864 + BASE, bx: 5120, bz: 4864 + BASE, h: BASE }, pos, depth);
      return stripNeedsPerspective(false, pos, depth, 40);
    };
    let x0 = 0;
    while (x0 < 4800 && !wants(x0)) x0 += 8;
    const run = () => {
      const { caps, world } = fakeCaps(true);
      const pass = createFences(caps, new WeakSet(), fader, scanWithWall, () => undefined, CAM);
      const rg = world.renderGroup as { structureDidChange?: boolean };
      const at = (x: number, f: number, reCull = false) => pass.pre({ ...ctxAt(side, { x, y }, 1, f), reCull });
      at(x0 - 400, 1, true);
      return { pass, world, rg, at };
    };
    const a = run();
    a.at(x0, 2);
    expect(a.pass.stats?.()).toMatchObject({ persp: 0, switches: 0 });
    expect(meshes(a.world)).toHaveLength(1);
    a.rg.structureDidChange = true;
    a.at(x0, 3);
    const [strip, quad] = meshes(a.world);
    expect([strip!.scale.x, quad!.visible, quad!.scale.x]).toEqual([0, true, 1]);
    expect(a.pass.stats?.()).toMatchObject({ persp: 1, switches: 1, forced: 0 });

    const b = run();
    let f = 2;
    for (; f < 20 && b.pass.stats?.()['persp'] === 0; f++) b.at(x0, f);
    expect(f - 3).toBe(8);
    expect(b.pass.stats?.()).toMatchObject({ forced: 1 });
  });

  it('perf Task 7 (PC12): with the show-ahead lever a wall nearing the lens gets its quad on a frame that rebuilds anyway', () => {
    const side = { pitch: 10 * D, dist: 1, lookH: 170, yaw: 90 * D }, y = 4864 + BASE + 128;
    const strip = (x: number) => {
      const pos = new Float32Array(STRIP_VERTS * 2), depth = new Float32Array(STRIP_VERTS);
      projectStrip(ctxAt(side, { x, y }).basis, { ax: 4864, az: 4864 + BASE, bx: 5120, bz: 4864 + BASE, h: BASE }, pos, depth);
      return { pos, depth };
    };
    const first = (pred: (x: number) => boolean): number => { let x = 0; while (x < 4800 && !pred(x)) x += 8; return x; };
    const x0 = first((x) => { const s = strip(x); return stripNeedsPerspective(false, s.pos, s.depth, 40); });
    const xArm = first((x) => { const s = strip(x); return stripMayNeedPerspective(s.pos, s.depth, 40); });
    expect(xArm).toBeLessThan(x0 - 100);
    const run = (frames: number) => {
      const { caps, world } = fakeCaps(true);
      const pass = createFences(caps, new WeakSet(), fader, scanWithWall, () => undefined, CAM);
      const rg = world.renderGroup as { structureDidChange?: boolean };
      const at = (x: number, f: number, reCull = false) => {
        const c = ctxAt(side, { x, y }, 1, f);
        pass.pre({ ...c, reCull, cull: cullOf(c.basis, c.params, W, H, LEGACY_CULL.side, 0, { yaw: 0, pitch: 0, frames }) });
      };
      at(xArm - 400, 1, true);
      return { pass, world, rg, at };
    };
    const on = run(8);
    on.at(xArm + 8, 2);
    expect(meshes(on.world)).toHaveLength(1);
    on.rg.structureDidChange = true;
    on.at(xArm + 16, 3);
    on.rg.structureDidChange = false;
    const [s, q] = meshes(on.world);
    expect([s!.scale.x, q!.visible, q!.scale.x]).toEqual([1, true, 0]);
    let flips = 0;
    for (const m of [s!, q!]) {
      let v = m.visible;
      Object.defineProperty(m, 'visible', { configurable: true, get: () => v, set: (x: boolean) => { if (x !== v) flips++; v = x; } });
    }
    for (let f = 4, x = xArm + 24; x <= x0 + 8; f++, x += 8) on.at(x, f);
    expect([s!.scale.x, q!.scale.x, flips]).toEqual([0, 1, 0]);
    expect(on.pass.stats?.()).toMatchObject({ persp: 1, forced: 0 });

    // The lever turned off with the camera still: the arm goes with it, so the armed quad times out as an idle one.
    const still = run(8);
    still.at(xArm + 8, 2);
    still.rg.structureDidChange = true;
    still.at(xArm + 16, 3);
    const armed = meshes(still.world)[1]!;
    expect(armed.visible).toBe(true);
    for (let f = 4; f < 6 + IDLE_FRAMES; f++) {
      const c = ctxAt(side, { x: xArm + 16, y }, 1, f);
      still.pass.pre({ ...c, reCull: true, camStill: true, cull: cullOf(c.basis, c.params, W, H, LEGACY_CULL.side, 0, { yaw: 0, pitch: 0, frames: 0 }) });
    }
    expect(armed.visible).toBe(false);

    // Lever off: nothing is armed; the switch waits for a rebuild frame as before.
    const off = run(0);
    off.rg.structureDidChange = true;
    off.at(xArm + 16, 2);
    off.rg.structureDidChange = false;
    expect(meshes(off.world)).toHaveLength(1);
  });

  // The lever on through the cull (frames 8, no turn band): only the waits it adds differ from ctxAt.
  const withAhead = (c: FrameCtx, frames: number, reCull: boolean): FrameCtx =>
    ({ ...c, reCull, cull: cullOf(c.basis, c.params, W, H, LEGACY_CULL.side, 0, { yaw: 0, pitch: 0, frames }) });

  it('perf Task 7 (E3): with the lever a hidden quad is not keyed (its key would re-sort World with nothing drawn)', () => {
    const keyOf = (frames: number): number => {
      const { caps, world } = fakeCaps(true);
      const pass = createFences(caps, new WeakSet(), fader, scanWithWall, () => undefined, CAM);
      pass.pre(withAhead(ctxAt(FP.p, FP.target, 1, 1), frames, true));
      for (let f = 2; f < 140; f++) pass.pre(withAhead(ctxAt(TP.p, TP.target, 1, f), frames, true));
      const quad = meshes(world)[1]!;
      expect(quad.visible).toBe(false);
      quad.zIndex = -1;
      pass.pre(withAhead(ctxAt(TP.p, TP.target, 1, 140), frames, true));
      return quad.zIndex;
    };
    expect(keyOf(8)).toBe(-1);
    expect(keyOf(0)).toBe(depthKey(4992, 4864 + BASE, 0, -1, 0));
  });

  it('perf Task 7 (E3): with the lever a wall that comes on needing its quad waits while its corners are off the real screen', () => {
    // First person beside the wall facing away from it: inside the keep radius (never culled), behind the lens.
    const away = { ...FP.p, yaw: 180 * D };
    const run = (frames: number) => {
      const { caps, world } = fakeCaps(true);
      const pass = createFences(caps, new WeakSet(), fader, scanWithWall, () => undefined, CAM);
      pass.pre(withAhead(ctxAt(TP.p, TP.target, 1, 1), frames, true));
      pass.pre(withAhead(ctxAt(away, FP.target, 1, 2), frames, false));
      return { pass, world };
    };
    const on = run(8);
    expect(meshes(on.world)).toHaveLength(1);
    expect(meshes(on.world)[0]!.scale.x).toBe(0);
    expect(on.pass.stats?.()).toMatchObject({ shown: 0, persp: 0, pending: 1, forced: 0 });
    // A frame that rebuilds anyway builds and shows it.
    on.pass.pre(withAhead(ctxAt(away, FP.target, 1, 3), 8, true));
    const [, quad] = meshes(on.world);
    expect([quad?.visible, quad?.scale.x]).toEqual([true, 1]);
    expect(on.pass.stats?.()).toMatchObject({ persp: 1, forced: 0 });

    // Lever off: the quad is built and shown at once, a rebuild of its own.
    const off = run(0);
    expect(meshes(off.world)).toHaveLength(2);
    expect(off.pass.stats?.()).toMatchObject({ persp: 1, forced: 1 });
  });

  describe('visibility flips ride frames that rebuild World (perf Task 1, A PA1)', () => {
    // Moving the target east slides the wall west across the screen: its strip's screen box at target x.
    const box = (x: number) => {
      const pos = new Float32Array(STRIP_VERTS * 2), depth = new Float32Array(STRIP_VERTS);
      projectStrip(ctxAt(TP.p, { x, y: TP.target.y }).basis, { ax: 4864, az: 4864 + BASE, bx: 5120, bz: 4864 + BASE, h: BASE }, pos, depth);
      let x0 = Infinity, x1 = -Infinity, foot = -Infinity;
      for (let v = 0; v < STRIP_VERTS; v++) { x0 = Math.min(x0, pos[2 * v]!); x1 = Math.max(x1, pos[2 * v]!); }
      for (const v of [STRIP_VERTS - 5, STRIP_VERTS - 1]) foot = Math.max(foot, pos[2 * v]!);
      // Inside the fixed margins (frame/cull.ts; the ring is off in these frames): the wall's two ground ends.
      const c = ctxAt(TP.p, { x, y: TP.target.y }), o = [0, 0, 0], pts = new Float64Array(6);
      [4864, 5120].forEach((wx, i) => { project(c.basis, wx, 0, 4864 + BASE, o); pts.set(o, 3 * i); });
      return { x0, x1, foot, kept: legacyWallShow(c.cull, pts, LEGACY_CULL.art.above, LEGACY_CULL.art.below) };
    };
    const where = (pred: (b: ReturnType<typeof box>) => boolean): number => {
      for (let x = TP.target.x; x < TP.target.x + 20000; x += 4) if (pred(box(x))) return x;
      throw new Error('no such target');
    };
    const CULLED = where((b) => !b.kept) + 200;
    const IN_MARGIN = where((b) => b.kept && b.x1 < -200);
    const EDGE = where((b) => b.x1 > 4 && b.x1 < 30);
    // ahead: the show-ahead lever (frames; 0 off), with no turn band, so only the waits it adds differ.
    const setup = (ahead = 0) => {
      const { caps, world } = fakeCaps(true);
      const pass = createFences(caps, new WeakSet(), fader, scanWithWall, () => undefined, CAM);
      const rg = world.renderGroup as { structureDidChange?: boolean };
      const at = (x: number, f: number, check = false) => {
        const c = ctxAt(TP.p, { x, y: TP.target.y }, 1, f);
        pass.pre({ ...c, reCull: false, roll: check ? 0 : -1, cull: cullOf(c.basis, c.params, W, H, LEGACY_CULL.side, 0, { yaw: 0, pitch: 0, frames: ahead }) });
      };
      pass.pre(ctxAt(TP.p, TP.target, 1, 1));
      const strip = meshes(world)[0]!;
      let flips = 0, v = strip.visible;
      Object.defineProperty(strip, 'visible', { configurable: true, get: () => v, set: (x: boolean) => { if (x !== v) flips++; v = x; } });
      return { pass, rg, at, strip, flips: () => flips };
    };

    it('a culled wall is parked at scale 0, keeps visible, and is hidden once idle on a frame that rebuilds anyway', () => {
      const t = setup();
      expect(t.strip.visible).toBe(true);
      t.at(CULLED, 2, true);
      expect([t.strip.visible, t.strip.scale.x]).toEqual([true, 0]);
      for (let f = 3; f < 60; f++) t.at(CULLED, f);
      t.rg.structureDidChange = true;
      t.at(CULLED, 60);
      expect([t.strip.visible, t.flips()]).toEqual([true, 0]);
      t.at(CULLED, 3 + IDLE_FRAMES);
      expect([t.strip.visible, t.flips()]).toEqual([false, 1]);
      expect(t.pass.stats?.()).toMatchObject({ forced: 0 });
    });

    it('a hidden wall back in view waits while its strip is off screen and shows on the frame it reaches the screen', () => {
      const t = setup();
      t.at(CULLED, 2, true);
      t.rg.structureDidChange = true;
      t.at(CULLED, 2 + IDLE_FRAMES);
      t.rg.structureDidChange = false;
      expect(t.strip.visible).toBe(false);
      t.at(IN_MARGIN, 200, true);
      expect(t.strip.visible).toBe(false);
      expect(t.pass.stats?.()).toMatchObject({ shown: 1, pending: 1 });
      t.at(EDGE, 201);
      expect([t.strip.visible, t.strip.scale.x]).toEqual([true, 1]);
      expect(t.flips()).toBe(2);
      expect(t.pass.stats?.()).toMatchObject({ pending: 0, forced: 1 });
    });

    // A key changes only on a 15° yaw step (frame.ts SORT_STEP), a frame that rebuilds World anyway; a wall that sat
    // out a step comes back with its old key, and re-keying it re-sorts World (live 2026-10-07: 4–6 of the 8–10
    // sort-only frames in a 30 °/s orbit). STALE stands in for that old key.
    const STALE = -1;

    it('perf Task 7 (E3): with the lever a hidden strip is not keyed while it waits, and is keyed on the frame it shows', () => {
      const t = setup(8);
      t.at(CULLED, 2, true);
      t.rg.structureDidChange = true;
      t.at(CULLED, 2 + IDLE_FRAMES);
      t.rg.structureDidChange = false;
      t.strip.zIndex = STALE;
      t.at(IN_MARGIN, 200, true);
      expect([t.strip.visible, t.strip.zIndex]).toEqual([false, STALE]);
      expect(t.pass.stats?.()).toMatchObject({ shown: 0, pending: 1 });
      t.at(EDGE, 201);
      expect([t.strip.visible, t.strip.scale.x, t.strip.zIndex]).toEqual([true, 1, depthKey(4992, 4864 + BASE, 0, -1, 0)]);
      expect(t.pass.stats?.()).toMatchObject({ shown: 1, pending: 0 });
    });

    it('perf Task 7 (E3): with the lever a parked strip with a stale key waits at scale 0 off screen, and is re-keyed on a rebuild frame', () => {
      const key = depthKey(4992, 4864 + BASE, 0, -1, 0);
      const t = setup(8);
      t.at(CULLED, 2, true);
      expect([t.strip.visible, t.strip.scale.x]).toEqual([true, 0]);
      t.strip.zIndex = STALE;
      t.at(IN_MARGIN, 3, true);
      expect([t.strip.scale.x, t.strip.zIndex]).toEqual([0, STALE]);
      expect(t.pass.stats?.()).toMatchObject({ shown: 0, pending: 1 });
      t.rg.structureDidChange = true;
      t.at(IN_MARGIN, 4);
      t.rg.structureDidChange = false;
      expect([t.strip.scale.x, t.strip.zIndex]).toEqual([1, key]);
      // On screen it cannot wait: re-keyed at once.
      t.at(CULLED, 5, true);
      t.strip.zIndex = STALE;
      t.at(EDGE, 6, true);
      expect([t.strip.scale.x, t.strip.zIndex]).toEqual([1, key]);
      expect(t.flips()).toBe(0);

      // Lever off: re-keyed as soon as it is back in view, as before.
      const off = setup(0);
      off.at(CULLED, 2, true);
      off.strip.zIndex = STALE;
      off.at(IN_MARGIN, 3, true);
      expect([off.strip.scale.x, off.strip.zIndex]).toEqual([1, key]);
    });

    it('perf 5 ring: a wall near the camera culled off screen is re-decided on the next moving frame outside its slice', () => {
      const t = setup();
      const ringAt = (x: number, f: number, still: boolean, check = false): void => {
        const c = ctxAt(TP.p, { x, y: TP.target.y }, 1, f);
        t.pass.pre({ ...c, reCull: false, roll: check ? 0 : -1, capMask: 0, camStill: still, cull: cullOf(c.basis, c.params, W, H, 0.75, RING_PX) });
      };
      // Its strip just left of the screen, ~2,500 px from the camera (inside the ring less a cap): the screen culls it.
      const near = where((b) => b.x1 < -20);
      ringAt(near, 2, false, true);
      expect(t.strip.scale.x).toBe(0);
      ringAt(near, 3, true);
      expect(t.strip.scale.x).toBe(0);
      ringAt(TP.target.x, 4, false);
      expect(t.strip.scale.x).toBe(1);
    });
  });

  it('without a batched mesh geometry class every wall is a perspective quad', () => {
    const { caps, world } = fakeCaps(false);
    const pass = createFences(caps, new WeakSet(), fader, scanWithWall, () => undefined, CAM);
    pass.pre(ctxAt(TP.p, TP.target));
    const ms = meshes(world);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.shader).not.toBeNull();
    expect(ms[0]!.visible).toBe(true);
  });

  it('drop hides and detaches every wall; destroy frees meshes, geometries and the program', () => {
    const { caps, world, destroyed } = fakeCaps(true);
    const pass = createFences(caps, new WeakSet(), fader, scanWithWall, () => undefined, CAM);
    pass.pre(ctxAt(FP.p, FP.target));
    pass.drop();
    expect(meshes(world)).toHaveLength(0);
    pass.pre(ctxAt(TP.p, TP.target, 1, 2));
    expect(meshes(world).filter((m) => m.visible)).toHaveLength(1);
    pass.destroy();
    expect(meshes(world)).toHaveLength(0);
    expect(destroyed.filter((d) => d === 'mesh')).toHaveLength(2);
    expect(destroyed).toEqual(expect.arrayContaining(['meshGeometry', 'geometry', 'shader', 'program']));
  });
});
