import { TILE } from '../constants';
import type { CamParams, XY } from './camera';

export interface CurveKey { s: number; pitch: number; fov: number; m: number; lookH: number; yOff: number; follow: number; orbit: number }

// Zoom curve v2 (user-approved hand test, 2026-10-02): the tilt finishes by s 0.18 while pulling back to m 0.32,
// then a long dolly to over-the-shoulder. pitch/fov in degrees; m = scale at the feet / the game's 2D zoom k.
export const CURVE_KEYS: readonly CurveKey[] = [
  { s: 0.0, pitch: 90, fov: 20, m: 1.0, lookH: 0, yOff: 0, follow: 0, orbit: 0 },
  { s: 0.09, pitch: 58, fov: 36, m: 0.55, lookH: 60, yOff: 0.06, follow: 1, orbit: 0.6 },
  { s: 0.18, pitch: 34, fov: 50, m: 0.32, lookH: 110, yOff: 0.12, follow: 1, orbit: 1 },
  { s: 0.6, pitch: 24, fov: 56, m: 1.0, lookH: 130, yOff: 0.1, follow: 1, orbit: 1 },
  { s: 0.92, pitch: 12, fov: 64, m: 2.6, lookH: 155, yOff: 0.06, follow: 1, orbit: 1 },
];
export const S_LAST_THIRD = 0.92;
/** Where the tilt ends (the first key at full orbit): entering and leaving 3D animate 0 ↔ here (P1 a). */
export const S_TILT_END = CURVE_KEYS.find((k) => k.orbit >= 1)?.s ?? 0.18;
export const FIRST_PERSON = { pitch: 2, fov: 70, dist: 1, lookH: 170, yOff: 0, near: 20 } as const;
/** Rendered pitch limits in degrees: third person never looks from below the ground, first person per spec §7.3. */
export const TP_PITCH = { min: 2, max: 90 } as const;
export const FP_PITCH = { min: -60, max: 80 } as const;
export const NEAR_PLANE = 40;
// No fog (user decision 2026-10-03): the far plane clears the movement map's diagonal plus slack (live 1419: 101 × 60
// tiles → 31,098 px; it was a fixed 31,000). It is a CPU cull bound only: the GPU clips at the near plane alone.
const FAR_SLACK_TILES = 4;
export const farPlaneFor = (cols: number, rows: number): number => (Math.hypot(cols, rows) + FAR_SLACK_TILES) * TILE;

const D2R = Math.PI / 180;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const wrapDeg = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function pchipEnd(h0: number, h1: number, d0: number, d1: number): number {
  const m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (Math.sign(m) !== Math.sign(d0)) return 0;
  if (Math.sign(d0) !== Math.sign(d1) && Math.abs(m) > Math.abs(3 * d0)) return 3 * d0;
  return m;
}

/** Monotone cubic (Fritsch–Carlson / PCHIP) tangents: C1 through the keys with no overshoot past them (A S5). */
export function pchipSlopes(x: readonly number[], y: readonly number[]): number[] {
  const n = x.length;
  const h: number[] = [], d: number[] = [];
  for (let i = 0; i + 1 < n; i++) { h.push(x[i + 1]! - x[i]!); d.push((y[i + 1]! - y[i]!) / h[i]!); }
  const m = new Array<number>(n).fill(0);
  for (let k = 1; k + 1 < n; k++) {
    const a = d[k - 1]!, b = d[k]!;
    if (a === 0 || b === 0 || Math.sign(a) !== Math.sign(b)) continue;
    const w1 = 2 * h[k]! + h[k - 1]!, w2 = h[k]! + 2 * h[k - 1]!;
    m[k] = (w1 + w2) / (w1 / a + w2 / b);
  }
  m[0] = pchipEnd(h[0]!, h[1]!, d[0]!, d[1]!);
  m[n - 1] = pchipEnd(h[n - 2]!, h[n - 3]!, d[n - 2]!, d[n - 3]!);
  return m;
}

interface Channel { y: readonly number[]; m: readonly number[] }
const XS = CURVE_KEYS.map((k) => k.s);
const channel = (f: (k: CurveKey) => number): Channel => { const y = CURVE_KEYS.map(f); return { y, m: pchipSlopes(XS, y) }; };
// Scale is interpolated in log space so equal steps of s feel like equal zoom ratios.
const CH = {
  pitch: channel((k) => k.pitch), fov: channel((k) => k.fov), lnM: channel((k) => Math.log(k.m)), lookH: channel((k) => k.lookH),
  yOff: channel((k) => k.yOff), follow: channel((k) => k.follow), orbit: channel((k) => k.orbit),
};

/** The third-person key at s (null = first person). Pass `out` to fill a reused key on hot paths. At s = 0 the Hermite
 *  basis is exactly (1, 0, 0, 0), so the 2D match is exact. */
export function curveAt(s: number, out?: CurveKey): CurveKey | null {
  if (s >= 1) return null;
  const x = Math.min(s, S_LAST_THIRD);
  let i = 0;
  while (i < XS.length - 2 && x > XS[i + 1]!) i++;
  const h = XS[i + 1]! - XS[i]!;
  const t = clamp((x - XS[i]!) / h, 0, 1), t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = (t3 - 2 * t2 + t) * h, h01 = -2 * t3 + 3 * t2, h11 = (t3 - t2) * h;
  const at = (c: Channel): number => h00 * c.y[i]! + h10 * c.m[i]! + h01 * c.y[i + 1]! + h11 * c.m[i + 1]!;
  const k = out ?? { s: 0, pitch: 0, fov: 0, m: 0, lookH: 0, yOff: 0, follow: 0, orbit: 0 };
  k.s = s;
  k.pitch = at(CH.pitch);
  k.fov = at(CH.fov);
  k.m = Math.exp(at(CH.lnM));
  k.lookH = at(CH.lookH);
  k.yOff = at(CH.yOff);
  k.follow = at(CH.follow);
  k.orbit = at(CH.orbit);
  return k;
}

/** Distance at which the feet of the look point appear at scale k·m. */
export function distForScale(fpx: number, k: number, m: number, lookH: number, pitchRad: number): number {
  return Math.max(1, fpx / (k * m) - lookH * Math.sin(pitchRad));
}

// First person is the end of the curve (P2 a): s (S_LAST_THIRD, 1) pushes the lens from over the shoulder through the
// head. Each channel leaves the last key at the curve's own rate (C1, A T4) and arrives at the eye at rest.
const LAST_I = CURVE_KEYS.length - 1;
const LAST = CURVE_KEYS[LAST_I]!;
const BAND = 1 - S_LAST_THIRD;
const SLOPE_EPS = 1e-4;
/** Lens fraction (0 over the shoulder, 1 at the eye) where your own body has faded out / the held item starts to rise. */
export const BODY_GONE_E = 0.6;
export const HAND_FROM_E = 0.7;
const hermite0 = (y0: number, m0: number, y1: number, u: number): number => {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * m0 + (3 * u2 - 2 * u3) * y1;
};
const smooth = (u: number): number => u * u * (3 - 2 * u);
const smoothstep = (a: number, b: number, x: number): number => smooth(clamp((x - a) / (b - a), 0, 1));
const bandU = (s: number): number => clamp((s - S_LAST_THIRD) / BAND, 0, 1);
const bandAt = (c: Channel, y1: number, u: number): number => hermite0(c.y[LAST_I]!, c.m[LAST_I]! * BAND, y1, u);

export interface PitchRange { base: number; lo: number; hi: number; orbit: number }

/** Rendered pitch = clamp(base + offset·orbit, lo, hi), in degrees: one shared look offset across modes (P5 a). */
export function pitchRange(s: number, out: PitchRange, scratch: CurveKey): PitchRange {
  if (s <= S_LAST_THIRD) {
    const key = curveAt(s, scratch)!;
    out.base = key.pitch; out.lo = TP_PITCH.min; out.hi = TP_PITCH.max; out.orbit = key.orbit;
    return out;
  }
  const u = bandU(s), w = smooth(u);
  out.base = bandAt(CH.pitch, FIRST_PERSON.pitch, u);
  out.lo = lerp(TP_PITCH.min, FP_PITCH.min, w);
  out.hi = lerp(TP_PITCH.max, FP_PITCH.max, w);
  out.orbit = 1;
  return out;
}

// The 2D match (exact keys, no fades, flat weather over World) holds while the curve's own pitch is ≥ 80°, and fully
// tilted behaviour from its 60°. Keyed on s, never the rendered pitch: free-look to 90° or a first-person look down
// must not flip a 3D view back to 2D rules (A V2).
const EXACT_TILT_PITCH = 80;
const FULL_TILT_PITCH = 60;
export const tiltOf = (curvePitchDeg: number): number =>
  clamp((EXACT_TILT_PITCH - curvePitchDeg) / (EXACT_TILT_PITCH - FULL_TILT_PITCH), 0, 1);

export interface CameraView {
  params: CamParams;
  target: XY;
  /** 0: the straight-down 2D match (s = 0 exact); 1: fully 3D. A function of s alone (tiltOf). */
  tilt: number;
  /** First-person mode: your own body hidden, the held item pinned as the viewmodel. */
  hideSelf: boolean;
  /** Your own body's alpha while it is still a billboard (the push-in fade). */
  selfAlpha: number;
  /** How far the held item has risen into view (0 below the screen, 1 in place); > 0 only with hideSelf. */
  hand: number;
}
/** fovDeg: the user's field of view setting, vertical degrees (P8). groundH: the followed avatar's height (bench, saddle);
 * the camera rises by it as far as it follows the avatar, so s = 0 stays the 2D match. far: farPlaneFor(the map). */
export interface ViewInputs { s: number; W: number; H: number; k: number; viewCentre: XY; ground: XY | null; groundH?: number; userYawDeg: number; userPitchDeg: number; fovDeg: number; far: number }

// P8: the setting shifts every key by (fov − 70)·orbit, so s = 0 (orbit 0) keeps the 2D match, and first person (orbit
// 1) gets the setting itself. Near planes scale with the lens (lensRatio = rendered fpx / curve fpx), so what is too
// close to draw keeps the same on-screen size: fixed at 40, a 100° lens put a 303 px window's avatar inside the near plane.
const userFov = (base: number, orbit: number, fovDeg: number): number => base + (fovDeg - FIRST_PERSON.fov) * orbit;
const lensRatio = (base: number, fov: number): number => Math.tan((base * D2R) / 2) / Math.tan((fov * D2R) / 2);
const fpxOf = (H: number, fovDeg: number): number => (H / 2) / Math.tan((fovDeg * D2R) / 2);

/** Look rate factor at s: a drag moves the picture as far on screen as it does at the default FOV (P8). */
export function lookScale(s: number, fovDeg: number, scratch: CurveKey): number {
  let base: number = FIRST_PERSON.fov, orbit = 1;
  if (s <= S_LAST_THIRD) { const key = curveAt(s, scratch)!; base = key.fov; orbit = key.orbit; }
  else if (s < 1) base = bandAt(CH.fov, FIRST_PERSON.fov, bandU(s));
  return 1 / lensRatio(base, userFov(base, orbit, fovDeg));
}

const tpScratch: CurveKey = { ...CURVE_KEYS[0]! };
const tpDist = (s: number, i: ViewInputs): number => {
  const key = curveAt(s, tpScratch)!;
  const pitch = clamp(key.pitch + i.userPitchDeg * key.orbit, TP_PITCH.min, TP_PITCH.max) * D2R;
  return distForScale(fpxOf(i.H, userFov(key.fov, key.orbit, i.fovDeg)), i.k, key.m, key.lookH, pitch);
};
const bandScratch: PitchRange = { base: 0, lo: 0, hi: 0, orbit: 1 };

function pushInView(i: ViewInputs, g: XY): CameraView {
  const u = bandU(i.s);
  const r = pitchRange(i.s, bandScratch, tpScratch);
  const d0 = tpDist(S_LAST_THIRD, i);
  const m0 = ((d0 - tpDist(S_LAST_THIRD - SLOPE_EPS, i)) / SLOPE_EPS) * BAND;
  const dist = Math.max(FIRST_PERSON.dist, hermite0(d0, m0, FIRST_PERSON.dist, u));
  // The lens's way from the shoulder to the eye: the body fades while it is still well clear of the near plane.
  const e = d0 - FIRST_PERSON.dist > 1e-6 ? clamp((d0 - dist) / (d0 - FIRST_PERSON.dist), 0, 1) : u;
  const hand = smoothstep(HAND_FROM_E, 1, e);
  const gone = smoothstep(0, BODY_GONE_E, e);
  const fov0 = bandAt(CH.fov, FIRST_PERSON.fov, u), fov = userFov(fov0, 1, i.fovDeg);
  return {
    params: {
      yaw: wrapDeg(i.userYawDeg) * D2R,
      pitch: clamp(r.base + i.userPitchDeg, r.lo, r.hi) * D2R,
      dist,
      fov: fov * D2R,
      lookH: bandAt(CH.lookH, FIRST_PERSON.lookH, u) + (i.groundH ?? 0),
      yOff: bandAt(CH.yOff, FIRST_PERSON.yOff, u),
      // Relaxed with the fade: in a short window (Discord, 303 px) the shoulder lens is only ~60 px from the feet.
      near: lerp(NEAR_PLANE, FIRST_PERSON.near, gone) * lensRatio(fov0, fov),
      far: i.far,
    },
    target: { x: g.x, y: g.y },
    tilt: 1,
    hideSelf: hand > 0,
    selfAlpha: 1 - gone,
    hand,
  };
}

/** The camera for curve position s. Free-look offsets fade in with `orbit`, so s = 0 is always the 2D match. Yaw is
 *  scaled before it is wrapped, so a turn past ±180° below orbit 1 stays continuous (A T7). */
export function viewForS(i: ViewInputs): CameraView {
  const g = i.ground ?? i.viewCentre;
  if (i.s > S_LAST_THIRD && i.s < 1) return pushInView(i, g);
  const key = curveAt(i.s);
  if (!key) {
    const pitch = clamp(FIRST_PERSON.pitch + i.userPitchDeg, FP_PITCH.min, FP_PITCH.max);
    return {
      params: {
        yaw: wrapDeg(i.userYawDeg) * D2R, pitch: pitch * D2R, dist: FIRST_PERSON.dist, fov: i.fovDeg * D2R, lookH: FIRST_PERSON.lookH + (i.groundH ?? 0), yOff: FIRST_PERSON.yOff,
        near: FIRST_PERSON.near * lensRatio(FIRST_PERSON.fov, i.fovDeg), far: i.far,
      },
      target: { x: g.x, y: g.y },
      tilt: 1,
      hideSelf: true,
      selfAlpha: 0,
      hand: 1,
    };
  }
  const fov = userFov(key.fov, key.orbit, i.fovDeg);
  const pitch = clamp(key.pitch + i.userPitchDeg * key.orbit, TP_PITCH.min, TP_PITCH.max) * D2R;
  return {
    params: {
      yaw: wrapDeg(i.userYawDeg * key.orbit) * D2R,
      pitch,
      dist: distForScale(fpxOf(i.H, fov), i.k, key.m, key.lookH, pitch),
      fov: fov * D2R,
      lookH: key.lookH + (i.groundH ?? 0) * key.follow,
      yOff: key.yOff,
      near: NEAR_PLANE * lensRatio(key.fov, fov),
      far: i.far,
    },
    target: { x: lerp(i.viewCentre.x, g.x, key.follow), y: lerp(i.viewCentre.y, g.y, key.follow) },
    tilt: tiltOf(key.pitch),
    hideSelf: false,
    selfAlpha: 1,
    hand: 0,
  };
}
