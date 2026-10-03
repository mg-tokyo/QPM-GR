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

export function sortYOf(gameZ: number, ownY: number): number {
  return gameZ >= SORT_Z_SCALE ? Math.floor(gameZ) / SORT_Z_SCALE : ownY;
}

export function tiebreakOf(gameZ: number): number {
  return gameZ >= SORT_Z_SCALE ? gameZ - Math.floor(gameZ) : 0;
}

export function quantizeYaw(yaw: number, stepRad: number): number {
  return stepRad > 0 ? Math.round(yaw / stepRad) * stepRad : yaw;
}

/** At yaw 0 (dx 0, dz −1) this is exactly the game's zIndex. */
export function depthKey(gx: number, gy: number, dx: number, dz: number, tiebreak: number): number {
  return -(gx * dx + gy * dz) * SORT_Z_SCALE + tiebreak;
}

/** D6 blend: the foot straight down (exact s = 0), the sort line at ≤ 60° pitch. Buildings, and tiles on their centre. */
export function standLine(footY: number, sortY: number, pitch: number): number {
  if (!(sortY < footY)) return footY;
  const t = Math.cos(pitch);
  return footY + (sortY - footY) * Math.min(1, t * t * 4);
}

export function stickyQuantize(prev: number | undefined, v: number, step = 32): number {
  if (prev !== undefined && Math.abs(v - prev) < step) return prev;
  return Math.round(v / step) * step;
}
