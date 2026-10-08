import { TILE } from '../constants';
import type { XY } from './camera';
import { springStep, type SpringPoint } from './spring';

/** cadenceMs: the first guess at the game's step interval (live 2026-10-06 v1419 movementCadence: 100), refined from the
 * steps seen. marginMs: how late after its tick a step may be seen and still play on time (≥ a frame). tauMs: the
 * smoothing spring (start, stop, turns). */
export interface FollowTune { cadenceMs: number; marginMs: number; tauMs: number }
export const FOLLOW_DEFAULTS: Readonly<FollowTune> = { cadenceMs: 100, marginMs: 34, tauMs: 30 };

// A jump past this (a teleport, a respawn) is not a step: shown at once, as the game camera snaps.
const SNAP_PX = 1.5 * TILE;
const SETTLE_PX = 0.5;
const SETTLE_V = 0.005;
const QUEUE = 4;
const CAD_MIN = 50;
const CAD_MAX = 400;

export interface FollowStats { through: boolean; queued: number; cadenceMs: number }

/** M3 / P16 a: the point the 3D camera and your own avatar follow. Each step's target (a tile centre, or the planned
 * point on the heading line) plays back linearly over one cadence, on the step's tick time rather than the frame that saw
 * it, so a step train moves at one speed; a ramp-aware critically damped spring rounds starts, stops and turns. At rest
 * it hands over to the game's own point and then passes it through unchanged. */
export class StepFollower {
  readonly tune: FollowTune = { ...FOLLOW_DEFAULTS };
  private cad = FOLLOW_DEFAULTS.cadenceMs;
  private readonly wx = new Float64Array(QUEUE);
  private readonly wy = new Float64Array(QUEUE);
  private readonly ws = new Float64Array(QUEUE);
  private readonly we = new Float64Array(QUEUE);
  // 1: the target moved on the spot (no step), e.g. the glide onto the last tile once steering ended.
  private readonly spot = new Uint8Array(QUEUE);
  private head = 0;
  private n = 0;
  private fromX = 0;
  private fromY = 0;
  private px = 0;
  private py = 0;
  private tx = NaN;
  private ty = NaN;
  private tick = -Infinity;
  private lastStep = -Infinity;
  private endT = -Infinity;
  private readonly sx: SpringPoint = { s: 0, v: 0 };
  private readonly sy: SpringPoint = { s: 0, v: 0 };
  private t = NaN;
  private through = true;
  private steered = false;
  private reaim = false;

  reset(): void {
    this.tx = NaN; this.ty = NaN; this.n = 0; this.through = true; this.steered = false; this.reaim = false;
    this.tick = -Infinity; this.lastStep = -Infinity; this.endT = -Infinity; this.t = NaN; this.cad = this.tune.cadenceMs;
  }

  stats(): FollowStats { return { through: this.through, queued: this.n, cadenceMs: this.cad }; }

  /** (tx, ty): where the avatar is headed; stepped: its tile changed this frame (else the target moved on the spot);
   * steering: a planned point is held (keys down), so idle holds it instead of the game point. */
  update(tx: number, ty: number, stepped: boolean, steering: boolean, raw: XY, now: number, out: XY): XY {
    const ended = this.steered && !steering;
    this.steered = steering;
    if (Number.isNaN(this.tx)) { this.tx = tx; this.ty = ty; return this.passRaw(raw, now, out); }
    if (tx !== this.tx || ty !== this.ty) {
      const jump = Math.max(Math.abs(tx - this.tx), Math.abs(ty - this.ty)) > SNAP_PX;
      this.tx = tx; this.ty = ty;
      if (jump) { this.n = 0; this.tick = -Infinity; this.endT = -Infinity; this.through = true; this.reaim = false; }
      else {
        // Leaving the pass-through: playback starts where the output stands (last frame's game point).
        if (this.through) { this.through = false; this.px = this.sx.s; this.py = this.sy.s; this.sx.v = 0; this.sy.v = 0; }
        // Steering just ended: glide onto the last tile. Only the step the avatar view shows a frame late may re-aim
        // it; later steps without steering (the D-pad, camMove off) play on the cadence (review 2026-10-06).
        if (ended || (!steering && stepped && this.reaim)) { this.reaim = ended; this.settle(tx, ty, now); }
        else { this.reaim = false; this.schedule(tx, ty, stepped, now); }
      }
    }
    if (this.through) return this.passRaw(raw, now, out);
    this.play(now, steering ? tx : raw.x, steering ? ty : raw.y);
    const settled = Math.abs(this.sx.s - raw.x) < SETTLE_PX && Math.abs(this.sy.s - raw.y) < SETTLE_PX
      && Math.abs(this.sx.v) < SETTLE_V && Math.abs(this.sy.v) < SETTLE_V;
    if (this.n === 0 && !steering && settled) { this.through = true; return this.passRaw(raw, now, out); }
    out.x = this.sx.s; out.y = this.sy.s;
    return out;
  }

  private passRaw(raw: XY, now: number, out: XY): XY {
    this.sx.s = this.px = this.fromX = raw.x; this.sy.s = this.py = this.fromY = raw.y;
    this.sx.v = 0; this.sy.v = 0; this.t = now;
    out.x = raw.x; out.y = raw.y;
    return out;
  }

  private pop(): void {
    this.fromX = this.wx[this.head]!; this.fromY = this.wy[this.head]!;
    this.head = (this.head + 1) % QUEUE; this.n--;
  }

  // The playback is piecewise linear (hold, then a segment per waypoint; idle holds (ix, iy)): the spring is stepped
  // exactly across each piece the frame spans, so a segment starting mid-frame never pulls the output backwards.
  private play(now: number, ix: number, iy: number): void {
    const w = 1 / this.tune.tauMs;
    let a = this.t;
    while (a < now) {
      let b = now, u = 0, v = 0, bx: number, by: number;
      if (this.n > 0) {
        const i = this.head, s = this.ws[i]!, e = this.we[i]!;
        if (a < s) { b = Math.min(s, now); bx = this.fromX; by = this.fromY; }
        else {
          b = Math.min(e, now);
          const span = e - s, ex = this.wx[i]! - this.fromX, ey = this.wy[i]! - this.fromY, f = (b - s) / span;
          u = ex / span; v = ey / span; bx = this.fromX + ex * f; by = this.fromY + ey * f;
        }
      } else { bx = this.fromX = ix; by = this.fromY = iy; }
      if (b > a) { this.axis(this.sx, bx, u, b - a, w); this.axis(this.sy, by, v, b - a, w); }
      this.px = bx; this.py = by;
      if (this.n > 0 && b >= this.we[this.head]!) this.pop();
      a = Math.max(a, b);
    }
    if (now > this.t) this.t = now;
  }

  // A step on the game's cadence plays from its tick (the earliest sighting, steps never land early) plus the margin,
  // so one seen a frame late still starts on time; anything else (the first step, after a pause) starts fresh.
  private schedule(tx: number, ty: number, stepped: boolean, now: number): void {
    // A step supersedes an on-the-spot move still waiting its turn: queued behind it, every later step would lag a cadence.
    const tail = (this.head + this.n - 1) % QUEUE;
    if (stepped && this.n > 0 && this.spot[tail] === 1 && now < this.ws[tail]!) {
      this.n--;
      this.endT = this.n > 0 ? this.we[(this.head + this.n - 1) % QUEUE]! : -Infinity;
    }
    if (this.n === 0) { this.fromX = this.px; this.fromY = this.py; }
    let start: number;
    if (stepped) {
      const pred = this.tick + this.cad;
      if (Math.abs(now - pred) <= this.cad / 2) {
        const iv = now - this.lastStep;
        if (iv >= this.cad * 0.6 && iv <= this.cad * 1.6) this.cad = Math.min(CAD_MAX, Math.max(CAD_MIN, this.cad + 0.1 * (iv - this.cad)));
        this.tick = Math.min(pred, now);
      } else this.tick = now;
      this.lastStep = now;
      start = Math.max(this.endT, this.tick + this.tune.marginMs);
    } else start = Math.max(this.endT, now);
    if (this.n === QUEUE) this.pop();
    const i = (this.head + this.n) % QUEUE;
    this.wx[i] = tx; this.wy[i] = ty; this.ws[i] = start; this.we[i] = start + this.cad; this.spot[i] = stepped ? 0 : 1;
    this.endT = start + this.cad;
    this.n++;
  }

  // Steering ended (keys up, a stop at a wall): what is left of the walk plays as one straight glide from where the
  // playback stands onto the last tile, in the time the queue had left but never faster than a step. Played out, the
  // queued points on the heading line overshot the last tile's centre and hooked back to it (live 2026-10-06).
  private settle(tx: number, ty: number, now: number): void {
    const from = Number.isNaN(this.t) ? now : this.t;
    const len = Math.hypot(tx - this.px, ty - this.py) / TILE;
    const end = Math.max(this.endT, from + Math.max(1, len * this.cad));
    this.head = 0; this.n = 1;
    this.fromX = this.px; this.fromY = this.py;
    this.wx[0] = tx; this.wy[0] = ty; this.ws[0] = from; this.we[0] = end; this.spot[0] = 1;
    this.endT = end;
  }

  // Exact for a target moving linearly at u to `target` over dt: the error around its steady lag (2u·τ) decays as a
  // critically damped spring, so a constant speed shows no ripple whatever the frame times.
  private axis(p: SpringPoint, target: number, u: number, dt: number, w: number): void {
    const lag = (2 * u) / w;
    p.s -= target - u * dt - lag;
    p.v -= u;
    springStep(p, 0, dt, w);
    p.s += target - lag;
    p.v += u;
  }
}
