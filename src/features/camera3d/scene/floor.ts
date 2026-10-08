import type { Pass } from '../frame/frame';
import type { Overrides } from '../frame/overrides';
import { TILE } from '../constants';
import type { Ground } from '../settings';
import type { Caps, Node3, TexLike, UniformGroupLike } from '../types';
import { CAM_RESOURCE } from './camUniforms';
import { ringPieces, staggerBakes } from './floorRing';
import { GROUND_FS, GROUND_VS, compileNow } from './shaders';
import { setTilemapShown } from './tileArt';

const R = 27; // far grid/bake half-size in tiles (27 keeps near + far + map under the 130 MB gate)
const RELEASE_MS = 30_000;
// No fog (user decision 2026-10-03): past the far bake the floor samples one whole-map bake at 16 texels per tile.
const MAP_RES = 0.0625;
const MARGIN = 8; // floor mesh tiles past each map edge
// Texels per world px of the near and far bakes. Low: 38 MB with the map instead of 127 (S §4.2); the map stays.
const GROUND_RES: Readonly<Record<Ground, { near: number; far: number }>> = { high: { near: 1, far: 0.25 }, low: { near: 0.5, far: 0.125 } };

/** ring (PC2, 2026-10-07): near/far hold world texel mod their side and repaint only the tiles that entered the window;
 * full: every rebake renders the whole window (before perf Task 6; kept as the A/B lever). */
export type FloorMode = 'ring' | 'full';

/** release: the floor bakes were freed (30 s after exit, or destroy); free whatever was baked alongside them. */
export interface BakeHooks { before(): void; after(): void; release?(): void }
export interface FreshBake { fresh: TexLike; level: TexLike; ox: number; oy: number; wrap: boolean }
export interface Floor extends Pass {
  addBakeHooks(h: BakeHooks): void;
  forceRebake(): void;
  releaseBakes(): void;
  memoryMB(): number;
  renderTextureClass(): unknown;
  /** Tuning only (polish Task 14 lever A/B): tiles the target may move before the near bake follows. */
  nearSlack(tiles?: number): number;
  /** Tuning only (perf Task 6 A/B): a change rebakes every level in place, at its current window. */
  bakeMode(m?: FloorMode): FloorMode;
  /** The Ground sharpness setting: a change rebakes every held level once, whole, at its current window. */
  setGround(g: Ground): void;
  /** Debug parity: a full bake of a level's current window (the caller destroys it), and where that window's top-left
   * texel sits in the level texture. */
  freshBake(ov: Overrides, which: 'near' | 'far'): FreshBake | null;
}

interface Level {
  half: number; res: number; slack: number; tex: string; samp: string; rt: TexLike | null; ci: number | null; cj: number | null;
  x0: number; y0: number; side: number; px: number; count: number; ms: number;
  /** rt holds world texel mod side (a ring bake). */
  wrap: boolean;
}
/** World rect (wx, wy, w, h) painted into the texture rect at (fx, fy), logical px. */
interface Paint { wx: number; wy: number; w: number; h: number; fx: number; fy: number }

interface GroundUniforms {
  uRegionOrigin: Float32Array; uFarRect: Float32Array; uNearRect: Float32Array;
  uNearBlendPx: number; uNearOn: number; uFarBlendPx: number; uMapRect: Float32Array; uMapOn: number; uWrap: Float32Array;
}

interface MapBake { rt: TexLike | null; w: number; h: number; count: number; ms: number }

const setRect = (a: Float32Array, x0: number, y0: number, sx: number, sy: number): void => { a[0] = x0; a[1] = y0; a[2] = sx; a[3] = sy; };
const mod = (v: number, n: number): number => ((v % n) + n) % n;

/** cam: the shared camera uniform group (camUniforms.ts). */
export function createFloor(caps: Caps, cam: UniformGroupLike): Floor {
  const { scene: s, classes: C } = caps;
  const { cols, rows } = caps.systems.map;
  const mapW = cols * TILE, mapH = rows * TILE;
  // One tile-grid mesh over the map plus a margin (the far bake keeps whatever Ground draws past the map edge).
  const nx = cols + 2 * MARGIN, ny = rows + 2 * MARGIN;
  const pos = new Float32Array((nx + 1) * (ny + 1) * 2);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const o = (j * (nx + 1) + i) * 2; pos[o] = i * TILE; pos[o + 1] = j * TILE; }
  const idx = new Uint32Array(nx * ny * 6);
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    idx.set([a, b, d, a, d, c], k);
    k += 6;
  }
  const geometry = new C.Geometry({ attributes: { aPosition: { buffer: pos, format: 'float32x2' } }, indexBuffer: idx, topology: 'triangle-list' });
  const f1 = (v: number) => ({ value: v, type: 'f32' });
  const fv = (len: number, type: string) => ({ value: new Float32Array(len), type });
  const U: UniformGroupLike = new C.UniformGroup({
    uRegionOrigin: fv(2, 'vec2<f32>'), uFarRect: fv(4, 'vec4<f32>'), uNearRect: fv(4, 'vec4<f32>'),
    uNearBlendPx: f1(TILE), uNearOn: f1(0), uFarBlendPx: f1(1024), uMapRect: fv(4, 'vec4<f32>'), uMapOn: f1(0), uWrap: fv(2, 'vec2<f32>'),
  });
  const u = U.uniforms as unknown as GroundUniforms;
  const white = C.Texture.WHITE.source;
  const shader = new C.Shader({
    glProgram: new C.GlProgram({ vertex: GROUND_VS, fragment: GROUND_FS, name: 'qpm3d-ground' }),
    resources: {
      [CAM_RESOURCE]: cam, qpm3dGround: U, uFarTexture: white, uFarSampler: white.style, uNearTexture: white, uNearSampler: white.style,
      uMapTexture: white, uMapSampler: white.style,
    },
  });
  const mesh = new C.Mesh({ geometry, shader, texture: C.Texture.WHITE });
  mesh.label = 'qpm3d-ground';
  mesh.visible = false;
  s.ground.addChild(mesh);
  // Never on the stage: an empty node allocates a blank bake; the eraser zeroes a ring band. 'erase' (dst × (1 − src α)),
  // not 'none': PIXI turns blending off for 'none', so it wrote white (live 2026-10-07, far texels past the map edge).
  const blankNode = new C.Container();
  const eraser = new C.Container();
  const erasers: Node3[] = [];

  const lvl = (half: number, res: number, slack: number, tex: string, samp: string): Level => ({
    half, res, slack, tex, samp, rt: null, ci: null, cj: null, x0: 0, y0: 0, side: 1, px: 0, count: 0, ms: 0, wrap: false,
  });
  const far = lvl(R, GROUND_RES.high.far, 6, 'uFarTexture', 'uFarSampler');
  // Slack 3 (A PF3 A/B, live 2026-10-05): 12 near rebakes per walk instead of 15–18, floor max 0.7 ms instead of 1.4–1.9,
  // and a stale bake shifted 3 tiles on both axes matched a fresh one in third and first person (no seam).
  const near = lvl(6, GROUND_RES.high.near, 3, 'uNearTexture', 'uNearSampler');
  const map: MapBake = { rt: null, w: 0, h: 0, count: 0, ms: 0 };
  const hooks: BakeHooks[] = [];
  let forceRegen = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let rtClass: unknown = null;
  let mode: FloorMode = 'ring';
  let ground: Ground = 'high';
  let remake = false;
  let sigPb: unknown = null, sigLen = -1;
  let paintedPx = 0, pieces = 0, staggered = 0;

  const maxSide = (): number => {
    const gl = s.renderer.gl;
    const m = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 4096;
    return Math.min(4096, Number.isFinite(m) && m > 0 ? m : 4096);
  };

  const texOpts = (px: number, wrap: boolean) => ({
    autoGenerateMipmaps: true, mipLevelCount: Math.floor(Math.log2(px)) + 1, scaleMode: 'linear', addressMode: wrap ? 'repeat' : 'clamp-to-edge', maxAnisotropy: 16,
  });

  /** into: re-render the region into this texture (same size and resolution) instead of allocating a new one. */
  function generate(ov: Overrides, x0: number, y0: number, w: number, h: number, res: number, into: TexLike | null = null): TexLike | null {
    const tv = ov.raw<boolean>('visible', s.tilemap), mv = mesh.visible;
    setTilemapShown(ov, s.tilemap, true);
    mesh.visible = false;
    let rt: TexLike | null = null;
    try {
      for (const hk of hooks) hk.before();
      if (into) {
        // What generateTexture does minus the allocation: a new mip-chained texture plus framebuffer per rebake was
        // nearly all of a 3D bake frame's floor time (live 2026-10-03: 0.9–4.2 ms).
        s.renderer.render({ container: s.ground, transform: new C.Matrix(1, 0, 0, 1, -x0, -y0), target: into, clearColor: [0, 0, 0, 0] });
        into.source.updateMipmaps?.();
        rt = into;
      } else {
        rt = s.renderer.generateTexture({
          target: s.ground, frame: new C.Rectangle(x0, y0, w, h), resolution: res, textureSourceOptions: texOpts(Math.max(w, h) * res, false),
        });
      }
    } finally {
      for (const hk of hooks) hk.after();
      setTilemapShown(ov, s.tilemap, tv);
      mesh.visible = mv;
    }
    if (rt) rtClass ??= (rt as unknown as { constructor: unknown }).constructor;
    return rt;
  }

  // PIXI's render clear is a whole-texture gl.clear (live 8.20), so a band is cleared by drawing over it.
  function erase(into: TexLike, parts: readonly Paint[]): void {
    for (let i = 0; i < parts.length; i++) {
      let sp = erasers[i];
      if (!sp) {
        sp = new C.Sprite(C.Texture.WHITE);
        (sp as unknown as { blendMode: string }).blendMode = 'erase';
        eraser.addChild(sp);
        erasers.push(sp);
      }
      const p = parts[i]!;
      sp.visible = true;
      sp.x = p.fx; sp.y = p.fy; sp.width = p.w; sp.height = p.h;
    }
    for (let i = parts.length; i < erasers.length; i++) erasers[i]!.visible = false;
    s.renderer.render({ container: eraser, target: into, clear: false });
  }

  /** Bands into a ring texture: bake hooks and the tilemap dance once, then one render per band (frame = its rect). */
  function paint(ov: Overrides, into: TexLike, parts: readonly Paint[], res: number): void {
    const tv = ov.raw<boolean>('visible', s.tilemap), mv = mesh.visible;
    setTilemapShown(ov, s.tilemap, true);
    mesh.visible = false;
    try {
      for (const hk of hooks) hk.before();
      erase(into, parts);
      for (const p of parts) {
        s.renderer.render({
          container: s.ground, transform: new C.Matrix(1, 0, 0, 1, -p.wx, -p.wy), target: into, clear: false, frame: new C.Rectangle(p.fx, p.fy, p.w, p.h),
        });
        paintedPx += p.w * p.h * res * res;
      }
    } finally {
      for (const hk of hooks) hk.after();
      setTilemapShown(ov, s.tilemap, tv);
      mesh.visible = mv;
    }
  }

  function bindLevel(lv: Level, rt: TexLike): void {
    shader.resources[lv.tex] = rt.source;
    shader.resources[lv.samp] = rt.source.style;
    if (lv === far) (mesh as unknown as { texture: TexLike }).texture = rt;
  }

  function bakeMap(ov: Overrides): void {
    const t0 = performance.now();
    const res = Math.min(MAP_RES, maxSide() / Math.max(mapW, mapH));
    const rt = generate(ov, 0, 0, mapW, mapH, res);
    if (!rt) return;
    shader.resources.uMapTexture = rt.source;
    shader.resources.uMapSampler = rt.source.style;
    map.rt?.destroy(true);
    Object.assign(map, { rt, w: Math.round(mapW * res), h: Math.round(mapH * res), ms: performance.now() - t0 });
    map.count++;
    paintedPx += map.w * map.h;
  }

  function bake(lv: Level, ci: number, cj: number, ov: Overrides): void {
    const t0 = performance.now();
    const side = (2 * lv.half + 1) * TILE, x0 = (ci - lv.half) * TILE, y0 = (cj - lv.half) * TILE;
    const px = Math.min(maxSide(), Math.round(side * lv.res));
    const old = lv.rt;
    const rt = generate(ov, x0, y0, side, side, px / side, old && !lv.wrap && lv.px === px && lv.side === side ? old : null);
    if (!rt) return;
    if (rt !== old) {
      bindLevel(lv, rt);
      if (old) old.destroy(true);
    }
    Object.assign(lv, { rt, ci, cj, x0, y0, side, px, wrap: false, ms: performance.now() - t0 });
    lv.count++;
    paintedPx += px * px;
  }

  /** Only the tiles that entered the window are painted (all of them without a fitting ring texture, or when whole). */
  function ringBake(lv: Level, ci: number, cj: number, ov: Overrides, whole: boolean): void {
    const t0 = performance.now();
    const n = 2 * lv.half + 1, side = n * TILE, px = Math.min(maxSide(), Math.round(side * lv.res));
    let rt = lv.rt;
    if (!rt || !lv.wrap || lv.px !== px || lv.side !== side) {
      const old = rt;
      rt = s.renderer.generateTexture({ target: blankNode, frame: new C.Rectangle(0, 0, side, side), resolution: px / side, textureSourceOptions: texOpts(px, true) });
      bindLevel(lv, rt);
      old?.destroy(true);
      whole = true;
    }
    const prev = whole || lv.ci === null || lv.cj === null ? null : { a: lv.ci - lv.half, b: lv.cj - lv.half };
    const list = ringPieces(prev, { a: ci - lv.half, b: cj - lv.half }, n);
    const parts = list.map((p) => ({ wx: p.wx * TILE, wy: p.wy * TILE, w: p.w * TILE, h: p.h * TILE, fx: p.tx * TILE, fy: p.ty * TILE }));
    pieces += parts.length;
    if (parts.length) {
      paint(ov, rt, parts, px / side);
      rt.source.updateMipmaps?.();
    }
    Object.assign(lv, { rt, ci, cj, x0: (ci - lv.half) * TILE, y0: (cj - lv.half) * TILE, side, px, wrap: true, ms: performance.now() - t0 });
    lv.count++;
  }

  const bakeLevel = (lv: Level, ci: number, cj: number, ov: Overrides, whole: boolean): void => {
    if (mode === 'ring') ringBake(lv, ci, cj, ov, whole);
    else bake(lv, ci, cj, ov);
  };

  const off = (lv: Level, ci: number, cj: number, tiles: number): boolean =>
    lv.ci === null || lv.cj === null || Math.abs(ci - lv.ci) > tiles || Math.abs(cj - lv.cj) > tiles;
  const stale = (lv: Level, ci: number, cj: number): boolean => off(lv, ci, cj, lv.slack);

  function dropLevel(lv: Level): void {
    shader.resources[lv.tex] = white;
    shader.resources[lv.samp] = white.style;
    if (lv === far) (mesh as unknown as { texture: TexLike }).texture = C.Texture.WHITE;
    if (lv.rt) { lv.rt.destroy(true); lv.rt = null; }
    lv.wrap = false;
  }

  // Unbound before destroyed: PIXI warns when a bound texture source or sampler is destroyed.
  function releaseBakes(): void {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    shader.resources.uMapTexture = white;
    shader.resources.uMapSampler = white.style;
    if (map.rt) { map.rt.destroy(true); map.rt = null; }
    for (const lv of [far, near]) { dropLevel(lv); lv.ci = null; lv.cj = null; }
    for (const hk of hooks) hk.release?.();
  }

  const armRelease = (): void => {
    if (!releaseTimer) releaseTimer = setTimeout(() => { releaseTimer = null; releaseBakes(); }, RELEASE_MS);
  };

  const mb = (lv: Level): number => (lv.rt ? (lv.px * lv.px * 4 * (4 / 3)) / 1048576 : 0);
  const mbMap = (): number => (map.rt ? (map.w * map.h * 4 * (4 / 3)) / 1048576 : 0);

  return {
    name: 'floor',
    pre(ctx) {
      if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
      const ci = Math.floor(ctx.target.x / TILE), cj = Math.floor(ctx.target.y / TILE);
      if (remake) {
        remake = false;
        for (const lv of [far, near]) {
          const wci = lv.ci, wcj = lv.cj;
          dropLevel(lv);
          lv.ci = null; lv.cj = null;
          if (wci !== null && wcj !== null) bakeLevel(lv, wci, wcj, ctx.ov, true);
        }
      }
      // A ring keeps what it painted until it scrolls out. The game builds the tilemap once from static map data (beta 3668
      // MapSystem.ts:49, nothing calls clear()); a replaced or resized buffer is drift, and repaints everything.
      const pb = s.tileData.pointsBuf;
      if (mode === 'ring' && (pb !== sigPb || pb.length !== sigLen)) { if (sigLen >= 0) forceRegen = true; sigPb = pb; sigLen = pb.length; }
      if (forceRegen || !map.rt) bakeMap(ctx.ov);
      const nearDue = forceRegen || stale(near, ci, cj), farDue = forceRegen || stale(far, ci, cj);
      if (nearDue || farDue) {
        // Far has 6 tiles of slack: a frame's wait is never seen; urgent once it has no bake or the camera ran 2× past it.
        const pick = staggerBakes(nearDue, farDue, forceRegen || off(far, ci, cj, 2 * far.slack));
        if (pick.far) bakeLevel(far, ci, cj, ctx.ov, forceRegen);
        else if (farDue) staggered++;
        if (pick.near) bakeLevel(near, ci, cj, ctx.ov, forceRegen);
      }
      forceRegen = false;
      u.uRegionOrigin[0] = -MARGIN * TILE; u.uRegionOrigin[1] = -MARGIN * TILE;
      setRect(u.uFarRect, far.x0, far.y0, 1 / far.side, 1 / far.side);
      if (near.rt) setRect(u.uNearRect, near.x0, near.y0, 1 / near.side, 1 / near.side);
      u.uNearOn = near.rt ? 1 : 0;
      setRect(u.uMapRect, 0, 0, 1 / mapW, 1 / mapH);
      u.uMapOn = map.rt ? 1 : 0;
      u.uWrap[0] = near.wrap ? 1 : 0; u.uWrap[1] = far.wrap ? 1 : 0;
      U.update();
      mesh.visible = true;
    },
    drop() {
      mesh.visible = false;
      armRelease();
    },
    destroy() {
      releaseBakes();
      s.ground.removeChild(mesh);
      mesh.destroy();
      geometry.destroy(true);
      shader.destroy(true);
      eraser.destroy({ children: true });
      blankNode.destroy();
    },
    stats: () => ({
      farBakes: far.count, nearBakes: near.count, mapBakes: map.count, farMs: +far.ms.toFixed(2), nearMs: +near.ms.toFixed(2),
      mapMs: +map.ms.toFixed(2), mb: +(mb(far) + mb(near) + mbMap()).toFixed(1), mode, ground, mpx: +(paintedPx / 1e6).toFixed(1), pieces, staggered,
    }),
    addBakeHooks(h) { hooks.push(h); },
    forceRebake() { forceRegen = true; },
    releaseBakes,
    // Near first: at max zoom straight down it is all the first 3D frame samples. Released like a 3D exit's bakes.
    warm(ov, at) {
      if (!at) return false;
      // A remake asked for in 2D (Ground, bake mode): free the old bakes so the prewarm repaints them, a level per 2D
      // frame, instead of the first 3D frame repainting both.
      if (remake) {
        remake = false;
        for (const lv of [far, near]) { dropLevel(lv); lv.ci = null; lv.cj = null; }
      }
      const ci = Math.floor(at.x / TILE), cj = Math.floor(at.y / TILE);
      if (stale(near, ci, cj)) bakeLevel(near, ci, cj, ov, false);
      else if (stale(far, ci, cj)) bakeLevel(far, ci, cj, ov, false);
      else if (!map.rt) bakeMap(ov);
      else return false;
      armRelease();
      return true;
    },
    compile() { compileNow(caps, geometry, shader); },
    memoryMB: () => mb(far) + mb(near) + mbMap(),
    renderTextureClass: () => rtClass,
    nearSlack(tiles) {
      if (tiles !== undefined && tiles >= 0 && tiles < near.half) near.slack = tiles;
      return near.slack;
    },
    bakeMode(m) {
      if (m && m !== mode) { mode = m; remake = true; }
      return mode;
    },
    setGround(g) {
      if (g === ground) return;
      ground = g;
      near.res = GROUND_RES[g].near;
      far.res = GROUND_RES[g].far;
      remake = true;
    },
    freshBake(ov, which) {
      const lv = which === 'near' ? near : far;
      if (!lv.rt || lv.ci === null || lv.cj === null) return null;
      const fresh = generate(ov, lv.x0, lv.y0, lv.side, lv.side, lv.px / lv.side);
      if (!fresh) return null;
      const n = 2 * lv.half + 1, k = lv.px / n;
      const ox = lv.wrap ? mod(lv.ci - lv.half, n) * k : 0, oy = lv.wrap ? mod(lv.cj - lv.half, n) * k : 0;
      return { fresh, level: lv.rt, ox, oy, wrap: lv.wrap };
    },
  };
}
