import { TILE } from '../constants';
import type { DriftVerdict } from '../types';

// The game's World zIndex is its sort y (ground y, px) × 1e4 plus a tiebreak fraction (live 2026-10-02:
// Tile, Pet, FieldDesk, TramRoot, buildings Δ 0; AvatarContainer Δ +192…232 = its ground point).
export const SORT_Z_SCALE = 1e4;
// Below every entity key: |key| ≤ (map width + height in px) × 1e4 ≈ 4.2e8.
export const DECAL_Z = -1e12;
// Flat World content keeps the 2D order (each band + a ground y < 1e6): ground decor cards straight down (2D draws
// that tile art in Ground), AboveGround layer markers, the weather scrim (the layer's top, z 30), building decals.
const BAND = 1e6;
export const GROUND_DECOR_Z = DECAL_Z - BAND;
export const MARKER_Z = DECAL_Z;
// The AboveGround layer's own slot while it keeps tile-radius area marks (areaMarks.ts): after the markers, under the
// scrim, as the game's ground bands (groundMark 10 < weatherScrim 30).
export const AREA_MARK_Z = DECAL_Z + 0.5 * BAND;
export const SCRIM_Z = DECAL_Z + BAND;
export const BUILDING_DECAL_Z = DECAL_Z + 2 * BAND;

// An airborne rider and its mount (Phoenix) sort in the game's foremost band, over every World entity in 2D: zIndex =
// 9e11 + the usual key, under the world overlay at 1e12 (beta 3651 worldDepthSortKey.ts:15; live 2026-10-04 900062720006).
export const FOREMOST_Z = 9e11;
const WORLD_OVERLAY_Z = 1e12;

export const bandOf = (gameZ: number): number => (gameZ >= FOREMOST_Z && gameZ < WORLD_OVERLAY_Z ? FOREMOST_Z : 0);

export function sortYOf(gameZ: number, ownY: number): number {
  const z = gameZ - bandOf(gameZ);
  return z >= SORT_Z_SCALE ? Math.floor(z) / SORT_Z_SCALE : ownY;
}

// WorldDepthLayer, the last digit of a zIndex whose ground row is a whole pixel (avatars and a ridden pet stand on the
// tile centre; beta 3651 worldDepthSortKey.ts:25-50). Ground decor (benches, rocks, bridges) is Base, under the avatar
// on its own tile (tileObjectDepthRules.ts). A riding avatar sorts on Rider, its mount on Pet.
export const BASE_LAYER = 1;
export const RIDER_LAYER = 6;
export const PET_LAYER = 7;
export const layerOf = (sortY: number): number => Math.round(sortY * SORT_Z_SCALE) % 10;

export interface DepthKeyCheck { samples: number; ok: number; verdict: DriftVerdict }
const DEPTH_MIN_SAMPLES = 20;
const DEPTH_MIN_OK = 0.8;

/** The zIndex encoding still holds: World children off the origin (building containers sit at (0, 0)) sort within a
 * tile of their own y (live 1419: all 1,239; tiles Δ 0, avatars +192). A new scale or encoding fails nearly all. */
export function checkDepthKeys(nodes: readonly { x: number; y: number; zIndex: number }[]): DepthKeyCheck {
  let samples = 0, ok = 0;
  for (const n of nodes) {
    if ((n.x === 0 && n.y === 0) || !(n.zIndex < WORLD_OVERLAY_Z)) continue;
    samples++;
    const z = n.zIndex - bandOf(n.zIndex);
    if (z >= SORT_Z_SCALE && Math.abs(Math.floor(z) / SORT_Z_SCALE - n.y) <= TILE) ok++;
  }
  const verdict: DriftVerdict = samples < DEPTH_MIN_SAMPLES ? 'unknown' : ok >= DEPTH_MIN_OK * samples ? 'ok' : 'drift';
  return { samples, ok, verdict };
}

export function tiebreakOf(gameZ: number): number {
  return gameZ >= SORT_Z_SCALE ? gameZ - Math.floor(gameZ) : 0;
}

/** Tilted ties (same quantized depth): the game's layer, then its body-bottom fraction, as in 2D. Always < 1, so it
 * never crosses a depth step. A small literal zIndex (overlay, marker) has no layer: its sort y is its own moving y. */
export const tiltedTiebreak = (gameZ: number, sortY: number): number =>
  (gameZ >= SORT_Z_SCALE ? (layerOf(sortY) + tiebreakOf(gameZ)) / 10 : 0);

export function quantizeYaw(yaw: number, stepRad: number): number {
  return stepRad > 0 ? Math.round(yaw / stepRad) * stepRad : yaw;
}

/** `along`: the ground point projected on the view axis, gx·dx + gy·dz. */
export const depthKeyAlong = (along: number, tiebreak: number): number => -along * SORT_Z_SCALE + tiebreak;

/** At yaw 0 (dx 0, dz −1) this is exactly the game's zIndex. */
export function depthKey(gx: number, gy: number, dx: number, dz: number, tiebreak: number): number {
  return depthKeyAlong(gx * dx + gy * dz, tiebreak);
}

/** D6 blend: the foot straight down (exact s = 0), the sort line at ≤ 60° pitch. Buildings, and tiles on their centre. */
export function standLine(footY: number, sortY: number, pitch: number): number {
  if (!(sortY < footY)) return footY;
  const t = Math.cos(pitch);
  return footY + (sortY - footY) * Math.min(1, t * t * 4);
}

// Stateless (the spec's 50 % band): things on the same spot share a step whatever their history; a per-node hold put an
// avatar resting on a bench one step in front of or behind it depending on how it walked in (live 2026-10-05).
export const quantizeAlong = (v: number, step = 32): number => Math.round(v / step) * step;

/** The ground line from P (feet) to C (camera) crosses the wall from (x0, wy) to (x1, wy): a building's front on its sort
 * line. A building is a wall one tile deep (its collision row), so this, not its card's centre, says whether it hides P. */
export function wallBetween(px: number, py: number, cx: number, cy: number, x0: number, x1: number, wy: number): boolean {
  if ((py - wy) * (cy - wy) >= 0) return false;
  const x = px + ((cx - px) * (wy - py)) / (cy - py);
  return x >= x0 && x <= x1;
}

// Far above double precision at |key| ≈ 1e9.
const SHIFT_EPS = 1e-3;

/** Key offset for a building card (keys zMin…zMax) that covers the avatar on screen: over the avatar's whole depth step
 * when its wall stands between them and the camera, else under it; 0 when the order already agrees. The whole step: its
 * mount and a pet beside it share the step at a higher layer (a quantized step is an integer key, layers the fraction). */
export function buildingShift(zMin: number, zMax: number, avatarKey: number, behind: boolean): number {
  const step = Math.floor(avatarKey);
  if (behind) return zMin < step + 1 ? step + 1 - zMin : 0;
  return zMax > step - SHIFT_EPS ? step - SHIFT_EPS - zMax : 0;
}
