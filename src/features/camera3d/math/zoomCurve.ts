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
export const S_FIRST_PERSON = 0.97;
export const FIRST_PERSON = { pitch: 2, fov: 70, dist: 1, lookH: 170, yOff: 0, near: 20 } as const;
export const NEAR_PLANE = 40;
// No fog (user decision 2026-10-03): the far plane clears the map diagonal (101 × 60 tiles ≈ 30,080 px).
export const FAR_PLANE = 31000;

const D2R = Math.PI / 180;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const wrapDeg = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

export function curveAt(s: number): CurveKey | null {
  if (s >= 1) return null;
  let i = 0;
  while (i < CURVE_KEYS.length - 2 && s > CURVE_KEYS[i + 1]!.s) i++;
  const a = CURVE_KEYS[i]!, b = CURVE_KEYS[i + 1]!;
  const t = Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s)));
  return {
    s,
    pitch: lerp(a.pitch, b.pitch, t),
    fov: lerp(a.fov, b.fov, t),
    lookH: lerp(a.lookH, b.lookH, t),
    yOff: lerp(a.yOff, b.yOff, t),
    follow: lerp(a.follow, b.follow, t),
    orbit: lerp(a.orbit, b.orbit, t),
    m: Math.exp(lerp(Math.log(a.m), Math.log(b.m), t)),
  };
}

/** Distance at which the feet of the look point appear at scale k·m. */
export function distForScale(fpx: number, k: number, m: number, lookH: number, pitchRad: number): number {
  return Math.max(1, fpx / (k * m) - lookH * Math.sin(pitchRad));
}

export interface CameraView { params: CamParams; target: XY; hideSelf: boolean }
export interface ViewInputs { s: number; W: number; H: number; k: number; viewCentre: XY; ground: XY | null; userYawDeg: number; userPitchDeg: number }

/** The camera for curve position s. Free-look offsets fade in with `orbit`, so s = 0 is always the 2D match. */
export function viewForS(i: ViewInputs): CameraView {
  const key = curveAt(i.s);
  const g = i.ground ?? i.viewCentre;
  if (!key) {
    const pitch = Math.min(80, Math.max(-60, FIRST_PERSON.pitch + i.userPitchDeg));
    return {
      params: { yaw: wrapDeg(i.userYawDeg) * D2R, pitch: pitch * D2R, dist: FIRST_PERSON.dist, fov: FIRST_PERSON.fov * D2R, lookH: FIRST_PERSON.lookH, yOff: FIRST_PERSON.yOff, near: FIRST_PERSON.near, far: FAR_PLANE },
      target: { x: g.x, y: g.y },
      hideSelf: true,
    };
  }
  const fpx = (i.H / 2) / Math.tan(key.fov * D2R / 2);
  const pitch = Math.min(90, Math.max(2, key.pitch + i.userPitchDeg * key.orbit)) * D2R;
  return {
    params: {
      yaw: wrapDeg(i.userYawDeg) * key.orbit * D2R,
      pitch,
      dist: distForScale(fpx, i.k, key.m, key.lookH, pitch),
      fov: key.fov * D2R,
      lookH: key.lookH,
      yOff: key.yOff,
      near: NEAR_PLANE,
      far: FAR_PLANE,
    },
    target: { x: lerp(i.viewCentre.x, g.x, key.follow), y: lerp(i.viewCentre.y, g.y, key.follow) },
    hideSelf: false,
  };
}
