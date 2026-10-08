import { summarize } from '../../diagnostics/perfMonitor';
import { delay } from '../../utils/scheduling/scheduling';
import { TILE } from './constants';
import type { ManualView, SweepOpts } from './debugApi';
import { appearCount, appearEntered, installAppearProbe } from './debugAppear';
import type { XY } from './math/camera';
import type { Runtime } from './runtime';
import type { Node3, ZoomLike } from './types';

export interface Stat { avg: number; p95: number; max: number }
/** Per frame, every frame that rendered during the window (audit A §1 columns). */
export interface PerfResult {
  /** '3d' when every measured frame was a 3D frame. */
  mode: '2d' | '3d' | 'mixed';
  frames: number;
  /** The whole game frame (ticker update), the pop-in probe's own time taken out. */
  tick: Stat;
  /** PIXI's RenderGroupSystem.render, outermost (Rive drawing included). */
  render: Stat;
  /** Outermost calls: the transform walk, the vertex repack, World instruction rebuilds (count and ms). */
  updMs: number; renderablesMs: number; builds: number; buildMs: number;
  draws: number;
  /** Timer-query ms, every render and mip generation in the frame summed (floor bakes included); null without the
   * extension. bake: frames that generated mips (a floor bake finished), quiet: the rest. */
  gpu: (Stat & { frames: number; skipped: number; bake: Stat & { frames: number }; quiet: Stat & { frames: number } }) | null;
  /** gl.generateMipmap calls on the game context per frame. */
  mips: number;
  /** camera3d passes + restore + sync2d per 3D frame (A §1 "QPM"), and each part. */
  qpm: number; passes: Record<string, number>; passP95: Record<string, number>; reCulls: number; rollFrames: number;
  /** Slices the travel cap re-checked during the window (frame.ts CullRoll); the widest show-ahead band (cull.ts). */
  capped: number; bandPeakDeg: number;
  /** World roots PIXI draws and their subtree nodes, after the window. */
  shownRoots: number; shownNodes: number;
  /** The last 3D frame's billboards, and how many sit off screen (audit PA4 rule, offScreenRoot). */
  drawnRoots: number; offscreenRoots: number;
  /** QPM pop-ins during the window (firstAppear() has the detail); entered: appearances whose point only came onto the
   * screen that frame (not pop-ins). */
  popIns: number; entered: number;
  /** Wraps another script replaced during the call (left as pass-throughs); frames past the row buffer. */
  displaced: string[]; dropped: number;
}

const r3 = (v: number): number => +v.toFixed(3);

export function statOf(v: ArrayLike<number>, n: number): Stat {
  if (n <= 0) return { avg: 0, p95: 0, max: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += v[i] ?? 0;
  const s = summarize(v, n);
  return { avg: r3(sum / n), p95: r3(s.p95), max: r3(s.max) };
}

/** The audit's PA4 rule: a billboard is off screen when its point is more than one tile beside the screen, three
 * above or two below (tile = its on-screen tile size). */
export function offScreenRoot(px: number, py: number, mm: number, W: number, H: number): boolean {
  const t = mm * TILE;
  return px < -t || px > W + t || py < -3 * t || py > H + 2 * t;
}

export const WALK_PX_PER_S = 10 * TILE;
/** The A §7 walk, px from its start: out at 10 tiles/s for 2 s, back for 2 s, repeating. */
export function walkOffset(tSec: number): number {
  const p = tSec % 4;
  return WALK_PX_PER_S * (p < 2 ? p : 4 - p);
}

type Fn = (this: unknown, ...a: unknown[]) => unknown;
interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
const DRAWS = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const;
// Timer queries in flight (results land a few frames later); a full pool skips timing that render.
const POOL = 64;
const MAX_FPS = 250;
let running = false;

function protoOwning(obj: unknown, key: string): object | null {
  let p = obj !== null && typeof obj === 'object' ? (Object.getPrototypeOf(obj) as object | null) : null;
  for (; p; p = Object.getPrototypeOf(p) as object | null) if (Object.prototype.hasOwnProperty.call(p, key)) return p;
  return null;
}

/** Wraps the own function host[key] for one call; the undo assigns the original back (never a delete: V8 would
 * normalise the host, memory v8-delete-normalises-game-nodes). When another script wrapped on top since, ours stays
 * as a pass-through (its wrapper checks the call's `on`) and undo returns false. */
function wrap(host: object, key: string, make: (orig: Fn) => Fn): (() => boolean) | null {
  const h = host as Record<string, unknown>;
  const orig = h[key];
  if (typeof orig !== 'function' || !Object.prototype.hasOwnProperty.call(h, key)) return null;
  const w = make(orig as Fn);
  h[key] = w;
  return () => {
    if (h[key] !== w) return false;
    h[key] = orig;
    return true;
  };
}

function shownCounts(rt: Runtime): { roots: number; nodes: number } {
  const stack: Node3[] = [];
  let roots = 0, nodes = 0;
  for (const ch of rt.caps.scene.world.children) {
    if (!rt.ov.raw<boolean>('visible', ch)) continue;
    roots++;
    stack.push(ch);
    while (stack.length) {
      const n = stack.pop()!;
      nodes++;
      const kids = n.children as Node3[] | undefined;
      if (kids) for (const c of kids) stack.push(c);
    }
  }
  return { roots, nodes };
}

// FrameRunner.passStats() counters, not pass timings.
const NOT_PASSES = new Set(['frames', 'reCulls', 'rollFrames', 'capped', 'bandPeakDeg']);

async function measure(rt: Runtime, ms: number): Promise<PerfResult | string> {
  const { renderer, app } = rt.caps.scene;
  const ticker = app.ticker;
  const rgProto = protoOwning((renderer as unknown as { renderGroup?: unknown }).renderGroup, 'render');
  const tkProto = protoOwning(ticker, 'update');
  if (!rgProto || !tkProto) return 'no render group system or ticker';
  const gl = renderer.gl ?? null;
  const ext = gl ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as unknown as TimerExt | null) : null;
  const cap = Math.ceil((ms / 1000) * MAX_FPS) + 64;
  const col = {
    tick: new Float64Array(cap), render: new Float64Array(cap), upd: new Float64Array(cap), build: new Float64Array(cap),
    builds: new Float64Array(cap), rend: new Float64Array(cap), draws: new Float64Array(cap), live: new Uint8Array(cap),
    gpu: new Float64Array(cap), gpuQ: new Int32Array(cap), gpuR: new Int32Array(cap), mips: new Float64Array(cap),
  };
  const acc = { render: 0, upd: 0, build: 0, builds: 0, rend: 0, draws: 0, renders: 0, probe: 0, mips: 0 };
  const depth = { render: 0, upd: 0, build: 0, rend: 0 };
  let rows = 0, dropped = 0, on = true;
  const pool: Array<WebGLQuery | null> = new Array<WebGLQuery | null>(POOL).fill(null);
  const slotRow = new Int32Array(POOL);
  let head = 0, tail = 0, skipped = 0;

  const gpuBegin = (): boolean => {
    if (!gl || !ext || rows >= cap) return false;
    if (tail - head >= POOL || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) !== null) { skipped++; return false; }
    const slot = tail % POOL;
    const q = (pool[slot] ??= gl.createQuery());
    if (!q) return false;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    slotRow[slot] = rows;
    col.gpuQ[rows]!++;
    tail++;
    return true;
  };
  const collect = (): void => {
    if (!gl || !ext) return;
    let disjoint: boolean | null = null;
    while (head < tail) {
      const slot = head % POOL;
      const q = pool[slot]!;
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) !== true) break;
      disjoint ??= gl.getParameter(ext.GPU_DISJOINT_EXT) === true;
      const row = slotRow[slot]!;
      // A disjoint result is meaningless: the row's count can then never match and it is left out.
      if (disjoint) col.gpuR[row] = -1e9;
      else { col.gpu[row]! += Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6; col.gpuR[row]!++; }
      head++;
    }
  };

  // Outermost call only: these recurse into nested render groups.
  const timed = (k: 'upd' | 'build' | 'rend') => (orig: Fn): Fn => function (this: unknown, ...a: unknown[]): unknown {
    if (depth[k]++ > 0 || !on) { try { return orig.apply(this, a); } finally { depth[k]--; } }
    const t = performance.now();
    try { return orig.apply(this, a); } finally { depth[k]--; acc[k] += performance.now() - t; if (k === 'build') acc.builds++; }
  };
  const render = (orig: Fn): Fn => function (this: unknown, ...a: unknown[]): unknown {
    if (depth.render++ > 0 || !on) { try { return orig.apply(this, a); } finally { depth.render--; } }
    const timing = gpuBegin();
    const t = performance.now();
    try { return orig.apply(this, a); } finally {
      depth.render--;
      acc.render += performance.now() - t;
      acc.renders++;
      if (timing && gl && ext) gl.endQuery(ext.TIME_ELAPSED_EXT);
    }
  };
  const tick = (orig: Fn): Fn => function (this: unknown, ...a: unknown[]): unknown {
    if (this !== ticker || !on) return orig.apply(this, a);
    const t = performance.now();
    try { return orig.apply(this, a); } finally {
      const total = performance.now() - t - acc.probe;
      if (acc.renders > 0) {
        if (rows < cap) {
          col.tick[rows] = total; col.render[rows] = acc.render; col.upd[rows] = acc.upd; col.build[rows] = acc.build;
          col.builds[rows] = acc.builds; col.rend[rows] = acc.rend; col.draws[rows] = acc.draws; col.live[rows] = rt.isLive() ? 1 : 0;
          col.mips[rows] = acc.mips;
          rows++;
        } else dropped++;
        acc.render = 0; acc.upd = 0; acc.build = 0; acc.builds = 0; acc.rend = 0; acc.draws = 0; acc.renders = 0; acc.mips = 0;
      }
      acc.probe = 0;
      collect();
    }
  };
  // On a shared prototype other contexts (Rive's) call it too: count the game gl only.
  const draw = (orig: Fn): Fn => function (this: unknown, ...a: unknown[]): unknown { if (on && this === gl) acc.draws++; return orig.apply(this, a); };
  // Mip generation runs outside any render (TextureSource.updateMipmaps), so the render queries miss it.
  const mip = (orig: Fn): Fn => function (this: unknown, ...a: unknown[]): unknown {
    if (!on || this !== gl) return orig.apply(this, a);
    acc.mips++;
    const timing = gpuBegin();
    try { return orig.apply(this, a); } finally { if (timing && gl && ext) gl.endQuery(ext.TIME_ELAPSED_EXT); }
  };

  const undo: Array<[string, () => boolean]> = [];
  const displaced: string[] = [];
  const add = (name: string, u: (() => boolean) | null): void => { if (u) undo.push([name, u]); };
  const release = (): void => { if (gl) for (const q of pool) if (q) gl.deleteQuery(q); pool.fill(null); };
  let offProbe: (() => void) | null = null;
  let pop0 = 0, ent0 = 0, ok = false;
  try {
    add('render', wrap(rgProto, 'render', render));
    add('_updateRenderGroups', wrap(rgProto, '_updateRenderGroups', timed('upd')));
    add('_buildInstructions', wrap(rgProto, '_buildInstructions', timed('build')));
    add('_updateRenderables', wrap(rgProto, '_updateRenderables', timed('rend')));
    add('ticker.update', wrap(tkProto, 'update', tick));
    // Live 2026-10-06 (v1419): the game's gl owns arrow wrappers for all four; the prototype is the drift fallback.
    if (gl) for (const name of DRAWS) { const host = Object.prototype.hasOwnProperty.call(gl, name) ? gl : protoOwning(gl, name); if (host) add(name, wrap(host, name, draw)); }
    if (gl) { const host = Object.prototype.hasOwnProperty.call(gl, 'generateMipmap') ? gl : protoOwning(gl, 'generateMipmap'); if (host) add('generateMipmap', wrap(host, 'generateMipmap', mip)); }
    offProbe = installAppearProbe(rt, (m) => { acc.probe += m; });
    pop0 = appearCount(); ent0 = appearEntered();
    rt.frame.passStats();
    await delay(ms);
    ok = true;
  } finally {
    on = false;
    offProbe?.();
    for (let i = undo.length - 1; i >= 0; i--) if (!undo[i]![1]()) displaced.push(undo[i]![0]);
    if (!ok) release();
  }
  const popIns = appearCount() - pop0, entered = appearEntered() - ent0;
  let ps: ReturnType<Runtime['frame']['passStats']>;
  let shown: { roots: number; nodes: number };
  let drawnRoots = 0, offscreenRoots = 0;
  try {
    ps = rt.frame.passStats();
    shown = shownCounts(rt);
    const ctx = rt.frame.ctx();
    if (rt.isLive() && ctx) {
      const tab = rt.frame.published();
      drawnRoots = tab.len;
      for (let i = 0; i < tab.len; i++) { const e = tab.entries[i]!; if (offScreenRoot(e.px, e.py, e.mm, ctx.W, ctx.H)) offscreenRoots++; }
    }
    // Results of the last frames' queries arrive shortly after.
    await delay(250);
    collect();
  } finally {
    release();
  }

  const n = rows;
  const sum = (a: Float64Array): number => { let s = 0; for (let i = 0; i < n; i++) s += a[i]!; return s; };
  const per = (a: Float64Array): number => (n ? r3(sum(a) / n) : 0);
  const gpuMs = new Float64Array(n), bakeMs = new Float64Array(n), quietMs = new Float64Array(n);
  let gn = 0, bn = 0, qn = 0;
  for (let i = 0; i < n; i++) {
    if (!(col.gpuQ[i]! > 0 && col.gpuR[i] === col.gpuQ[i])) continue;
    gpuMs[gn++] = col.gpu[i]!;
    if (col.mips[i]! > 0) bakeMs[bn++] = col.gpu[i]!; else quietMs[qn++] = col.gpu[i]!;
  }
  let liveRows = 0;
  for (let i = 0; i < n; i++) liveRows += col.live[i]!;
  const msRec = ps.ms ?? {}, p95Rec = ps.p95 ?? {};
  const passes: Record<string, number> = {}, passP95: Record<string, number> = {};
  let qpm = 0;
  for (const [k, v] of Object.entries(msRec)) if (!NOT_PASSES.has(k) && typeof v === 'number') { passes[k] = v; qpm += v; }
  for (const [k, v] of Object.entries(p95Rec)) if (typeof v === 'number') passP95[k] = v;
  return {
    mode: liveRows === n ? (n ? '3d' : '2d') : liveRows === 0 ? '2d' : 'mixed',
    frames: n, tick: statOf(col.tick, n), render: statOf(col.render, n),
    updMs: per(col.upd), renderablesMs: per(col.rend), builds: per(col.builds), buildMs: per(col.build), draws: Math.round(per(col.draws)),
    gpu: ext ? { ...statOf(gpuMs, gn), frames: gn, skipped, bake: { ...statOf(bakeMs, bn), frames: bn }, quiet: { ...statOf(quietMs, qn), frames: qn } } : null,
    mips: per(col.mips),
    qpm: r3(qpm), passes, passP95, reCulls: Number(msRec.reCulls ?? 0), rollFrames: Number(msRec.rollFrames ?? 0), capped: Number(msRec.capped ?? 0),
    bandPeakDeg: Number(msRec.bandPeakDeg ?? 0),
    shownRoots: shown.roots, shownNodes: shown.nodes, drawnRoots, offscreenRoots, popIns, entered, displaced, dropped,
  };
}

/** Per-frame cost over `ms` (2D or 3D, whatever is on screen). Nothing stays installed after it resolves. */
export function perf(rt: Runtime, ms = 3000): Promise<PerfResult | string> {
  if (running) return Promise.resolve('busy');
  running = true;
  return measure(rt, ms).finally(() => { running = false; });
}

export interface BenchPose { s: number; yaw: number }
export interface BenchOpts {
  /** Still poses (default: the A §1 set). grid: the A §7 grid instead (s 0.2/0.5/0.85/1 × yaw 0/90/135/180). */
  poses?: BenchPose[]; grid?: boolean;
  twoD?: boolean; walk?: BenchPose | null; orbit?: boolean;
  ms?: number; walkMs?: number; settleMs?: number; intent?: number;
}
export type BenchRow = PerfResult & { sweep?: Record<string, number> | string };
export interface BenchCamera {
  enter(o: Partial<ManualView>): boolean;
  set(o: Partial<ManualView>): ManualView;
  exit(): void;
  sweep(o: SweepOpts): Promise<Record<string, number> | string>;
}
export interface BenchEnv {
  cam: BenchCamera;
  live(): boolean;
  ground(): XY | null;
  /** The game's persisted 2D zoom intent (memory: save and restore it exactly). */
  intent: { get(): number; set(v: number): void } | null;
  perf(ms: number): Promise<PerfResult | string>;
  /** Calls fn ahead of every stage render (before the 3D view is read) until the returned off() runs. */
  beforeFrame(fn: (now: number) => void): () => void;
  wait(ms: number): Promise<void>;
  now(): number;
}

// The A §1 poses (from max zoom): empty map side, first person both ways, looking across the map.
const A1_POSES: readonly BenchPose[] = [{ s: 0.85, yaw: 0 }, { s: 1, yaw: 0 }, { s: 1, yaw: 135 }, { s: 0.5, yaw: 135 }];
const WALK_POSE: BenchPose = { s: 0.85, yaw: 135 };
const ORBIT = { from: 90, deg: 90, rate: 30, pitch: 12, dist: 700, settleMs: 600 } as const;
const MAX_INTENT = 384;
const ZOOM_SETTLE_MS = 2500;

const grid = (): BenchPose[] => [0.2, 0.5, 0.85, 1].flatMap((s) => [0, 90, 135, 180].map((yaw) => ({ s, yaw })));

async function benchWalk(env: BenchEnv, p: BenchPose, ms: number, settleMs: number): Promise<BenchRow | string> {
  const g = env.ground();
  if (!g) return 'no avatar ground point';
  // One target object, moved in place: no allocation per measured frame.
  const at: XY = { x: g.x, y: g.y };
  if (!env.cam.enter({ s: p.s, yaw: p.yaw, lookPitch: 0, target: at })) return 'enter refused';
  try {
    await env.wait(settleMs);
    const t0 = env.now();
    const off = env.beforeFrame((now) => {
      const d = walkOffset((now - t0) / 1000) * Math.SQRT1_2;
      at.x = g.x + d; at.y = g.y + d;
    });
    try { return await env.perf(ms); } finally { off(); }
  } finally {
    env.cam.set({ target: null });
  }
}

// The sweep settles, then turns for deg / rate s; the window sits inside the turn.
async function benchOrbit(env: BenchEnv): Promise<BenchRow | string> {
  env.cam.exit();
  env.cam.set({ target: null, lookPitch: 0 });
  const sw = env.cam.sweep(ORBIT);
  await env.wait(ORBIT.settleMs + 150);
  if (!env.live()) return `orbit: ${JSON.stringify(await sw)}`;
  const row = await env.perf((ORBIT.deg / ORBIT.rate) * 1000 - 300);
  const sweep = await sw;
  return typeof row === 'string' ? row : { ...row, sweep };
}

/** Runs the pose set from 2D at max zoom. A pose that throws becomes an error row; the manual camera and the zoom
 * intent are put back whatever happens. */
export async function runBench(o: BenchOpts, env: BenchEnv): Promise<Record<string, BenchRow | string> | string> {
  if (env.live()) return 'exit 3D first';
  const zoom = env.intent;
  if (!zoom) return 'no zoom intent';
  const { ms = 3000, walkMs = 4000, settleMs = 1500, twoD = true, orbit = true } = o;
  const walk = o.walk === undefined ? WALK_POSE : o.walk;
  const poses = o.poses ?? (o.grid ? grid() : A1_POSES);
  const savedManual = env.cam.set({});
  const savedIntent = zoom.get();
  const rows: Record<string, BenchRow | string> = {};
  const run = async (key: string, f: () => Promise<BenchRow | string>): Promise<void> => {
    try { rows[key] = await f(); } catch (e) { rows[key] = `error: ${e instanceof Error ? e.message : String(e)}`; }
  };
  try {
    zoom.set(o.intent ?? MAX_INTENT);
    await env.wait(ZOOM_SETTLE_MS);
    if (twoD) await run('2d', () => env.perf(ms));
    for (const p of poses) {
      await run(`s${p.s} y${p.yaw}`, async () => {
        if (!env.cam.enter({ s: p.s, yaw: p.yaw, lookPitch: 0, target: null })) return 'enter refused';
        await env.wait(settleMs);
        return env.perf(ms);
      });
    }
    if (walk) await run(`walk s${walk.s} y${walk.yaw}`, () => benchWalk(env, walk, walkMs, settleMs));
    if (orbit) await run('orbit', () => benchOrbit(env));
  } finally {
    env.cam.exit();
    env.cam.set(savedManual);
    zoom.set(savedIntent);
  }
  return rows;
}

/** bench() on the live runtime: debugApi supplies the manual camera. */
export function bench(rt: Runtime, cam: BenchCamera, o: BenchOpts = {}): Promise<Record<string, BenchRow | string> | string> {
  if (running) return Promise.resolve('busy');
  running = true;
  const zoom = rt.caps.systems.zoomSys.zoom as ZoomLike & { setIntent?: unknown };
  const setIntent = zoom.setIntent;
  const env: BenchEnv = {
    cam,
    live: () => rt.isLive(),
    ground: () => rt.ground(),
    intent: typeof setIntent === 'function'
      ? { get: () => zoom.intentTileSize, set: (v) => { (setIntent as (this: unknown, v: number) => void).call(zoom, v); } }
      : null,
    perf: (ms) => measure(rt, ms),
    beforeFrame: (fn) => rt.onStageRender(() => fn(performance.now())),
    wait: delay,
    now: () => performance.now(),
  };
  return runBench(o, env).finally(() => { running = false; });
}
