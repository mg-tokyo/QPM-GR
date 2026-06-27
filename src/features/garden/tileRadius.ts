// src/features/garden/tileRadius.ts
// Pure tile-geometry helpers for radius-based ability targeting.
// Mirrors the Chebyshev distance formula used by the game engine
// (beta source: world/map/utils.ts:275-276, nested for-loop over [-r, r] × [-r, r]).
//
// Used for abilities like Thundercharger that affect crops within `tileRadius` of
// the activating pet. `tileRadius: 1` → 9 tiles (center + 8 neighbors).

export interface TilePosition {
  x: number;
  y: number;
}

/**
 * Returns every tile coordinate within Chebyshev radius `r` of `center`:
 *   max(|dx|, |dy|) <= r
 *
 * For radius 1 this is the 8-neighbor + center grid (9 tiles total).
 * For radius 0 this is just the center (or empty if !includeSelf).
 *
 * Pure function — does not depend on garden state. Callers resolve coordinates
 * to crops/objects via their own lookup against `GardenSnapshot.tileObjects`.
 */
export function getTilesInChebyshevRadius(
  center: TilePosition,
  radius: number,
  includeSelf = true,
): TilePosition[] {
  if (radius < 0) return [];
  const tiles: TilePosition[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (!includeSelf && dx === 0 && dy === 0) continue;
      tiles.push({ x: center.x + dx, y: center.y + dy });
    }
  }
  return tiles;
}

/** Returns true if `b` is within Chebyshev radius `r` of `a`. */
export function isWithinChebyshevRadius(a: TilePosition, b: TilePosition, radius: number): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= radius;
}
