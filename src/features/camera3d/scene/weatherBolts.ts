import { project } from '../math/camera';
import { depthKey } from '../math/depth';
import type { FrameCtx } from '../frame/frame';
import type { Caps, Node3, TexLike } from '../types';
import { fadeTarget } from './fades';
import { baseRowOf } from './tileArt';
import { bucketCells, claimSlots, nextPhases, phaseOf, stormCells, strikeFrame, type CellHash, type StormCell } from './weatherCells';
import { gpuPhases } from './weatherPhases';

// Striking plus reserved slots. One phase bucket (1 in 50 cells, ~4 within the radius) strikes at a time (live 10-03),
// so one World rebuild pre-keys the next ~7 strikes.
const POOL = 32;
// Buckets are rebuilt per rolling-cull pass start (every ≥ 2 tiles of target motion): keep slack beyond the radius.
const MARGIN = 1024;

export interface BoltSource { game: Node3; uniforms: Record<string, unknown>; key: string; hash: CellHash; vs: string }
export interface WeatherBolts {
  update(ctx: FrameCtx, src: BoltSource | null, alpha: number, radius: number): void;
  drop(): void;
  destroy(): void;
  stats(): Record<string, number | string>;
}

const num = (u: Record<string, unknown>, k: string): number => { const v = u[k]; return typeof v === 'number' ? v : 0; };
const vec = (u: Record<string, unknown>, k: string, i: number): number => { const v = u[k]; return v instanceof Float32Array ? v[i] ?? 0 : 0; };
function aCellOf(geometry: unknown): Float32Array | null {
  const a = (geometry as { attributes?: { aCell?: { buffer?: { data?: unknown } } } } | null)?.attributes?.aCell?.buffer?.data;
  return a instanceof Float32Array ? a : null;
}
function inView(ctx: FrameCtx, c: StormCell, radius: number): boolean {
  const b = ctx.basis;
  if (Math.hypot(c.gx - b.C[0], c.gy - b.C[2]) > radius) return false;
  project(b, c.gx, 0, c.gy, ctx.out);
  const cz = ctx.out[2]!;
  return cz >= ctx.params.near && cz <= ctx.params.far;
}

/** Spec §6.8.1 storm bolts: the game's strike frames on pooled World sprites, depth-keyed so buildings hide them. */
export function createWeatherBolts(caps: Caps, skip: WeakSet<Node3>): WeatherBolts {
  const { scene: s, classes: C } = caps;
  const pool: Node3[] = [];
  const owners: Array<StormCell | null> = [];
  const strikes: StormCell[] = [], strikeTex: TexLike[] = [], slotOf: number[] = [];
  const drawn = new Uint8Array(POOL);
  // This frame's schedule, read by `upcoming` only when claimSlots refills (no per-frame closure).
  let fCtx: FrameCtx | null = null, fCyc = 0, fP = 0, fSlots = 0, fN = 0, fRadius = 0, keyDx = NaN, keyDz = NaN;
  const upcoming = (): StormCell[][] => {
    const ctx = fCtx;
    if (!ctx) return [];
    const groups: StormCell[][] = [];
    for (const p of nextPhases(fCyc, fP, fSlots, fN, POOL)) {
      const g = (buckets[p] ?? []).filter((c) => inView(ctx, c, fRadius));
      if (g.length) groups.push(g);
    }
    return groups;
  };
  let frames: TexLike[] = [];
  let cells: StormCell[] = [];
  let buckets: StormCell[][] = [];
  let builtTex: TexLike | null = null, builtGeo: unknown = null, builtKey = '', builtRadius = 0;
  let attached = false, shown = 0, dropped = 0, phaseMs = 0;
  let phaseSource = '-';

  const park = (sp: Node3): void => { if (sp.alpha !== 0) { sp.alpha = 0; sp.scale.set(0, 0); } };

  // Attached for the whole storm while 3D is live. A visibility flip on a World child rebuilds World's instruction set
  // (spike Task 4: build frames ~11 ms render vs ~6 ms), so idle sprites are parked at alpha 0 / scale 0 instead.
  function attach(on: boolean): void {
    if (attached === on) return;
    attached = on;
    owners.fill(null);
    for (const sp of pool) { if (on) s.world.addChild(sp); else { park(sp); s.world.removeChild(sp); } }
  }

  function build(src: BoltSource, tex: TexLike, aCell: Float32Array): void {
    for (const f of frames) f.destroy(false);
    const fw = vec(src.uniforms, 'uFrameSizePx', 0), fh = vec(src.uniforms, 'uFrameSizePx', 1);
    const n = num(src.uniforms, 'uFrameCount');
    frames = [];
    for (let i = 0; i < n - 1; i++) frames.push(new C.Texture({ source: tex.source, frame: new C.Rectangle(tex.frame.x + i * fw, tex.frame.y, fw, fh) }));
    // A strike lands on the strip's lowest opaque row (live 10-03: 1278 of 1413), measured once at 1/4 scale.
    const strip = new C.Texture({ source: tex.source, frame: new C.Rectangle(tex.frame.x, tex.frame.y, fw * n, fh) });
    const foot = baseRowOf(caps, `${src.key}:${fw * n}x${fh}`, strip, fh, 0.25);
    strip.destroy(false);
    // Phases exactly as the game's GPU computes them (alignment principle); the CPU twin only where that fails.
    const P = num(src.uniforms, 'uPhaseCount');
    const t0 = performance.now();
    const map = gpuPhases(src.vs, aCell, P);
    phaseMs = performance.now() - t0;
    phaseSource = map ? 'gpu' : 'cpu';
    cells = stormCells(aCell, fw, fh, foot, (cx, cy) => {
      const g = map ? map.phases[cy * map.cols + cx] : undefined;
      return g !== undefined && g !== 255 ? g : phaseOf(src.hash, cx, cy, P);
    });
    if (pool.length === 0) {
      for (let i = 0; i < POOL; i++) {
        const sp = new C.Sprite(C.Texture.EMPTY);
        sp.label = 'qpm3d-bolt';
        sp.eventMode = 'none';
        sp.alpha = 0;
        sp.scale.set(0, 0);
        skip.add(sp);
        pool.push(sp);
        owners.push(null);
      }
    }
    owners.fill(null);
    // Idle sprites hold a strike frame: a strike starting on one then keeps its texture source (no batch rebuild).
    for (const sp of pool) {
      sp.anchor?.set(0.5, fh > 0 ? foot / fh : 1);
      if (frames[0]) sp.texture = frames[0];
    }
    builtTex = tex; builtGeo = src.game.geometry; builtKey = src.key;
    buckets = []; builtRadius = 0;
  }

  return {
    update(ctx, src, alpha, radius) {
      shown = 0;
      const tex = src?.game.texture ?? null;
      const aCell = src ? aCellOf(src.game.geometry) : null;
      if (!src || !tex || !aCell) { attach(false); return; }
      if (tex !== builtTex || src.game.geometry !== builtGeo || src.key !== builtKey) build(src, tex, aCell);
      attach(true);
      if (alpha <= 0 || frames.length === 0) { owners.fill(null); for (const sp of pool) park(sp); return; }
      const P = num(src.uniforms, 'uPhaseCount');
      const b = ctx.basis, out = ctx.out;
      // reCull no longer fires on target motion (Task 17 part 2f): a rolling pass starts (roll 0) every ≥ 2 tiles.
      if (ctx.reCull || ctx.roll === 0 || radius !== builtRadius || buckets.length !== P) { buckets = bucketCells(cells, b.C[0], b.C[2], radius + MARGIN, P); builtRadius = radius; }
      const cyc = num(src.uniforms, 'uCycleFrame'), slots = num(src.uniforms, 'uCycleSlots'), n = num(src.uniforms, 'uFrameCount');
      const opacity = num(src.uniforms, 'uOpacity');
      let count = 0;
      for (let p = 0; p < buckets.length; p++) {
        const f = strikeFrame(cyc, p, P, slots, n);
        const t = f >= 0 ? frames[f] : undefined;
        if (!t) continue;
        for (const c of buckets[p]!) {
          if (!inView(ctx, c, radius)) continue;
          strikes[count] = c;
          strikeTex[count] = t;
          count++;
        }
      }
      strikes.length = count;
      strikeTex.length = count;
      fCtx = ctx; fCyc = cyc; fP = P; fSlots = slots; fN = n; fRadius = radius;
      const rekey = ctx.dx !== keyDx || ctx.dz !== keyDz;
      keyDx = ctx.dx; keyDz = ctx.dz;
      const lost = claimSlots(owners, strikes, slotOf, upcoming, rekey);
      fCtx = null;
      dropped += lost;
      drawn.fill(0);
      for (let k = 0; k < count; k++) {
        const i = slotOf[k]!, sp = pool[i];
        if (!sp) continue;
        drawn[i] = 1;
        const c = strikes[k]!, t = strikeTex[k]!;
        project(b, c.gx, 0, c.gy, out);
        if (sp.texture !== t) sp.texture = t;
        const mm = b.fpx / out[2]!;
        sp.position.set(out[0]!, out[1]!);
        sp.scale.set(mm, mm);
        sp.alpha = alpha * opacity * fadeTarget(null, depthKey(c.gx, c.gy, ctx.dx, ctx.dz, 0), null, null, Math.hypot(c.gx - b.C[0], c.gy - b.C[2]));
      }
      // Reserved slots take their key now, on a frame World rebuilds anyway; idle keys never change otherwise.
      for (let i = 0; i < pool.length; i++) {
        const o = owners[i], sp = pool[i]!;
        if (o) { const key = depthKey(o.gx, o.gy, ctx.dx, ctx.dz, 0); if (sp.zIndex !== key) sp.zIndex = key; }
        if (!drawn[i]) park(sp);
      }
      shown = count - lost;
    },
    drop() { attach(false); buckets = []; },
    destroy() {
      attach(false);
      for (const sp of pool) sp.destroy();
      pool.length = 0;
      owners.length = 0;
      strikes.length = 0; strikeTex.length = 0;
      keyDx = NaN; keyDz = NaN;
      for (const f of frames) f.destroy(false);
      frames = []; cells = []; buckets = [];
      builtTex = null; builtGeo = null; builtKey = ''; builtRadius = 0;
    },
    stats: () => ({ bolts: shown, boltsDropped: dropped, boltCells: cells.length, phaseSource, phaseMs: +phaseMs.toFixed(1) }),
  };
}
