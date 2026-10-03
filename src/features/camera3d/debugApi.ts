import { readSync } from '../../core/gameState';
import { getEngineSystem } from '../../utils/quinoaEngine';
import { gpu, simulateWeather, wait, weatherTune } from './debugWeather';
import { getCamera3dPasses, getCamera3dPicker, getCamera3dRuntime, getCamera3dStatus, getZoomBridge, setCamera3dSetting, startCamera3d, stopCamera3d } from './index';
import type { XY } from './math/camera';
import { FAR_PLANE, NEAR_PLANE, viewForS, type CameraView } from './math/zoomCurve';
import type { ViewSource, ViewSourceInput } from './runtime';
import type { ViewmodelTune } from './scene/viewmodel';

const D2R = Math.PI / 180;
interface ManualView { yaw: number; pitch: number; dist: number; fov: number; lookH: number; yOff: number; target: XY | null; hideSelf: boolean; s: number | null }
const manual: ManualView = { yaw: 0, pitch: 28, dist: 1600, fov: 55, lookH: 120, yOff: 0.12, target: null, hideSelf: false, s: null };

const manualSource: ViewSource = (i: ViewSourceInput): CameraView => {
  if (manual.s !== null) {
    return viewForS({ s: manual.s, W: i.W, H: i.H, k: i.k, viewCentre: i.viewCentre, ground: i.ground, userYawDeg: manual.yaw, userPitchDeg: 0 });
  }
  const t = manual.target ?? i.ground ?? i.viewCentre;
  return {
    params: { yaw: manual.yaw * D2R, pitch: manual.pitch * D2R, dist: manual.dist, fov: manual.fov * D2R, lookH: manual.lookH, yOff: manual.yOff, near: NEAR_PLANE, far: FAR_PLANE },
    target: { x: t.x, y: t.y },
    hideSelf: manual.hideSelf,
  };
};

function renderGrab(scale = 0.5): HTMLCanvasElement | null {
  const r = getCamera3dRuntime();
  if (!r) return null;
  const { renderer, stage } = r.caps.scene;
  renderer.render({ container: stage });
  const src = renderer.canvas;
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * scale);
  c.height = Math.round(src.height * scale);
  c.getContext('2d')?.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function diff(a: HTMLCanvasElement, b: HTMLCanvasElement, tol = 24): { overPct: number; meanDelta: number } {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const A = a.getContext('2d')?.getImageData(0, 0, w, h).data, B = b.getContext('2d')?.getImageData(0, 0, w, h).data;
  if (!A || !B) return { overPct: 100, meanDelta: 255 };
  let over = 0, sum = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d = Math.max(Math.abs(A[i]! - B[i]!), Math.abs(A[i + 1]! - B[i + 1]!), Math.abs(A[i + 2]! - B[i + 2]!));
    sum += d;
    if (d > tol) over++;
  }
  const n = A.length / 4;
  return { overPct: +((100 * over) / n).toFixed(2), meanDelta: +(sum / n).toFixed(2) };
}

/** Per-frame time of the game systems that cull on the frame viewport (spec §9.1), over `ms` of stage renders. */
async function cost(ms = 3000): Promise<{ live: boolean; frames: number; sysMsPerFrame: Record<string, number>; sysTotal: number }> {
  const r = getCamera3dRuntime();
  let engine: unknown = null;
  try { engine = readSync('quinoaEngine'); } catch { engine = null; }
  const acc: Record<string, number> = {};
  const undo: Array<() => void> = [];
  // literal-list-justified: debug-only probe; the engine system names that cull on the frame viewport (spec §9.1)
  for (const name of ['pet', 'avatar', 'tileObject', 'building', 'npcVisit']) {
    const sys = getEngineSystem(engine, name) as Record<string, unknown> | null;
    if (!sys) continue;
    acc[name] = 0;
    for (const fn of ['preDraw', 'draw'] as const) {
      const orig = sys[fn];
      if (typeof orig !== 'function') continue;
      const own = Object.prototype.hasOwnProperty.call(sys, fn);
      sys[fn] = function (this: unknown, ...a: unknown[]): unknown {
        const t0 = performance.now();
        try { return (orig as (...x: unknown[]) => unknown).apply(this, a); } finally { acc[name] = (acc[name] ?? 0) + performance.now() - t0; }
      };
      undo.push(() => { if (own) sys[fn] = orig; else delete sys[fn]; });
    }
  }
  let frames = 0;
  const off = r ? r.onStageRender(() => { frames++; }) : null;
  try { await wait(ms); } finally { off?.(); for (const u of undo) u(); }
  const per: Record<string, number> = {};
  for (const [name, total] of Object.entries(acc)) per[name] = +(total / Math.max(1, frames)).toFixed(3);
  return { live: r?.isLive() ?? false, frames, sysMsPerFrame: per, sysTotal: +Object.values(per).reduce((a, b) => a + b, 0).toFixed(3) };
}

interface SweepOpts { from?: number; deg?: number; rate?: number; pitch?: number; dist?: number; settleMs?: number }

/** Controlled yaw sweep on the manual camera (same start, range and rate for every config). Leaves 3D live; exit() after. */
async function sweep(o: SweepOpts = {}): Promise<Record<string, number> | string> {
  const r = getCamera3dRuntime();
  if (!r) return 'no runtime';
  const { from = 0, deg = 180, rate = 30, pitch = 28, dist = 1600, settleMs = 600 } = o;
  Object.assign(manual, { yaw: from, pitch, dist, s: null });
  if (!r.enter(manualSource)) return `blocked: ${r.blockedReason() ?? 'disabled'}`;
  await wait(settleMs);
  const is = (r.caps.scene.world.renderGroup as unknown as { instructionSet?: { _mcBuildTick?: number } } | null | undefined)?.instructionSet;
  const dur = (deg / rate) * 1000;
  const gaps: number[] = [], js: number[] = [], render: number[] = [];
  let t0 = 0, last = 0, builds = 0;
  let tick: number | undefined;
  let done: () => void = () => undefined;
  const finished = new Promise<void>((res) => { done = res; });
  const offStage = r.onStageRender(() => { tick = is?._mcBuildTick; });
  const offFrame = r.onFrame((f) => {
    const now = performance.now();
    if (!t0) t0 = now; else gaps.push(now - last);
    last = now;
    js.push(f.jsMs);
    render.push(f.renderMs);
    if (is && is._mcBuildTick !== tick) builds++;
    const t = Math.min(1, (now - t0) / dur);
    manual.yaw = from + deg * t;
    if (t >= 1) done();
  });
  const offExit = r.onExit(() => done());
  try { await finished; } finally { offStage(); offFrame(); offExit(); }
  const p95 = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length * 0.95)]!.toFixed(2) : 0; };
  const avg = (a: number[]): number => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : 0);
  return {
    frames: js.length, buildFrames: builds, buildPct: js.length ? +((100 * builds) / js.length).toFixed(1) : 0,
    jsAvg: avg(js), jsP95: p95(js), renderAvg: avg(render), renderP95: p95(render), gapAvg: avg(gaps), gapP95: p95(gaps),
  };
}

interface RecRow { t: number; js: number; render: number; ax: number; ay: number }
const rec: { on: boolean; rows: RecRow[]; off: (() => void) | null } = { on: false, rows: [], off: null };

export function getCamera3dDebugApi() {
  return {
    state: () => ({ status: getCamera3dStatus(), blocked: getCamera3dRuntime()?.blockedReason() ?? null, ground: getCamera3dRuntime()?.ground() ?? null, manual: { ...manual } }),
    enter: (o: Partial<ManualView> = {}): boolean => { Object.assign(manual, o); return getCamera3dRuntime()?.enter(manualSource) ?? false; },
    set: (o: Partial<ManualView>): ManualView => { Object.assign(manual, o); return { ...manual }; },
    exit: (): void => { getCamera3dRuntime()?.exit('debug'); },
    renderGrab,
    diff,
    /** Run from 2D: same-task 2D frame vs the s = 0 3D frame. */
    handoffDiff(scale = 0.5) {
      const r = getCamera3dRuntime();
      if (!r) return 'no runtime';
      if (r.isLive()) return 'exit 3D first';
      const a = renderGrab(scale);
      const saved = { ...manual };
      manual.s = 0;
      r.enter(manualSource);
      const b = renderGrab(scale);
      r.exit('debug-handoff');
      Object.assign(manual, saved);
      return a && b ? { ...diff(a, b), a, b } : 'grab failed';
    },
    profile: () => getCamera3dRuntime()?.stats() ?? null,
    passStats: () => getCamera3dRuntime()?.frame.passStats() ?? null,
    memoryMB: () => getCamera3dPasses()?.floor.memoryMB() ?? 0,
    cost,
    sweep,
    pick: (x: number, y: number) => getCamera3dPicker()?.pick(x, y, true) ?? 'no picker',
    pickStats: () => getCamera3dPicker()?.stats() ?? null,
    zoom: () => getZoomBridge()?.state() ?? null,
    /** Tuning only: the next detail-setting change re-applies the preset. */
    fog(start?: number, end?: number): { start: number; end: number } | null {
      const f = getCamera3dPasses()?.fog;
      if (!f) return null;
      if (start !== undefined && end !== undefined) { f.start = start; f.end = end; }
      return { start: f.start, end: f.end };
    },
    /** Tuning only (D17 placement A/B, gates G8/G9): lasts until the page reloads. */
    viewmodel(t?: Partial<ViewmodelTune>): ViewmodelTune | null {
      const v = getCamera3dPasses()?.viewmodel;
      if (!v) return null;
      if (t) Object.assign(v, t);
      return { ...v, hand: { ...v.hand }, carry: { ...v.carry } };
    },
    weather: weatherTune,
    gpu,
    simulateWeather,
    setting: setCamera3dSetting,
    /** Lifecycle check (plan Task 17 row 18): full uninstall, then a fresh install. */
    stop: stopCamera3d,
    start: startCamera3d,
    rec: {
      start(): string {
        const r = getCamera3dRuntime();
        if (!r) return 'no runtime';
        rec.rows = [];
        rec.on = true;
        rec.off?.();
        rec.off = r.onFrame((f) => {
          const a = r.avatar();
          rec.rows.push({ t: performance.now(), js: f.jsMs, render: f.renderMs, ax: a ? Math.round(a.x) : 0, ay: a ? Math.round(a.y) : 0 });
          if (rec.rows.length > 20000) rec.rows.shift();
        });
        return 'recording';
      },
      stop(): number { rec.off?.(); rec.off = null; rec.on = false; return rec.rows.length; },
      summary() {
        const R = rec.rows;
        let lastMove = -1e9;
        const moving = R.map((row, i) => { if (i > 0 && (row.ax !== R[i - 1]!.ax || row.ay !== R[i - 1]!.ay)) lastMove = row.t; return row.t - lastMove < 500; });
        const agg = (sel: (i: number) => boolean) => {
          const rows = R.filter((_, i) => sel(i));
          if (!rows.length) return { frames: 0 };
          const js = rows.map((r) => r.js).sort((a, b) => a - b), rd = rows.map((r) => r.render).sort((a, b) => a - b);
          const gaps: number[] = [];
          for (let i = 1; i < R.length; i++) if (sel(i) && sel(i - 1)) gaps.push(R[i]!.t - R[i - 1]!.t);
          gaps.sort((a, b) => a - b);
          const p95 = (a: number[]) => (a.length ? +a[Math.floor(a.length * 0.95)]!.toFixed(2) : 0);
          const avg = (a: number[]) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
          return { frames: rows.length, jsAvg: avg(js), jsP95: p95(js), renderAvg: avg(rd), renderP95: p95(rd), gapP95: p95(gaps) };
        };
        return { rows: R.length, walking: agg((i) => moving[i]!), idle: agg((i) => !moving[i]) };
      },
    },
  };
}
