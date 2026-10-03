import { makeBasis, type Basis, type CamParams, type XY } from '../math/camera';
import { quantizeYaw } from '../math/depth';
import type { CameraView } from '../math/zoomCurve';
import type { Caps, Node3 } from '../types';
import { DrawnTable, FullSaves, sync2d } from './drawn';
import type { Overrides } from './overrides';

// Depth keys use a 15° yaw step and visibility is re-decided per epoch: spike Task 4, 12 % build frames on a still
// sweep instead of 100 %.
export const SORT_STEP = (15 * Math.PI) / 180;
export const EXACT_PITCH = (80 * Math.PI) / 180;
const VIEW_STEP = (5 * Math.PI) / 180;
const DIST_STEP = Math.log(1.25);
const RING_FRAMES = 512;
export const ROLL_SLICES = 8; // power of two: recheck() masks with it
const ROLL_TRIGGER_PX = 512;
const JUMP_PX = 1536;

/** Yaw step × pitch, fov and distance buckets × screen size: a change re-culls everything in one frame. */
export function epochKey(p: CamParams, W: number, H: number): string {
  const d = Math.round(Math.log(Math.max(1, p.dist)) / DIST_STEP);
  return `${Math.round(p.yaw / SORT_STEP)}|${Math.round(p.pitch / VIEW_STEP)}|${Math.round(p.fov / VIEW_STEP)}|${d}|${W}x${H}`;
}

/** Target motion re-culls one slice per frame once the target is 2 tiles from the last pass start: a whole re-cull
 * on each 4-tile cell crossing made ~10 % of walking frames spikes (live 2026-10-03). A respawn or teleport (a jump
 * past JUMP_PX) still re-culls everything at once. Between two checks an item drifts < 4 tiles: the cull margins. */
export class CullRoll {
  full = false;
  roll = -1;
  private next = -1;
  private ax = NaN;
  private ay = NaN;

  step(x: number, y: number, viewChanged: boolean): void {
    const moved = Math.hypot(x - this.ax, y - this.ay);
    this.full = viewChanged || !(moved < JUMP_PX);
    this.roll = -1;
    if (this.full) { this.next = -1; this.ax = x; this.ay = y; return; }
    if (this.next < 0 && moved >= ROLL_TRIGGER_PX) { this.next = 0; this.ax = x; this.ay = y; }
    if (this.next >= 0) { this.roll = this.next; this.next = this.roll + 1 < ROLL_SLICES ? this.roll + 1 : -1; }
  }

  reset(): void { this.next = -1; this.ax = NaN; this.ay = NaN; }
}

/** Whether the item in `slot` (any integer, stable per item) re-decides its visibility this frame. */
export const recheck = (ctx: FrameCtx, slot: number): boolean => ctx.reCull || (slot & (ROLL_SLICES - 1)) === ctx.roll;

/** A world-position slot: stable for the static tiles, spread evenly over the slices. */
export const cullSlot = (x: number, y: number): number => (x >> 8) + 3 * (y >> 8);

const KEEP_PX = 768;
/** Never culled: orbiting and walking sweep items next to the camera across the screen edge and the near plane
 * faster than a re-check (live 2026-10-03: 22 bottom-edge tile pop-ins in 40 s). Behind the lens they are parked. */
export const nearCamera = (ctx: FrameCtx, x: number, y: number): boolean => {
  const dx = x - ctx.basis.C[0], dy = y - ctx.basis.C[2];
  return dx * dx + dy * dy < KEEP_PX * KEEP_PX;
};

export interface Fog { start: number; end: number }

export interface FrameCtx {
  readonly caps: Caps;
  readonly ov: Overrides;
  readonly saves: FullSaves;
  drawn: DrawnTable;
  W: number;
  H: number;
  params: CamParams;
  basis: Basis;
  target: XY;
  dx: number;
  dz: number;
  exactKeys: boolean;
  /** Every item re-decides its visibility this frame. */
  reCull: boolean;
  /** −1, or the slice of a rolling re-cull (see recheck). */
  roll: number;
  marginX: number;
  marginTop: number;
  hideSelf: boolean;
  frameNo: number;
  now: number;
  avatar: Node3 | null;
  avatarKey: number | null;
  avatarUpper: XY | null;
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
  stats?(): Record<string, number | string | boolean>;
}

export interface FrameRunner {
  pre(view: CameraView, avatar: Node3 | null): void;
  post(): void;
  drop(): void;
  destroy(): void;
  resetEpoch(): void;
  ctx(): FrameCtx | null;
  published(): DrawnTable;
  passStats(): Record<string, Record<string, number | string | boolean>>;
}

export function createFrameRunner(caps: Caps, ov: Overrides, passes: readonly Pass[]): FrameRunner {
  const tables = [new DrawnTable(), new DrawnTable()] as const;
  const saves = new FullSaves();
  const out = [0, 0, 0];
  let cur = 0;
  let pending = false;
  let epoch = '';
  const roll = new CullRoll();
  let frameNo = 0;
  let ctx: FrameCtx | null = null;
  // Per-pass pre+post ms since the last passStats() read, then restore and sync2d (perf gates, spec §14). The ring
  // keeps each frame's split so a p95 names the pass behind the spike frames.
  const N = passes.length + 2;
  const passMs = new Float64Array(N);
  const frameMs = new Float64Array(N);
  const ring = new Float64Array(N * RING_FRAMES);
  let timed = 0, reCulls = 0, rollFrames = 0;

  return {
    pre(view, avatar) {
      const { renderer, camera, tilemap } = caps.scene;
      const W = renderer.screen.width, H = renderer.screen.height;
      const drawn = tables[cur]!;
      drawn.reset();
      saves.reset();
      saves.save(camera);
      camera.pivot.set(0, 0); camera.skew.set(0, 0); camera.rotation = 0; camera.scale.set(1, 1); camera.position.set(0, 0);
      const basis = makeBasis(view.params, view.target.x, view.target.y, W, H);
      const yawK = quantizeYaw(view.params.yaw, SORT_STEP);
      const e = epochKey(view.params, W, H);
      roll.step(view.target.x, view.target.y, e !== epoch);
      epoch = e;
      ctx = {
        caps, ov, saves, drawn, W, H, params: view.params, basis, target: view.target,
        dx: Math.sin(yawK), dz: -Math.cos(yawK), exactKeys: view.params.pitch >= EXACT_PITCH, reCull: roll.full, roll: roll.roll,
        marginX: W * 0.75, marginTop: H * 0.75, hideSelf: view.hideSelf, frameNo: ++frameNo, now: performance.now(),
        avatar, avatarKey: null, avatarUpper: null, out,
      };
      pending = true;
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
      for (let i = 0; i < passes.length; i++) {
        const t = performance.now();
        try { passes[i]!.post?.(ctx); } catch { /* restore below must still run */ }
        frameMs[i]! += performance.now() - t;
      }
      const t0 = performance.now();
      ctx.drawn.restore();
      saves.restoreAll();
      const t1 = performance.now();
      sync2d(caps.scene.world);
      frameMs[passes.length] = t1 - t0;
      frameMs[passes.length + 1] = performance.now() - t1;
      const slot = (timed % RING_FRAMES) * N;
      for (let i = 0; i < N; i++) { passMs[i]! += frameMs[i]!; ring[slot + i] = frameMs[i]!; }
      if (ctx.reCull) reCulls++;
      if (ctx.roll >= 0) rollFrames++;
      timed++;
      cur = 1 - cur;
    },
    drop() {
      for (const p of passes) {
        try { p.drop(); } catch { /* every pass gets its drop */ }
      }
      ov.dropAll();
      epoch = '';
      roll.reset();
    },
    destroy() {
      this.drop();
      for (const p of passes) {
        try { p.destroy(); } catch { /* every pass gets its destroy */ }
      }
    },
    resetEpoch() { epoch = ''; roll.reset(); },
    ctx: () => ctx,
    published: () => tables[1 - cur]!,
    passStats() {
      const outStats: Record<string, Record<string, number | string | boolean>> = {};
      for (const p of passes) if (p.stats) outStats[p.name] = p.stats();
      const names = [...passes.map((p) => p.name), 'restore', 'sync2d'];
      const k = Math.min(timed, RING_FRAMES);
      const ms: Record<string, number> = { frames: timed, reCulls, rollFrames }, p95: Record<string, number> = {}, max: Record<string, number> = {};
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
      passMs.fill(0);
      timed = 0;
      reCulls = 0;
      rollFrames = 0;
      return outStats;
    },
  };
}
