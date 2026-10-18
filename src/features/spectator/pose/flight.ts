import type { SpectatorPose } from '../state';

/** Each clamped to −1…1. fx: right +; fy: forward + (W, north in 2D); the signs of camera3d's keyAxes. up: E +.
 * stepFlight2d ignores up: 2D height is the game's zoom, stepped through zoomStepFor. */
export interface FlightInput { fx: number; fy: number; up: number; fast: boolean }

/** tilePx: the game's zoom tile size. It and the view are CSS px: the stage is autoDensity (live 1448, screen.width =
 * canvas clientWidth, Camera scale × 256 = zoom.effective). */
export interface Flight2dCtx { tilePx: number; viewW: number; viewH: number; mapCols: number; mapRows: number; speedCssPxPerSec: number }
export type View2dCtx = Omit<Flight2dCtx, 'speedCssPxPerSec'>;

/** CSS px per second on screen, so a zoom mid-flight keeps the speed the eye sees. */
export interface FlightVel { x: number; y: number }

/** at(now, dest): a destination that moved since the start (a walking avatar) is blended toward instead, so the
 * flight still ends exactly on it. The duration stays the one set at creation. */
export interface FlyTo { at(nowMs: number, dest?: SpectatorPose): SpectatorPose; done(nowMs: number): boolean }

const FAST_FACTOR = 3;
// e^-3 ≈ 0.05: within 5 % of the new speed 120 ms after any change, up, down or into fast (S §4.1 ramp).
const RAMP_TAU_MS = 40;
const SNAP_PX_PER_SEC = 1;
const MAX_STEP_MS = 100;
const FLY_MIN_MS = 250;
const FLY_MAX_MS = 900;
const FLY_FULL_TILES = 100;

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);
const clamp1 = (v: number): number => Math.max(-1, Math.min(1, finite(v)));
const wrapDeg = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - ((2 - 2 * t) ** 3) / 2);

// The centres the game can render: computeProjection keeps half a view inside the map, and grid g draws at world
// (g + 0.5) × 256 (live 1448). Clamping here keeps the pose from drifting into a band the screen never shows.
function band(p: number, half: number, n: number): number {
  const lo = half - 0.5, hi = n - half - 0.5;
  return lo > hi ? n / 2 - 0.5 : Math.min(hi, Math.max(lo, p));
}

// The game's map-fit floor (computeProjection): the view never shows past the map edge.
const screenTileOf = (ctx: View2dCtx): number =>
  Math.max(finite(ctx.tilePx), finite(ctx.viewW / ctx.mapCols), finite(ctx.viewH / ctx.mapRows));

function approach(v: number, target: number, k: number): number {
  const next = finite(v) + (target - finite(v)) * k;
  return Math.abs(target - next) < SNAP_PX_PER_SEC ? target : next;
}

export function stepFlight2d(
  pose: SpectatorPose, vel: FlightVel, input: FlightInput, dtMs: number, ctx: Flight2dCtx,
): { pose: SpectatorPose; vel: FlightVel } {
  if (!(dtMs > 0)) return { pose: { ...pose }, vel: { ...vel } };
  const tile = screenTileOf(ctx);
  if (!(tile > 0) || !(ctx.mapCols > 0) || !(ctx.mapRows > 0)) return { pose: { ...pose }, vel: { x: 0, y: 0 } };
  const dt = Math.min(dtMs, MAX_STEP_MS);

  let fx = clamp1(input.fx), fy = clamp1(input.fy);
  const len = Math.hypot(fx, fy);
  if (len > 1) { fx /= len; fy /= len; }
  const speed = Math.max(0, finite(ctx.speedCssPxPerSec)) * (input.fast ? FAST_FACTOR : 1);
  const k = 1 - Math.exp(-dt / RAMP_TAU_MS);
  let vx = approach(vel.x, fx * speed, k);
  let vy = approach(vel.y, (0 - fy) * speed, k);

  const nx = finite(pose.x) + (vx / tile) * (dt / 1000);
  const ny = finite(pose.y) + (vy / tile) * (dt / 1000);
  const x = band(nx, finite(ctx.viewW) / (2 * tile), ctx.mapCols);
  const y = band(ny, finite(ctx.viewH) / (2 * tile), ctx.mapRows);
  if ((x > nx && vx < 0) || (x < nx && vx > 0)) vx = 0;
  if ((y > ny && vy < 0) || (y < ny && vy > 0)) vy = 0;
  return { pose: { ...pose, x, y }, vel: { x: vx, y: vy } };
}

/** Grab and pan: a drag of (dx, dy) CSS px moves the camera the other way at the scale the screen shows. */
export function panPose2d(pose: SpectatorPose, dxPx: number, dyPx: number, ctx: View2dCtx): SpectatorPose {
  const tile = screenTileOf(ctx);
  if (!(tile > 0) || !(ctx.mapCols > 0) || !(ctx.mapRows > 0)) return { ...pose };
  return {
    ...pose,
    x: band(finite(pose.x) - finite(dxPx) / tile, finite(ctx.viewW) / (2 * tile), ctx.mapCols),
    y: band(finite(pose.y) - finite(dyPx) / tile, finite(ctx.viewH) / (2 * tile), ctx.mapRows),
  };
}

/** The game's keyboard zoom step: stepKeyboard(1) zooms in ×1.3, −1 out (beta 4035 ZoomController; stepKeyboard is on
 * the live 1448 controller, the sign not yet confirmed live). E (up) zooms out. */
export function zoomStepFor(up: number): -1 | 0 | 1 {
  return up > 0 ? -1 : up < 0 ? 1 : 0;
}

export function flyToDurationMs(distanceTiles: number): number {
  const t = Math.min(1, Math.max(0, finite(distanceTiles)) / FLY_FULL_TILES);
  return FLY_MIN_MS + (FLY_MAX_MS - FLY_MIN_MS) * Math.sqrt(t);
}

// alt is a scale (2D tile size, 3D height), so equal steps of time give equal zoom ratios.
const blendAlt = (a: number, b: number, u: number): number => (a > 0 && b > 0 ? a * (b / a) ** u : lerp(a, b, u));

/** Duration from the ground distance; yaw turns the short way. A non-finite clock ends at the destination. */
export function createFlyTo(from: SpectatorPose, to: SpectatorPose, nowMs: number): FlyTo {
  const a = { ...from }, b = { ...to };
  const dur = flyToDurationMs(Math.hypot(b.x - a.x, b.y - a.y));
  return {
    at(now, dest) {
      const end = dest ?? b;
      const t = (now - nowMs) / dur;
      if (!(t < 1)) return { ...end };
      if (t <= 0) return { ...a };
      const u = easeInOut(t);
      const turn = wrapDeg(end.yaw - a.yaw);
      return { x: lerp(a.x, end.x, u), y: lerp(a.y, end.y, u), alt: blendAlt(a.alt, end.alt, u), yaw: wrapDeg(a.yaw + turn * u), pitch: lerp(a.pitch, end.pitch, u) };
    },
    done: (now) => !(now - nowMs < dur),
  };
}
