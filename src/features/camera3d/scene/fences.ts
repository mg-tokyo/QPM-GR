import { project } from '../math/camera';
import { depthKey } from '../math/depth';
import { recheck, type FrameCtx, type Pass } from '../frame/frame';
import type { Caps, Node3, TexLike } from '../types';
import type { Fader } from './fades';
import { FENCE_KEYS, artBaseRow, subTexture, type TileScan } from './tileArt';

const COLS = 4;
const TILE = 256;
// Affine fourth-corner error, relative to the column's screen height: drawn up to R_FULL, gone at R_HIDE.
const R_FULL = 0.1, R_HIDE = 0.25;
interface Wall { box: Node3; cols: Node3[]; ax: number; az: number; bx: number; bz: number; w: number; h: number; mx: number; mz: number }

/** Projected column edges: ground (g) and wall top (h) screen x, y and camera depth. */
export interface EdgeRows { gx: Float64Array; gy: Float64Array; gz: Float64Array; hx: Float64Array; hy: Float64Array; hz: Float64Array }

// A column sprite is pinned by three corners (B0, B1, T0); its fourth lands at B1 + T0 − B0. Near the lens the true
// corner drifts away, and a corner past the near plane flips through infinity (live 2026-10-03: the wall top crossed
// it while both feet were in front, wedges swept the screen).
export function columnAlpha(e: EdgeRows, i: number, near: number, W: number, H: number): number {
  const j = i + 1;
  if (Math.min(e.gz[i]!, e.gz[j]!, e.hz[i]!, e.hz[j]!) < near) return 0;
  if (Math.max(e.gx[i]!, e.gx[j]!, e.hx[i]!, e.hx[j]!) < 0 || Math.min(e.gx[i]!, e.gx[j]!, e.hx[i]!, e.hx[j]!) > W
    || Math.max(e.gy[i]!, e.gy[j]!, e.hy[i]!, e.hy[j]!) < 0 || Math.min(e.gy[i]!, e.gy[j]!, e.hy[i]!, e.hy[j]!) > H) return 0;
  const drift = Math.hypot(e.gx[j]! + e.hx[i]! - e.gx[i]! - e.hx[j]!, e.gy[j]! + e.hy[i]! - e.gy[i]! - e.hy[j]!);
  const r = drift / Math.max(1, Math.hypot(e.hx[i]! - e.gx[i]!, e.hy[i]! - e.gy[i]!));
  return Math.min(1, Math.max(0, (R_HIDE - r) / (R_HIDE - R_FULL)));
}

export function createFences(caps: Caps, skip: WeakSet<Node3>, fader: Fader, getScan: () => TileScan, onWalls: (fade: number) => void): Pass {
  const { scene: s, classes: C } = caps;
  let walls: Wall[] = [];
  let builtFor: TileScan | null = null;
  let wallsOn = false;
  let attached = false;
  const M = new C.Matrix();
  const n = COLS + 1;
  const e: EdgeRows = { gx: new Float64Array(n), gy: new Float64Array(n), gz: new Float64Array(n), hx: new Float64Array(n), hy: new Float64Array(n), hz: new Float64Array(n) };
  const { gx, gy, gz, hx, hy, hz } = e;

  function add(key: string, c0: number, c1: number, base: number, ax: number, az: number, bx: number, bz: number): void {
    const cw = (c1 - c0) / COLS;
    const texs: TexLike[] = [];
    for (let i = 0; i < COLS; i++) {
      const tex = subTexture(caps, key, c0 + i * cw, 0, cw, base);
      if (!tex) { for (const t of texs) t.destroy(false); return; }
      texs.push(tex);
    }
    const box = new C.Container();
    box.label = 'qpm3d-fence';
    box.visible = false;
    box.eventMode = 'none';
    const cols: Node3[] = [];
    for (const tex of texs) {
      const sp = new C.Sprite(tex);
      sp.anchor?.set(0, 1);
      box.addChild(sp);
      cols.push(sp);
    }
    skip.add(box);
    walls.push({ box, cols, ax, az, bx, bz, w: c1 - c0, h: base, mx: (ax + bx) / 2, mz: (az + bz) / 2 });
  }

  // Plot layout from the tilemap: top edge T H..H T', sides V, bottom R H..H R' (' = mirrored). The panel art (H)
  // ends at its base row; N-S runs and corner stubs reuse it on the post-column centre line (tile x + 128).
  // Detached while 2D, like the decor cards (the game's World zIndex sort).
  function attach(on: boolean): void {
    if (attached === on) return;
    attached = on;
    for (const w of walls) { if (on) s.world.addChild(w.box); else s.world.removeChild(w.box); }
  }

  function build(): void {
    attach(false);
    for (const w of walls) w.box.destroy({ children: true });
    walls = [];
    const scan = getScan();
    builtFor = scan;
    const pb = scan.pb;
    const base = artBaseRow(caps, FENCE_KEYS.H, TILE, TILE);
    for (const [o, kind] of scan.fence) {
      const x = pb[o + 2]!, y = pb[o + 3]!, cx = x + 128, zb = y + base, mirrored = pb[o + 6] === 12;
      const key = FENCE_KEYS[kind];
      const ew = (c0: number, c1: number): void => {
        if (mirrored) add(key, c0, c1, base, x + TILE - c0, zb, x + TILE - c1, zb);
        else add(key, c0, c1, base, x + c0, zb, x + c1, zb);
      };
      if (kind === 'H') ew(0, TILE);
      else if (kind === 'V') add(FENCE_KEYS.H, 0, TILE, base, cx, y, cx, y + TILE);
      else if (kind === 'T') { ew(128, TILE); add(FENCE_KEYS.H, 0, TILE - base, base, cx, zb, cx, y + TILE); }
      else { ew(0, TILE); add(FENCE_KEYS.H, 0, base, base, cx, y, cx, zb); }
    }
  }

  return {
    name: 'fences',
    pre(ctx: FrameCtx) {
      if (builtFor !== getScan()) build();
      attach(true);
      const pd = (ctx.params.pitch * 180) / Math.PI;
      const t = Math.min(1, Math.max(0, (75 - pd) / 20));
      const flip = (t > 0) !== wallsOn;
      wallsOn = t > 0;
      onWalls(t);
      const b = ctx.basis, o = ctx.out;
      const edge = (w: Wall, i: number): void => {
        const f = i / COLS;
        project(b, w.ax + (w.bx - w.ax) * f, 0, w.az + (w.bz - w.az) * f, o);
        gx[i] = o[0]!; gy[i] = o[1]!; gz[i] = o[2]!;
      };
      for (let wi = 0; wi < walls.length; wi++) {
        const w = walls[wi]!;
        const check = flip || recheck(ctx, wi);
        if (!check && !w.box.visible) continue;
        // The wall's ends are its outer column edges: the cull test reuses them.
        edge(w, 0); edge(w, COLS);
        const x0 = gx[0]!, y0 = gy[0]!, z0 = gz[0]!, x1 = gx[COLS]!, y1 = gy[COLS]!, z1 = gz[COLS]!;
        const vis = t > 0 && Math.max(z0, z1) >= ctx.params.near && Math.min(z0, z1) <= ctx.params.far
          && !(Math.max(x0, x1) < -ctx.marginX || Math.min(x0, x1) > ctx.W + ctx.marginX || Math.max(y0, y1) < -200 || Math.min(y0, y1) > ctx.H + 1600);
        if (check && w.box.visible !== vis) w.box.visible = vis;
        if (!w.box.visible) continue;
        for (let i = 1; i < COLS; i++) edge(w, i);
        for (let i = 0; i <= COLS; i++) {
          const f = i / COLS;
          project(b, w.ax + (w.bx - w.ax) * f, w.h, w.az + (w.bz - w.az) * f, o);
          hx[i] = o[0]!; hy[i] = o[1]!; hz[i] = o[2]!;
        }
        const cw = w.w / COLS;
        for (let i = 0; i < COLS; i++) {
          const sp = w.cols[i]!;
          const ca = columnAlpha(e, i, ctx.params.near, ctx.W, ctx.H);
          if (ca <= 0) { sp.scale.set(0, 0); continue; }
          const px0 = gx[i]!, py0 = gy[i]!;
          M.set((gx[i + 1]! - px0) / cw, (gy[i + 1]! - py0) / cw, -(hx[i]! - px0) / w.h, -(hy[i]! - py0) / w.h, px0, py0);
          sp.setFromMatrix(M);
          if (sp.alpha !== ca) sp.alpha = ca;
        }
        const key = depthKey(w.mx, w.mz, ctx.dx, ctx.dz, 0);
        if (w.box.zIndex !== key) w.box.zIndex = key;
        const a = t * fader.factor(ctx, w.box, key, w.mx, w.mz);
        if (w.box.alpha !== a) w.box.alpha = a;
      }
    },
    drop() { for (const w of walls) if (w.box.visible) w.box.visible = false; wallsOn = false; attach(false); },
    destroy() { attach(false); for (const w of walls) w.box.destroy({ children: true }); walls = []; builtFor = null; },
    stats: () => ({ walls: walls.length }),
  };
}
