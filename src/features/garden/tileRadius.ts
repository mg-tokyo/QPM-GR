// Mirrors the Chebyshev distance formula used by the game engine
// (beta source: world/map/utils.ts:275-276).
// Used for abilities like Thundercharger with a `tileRadius` (radius 1 → 9 tiles).

export interface TilePosition {
  x: number;
  y: number;
}

/** Every tile with max(|dx|, |dy|) <= radius of center (radius 1 = 8-neighbor + center). */
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
