import type { XY } from './camera';

/** The game's step directions (live 2026-10-06 v1419: MovementSystem.isValidDirection, movePlayer's offset table). */
export type StepDir = 'up' | 'right' | 'down' | 'left';
export const STEP_OF: Readonly<Record<StepDir, XY>> = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
// literal-list-justified: the game's directional key ids (e.key for arrows, e.code otherwise), not game data
export const DIR_OF: Readonly<Record<string, StepDir>> = { KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right', ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };

/** Held direction keys as (right, forward) counts; opposite keys cancel. */
export function keyAxes(keys: readonly string[], out: XY): XY {
  let f = 0, r = 0;
  for (const k of keys) {
    const d = DIR_OF[k];
    if (d === 'up') f++; else if (d === 'down') f--; else if (d === 'right') r++; else if (d === 'left') r--;
  }
  out.x = r; out.y = f;
  return out;
}

const axes: XY = { x: 0, y: 0 };
/** P15 a: the unit heading (tile axes, y south) the held keys ask for, camera-relative: W along the view (yaw 0 north,
 * clockwise), D to its right. False when no direction key is held or they cancel. */
export function walkHeading(yaw: number, keys: readonly string[], out: XY): boolean {
  keyAxes(keys, axes);
  const f = axes.y, r = axes.x;
  if (f === 0 && r === 0) return false;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const x = f * s + r * c, y = -f * c + r * s;
  const len = Math.hypot(x, y);
  out.x = x / len; out.y = y / len;
  return true;
}

// A heading this close to a blocked axis (L1 share of the other axis, ≈ 14°) stops at the wall as in 2D, instead of
// running sideways along it.
const SLIDE_MIN = 0.2;
const EPS = 1e-9;

export interface StepPlan { a: StepDir; b: StepDir | null }

const dirOn = (xAxis: boolean, v: number): StepDir => (xAxis ? (v > 0 ? 'right' : 'left') : (v > 0 ? 'down' : 'up'));
const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/** Cardinal steps along a free heading (M1, M2): each step goes on the axis with the larger accumulated error toward the
 * line (a Bresenham walk on the L1-normalised heading). `ax, ay`: the line's point minus the tile, in tiles. */
export class StepPlanner {
  ax = 0;
  ay = 0;
  /** The direction a slide found blocked, while the heading still runs into it. */
  wall: StepDir | null = null;
  private hx = 0;
  private hy = 0;
  private nx = 0;
  private ny = 0;
  private readonly out: StepPlan = { a: 'up', b: null };

  // The point to show for the tile just reached. Along a wall it is the tile centre: the error still alternates the
  // steps (so the wall is probed for a gap) but its point would swing 1.5 / 0.5 tiles apart (live 2026-10-06).
  get ox(): number { return this.wall === null ? this.ax : 0; }
  get oy(): number { return this.wall === null ? this.ay : 0; }

  reset(): void { this.ax = 0; this.ay = 0; this.hx = 0; this.hy = 0; this.wall = null; }

  /** a: the step toward the line; b: the wall slide to try when a is blocked (null: stop there). */
  plan(hx: number, hy: number): StepPlan {
    // A turn of 90° or more starts the line from here: the old error would send the first step sideways or back.
    if (hx * this.hx + hy * this.hy <= EPS) { this.ax = 0; this.ay = 0; this.wall = null; }
    // So does turning off the wall: the line runs on from the tile centre the slide showed.
    if (this.wall !== null && hx * STEP_OF[this.wall].x + hy * STEP_OF[this.wall].y <= EPS) { this.ax = 0; this.ay = 0; this.wall = null; }
    this.hx = hx; this.hy = hy;
    const l1 = Math.abs(hx) + Math.abs(hy);
    const dx = hx / l1, dy = hy / l1;
    this.nx = this.ax + dx; this.ny = this.ay + dy;
    // Only an axis the heading moves along, with the error on its side, may take the step: never against the keys.
    const sx = Math.abs(dx) > EPS && this.nx * dx >= 0 ? Math.abs(this.nx) : -1;
    const sy = Math.abs(dy) > EPS && this.ny * dy >= 0 ? Math.abs(this.ny) : -1;
    const xFirst = sx < 0 && sy < 0 ? Math.abs(dx) >= Math.abs(dy) : sx > sy + EPS || (Math.abs(sx - sy) <= EPS && Math.abs(dx) >= Math.abs(dy));
    this.out.a = xFirst ? dirOn(true, dx) : dirOn(false, dy);
    const other = xFirst ? dy : dx;
    this.out.b = Math.abs(other) >= SLIDE_MIN ? dirOn(!xFirst, other) : null;
    return this.out;
  }

  /** The step the game took after plan() (null: blocked). A slide or a block keeps the line's point out of the wall. */
  commit(took: StepDir | null): void {
    if (took !== null && took === this.out.a) {
      const s = STEP_OF[took];
      if (took === this.wall) this.wall = null;
      this.ax = clamp1(this.nx - s.x); this.ay = clamp1(this.ny - s.y);
    } else {
      this.wall = took !== null ? this.out.a : null;
      this.ax = 0; this.ay = 0;
    }
  }
}

/** One planned step: the game's own check decides (collision, a mount's collision mode); a slide when the step is
 * blocked. Returns the step taken, null when none was. */
export function steerStep(p: StepPlanner, hx: number, hy: number, tryStep: (d: StepDir) => boolean): StepDir | null {
  const { a, b } = p.plan(hx, hy);
  const took = tryStep(a) ? a : b !== null && tryStep(b) ? b : null;
  p.commit(took);
  return took;
}
