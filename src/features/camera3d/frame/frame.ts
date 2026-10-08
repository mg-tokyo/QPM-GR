import { LEGACY_CULL, TILE } from '../constants';
import { makeBasis, type Basis, type CamParams, type XY } from '../math/camera';
import { quantizeYaw } from '../math/depth';
import type { CameraView } from '../math/zoomCurve';
import type { Caps, Node3 } from '../types';
import { TurnBand, legacyShow, mayShow, newCull, updateCull, type Cull, type CullLevers } from './cull';
import { DrawnTable, FullSaves, sync2d } from './drawn';
import type { Overrides } from './overrides';
import { PersistTable, dualStateWorks } from './persist';

// Depth keys use a 15° yaw step and visibility is re-decided per epoch: spike Task 4, 12 % build frames on a still
// sweep instead of 100 %.
export const SORT_STEP = (15 * Math.PI) / 180;
const VIEW_STEP = (5 * Math.PI) / 180;
const DIST_STEP = Math.log(1.25);
const RING_FRAMES = 512;
export const ROLL_SLICES = 8; // power of two: recheck() masks with it
const ALL_SLICES = (1 << ROLL_SLICES) - 1;
const ROLL_TRIGGER_PX = 512;
/** Debug lever only (cullTune capPx 0): the old full re-cull once the target is this far from the pass start. */
const JUMP_PX = 1536;
/** A slice is re-checked once the target has travelled this far since its last check, so a cull decision holds for at
 * most this much travel. A 30 fps walk re-checks every slice within ~680 px through the rolling pass. */
export const TRAVEL_CAP_PX = 768;
/** On a moving frame everything this close to the camera is re-decided, against the exact screen inside one cap's travel
 * of the edge (PC9, PC10): the fixed margins only cover items farther out. Live 2026-10-07: every walk pop-in was a
 * tile 1,100–2,230 px from the camera at its last check; with the ring, 0 per walk (old margins 9 at 1×, 53 at 4×). */
export const RING_PX = 14 * TILE;
/** The show-ahead band (cull.ts TurnBand): frames of the current turn it covers, and its cap. */
export const AHEAD_FRAMES = 8;
const AHEAD_MAX = (30 * Math.PI) / 180;
/** Still camera: one rolling pass per this many frames re-decides anything no other trigger reaches (A V1). */
export const IDLE_ROLL_FRAMES = 120;
/** A walker re-decides its visibility after moving this far since its last check (half a tile; margins cover it). */
export const MOVE_PX = 128;
/** Override entries checked for despawned nodes per rolling frame (a pass of 8 frames covers ~4k). */
const PRUNE_PER_FRAME = 512;

/** Yaw step × pitch, fov and distance buckets × screen size: a change re-culls everything in one frame. */
export function epochKey(p: CamParams, W: number, H: number): string {
  const d = Math.round(Math.log(Math.max(1, p.dist)) / DIST_STEP);
  return `${Math.round(p.yaw / SORT_STEP)}|${Math.round(p.pitch / VIEW_STEP)}|${Math.round(p.fov / VIEW_STEP)}|${d}|${W}x${H}`;
}

/** Target motion re-culls one slice per frame once the target is 2 tiles from the last pass start: a whole re-cull
 * on each 4-tile cell crossing made ~10 % of walking frames spikes (live 2026-10-03). A slice the pass has not reached
 * within TRAVEL_CAP_PX of travel is re-checked at once (capMask; live 2026-10-07: an ~8 fps walk drew 61 pop-ins); every
 * slice due at once (a respawn, a teleport) is one full re-cull. */
export class CullRoll {
  full = false;
  roll = -1;
  /** Slices the travel cap re-checks this frame (bit per slice), beside `roll`. */
  capMask = 0;
  /** Tuning only (polish Task 14 lever A/B): target travel that starts a rolling pass. */
  triggerPx = ROLL_TRIGGER_PX;
  /** Tuning only (perf Task 5 A/B): 0 brings back the old full re-cull at JUMP_PX from the pass start. */
  capPx = TRAVEL_CAP_PX;
  private next = -1;
  private ax = NaN;
  private ay = NaN;
  private idle = 0;
  /** Target position at each slice's last check. */
  private readonly at = new Float64Array(2 * ROLL_SLICES).fill(NaN);

  step(x: number, y: number, viewChanged: boolean): void {
    const dx = x - this.ax, dy = y - this.ay;
    const moved = Math.sqrt(dx * dx + dy * dy);
    let due = 0;
    if (this.capPx > 0) {
      const c2 = this.capPx * this.capPx, at = this.at;
      for (let k = 0; k < ROLL_SLICES; k++) {
        const ex = x - at[2 * k]!, ey = y - at[2 * k + 1]!;
        if (!(ex * ex + ey * ey < c2)) due |= 1 << k;
      }
      this.full = viewChanged || due === ALL_SLICES;
    } else this.full = viewChanged || !(moved < JUMP_PX);
    this.roll = -1;
    this.capMask = 0;
    if (this.full) {
      this.next = -1; this.idle = 0; this.ax = x; this.ay = y;
      for (let k = 0; k < ROLL_SLICES; k++) this.mark(k, x, y);
      return;
    }
    if (this.next < 0) {
      if (moved >= this.triggerPx) { this.next = 0; this.ax = x; this.ay = y; }
      else if (++this.idle >= IDLE_ROLL_FRAMES) this.next = 0;
    }
    if (this.next >= 0) {
      this.idle = 0; this.roll = this.next; this.next = this.roll + 1 < ROLL_SLICES ? this.roll + 1 : -1;
      this.mark(this.roll, x, y);
      due &= ~(1 << this.roll);
    }
    this.capMask = due;
    for (let k = 0; due; k++, due >>= 1) if (due & 1) this.mark(k, x, y);
  }

  reset(): void { this.next = -1; this.idle = 0; this.ax = NaN; this.ay = NaN; this.at.fill(NaN); }

  private mark(k: number, x: number, y: number): void { this.at[2 * k] = x; this.at[2 * k + 1] = y; }
}

/** The camera inputs a placement reads: basis, clip planes, depth-key axis, tilt, first person (perf Task 4). */
export class CameraStamp {
  private readonly v = new Float64Array(20).fill(NaN);
  private n = 0;
  private moved = 0;

  /** True when nothing changed since the last call; never on the first call after reset(). */
  still(b: Basis, p: CamParams, dx: number, dz: number, tilt: number, hideSelf: boolean): boolean {
    this.n = 0; this.moved = 0;
    for (let i = 0; i < 3; i++) { this.put(b.C[i]!); this.put(b.F[i]!); this.put(b.U[i]!); }
    this.put(b.R[0]!); this.put(b.R[2]!); this.put(b.fpx); this.put(b.cx0); this.put(b.cy0);
    this.put(p.near); this.put(p.far); this.put(dx); this.put(dz); this.put(tilt); this.put(hideSelf ? 1 : 0);
    return this.moved === 0;
  }

  reset(): void { this.v.fill(NaN); }

  private put(x: number): void {
    const i = this.n++;
    if (this.v[i] !== x) { this.v[i] = x; this.moved++; }
  }
}

/** Where each walker (a non-tile entity) last re-decided its visibility. With a still camera nothing else re-checks
 * it: it stayed culled walking into view and drawn walking out (A V1). */
export class MoveCheck {
  private readonly at = new WeakMap<object, { x: number; y: number; tx: number; ty: number }>();

  /** (tx, ty): the camera target. A walker that crossed into another slot misses that slot's cadence, so it is also due
   * once the target has travelled `cap` since its last check (0: no cap). */
  due(n: object, x: number, y: number, tx = 0, ty = 0, cap = 0): boolean {
    const p = this.at.get(n);
    if (!p || Math.abs(x - p.x) + Math.abs(y - p.y) >= MOVE_PX) return true;
    const dx = tx - p.tx, dy = ty - p.ty;
    return cap > 0 && dx * dx + dy * dy >= cap * cap;
  }

  note(n: object, x: number, y: number, tx = 0, ty = 0): void {
    const p = this.at.get(n);
    if (p) { p.x = x; p.y = y; p.tx = tx; p.ty = ty; } else this.at.set(n, { x, y, tx, ty });
  }
}

/** Whether the item in `slot` (any integer, stable per item) re-decides its visibility this frame. */
export const recheck = (ctx: FrameCtx, slot: number): boolean => {
  const k = slot & (ROLL_SLICES - 1);
  return ctx.reCull || k === ctx.roll || ((ctx.capMask >> k) & 1) === 1;
};

/** A world-position slot: stable for the static tiles, spread evenly over the slices. */
export const cullSlot = (x: number, y: number): number => (x >> 8) + 3 * (y >> 8);

export const KEEP_PX = 768;
/** Never culled: orbiting and walking sweep items next to the camera across the screen edge and the near plane
 * faster than a re-check (live 2026-10-03: 22 bottom-edge tile pop-ins in 40 s). Behind the lens they are parked. */
export const nearCamera = (ctx: FrameCtx, x: number, y: number): boolean => {
  const dx = x - ctx.basis.C[0], dy = y - ctx.basis.C[2];
  return dx * dx + dy * dy < KEEP_PX * KEEP_PX;
};

/** Inside the ring on a moving frame: re-decide it now, whatever its slot (PC9). */
export const ringDue = (ctx: FrameCtx, x: number, y: number): boolean => {
  const r = ctx.cull.ring;
  if (r <= 0 || ctx.camStill) return false;
  const dx = x - ctx.basis.C[0], dy = y - ctx.basis.C[2];
  return dx * dx + dy * dy < r * r;
};

/** A cap inside the ring: the next moving frame re-decides it before it can leave (a longer jump makes its slice due),
 * so the screen as it is decides it. Without the cap (lever) nothing bounds a jump out of the ring: margins only. */
export const ringExact = (ctx: FrameCtx, x: number, y: number): boolean => {
  const c = ctx.cull, inner = c.ring - c.cap;
  if (c.ring <= 0 || c.cap <= 0 || inner <= 0) return false;
  const dx = x - ctx.basis.C[0], dy = y - ctx.basis.C[2];
  return dx * dx + dy * dy < inner * inner;
};

/** Visibility of ground point (gx, gy) projected to (sx, sy, cz), its art reaching side / up / down world px (frame/cull.ts).
 * Next to the lens always; well inside the ring the screen as the camera may turn it before the next rebuild (cull.ts
 * ahead; extra: world px the item may move itself before its next check); farther out the fixed margins (art: tile-art
 * bands, else billboard bands). */
export function mayBeSeen(ctx: FrameCtx, gx: number, gy: number, sx: number, sy: number, cz: number, side: number, up: number, down: number, extra: number, art: boolean): boolean {
  if (nearCamera(ctx, gx, gy)) return true;
  const c = ctx.cull;
  if (ringExact(ctx, gx, gy)) return mayShow(c, sx, sy, cz, side, up, down, extra, c.ahead);
  return art ? legacyShow(c, sx, sy, cz, LEGACY_CULL.art.above, LEGACY_CULL.art.below) : legacyShow(c, sx, sy, cz, c.legacy * ctx.H, LEGACY_CULL.below);
}

/** The Detail setting's reach in world px: the game's cull box (engine/viewport.ts) and the weather radius. */
export interface DetailRadius { px: number }

export interface FrameCtx {
  readonly caps: Caps;
  readonly ov: Overrides;
  readonly saves: FullSaves;
  /** Tile views keep their 3D transform across frames (perf Task 3): place them through it. */
  readonly persist: PersistTable;
  drawn: DrawnTable;
  W: number;
  H: number;
  params: CamParams;
  basis: Basis;
  target: XY;
  dx: number;
  dz: number;
  /** CameraView.tilt: 0 the 2D match, 1 fully 3D (by s, never pitch). */
  tilt: number;
  /** tilt 0: the game's own 2D sort keys, layers and bands. */
  exactKeys: boolean;
  /** Every item re-decides its visibility this frame. */
  reCull: boolean;
  /** −1, or the slice of a rolling re-cull (see recheck). */
  roll: number;
  /** Slices the travel cap re-checks this frame (CullRoll.capMask). */
  capMask: number;
  /** The camera is the same as last frame (CameraStamp): unchanged inputs give unchanged placements (perf Task 4). */
  camStill: boolean;
  /** What may be on screen before an item's next re-check, or this frame (perf Task 5). */
  readonly cull: Cull;
  hideSelf: boolean;
  /** CameraView.selfAlpha / .hand (the first-person push-in). */
  selfAlpha: number;
  hand: number;
  frameNo: number;
  now: number;
  avatar: Node3 | null;
  avatarKey: number | null;
  avatarUpper: XY | null;
  /** The followed avatar's ground point (2D world px) this frame. */
  avatarGround: XY | null;
  /** The steady follow point minus the game's ground point (P16 a): your avatar and its mount are drawn moved by it,
   * times tilt. */
  selfShift: XY;
  readonly out: number[];
}

export interface Pass {
  readonly name: string;
  pre(ctx: FrameCtx): void;
  post?(ctx: FrameCtx): void;
  /** 3D left: undo every persistent change this pass made to game nodes, hide its own nodes. */
  drop(): void;
  /** Feature stopped: free QPM nodes and GPU resources. */
  destroy(): void;
  /** One unit of setup ahead of entry, while 2D waits at the detent (A T2): true when it did work. */
  warm?(ov: Overrides, at: XY | null): boolean;
  /** Install, once every pass is registered for destroy: compiles its GL programs (a throw unwinds cleanly). */
  compile?(): void;
  stats?(): Record<string, number | string | boolean>;
}

export interface FrameRunner {
  pre(view: CameraView, avatar: Node3 | null, selfShift?: XY): void;
  /** Throws the first pass post error, after the 2D restore has run. */
  post(): void;
  drop(): void;
  resetEpoch(): void;
  /** Tuning only (polish Task 12): the depth-key yaw step (0: unquantized); visibility still re-decides per SORT_STEP. */
  setKeyStep(rad: number): void;
  keyStep(): number;
  /** Tuning only (A/B levers): rolling-pass trigger; margin the fixed side/top margins past the ring (× W, × H); capPx
   * the travel cap, 0 the old anchor re-cull; ringPx the near ring, 0 off. { margin 0.75, capPx 0, ringPx 0 } is the
   * rule of before perf Task 5. ahead: frames of the current turn the show-ahead band covers, 0 off (before perf Task 7);
   * aheadMaxDeg its cap. */
  cullTune(t?: { rollPx?: number; margin?: number; capPx?: number; ringPx?: number; ahead?: number; aheadMaxDeg?: number }): { rollPx: number; margin: number; capPx: number; ringPx: number; ahead: number; aheadMaxDeg: number };
  /** Tuning only (perf Task 3 A/B): dual state on or off; returns whether it is on (off when the self-test failed). */
  persistTune(on?: boolean): boolean;
  /** Tuning only (perf Task 4 A/B): off, no frame counts as still, so every pass takes its full path. */
  stillTune(on?: boolean): boolean;
  ctx(): FrameCtx | null;
  published(): DrawnTable;
  passStats(): Record<string, Record<string, number | string | boolean>>;
}

const NO_SHIFT: XY = { x: 0, y: 0 };

export function createFrameRunner(caps: Caps, ov: Overrides, passes: readonly Pass[]): FrameRunner {
  const tables = [new DrawnTable(), new DrawnTable()] as const;
  const saves = new FullSaves();
  const persist = new PersistTable(dualStateWorks(caps.classes.Container));
  const out = [0, 0, 0];
  let cur = 0;
  let pending = false;
  let epoch = '';
  let keyStep = SORT_STEP;
  const roll = new CullRoll();
  const stamp = new CameraStamp();
  let stillOn = true;
  let frameNo = 0;
  let ctx: FrameCtx | null = null;
  // Per-pass pre+post ms since the last passStats() read, then restore and sync2d (perf gates, spec §14). The ring
  // keeps each frame's split so a p95 names the pass behind the spike frames.
  const N = passes.length + 2;
  const passMs = new Float64Array(N);
  const frameMs = new Float64Array(N);
  const ring = new Float64Array(N * RING_FRAMES);
  let timed = 0, reCulls = 0, rollFrames = 0, capped = 0, bandPeak = 0;
  const lv: CullLevers = { capPx: TRAVEL_CAP_PX, legacy: LEGACY_CULL.side, ring: RING_PX, ahead: AHEAD_FRAMES, aheadMax: AHEAD_MAX };
  const cull = newCull();
  const turn = new TurnBand();
  let cullFresh = false;

  return {
    pre(view, avatar, selfShift = NO_SHIFT) {
      const { renderer, camera, tilemap } = caps.scene;
      const W = renderer.screen.width, H = renderer.screen.height;
      const drawn = tables[cur]!;
      drawn.reset();
      saves.reset();
      saves.save(camera);
      camera.pivot.set(0, 0); camera.skew.set(0, 0); camera.rotation = 0; camera.scale.set(1, 1); camera.position.set(0, 0);
      const basis = makeBasis(view.params, view.target.x, view.target.y, W, H);
      const yawK = quantizeYaw(view.params.yaw, keyStep);
      const dx = Math.sin(yawK), dz = -Math.cos(yawK);
      const e = epochKey(view.params, W, H);
      roll.step(view.target.x, view.target.y, e !== epoch);
      epoch = e;
      const still = stamp.still(basis, view.params, dx, dz, view.tilt, view.hideSelf);
      const turned = turn.step(view.params.yaw, view.params.pitch, lv.ahead, lv.aheadMax);
      if (turn.yaw > bandPeak) bandPeak = turn.yaw;
      // The stamp holds every input the bounds read (basis, near, far); the band decays after a turn; a lever change
      // clears cullFresh.
      if (!still || !cullFresh || turned) {
        updateCull(cull, basis, view.params, W, H, lv, turn);
        cullFresh = true;
      }
      persist.begin(++frameNo);
      ctx = {
        caps, ov, saves, persist, drawn, W, H, params: view.params, basis, target: view.target,
        dx, dz, tilt: view.tilt, exactKeys: view.tilt <= 0, reCull: roll.full, roll: roll.roll, capMask: roll.capMask, camStill: still && stillOn,
        cull, hideSelf: view.hideSelf, selfAlpha: view.selfAlpha, hand: view.hand, frameNo, now: performance.now(),
        avatar, avatarKey: null, avatarUpper: null, avatarGround: null, selfShift, out,
      };
      pending = true;
      // Overrides of despawned nodes go while the rolling passes run, not only on exit (A R4).
      if (ctx.reCull || ctx.roll >= 0 || ctx.capMask) ov.prune(PRUNE_PER_FRAME);
      ov.put('visible', tilemap, false);
      frameMs.fill(0);
      for (let i = 0; i < passes.length; i++) {
        const t = performance.now();
        passes[i]!.pre(ctx);
        frameMs[i]! += performance.now() - t;
      }
    },
    post() {
      if (!pending || !ctx) return;
      pending = false;
      let err: unknown = null;
      let failed = false;
      for (let i = 0; i < passes.length; i++) {
        const t = performance.now();
        try { passes[i]!.post?.(ctx); } catch (e) { if (!failed) { failed = true; err = e; } }
        frameMs[i]! += performance.now() - t;
      }
      const t0 = performance.now();
      ctx.drawn.restore();
      persist.finish();
      ctx.drawn.trim();
      saves.restoreAll();
      const t1 = performance.now();
      sync2d(caps.scene.world);
      frameMs[passes.length] = t1 - t0;
      frameMs[passes.length + 1] = performance.now() - t1;
      const slot = (timed % RING_FRAMES) * N;
      for (let i = 0; i < N; i++) { passMs[i]! += frameMs[i]!; ring[slot + i] = frameMs[i]!; }
      if (ctx.reCull) reCulls++;
      if (ctx.roll >= 0) rollFrames++;
      for (let m = ctx.capMask; m; m >>= 1) capped += m & 1;
      timed++;
      cur = 1 - cur;
      if (failed) throw err instanceof Error ? err : new Error(String(err));
    },
    drop() {
      // First: a held tile view left with its 3D render cache would draw in 3D on the next 2D frame (Review focus 1).
      persist.releaseAll();
      for (const p of passes) {
        try { p.drop(); } catch { /* every pass gets its drop */ }
      }
      ov.dropAll();
      // Nothing drawn is held once 3D is left; a frame still pending keeps its table for the 2D restore in post().
      if (!pending) for (const t of tables) { t.reset(); t.trim(); }
      epoch = '';
      roll.reset();
      stamp.reset();
      turn.reset();
      cullFresh = false;
    },
    resetEpoch() { epoch = ''; roll.reset(); stamp.reset(); turn.reset(); cullFresh = false; },
    setKeyStep(rad) { if (rad >= 0) { keyStep = rad; epoch = ''; } },
    keyStep: () => keyStep,
    cullTune(t) {
      if (t?.rollPx !== undefined && t.rollPx > 0) roll.triggerPx = t.rollPx;
      if (t?.margin !== undefined && t.margin >= 0) { lv.legacy = t.margin; epoch = ''; cullFresh = false; }
      if (t?.capPx !== undefined && t.capPx >= 0) { lv.capPx = roll.capPx = t.capPx; epoch = ''; cullFresh = false; }
      if (t?.ringPx !== undefined && t.ringPx >= 0) { lv.ring = t.ringPx; epoch = ''; cullFresh = false; }
      if (t?.ahead !== undefined && t.ahead >= 0) { lv.ahead = t.ahead; epoch = ''; cullFresh = false; }
      if (t?.aheadMaxDeg !== undefined && t.aheadMaxDeg >= 0) { lv.aheadMax = (t.aheadMaxDeg * Math.PI) / 180; epoch = ''; cullFresh = false; }
      return { rollPx: roll.triggerPx, margin: lv.legacy, capPx: lv.capPx, ringPx: lv.ring, ahead: lv.ahead, aheadMaxDeg: +((lv.aheadMax * 180) / Math.PI).toFixed(3) };
    },
    persistTune(on) { return on === undefined ? persist.enabled() : persist.setEnabled(on); },
    stillTune(on) { if (on !== undefined) stillOn = on; return stillOn; },
    ctx: () => ctx,
    published: () => tables[1 - cur]!,
    passStats() {
      const outStats: Record<string, Record<string, number | string | boolean>> = {};
      for (const p of passes) if (p.stats) outStats[p.name] = p.stats();
      const names = [...passes.map((p) => p.name), 'restore', 'sync2d'];
      const k = Math.min(timed, RING_FRAMES);
      const ms: Record<string, number> = { frames: timed, reCulls, rollFrames, capped, bandPeakDeg: +((bandPeak * 180) / Math.PI).toFixed(2) };
      const p95: Record<string, number> = {}, max: Record<string, number> = {};
      const col = new Float64Array(k);
      names.forEach((name, i) => {
        ms[name] = timed ? +(passMs[i]! / timed).toFixed(3) : 0;
        for (let f = 0; f < k; f++) col[f] = ring[f * N + i]!;
        col.sort();
        p95[name] = k ? +col[Math.floor(k * 0.95)]!.toFixed(3) : 0;
        max[name] = k ? +col[k - 1]!.toFixed(3) : 0;
      });
      outStats.ms = ms;
      outStats.p95 = p95;
      outStats.max = max;
      outStats.persist = { ...persist.stats() };
      passMs.fill(0);
      timed = 0;
      reCulls = 0;
      rollFrames = 0;
      capped = 0;
      bandPeak = 0;
      return outStats;
    },
  };
}
