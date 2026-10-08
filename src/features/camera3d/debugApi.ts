import { readSync } from '../../core/gameState';
import { getPixiRefs } from '../../core/pixiCapture';
import { getEngineSystem } from '../../utils/quinoaEngine';
import { findSceneParts, resolveSystems } from './capabilities';
import { firstAppear } from './debugAppear';
import { bench, perf, type BenchCamera, type BenchOpts } from './debugPerf';
import { gpu, simulateWeather, wait, weatherTune } from './debugWeather';
import type { FarAnim } from './engine/farAnim';
import {
  getCamera3dPasses, getCamera3dPicker, getCamera3dRuntime, getCamera3dSlowProbe, getCamera3dStatus, getCamera3dView, getZoomBridge,
  injectCamera3dInstallFault, retryCamera3d, setCamera3dSetting, startCamera3d, stopCamera3d,
} from './index';
import type { XY } from './math/camera';
import { checkDepthKeys } from './math/depth';
import { NEAR_PLANE, farPlaneFor, tiltOf, viewForS, type CameraView } from './math/zoomCurve';
import type { ViewSource, ViewSourceInput } from './runtime';
import {
  GRAPHICS_PRESET_NAMES, applyGraphicsPreset, getCamera3dHints, getCamera3dSettings, graphicsPresetOf, markCamera3dHint, resetCamera3dHints,
  type GraphicsPreset,
} from './settings';
import { checkTileLayout, scanTiles, skyStrip } from './scene/tileArt';
import type { FloorMode, FreshBake } from './scene/floor';
import type { ViewmodelTune } from './scene/viewmodel';
import type { RendererLike } from './types';

const D2R = Math.PI / 180;
/** With `s` set the curve drives the camera (yaw and lookPitch are the free-look offsets, target replaces the avatar's
 * ground point); null: the raw params. */
export interface ManualView { yaw: number; pitch: number; dist: number; fov: number; lookH: number; yOff: number; target: XY | null; hideSelf: boolean; s: number | null; lookPitch: number }
const manual: ManualView = { yaw: 0, pitch: 28, dist: 1600, fov: 55, lookH: 120, yOff: 0.12, target: null, hideSelf: false, s: null, lookPitch: 0 };

const manualSource: ViewSource = (i: ViewSourceInput): CameraView => {
  if (manual.s !== null) {
    return viewForS({
      s: manual.s, W: i.W, H: i.H, k: i.k, viewCentre: i.viewCentre, ground: manual.target ?? i.ground, groundH: manual.target ? 0 : i.ground?.h ?? 0,
      userYawDeg: manual.yaw, userPitchDeg: manual.lookPitch, fovDeg: getCamera3dSettings().fov, far: i.far,
    });
  }
  const t = manual.target ?? i.ground ?? i.viewCentre;
  return {
    params: { yaw: manual.yaw * D2R, pitch: manual.pitch * D2R, dist: manual.dist, fov: manual.fov * D2R, lookH: manual.lookH, yOff: manual.yOff, near: NEAR_PLANE, far: i.far },
    target: { x: t.x, y: t.y },
    // No s here: the raw camera keeps the pitch gate (spike and sweep recipes).
    tilt: tiltOf(manual.pitch),
    hideSelf: manual.hideSelf,
    selfAlpha: manual.hideSelf ? 0 : 1,
    hand: manual.hideSelf ? 1 : 0,
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

/** Texel parity of a level bake against a fresh full bake of the same window (perf Task 6): texels whose largest
 * channel differs at all, by more than 2, by more than 24, and the largest difference. */
function bakeParity(renderer: RendererLike, b: FreshBake): { texels: number; any: number; over2: number; over24: number; max: number } {
  const f = renderer.extract.pixels(b.fresh), l = renderer.extract.pixels(b.level);
  const w = Math.min(f.width, l.width), h = Math.min(f.height, l.height);
  let any = 0, over2 = 0, over24 = 0, max = 0;
  for (let j = 0; j < h; j++) {
    const lj = (b.oy + j) % l.height;
    for (let i = 0; i < w; i++) {
      const fo = (j * f.width + i) * 4, lo = (lj * l.width + ((b.ox + i) % l.width)) * 4;
      let d = 0;
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(f.pixels[fo + c]! - l.pixels[lo + c]!));
      if (d > 0) any++;
      if (d > 2) over2++;
      if (d > 24) over24++;
      if (d > max) max = d;
    }
  }
  return { texels: w * h, any, over2, over24, max };
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

export interface SweepOpts { from?: number; deg?: number; rate?: number; pitch?: number; dist?: number; settleMs?: number }

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

/** One-shot fault for the safety-net checks (polish Task 1): an install step name ('zoom', 'pass:weather', …) reinstalls
 * and throws there; 'stage' | 'view' | 'pre' | 'pick' | 'hover' throw once on the next such call (pre/pick/hover in 3D). */
function fault(kind: string): string {
  const r = getCamera3dRuntime();
  const boom = (): never => { throw new Error(`camera3d: injected ${kind} fault`); };
  const once = (host: Record<string, unknown>, key: string): string => {
    const orig = host[key];
    host[key] = (): never => { host[key] = orig; return boom(); };
    return `armed ${kind}`;
  };
  if (kind === 'stage') {
    if (!r) return 'no runtime';
    const off = r.onStageRender(() => { off(); boom(); });
    return 'armed stage';
  }
  if (kind === 'view') return r?.enter(boom) ? 'armed view' : 'enter refused';
  if (kind === 'pre') return r ? once(r.frame as unknown as Record<string, unknown>, 'pre') : 'no runtime';
  if (kind === 'pick' || kind === 'hover') {
    const p = getCamera3dPicker();
    return p ? once(p as unknown as Record<string, unknown>, kind) : 'no picker';
  }
  return injectCamera3dInstallFault(kind);
}

/** Every game-layout drift check (A V8) on the live scene, whether or not they kept 3D off (like cropSizeBoostDrift()). */
function drift(): Record<string, unknown> {
  const p = findSceneParts(getPixiRefs()?.stage);
  let engine: unknown = null;
  try { engine = readSync('quinoaEngine'); } catch { engine = null; }
  const sys = resolveSystems(engine);
  const map = Array.isArray(sys) ? null : sys.map;
  const scan = p.tileData ? scanTiles(p.tileData, null) : null;
  return {
    tileLayout: p.tileData ? checkTileLayout(p.tileData.pointsBuf) : 'no tilemap',
    depthKeys: p.world ? checkDepthKeys(p.world.children) : 'no World',
    skyBand: !scan ? 'no tilemap' : scan.len < 0 ? 'tile textures not loaded' : skyStrip(scan.pb, scan.sky, Infinity) ?? 'drift: no sky rects',
    map: map ? { cols: map.cols, rows: map.rows, far: Math.round(farPlaneFor(map.cols, map.rows)) } : 'no movement map',
    caps: getCamera3dStatus().caps,
    blocked: getCamera3dRuntime()?.blockedReason() ?? null,
  };
}

interface RecRow { t: number; js: number; render: number; ax: number; ay: number }
const rec: { on: boolean; rows: RecRow[]; off: (() => void) | null } = { on: false, rows: [], off: null };

const enterManual = (o: Partial<ManualView> = {}): boolean => { Object.assign(manual, o); return getCamera3dRuntime()?.enter(manualSource) ?? false; };
const setManual = (o: Partial<ManualView>): ManualView => { Object.assign(manual, o); return { ...manual }; };
const exitManual = (): void => { getCamera3dRuntime()?.exit('debug'); };
const benchCamera: BenchCamera = { enter: enterManual, set: setManual, exit: exitManual, sweep };

export function getCamera3dDebugApi() {
  return {
    state: () => ({ status: getCamera3dStatus(), view: getCamera3dView(), blocked: getCamera3dRuntime()?.blockedReason() ?? null, ground: getCamera3dRuntime()?.ground() ?? null, manual: { ...manual } }),
    enter: enterManual,
    set: setManual,
    exit: exitManual,
    /** Perf plan Task 0: per-frame cost of whatever is on screen over `ms` (A §1 columns). */
    perf: (ms?: number) => { const r = getCamera3dRuntime(); return r ? perf(r, ms) : Promise.resolve('no runtime'); },
    /** The A §1 pose set (or `grid`, A §7) from 2D at max zoom; puts the zoom intent and the manual camera back. */
    bench: (o?: BenchOpts) => { const r = getCamera3dRuntime(); return r ? bench(r, benchCamera, o) : Promise.resolve('no runtime'); },
    /** Pop-ins seen by perf()/bench() windows since the last read. */
    firstAppear,
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
    /** Perf Task 11: the slow probe's current run; `blocked` says why it isn't sampling. */
    slowProbe: () => getCamera3dSlowProbe()?.stats() ?? null,
    passStats: () => getCamera3dRuntime()?.frame.passStats() ?? null,
    /** Override totals since install: `writes` are QPM value writes (a zIndex write re-sorts World). */
    ovStats: () => getCamera3dRuntime()?.ov.stats() ?? null,
    /** The next 3D frame re-decides every item's visibility (stale-cull A/B against the live frame). */
    recull: (): void => { getCamera3dRuntime()?.frame.resetEpoch(); },
    /** Tuning only (polish Task 12 yaw-step A/B): the depth-key yaw step in degrees; lasts until reinstall. */
    sortStep(deg?: number): number | null {
      const f = getCamera3dRuntime()?.frame;
      if (!f) return null;
      if (deg !== undefined) f.setKeyStep(deg * D2R);
      return +(f.keyStep() / D2R).toFixed(3);
    },
    memoryMB: () => getCamera3dPasses()?.floor.memoryMB() ?? 0,
    /** Tuning only (A/B levers): rolling-pass trigger px, near-bake slack (polish Task 14); margin: the fixed side/top cull
     * margins past the ring (× W/H); capPx: the travel cap, 0: the old anchor re-cull; ringPx: the near ring re-decided
     * every moving frame, 0: off ({ margin: 0.75, capPx: 0, ringPx: 0 } is the cull of before perf Task 5); persist: tile
     * views keep 3D between frames (perf Task 3); still: the still-camera fast paths (perf Task 4); floor: how the near/far
     * bakes follow the camera (perf Task 6); ahead / aheadMaxDeg: the show-ahead band, 0 off (perf Task 7); farAnim: far
     * pets and players frozen ('off') or animating (perf Task 8; the next settings change sets it back); lasts until reinstall. */
    levers(o: { rollPx?: number; margin?: number; capPx?: number; ringPx?: number; ahead?: number; aheadMaxDeg?: number; nearSlack?: number; persist?: boolean; still?: boolean; floor?: FloorMode; farAnim?: FarAnim } = {}) {
      const f = getCamera3dRuntime()?.frame, passes = getCamera3dPasses();
      if (!f || !passes) return null;
      const { floor, farAnim } = passes;
      if (o.farAnim) farAnim.setMode(o.farAnim);
      return { ...f.cullTune(o), nearSlack: floor.nearSlack(o.nearSlack), persist: f.persistTune(o.persist), still: f.stillTune(o.still), floor: floor.bakeMode(o.floor), farAnim: farAnim.mode() };
    },
    /** Perf Task 6: a level bake against a fresh full bake of its own window, texel by texel (run in 3D). */
    floorParity(which: 'near' | 'far' = 'near') {
      const r = getCamera3dRuntime(), floor = getCamera3dPasses()?.floor;
      if (!r || !floor) return 'no runtime';
      const b = floor.freshBake(r.ov, which);
      if (!b) return 'no bake';
      try { return { wrap: b.wrap, ...bakeParity(r.caps.scene.renderer, b) }; } finally { b.fresh.destroy(true); }
    },
    cost,
    sweep,
    pick: (x: number, y: number) => getCamera3dPicker()?.pick(x, y) ?? 'no picker',
    /** The last drawn frame (polish Task 7 tap checks): entities whose label contains `match`, and every lifted unit. */
    drawn(match = '', max = 40) {
      const t = getCamera3dRuntime()?.frame.published();
      if (!t) return null;
      const entities: Array<{ label: string; x: number; y: number; px: number; py: number; mm: number }> = [];
      for (let i = 0; i < t.len && entities.length < max; i++) {
        const e = t.entries[i]!, label = e.node.label ?? '';
        if (label.includes(match)) entities.push({ label, x: e.x, y: e.y, px: e.px, py: e.py, mm: e.mm });
      }
      const lifts = t.liftList().slice(0, max).map((l) => ({ owner: l.owner.label ?? '', unit: l.node.label ?? '', x: l.x, y: l.y, px: l.px, py: l.py, mm: l.mm }));
      return { entities, lifts };
    },
    pickStats: () => getCamera3dPicker()?.stats() ?? null,
    zoom: () => getZoomBridge()?.state() ?? null,
    /** The last 3D frame's camera (polish Task 5: per-frame logs across the first-person push-in). */
    lastView() {
      const c = getCamera3dRuntime()?.frame.ctx();
      if (!c) return null;
      const C = c.basis.C;
      return {
        frameNo: c.frameNo, ...c.params, C: [C[0], C[1], C[2]], hideSelf: c.hideSelf, selfAlpha: c.selfAlpha, hand: c.hand, tilt: c.tilt, exactKeys: c.exactKeys,
        target: { x: c.target.x, y: c.target.y }, selfShift: { x: c.selfShift.x, y: c.selfShift.y },
      };
    },
    /** Tuning only (polish Task 3): the zoom spring's time constant; lasts until the page reloads. */
    zoomTune: (t?: { tauMs?: number }) => getZoomBridge()?.tune(t) ?? null,
    /** Tuning only (polish Task 17): the walk follower's cadence guess, late margin and spring; lasts until reinstall. */
    walk: (t?: { cadenceMs?: number; marginMs?: number; tauMs?: number }) => getCamera3dRuntime()?.walk(t) ?? null,
    hints: getCamera3dHints,
    resetHints: resetCamera3dHints,
    /** Restores one hint flag after a live test (feedback: reset one-time state). */
    markHint: markCamera3dHint,
    /** Tuning only: the Detail reach in px (the game's cull box, the weather radius); the next setting change resets it. */
    detailRadius(px?: number): number | null {
      const d = getCamera3dPasses()?.detail;
      if (!d) return null;
      if (px !== undefined && px > 0) d.px = px;
      return d.px;
    },
    drift,
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
    /** Perf Task 9: applies a graphics preset (stored like the card's pills); returns the one now lit. */
    preset(p?: GraphicsPreset): string {
      if (p !== undefined) {
        if (!GRAPHICS_PRESET_NAMES.includes(p)) return `unknown preset ${String(p)}`;
        applyGraphicsPreset(p);
      }
      return graphicsPresetOf(getCamera3dSettings());
    },
    /** Lifecycle check (plan Task 17 row 18): full uninstall, then a fresh install. */
    stop: stopCamera3d,
    start: startCamera3d,
    fault,
    retry: retryCamera3d,
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
