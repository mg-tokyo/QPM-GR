import type { FrameCtx, Pass } from '../frame/frame';
import type { Caps, TexLike, UniformGroupLike } from '../types';
import { GROUND_FS, GROUND_VS } from './shaders';

const TILE = 256;
const R = 27; // far grid/bake half-size in tiles (27 keeps near + far + map under the 130 MB gate)
const RELEASE_MS = 30_000;
const SKY_TINT = 0x9fd8f5;
// No fog (user decision 2026-10-03): past the far bake the floor samples one whole-map bake at 16 texels per tile.
const MAP_RES = 0.0625;
const MARGIN = 8; // floor mesh tiles past each map edge

export interface BakeHooks { before(): void; after(): void }
export interface Floor extends Pass {
  addBakeHooks(h: BakeHooks): void;
  setSkyReplaced(v: boolean): void;
  forceRebake(): void;
  releaseBakes(): void;
  memoryMB(): number;
  renderTextureClass(): unknown;
}

interface Level { half: number; res: number; slack: number; tex: string; samp: string; rt: TexLike | null; ci: number | null; cj: number | null; x0: number; y0: number; side: number; px: number; count: number; ms: number }

interface GroundUniforms {
  uRegionOrigin: Float32Array; uCamPos: Float32Array; uCamF: Float32Array; uCamR: Float32Array; uCamU: Float32Array;
  uFpx: number; uCenter: Float32Array; uNear: number; uFarRect: Float32Array; uNearRect: Float32Array;
  uNearBlendPx: number; uNearOn: number; uFarBlendPx: number; uMapRect: Float32Array; uMapOn: number;
}

interface MapBake { rt: TexLike | null; w: number; h: number; count: number; ms: number }

export function createFloor(caps: Caps): Floor {
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
    uRegionOrigin: fv(2, 'vec2<f32>'), uCamPos: fv(3, 'vec3<f32>'), uCamF: fv(3, 'vec3<f32>'), uCamR: fv(3, 'vec3<f32>'), uCamU: fv(3, 'vec3<f32>'),
    uFpx: f1(1), uCenter: fv(2, 'vec2<f32>'), uNear: f1(40), uFarRect: fv(4, 'vec4<f32>'), uNearRect: fv(4, 'vec4<f32>'),
    uNearBlendPx: f1(256), uNearOn: f1(0), uFarBlendPx: f1(1024), uMapRect: fv(4, 'vec4<f32>'), uMapOn: f1(0),
  });
  const u = U.uniforms as unknown as GroundUniforms;
  const white = C.Texture.WHITE.source;
  const shader = new C.Shader({
    glProgram: new C.GlProgram({ vertex: GROUND_VS, fragment: GROUND_FS, name: 'qpm3d-ground' }),
    resources: {
      qpm3dGround: U, uFarTexture: white, uFarSampler: white.style, uNearTexture: white, uNearSampler: white.style,
      uMapTexture: white, uMapSampler: white.style,
    },
  });
  const mesh = new C.Mesh({ geometry, shader, texture: C.Texture.WHITE });
  mesh.label = 'qpm3d-ground';
  mesh.visible = false;
  const sky = new C.Sprite(C.Texture.WHITE);
  sky.label = 'qpm3d-sky';
  sky.visible = false;
  s.ground.addChild(sky);
  s.ground.addChild(mesh);

  const far: Level = { half: R, res: 0.25, slack: 6, tex: 'uFarTexture', samp: 'uFarSampler', rt: null, ci: null, cj: null, x0: 0, y0: 0, side: 1, px: 0, count: 0, ms: 0 };
  const near: Level = { half: 6, res: 1, slack: 2, tex: 'uNearTexture', samp: 'uNearSampler', rt: null, ci: null, cj: null, x0: 0, y0: 0, side: 1, px: 0, count: 0, ms: 0 };
  const map: MapBake = { rt: null, w: 0, h: 0, count: 0, ms: 0 };
  const hooks: BakeHooks[] = [];
  let forceRegen = false;
  let skyReplaced = false;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let rtClass: unknown = null;

  const maxSide = (): number => {
    const gl = s.renderer.gl;
    const m = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 4096;
    return Math.min(4096, Number.isFinite(m) && m > 0 ? m : 4096);
  };

  /** into: re-render the region into this texture (same size and resolution) instead of allocating a new one. */
  function generate(ctx: FrameCtx, x0: number, y0: number, w: number, h: number, res: number, into: TexLike | null = null): TexLike | null {
    const mips = Math.floor(Math.log2(Math.max(w, h) * res)) + 1;
    const tv = ctx.ov.raw<boolean>('visible', s.tilemap), sv = sky.visible, mv = mesh.visible;
    ctx.ov.rawSet('visible', s.tilemap, true);
    sky.visible = false;
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
          target: s.ground, frame: new C.Rectangle(x0, y0, w, h), resolution: res,
          textureSourceOptions: { autoGenerateMipmaps: true, mipLevelCount: mips, scaleMode: 'linear', addressMode: 'clamp-to-edge', maxAnisotropy: 16 },
        });
      }
    } finally {
      for (const hk of hooks) hk.after();
      ctx.ov.rawSet('visible', s.tilemap, tv);
      sky.visible = sv;
      mesh.visible = mv;
    }
    if (rt) rtClass ??= (rt as unknown as { constructor: unknown }).constructor;
    return rt;
  }

  function bakeMap(ctx: FrameCtx): void {
    const t0 = performance.now();
    const res = Math.min(MAP_RES, maxSide() / Math.max(mapW, mapH));
    const rt = generate(ctx, 0, 0, mapW, mapH, res);
    if (!rt) return;
    shader.resources.uMapTexture = rt.source;
    shader.resources.uMapSampler = rt.source.style;
    map.rt?.destroy(true);
    Object.assign(map, { rt, w: Math.round(mapW * res), h: Math.round(mapH * res), ms: performance.now() - t0 });
    map.count++;
  }

  function bake(lv: Level, ci: number, cj: number, ctx: FrameCtx): void {
    const t0 = performance.now();
    const side = (2 * lv.half + 1) * TILE, x0 = (ci - lv.half) * TILE, y0 = (cj - lv.half) * TILE;
    const px = Math.min(maxSide(), Math.round(side * lv.res));
    const old = lv.rt;
    const rt = generate(ctx, x0, y0, side, side, px / side, old && lv.px === px && lv.side === side ? old : null);
    if (!rt) return;
    if (rt !== old) {
      shader.resources[lv.tex] = rt.source;
      shader.resources[lv.samp] = rt.source.style;
      if (lv === far) (mesh as unknown as { texture: TexLike }).texture = rt;
      if (old) old.destroy(true);
    }
    Object.assign(lv, { rt, ci, cj, x0, y0, side, px, ms: performance.now() - t0 });
    lv.count++;
  }

  const stale = (lv: Level, ci: number, cj: number): boolean => lv.ci === null || lv.cj === null || Math.abs(ci - lv.ci) > lv.slack || Math.abs(cj - lv.cj) > lv.slack;

  // Unbound before destroyed: PIXI warns when a bound texture source or sampler is destroyed.
  function releaseBakes(): void {
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    (mesh as unknown as { texture: TexLike }).texture = C.Texture.WHITE;
    shader.resources.uMapTexture = white;
    shader.resources.uMapSampler = white.style;
    if (map.rt) { map.rt.destroy(true); map.rt = null; }
    for (const lv of [far, near]) {
      shader.resources[lv.tex] = white;
      shader.resources[lv.samp] = white.style;
      if (lv.rt) { lv.rt.destroy(true); lv.rt = null; }
      lv.ci = null; lv.cj = null;
    }
  }

  const mb = (lv: Level): number => (lv.rt ? (lv.px * lv.px * 4 * (4 / 3)) / 1048576 : 0);
  const mbMap = (): number => (map.rt ? (map.w * map.h * 4 * (4 / 3)) / 1048576 : 0);

  return {
    name: 'floor',
    pre(ctx) {
      if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
      const ci = Math.floor(ctx.target.x / TILE), cj = Math.floor(ctx.target.y / TILE);
      if (forceRegen || !map.rt) bakeMap(ctx);
      if (forceRegen || stale(far, ci, cj)) bake(far, ci, cj, ctx);
      if (forceRegen || stale(near, ci, cj)) bake(near, ci, cj, ctx);
      forceRegen = false;
      const b = ctx.basis;
      u.uRegionOrigin[0] = -MARGIN * TILE; u.uRegionOrigin[1] = -MARGIN * TILE;
      u.uCamPos.set(b.C); u.uCamF.set(b.F); u.uCamR.set(b.R); u.uCamU.set(b.U);
      u.uFpx = b.fpx; u.uCenter[0] = b.cx0; u.uCenter[1] = b.cy0; u.uNear = ctx.params.near;
      u.uFarRect.set([far.x0, far.y0, 1 / far.side, 1 / far.side]);
      if (near.rt) u.uNearRect.set([near.x0, near.y0, 1 / near.side, 1 / near.side]);
      u.uNearOn = near.rt ? 1 : 0;
      u.uMapRect.set([0, 0, 1 / mapW, 1 / mapH]);
      u.uMapOn = map.rt ? 1 : 0;
      U.update();
      sky.tint = SKY_TINT;
      sky.position.set(0, 0);
      sky.width = ctx.W;
      sky.height = ctx.H;
      sky.visible = !skyReplaced;
      mesh.visible = true;
    },
    drop() {
      sky.visible = false;
      mesh.visible = false;
      if (!releaseTimer) releaseTimer = setTimeout(() => { releaseTimer = null; releaseBakes(); }, RELEASE_MS);
    },
    destroy() {
      releaseBakes();
      s.ground.removeChild(sky);
      s.ground.removeChild(mesh);
      mesh.destroy();
      geometry.destroy(true);
      shader.destroy(true);
      sky.destroy();
    },
    stats: () => ({
      farBakes: far.count, nearBakes: near.count, mapBakes: map.count, farMs: +far.ms.toFixed(2), nearMs: +near.ms.toFixed(2),
      mapMs: +map.ms.toFixed(2), mb: +(mb(far) + mb(near) + mbMap()).toFixed(1),
    }),
    addBakeHooks(h) { hooks.push(h); },
    setSkyReplaced(v) { skyReplaced = v; },
    forceRebake() { forceRegen = true; },
    releaseBakes,
    memoryMB: () => mb(far) + mb(near) + mbMap(),
    renderTextureClass: () => rtClass,
  };
}
