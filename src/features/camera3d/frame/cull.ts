import type { Basis, CamParams } from '../math/camera';

/** The screen in tangent space: |x/z| at the right/left edges, |y/z| at the top/bottom ones, and the lengths of those
 * face planes' normals. */
export interface ViewBox { r: number; l: number; t: number; b: number; nr: number; nl: number; nt: number; nb: number }

/** Per-frame cull bounds (perf Task 5, PC10): the screen as it is for items re-decided on every moving frame (the near
 * ring, frame.ts) or placed every frame; fixed margins for the rest, which wait for their rolling re-check. */
export interface Cull {
  readonly now: ViewBox;
  near: number; far: number; fpx: number; cx0: number; cy0: number; W: number; H: number;
  /** Items past the ring: the fixed side margin (× W; a billboard's top band is × H). */
  legacy: number;
  /** Ground radius (world px) of the ring re-decided on every moving frame (PC9); 0: off. */
  ring: number;
  /** The target travel cap (frame.ts CullRoll); 0: the old anchor re-cull, no cap. */
  cap: number;
  /** The screen widened by how far the camera may turn before an item's next chance to show on a frame that rebuilds
   * World anyway (PC12): ring items are decided in view against it, so a show waits off screen instead of forcing a
   * rebuild where its art reaches the edge. Urgency stays on the screen as it is. Band 0: equal to `now`. */
  readonly ahead: ViewBox;
  /** The show-ahead lever (frames of the current turn; 0: off). */
  aheadFrames: number;
}

/** The frame runner's A/B levers (cullTune); ahead: frames of the current turn the band covers, aheadMax its cap (rad). */
export interface CullLevers { capPx: number; legacy: number; ring: number; ahead: number; aheadMax: number }

const box0 = (): ViewBox => ({ r: 0, l: 0, t: 0, b: 0, nr: 1, nl: 1, nt: 1, nb: 1 });
export const newCull = (): Cull => ({
  now: box0(), ahead: box0(), near: 0, far: 0, fpx: 1, cx0: 0, cy0: 0, W: 0, H: 0, legacy: 0, ring: 0, cap: 0, aheadFrames: 0,
});

// A face stays short of 90° however wide the band, so its tangent and normal stay finite.
const FACE_MAX = (85 * Math.PI) / 180;
const widen = (t: number, band: number): number => (band > 0 ? Math.tan(Math.min(Math.atan(t) + band, FACE_MAX)) : t);

/** Fills `c` for this frame; turn: the show-ahead band (TurnBand), null or the lever off: none. */
export function updateCull(c: Cull, bs: Basis, p: CamParams, W: number, H: number, lv: CullLevers, turn: { yaw: number; pitch: number } | null): Cull {
  const { fpx, cx0, cy0 } = bs;
  c.fpx = fpx; c.cx0 = cx0; c.cy0 = cy0; c.W = W; c.H = H; c.near = p.near; c.far = p.far;
  c.legacy = lv.legacy; c.ring = lv.ring; c.cap = lv.capPx; c.aheadFrames = lv.ahead;
  const o = c.now, r = (W - cx0) / fpx, l = cx0 / fpx, t = cy0 / fpx, b = (H - cy0) / fpx;
  o.r = r; o.l = l; o.t = t; o.b = b;
  o.nr = Math.hypot(1, r); o.nl = Math.hypot(1, l); o.nt = Math.hypot(1, t); o.nb = Math.hypot(1, b);
  const by = lv.ahead > 0 && turn ? turn.yaw : 0, bp = lv.ahead > 0 && turn ? turn.pitch : 0, a = c.ahead;
  a.r = widen(r, by); a.l = widen(l, by); a.t = widen(t, bp); a.b = widen(b, bp);
  a.nr = by > 0 ? Math.sqrt(1 + a.r * a.r) : o.nr; a.nl = by > 0 ? Math.sqrt(1 + a.l * a.l) : o.nl;
  a.nt = bp > 0 ? Math.sqrt(1 + a.t * a.t) : o.nt; a.nb = bp > 0 ? Math.sqrt(1 + a.b * a.b) : o.nb;
  return c;
}

export const BAND_DECAY = 0.9;
// 0.06°: below it the band is off, so a camera that stopped turning stops refreshing the cull.
const BAND_EPS = 1e-3;
const wrapPi = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const hold = (prev: number, want: number, max: number): number => {
  const v = Math.min(max, Math.max(prev * BAND_DECAY, want));
  return v < BAND_EPS ? 0 : v;
};

/** The show-ahead band (rad): `frames` × this frame's turn, held at its peak and decaying by BAND_DECAY a frame. A slow
 * machine turns further per frame, so its band is wider in the same turn (PC12). */
export class TurnBand {
  yaw = 0;
  pitch = 0;
  private lastYaw = NaN;
  private lastPitch = NaN;

  /** Returns whether the band changed. */
  step(yaw: number, pitch: number, frames: number, max: number): boolean {
    const dy = Number.isNaN(this.lastYaw) ? 0 : Math.abs(wrapPi(yaw - this.lastYaw));
    const dp = Number.isNaN(this.lastPitch) ? 0 : Math.abs(pitch - this.lastPitch);
    this.lastYaw = yaw; this.lastPitch = pitch;
    const y = frames > 0 ? hold(this.yaw, frames * dy, max) : 0, p = frames > 0 ? hold(this.pitch, frames * dp, max) : 0;
    const changed = y !== this.yaw || p !== this.pitch;
    this.yaw = y; this.pitch = p;
    return changed;
  }

  reset(): void { this.yaw = 0; this.pitch = 0; this.lastYaw = NaN; this.lastPitch = NaN; }
}

/** A billboard whose foot projects to (sx, sy, cz), its art reaching side / up / down world px at that depth, may be on
 * screen (extra: world px of slack, such as what the item may move itself). A face of the screen with the foot past it
 * by more than the slack, art included, rules it out. Art lying flat (not facing the camera) of radius r is side = up =
 * down = 0, extra = r: a sphere's reach scales with the face normal. box: c.now, or c.ahead for a ring decision. */
export function mayShow(c: Cull, sx: number, sy: number, cz: number, side: number, up: number, down: number, extra = 0, box: ViewBox = c.now): boolean {
  if (cz < c.near - extra || cz > c.far + extra) return false;
  const k = cz / c.fpx, X = (sx - c.cx0) * k, Y = (c.cy0 - sy) * k;
  return !(X - box.r * cz > extra * box.nr + side || -X - box.l * cz > extra * box.nl + side
    || Y - box.t * cz > extra * box.nt + down || -Y - box.b * cz > extra * box.nb + up);
}

/** World-fixed geometry (a fence wall) with corners projected into pts as (sx, sy, cz) triples may be on screen: it is
 * ruled out only when every corner is past the same face. */
export function hullMayShow(c: Cull, pts: ArrayLike<number>, n: number, box: ViewBox = c.now): boolean {
  let nearOut = true, farOut = true, rOut = true, lOut = true, tOut = true, bOut = true;
  for (let i = 0; i < n; i++) {
    const sx = pts[3 * i]!, sy = pts[3 * i + 1]!, cz = pts[3 * i + 2]!;
    if (cz >= c.near) nearOut = false;
    if (cz <= c.far) farOut = false;
    const k = cz / c.fpx, X = (sx - c.cx0) * k, Y = (c.cy0 - sy) * k;
    if (!(X - box.r * cz > 0)) rOut = false;
    if (!(-X - box.l * cz > 0)) lOut = false;
    if (!(Y - box.t * cz > 0)) tOut = false;
    if (!(-Y - box.b * cz > 0)) bOut = false;
  }
  return !(nearOut || farOut || rOut || lOut || tOut || bOut);
}

/** The fixed screen margins (sides legacy × W, the caller's top/bottom bands). */
export function legacyShow(c: Cull, sx: number, sy: number, cz: number, above: number, below: number): boolean {
  const mx = c.legacy * c.W;
  return !(cz < c.near || cz > c.far || sx < -mx || sx > c.W + mx || sy < -above || sy > c.H + below);
}

/** The fixed margins for a fence wall: its two ground ends (pts corners 0 and 1), the caller's top/bottom bands. */
export function legacyWallShow(c: Cull, pts: ArrayLike<number>, above: number, below: number): boolean {
  const x0 = pts[0]!, y0 = pts[1]!, z0 = pts[2]!, x1 = pts[3]!, y1 = pts[4]!, z1 = pts[5]!, mx = c.legacy * c.W;
  return Math.max(z0, z1) >= c.near && Math.min(z0, z1) <= c.far
    && !(Math.max(x0, x1) < -mx || Math.min(x0, x1) > c.W + mx || Math.max(y0, y1) < -above || Math.min(y0, y1) > c.H + below);
}
