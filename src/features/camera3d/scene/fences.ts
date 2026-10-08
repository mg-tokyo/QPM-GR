import { LEGACY_CULL, TILE } from '../constants';
import { project } from '../math/camera';
import { depthKey } from '../math/depth';
import { hullMayShow, legacyWallShow } from '../frame/cull';
import { nearCamera, recheck, ringDue, ringExact, type FrameCtx, type Pass } from '../frame/frame';
import type { Caps, GeometryLike, Node3, ShaderLike, TexLike, UniformGroupLike } from '../types';
import { CAM_RESOURCE } from './camUniforms';
import type { Fader } from './fades';
import { FlipGate, IDLE_FRAMES, rectOnScreen } from './flipGate';
import { AREA_FS, WALL_VS, compileNow } from './shaders';
import { D8_MIRROR_H, FENCE_KEYS, RECT, artBaseRow, subTexture, type TileScan } from './tileArt';
import { STRIP_VERTS, projectStrip, stripCanWait, stripIndices, stripMayNeedPerspective, stripNeedsPerspective, stripUvs, wallQuadWorld, type WallLine } from './wallGeom';

const QUAD = new Uint32Array([0, 1, 2, 0, 2, 3]);
type Uvs = { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number };
type PanelTex = TexLike & { uvs?: Uvs };
interface DynGeometry extends GeometryLike { getBuffer(name: string): { update(): void } }
// Showing a hidden quad is a visibility flip, so an error-only switch waits up to this many frames for such a frame
// (live 1411: show flips made 22–25 of 150 yaw-sweep frames rebuild World). stripCanWait bounds the error meanwhile.
const MAX_WAIT = 8;
// A wall's four corners (both ends, ground and top) as projected (sx, sy, cz) triples, for frame/cull.ts.
const CORNERS = new Float64Array(12);

interface Wall extends WallLine {
  mx: number; mz: number; tex: PanelTex;
  /** The batched strip (null without a MeshGeometry class) and the perspective quad (built when first needed). */
  strip: Node3 | null; stripGeom: DynGeometry | null; persp: Node3 | null; perspGeom: GeometryLike | null;
  /** Fader identity: one node for the wall whichever mesh draws it. */
  key: Node3;
  pos: Float32Array; depth: Float32Array;
  /** arm: close to needing the quad, which is shown at scale 0 on a frame that rebuilds anyway (show-ahead lever on). */
  on: boolean; near: boolean; arm: boolean; stale: boolean;
  /** Frames since the perspective quad last drew; frames a switch to it has waited; the frame the wall left the view. */
  idle: number; wait: number; off: number;
}

/** Fence walls (spec §6.7): per-tile panel art standing on its plot line. Far from the lens a wall is a batched strip of
 * exactly projected vertices (no extra draw call); near it, a perspective quad (A V4; wallGeom.ts). camU: the shared
 * camera uniform group (camUniforms.ts). */
export function createFences(
  caps: Caps, skip: WeakSet<Node3>, fader: Fader, getScan: () => TileScan, onWalls: (fade: number) => void, camU: UniformGroupLike,
): Pass {
  const { scene: s, classes: C } = caps;
  const MG = C.MeshGeometry;
  const uvs = stripUvs(), idx = stripIndices();
  const panels = new Map<string, PanelTex>();
  const shaders = new Map<object, ShaderLike>();
  let walls: Wall[] = [];
  let builtFor: TileScan | null = null;
  let wallsOn = false;
  let attached = false;
  let program: unknown = null;
  const gate = new FlipGate(s.world);
  // switches: strip ↔ perspective changes since install (hysteresis check: a wall should not flicker between them).
  let shown = 0, persp = 0, switches = 0, parked = 0, pending = 0;

  const resources = (): void => {
    program ??= new C.GlProgram({ vertex: WALL_VS, fragment: AREA_FS, name: 'qpm3d-wall' });
  };
  const shaderFor = (src: object): ShaderLike => {
    let sh = shaders.get(src);
    if (!sh) {
      resources();
      sh = new C.Shader({ glProgram: program, resources: { [CAM_RESOURCE]: camU, uAreaTexture: src, uAreaSampler: (src as { style?: unknown }).style } });
      shaders.set(src, sh);
    }
    return sh;
  };
  const quadGeometry = (pos: Float32Array, uv: Float32Array): GeometryLike =>
    new C.Geometry({ attributes: { aPosition: { buffer: pos, format: 'float32x3' }, aUV: { buffer: uv, format: 'float32x2' } }, indexBuffer: QUAD, topology: 'triangle-list' });

  const own = (m: Node3): Node3 => {
    m.label = 'qpm3d-fence';
    m.visible = false;
    m.eventMode = 'none';
    skip.add(m);
    if (attached) { s.world.addChild(m); gate.noteFlip(); }
    return m;
  };

  function perspOf(w: Wall): Node3 | null {
    const u = w.tex.uvs;
    if (!u) return null;
    const geom = quadGeometry(wallQuadWorld(w), new Float32Array([u.x0, u.y0, u.x1, u.y1, u.x2, u.y2, u.x3, u.y3]));
    w.perspGeom = geom;
    return (w.persp = own(new C.Mesh({ geometry: geom, shader: shaderFor(w.tex.source), texture: C.Texture.WHITE })));
  }

  function panel(key: string, c0: number, c1: number, base: number): PanelTex | null {
    const id = `${key}|${c0}|${c1}|${base}`;
    let t = panels.get(id);
    if (!t) { const made = subTexture(caps, key, c0, 0, c1 - c0, base) as PanelTex | null; if (!made) return null; t = made; panels.set(id, t); }
    return t;
  }

  function add(key: string, c0: number, c1: number, base: number, ax: number, az: number, bx: number, bz: number): void {
    const tex = panel(key, c0, c1, base);
    if (!tex) return;
    const w = { ax, az, bx, bz, h: base, mx: (ax + bx) / 2, mz: (az + bz) / 2, tex, strip: null, stripGeom: null, persp: null, perspGeom: null,
      pos: new Float32Array(STRIP_VERTS * 2), depth: new Float32Array(STRIP_VERTS), on: false, near: MG === null, arm: false, stale: true, idle: IDLE_FRAMES, wait: 0, off: 0 } as Omit<Wall, 'key'> & { key?: Node3 };
    if (MG) {
      const geom = new MG({ positions: w.pos, uvs, indices: idx }) as DynGeometry & { positions?: Float32Array };
      if (geom.positions) w.pos = geom.positions;
      w.stripGeom = geom;
      w.strip = own(new C.Mesh({ geometry: geom, texture: tex }));
    } else if (!perspOf(w as Wall)) return;
    w.key = (w.strip ?? w.persp)!;
    walls.push(w as Wall);
  }

  function attach(on: boolean): void {
    if (attached === on) return;
    attached = on;
    gate.noteFlip();
    for (const w of walls) for (const m of [w.strip, w.persp]) if (m) { if (on) s.world.addChild(m); else s.world.removeChild(m); }
  }

  function release(): void {
    attach(false);
    for (const w of walls) {
      w.strip?.destroy();
      w.stripGeom?.destroy(true);
      w.persp?.destroy();
      w.perspGeom?.destroy(true);
    }
    walls = [];
    for (const t of panels.values()) t.destroy(false);
    panels.clear();
    for (const sh of shaders.values()) sh.destroy(false);
    shaders.clear();
  }

  // Plot layout from the tilemap: top edge T H..H T', sides V, bottom R H..H R' (' = mirrored). The panel art (H)
  // ends at its base row; N-S runs and corner stubs reuse it on the post-column centre line (tile x + 128).
  // Detached while 2D, like the decor cards (the game's World zIndex sort).
  function build(): void {
    release();
    const scan = getScan();
    builtFor = scan;
    const pb = scan.pb;
    const base = artBaseRow(caps, FENCE_KEYS.H, TILE, TILE);
    for (const [o, kind] of scan.fence) {
      const x = pb[o + RECT.X]!, y = pb[o + RECT.Y]!, cx = x + TILE / 2, zb = y + base, mirrored = pb[o + RECT.ROTATE] === D8_MIRROR_H;
      const key = FENCE_KEYS[kind];
      const ew = (c0: number, c1: number): void => {
        if (mirrored) add(key, c0, c1, base, x + TILE - c0, zb, x + TILE - c1, zb);
        else add(key, c0, c1, base, x + c0, zb, x + c1, zb);
      };
      if (kind === 'H') ew(0, TILE);
      else if (kind === 'V') add(FENCE_KEYS.H, 0, TILE, base, cx, y, cx, y + TILE);
      else if (kind === 'T') { ew(TILE / 2, TILE); add(FENCE_KEYS.H, 0, TILE - base, base, cx, zb, cx, y + TILE); }
      else { ew(0, TILE); add(FENCE_KEYS.H, 0, base, base, cx, y, cx, zb); }
    }
  }

  // Well inside the near ring, the wall's four corners against the screen as the camera may turn it before the next
  // rebuild (frame.ts ringExact, cull.ts ahead; its quad is world-fixed, so they bound it); farther out, its two ground
  // ends with the fixed margins.
  function inView(ctx: FrameCtx, w: Wall): boolean {
    const exact = ringExact(ctx, w.mx, w.mz);
    corners(ctx, w, exact ? 4 : 2);
    return exact ? hullMayShow(ctx.cull, CORNERS, 4, ctx.cull.ahead) : legacyWallShow(ctx.cull, CORNERS, LEGACY_CULL.art.above, LEGACY_CULL.art.below);
  }
  function corners(ctx: FrameCtx, w: Wall, n: number): void {
    const o = ctx.out;
    for (let i = 0; i < n; i++) {
      project(ctx.basis, i & 1 ? w.bx : w.ax, i & 2 ? w.h : 0, i & 1 ? w.bz : w.az, o);
      CORNERS[3 * i] = o[0]!; CORNERS[3 * i + 1] = o[1]!; CORNERS[3 * i + 2] = o[2]!;
    }
  }

  // Perf Task 7 (E3, the show-ahead lever): a wall that would flip a mesh or re-key one waits at scale 0 for a frame
  // that rebuilds World anyway while it is off the real screen (its strip box; near the lens its corner hull, as the
  // quad may reach behind the camera). Keys change only on a 15° step, so a re-key is a wall that sat one out (live
  // 2026-10-07: 4–6 of the 8–10 sort-only frames in a 30 °/s orbit).
  function mustWait(ctx: FrameCtx, w: Wall, key: number): boolean {
    const d = w.near ? w.persp : w.strip;
    const change = d?.visible !== true || (w.strip?.visible === true && w.strip.zIndex !== key) || (w.persp?.visible === true && w.persp.zIndex !== key);
    if (!change || gate.structural(ctx)) return false;
    if (!w.near) return !stripOnScreen(ctx, w.pos);
    corners(ctx, w, 4);
    return !hullMayShow(ctx.cull, CORNERS, 4);
  }
  function hold(w: Wall): void {
    if (w.strip?.visible && w.strip.scale.x !== 0) w.strip.scale.set(0, 0);
    if (w.persp?.visible && w.persp.scale.x !== 0) w.persp.scale.set(0, 0);
    pending++;
  }

  // The strip's projected box (screen px) overlaps the screen.
  function stripOnScreen(ctx: FrameCtx, pos: Float32Array): boolean {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let v = 0; v < STRIP_VERTS; v++) {
      const x = pos[2 * v]!, y = pos[2 * v + 1]!;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return rectOnScreen(ctx, x0, y0, x1, y1);
  }
  // Out of view: drawn at scale 0 until a frame that rebuilds World anyway hides it (flipGate.ts).
  function park(ctx: FrameCtx, w: Wall, m: Node3 | null): void {
    if (!m?.visible) return;
    if (m.scale.x !== 0) m.scale.set(0, 0);
    if (gate.canHide(ctx, ctx.frameNo - w.off)) gate.set(m, false);
    else parked++;
  }
  function conceal(ctx: FrameCtx, w: Wall): void { park(ctx, w, w.strip); park(ctx, w, w.persp); w.idle = IDLE_FRAMES; w.wait = 0; }
  // Switching meshes moves scales only: a visibility flip rebuilds World's instructions (live 1411: a third-person yaw
  // sweep switched walls on 52 of 150 frames, each one a rebuild). Both meshes carry the key, so a switch never re-sorts.
  // live: with the show-ahead lever a hidden mesh keeps its old key (re-keying it re-sorts World with nothing drawn).
  const tune = (m: Node3 | null, k: number, key: number, a: number, live: boolean): void => {
    if (!m || (live && !m.visible)) return;
    if (m.scale.x !== k) m.scale.set(k, k);
    if (m.zIndex !== key) m.zIndex = key;
    if (m.alpha !== a) m.alpha = a;
  };
  function display(w: Wall, key: number, a: number, ctx: FrameCtx): void {
    const ahead = ctx.cull.aheadFrames > 0;
    if (w.persp) {
      w.idle = w.near || w.arm ? 0 : w.idle + 1;
      if (w.near || (w.arm && gate.structural(ctx))) gate.set(w.persp, true);
      else if (w.persp.visible && gate.canHide(ctx, w.idle)) gate.set(w.persp, false);
    }
    // Near the lens the strip shows with the quad, so the switch back is by scale alone. With the lever it shows there
    // only on a frame that rebuilds anyway; a strip that draws was already held by mustWait while off screen.
    if (w.strip && !w.strip.visible) {
      if (gate.canShow(ctx, ahead ? !w.near : w.near || stripOnScreen(ctx, w.pos))) gate.set(w.strip, true);
      else pending++;
    }
    tune(w.strip, w.near ? 0 : 1, key, a, ahead);
    tune(w.persp, w.near ? 1 : 0, key, a, ahead);
  }

  return {
    name: 'fences',
    pre(ctx: FrameCtx) {
      gate.begin(ctx);
      if (builtFor !== getScan()) build();
      attach(true);
      // Walls fade in with the tilt (s), as the fence cards (decor.ts) fade out: the 2D match draws only the cards.
      const t = ctx.tilt;
      const flip = (t > 0) !== wallsOn;
      wallsOn = t > 0;
      onWalls(t);
      const near = ctx.params.near;
      // A still camera leaves every strip where it was: no projection, no upload (ctx.camStill covers what projectStrip
      // reads: the basis and the near plane).
      const moved = !ctx.camStill;
      shown = 0; persp = 0; parked = 0; pending = 0;
      for (let wi = 0; wi < walls.length; wi++) {
        const w = walls[wi]!;
        const check = flip || recheck(ctx, wi) || ringDue(ctx, w.mx, w.mz);
        if (!check && !w.on) { conceal(ctx, w); continue; }
        let fresh = false;
        if (check) {
          // Never culled next to the lens: the GPU clips a perspective quad, and orbiting sweeps those walls fastest.
          const vis = t > 0 && (nearCamera(ctx, w.mx, w.mz) || inView(ctx, w));
          if (vis !== w.on) { w.on = vis; fresh = vis; if (!vis) w.off = ctx.frameNo; }
        }
        if (!w.on) { conceal(ctx, w); continue; }
        if (moved || fresh || w.wait > 0) {
          if ((moved || fresh) && projectStrip(ctx.basis, w, w.pos, w.depth)) w.stale = true;
          const was = w.near;
          w.near = !w.strip || stripNeedsPerspective(w.near, w.pos, w.depth, near);
          if (w.near && !was && w.persp?.visible !== true && w.wait < MAX_WAIT && !gate.structural(ctx) && stripCanWait(w.pos, w.depth, near)) {
            w.near = false;
            w.wait++;
          } else w.wait = 0;
          if (w.near !== was) switches++;
          w.arm = ctx.cull.aheadFrames > 0 && !w.near && w.strip !== null && stripMayNeedPerspective(w.pos, w.depth, near);
        }
        // The lever can go off with the camera still (no re-projection): the arm goes with it.
        if (ctx.cull.aheadFrames <= 0) w.arm = false;
        const key = depthKey(w.mx, w.mz, ctx.dx, ctx.dz, 0);
        if (ctx.cull.aheadFrames > 0 && mustWait(ctx, w, key)) { hold(w); continue; }
        if (w.near && !w.persp && !perspOf(w)) { conceal(ctx, w); continue; }
        // Building the quad adds a World child, a structure change of its own: only on a frame that rebuilds anyway.
        if (w.arm && !w.persp && gate.structural(ctx)) perspOf(w);
        if (!w.near && w.stale) { w.stripGeom!.getBuffer('aPosition').update(); w.stale = false; }
        display(w, key, t * fader.factor(ctx, w.key, key, w.mx, w.mz), ctx);
        shown++;
        if (w.near) persp++;
      }
      gate.end();
    },
    warm() { if (builtFor === getScan()) return false; build(); return true; },
    // The perspective program compiles at install, not on the frame the first wall comes near (A T2).
    compile() {
      resources();
      const src = C.Texture.WHITE.source;
      const geom = quadGeometry(new Float32Array(12), new Float32Array(8));
      const sh = new C.Shader({ glProgram: program, resources: { [CAM_RESOURCE]: camU, uAreaTexture: src, uAreaSampler: src.style } });
      try { compileNow(caps, geom, sh); } finally { geom.destroy(true); sh.destroy(false); }
    },
    drop() {
      for (const w of walls) {
        if (w.strip) w.strip.visible = false;
        if (w.persp) w.persp.visible = false;
        w.on = false; w.arm = false; w.idle = IDLE_FRAMES; w.wait = 0;
      }
      wallsOn = false;
      attach(false);
    },
    destroy() {
      release();
      builtFor = null;
      (program as { destroy?(): void } | null)?.destroy?.();
      program = null;
    },
    stats: () => ({ walls: walls.length, shown, persp, switches, forced: gate.forced, parked, pending, batched: MG !== null }),
  };
}
