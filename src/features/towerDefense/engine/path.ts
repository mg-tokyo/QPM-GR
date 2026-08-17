import type { Point } from '../types';
import { bumpPosition } from '../debug/perfCounters';

export interface PathPoint {
  readonly point: Point;
  readonly cumulativeDistance: number;
}

// S-curve across both dirt plots on a 23×12 layout. Enters upper-left
// boardwalk (0,2), exits upper-right (22,2). Length 70 tiles; crosses the
// col-11 boardwalk gap only at row 8. Leaves ~133 dirt tiles free for tower
// placement. Path Y band [2, 8] stays clear of both boardwalk rows (0 and 11).
const CORNERS: readonly Point[] = [
  { x:  0, y:  2 },
  { x: 10, y:  2 },
  { x: 10, y:  5 },
  { x:  1, y:  5 },
  { x:  1, y:  8 },
  { x: 21, y:  8 },
  { x: 21, y:  5 },
  { x: 12, y:  5 },
  { x: 12, y:  2 },
  { x: 22, y:  2 },
];

function buildWaypoints(): readonly PathPoint[] {
  const out: PathPoint[] = [];
  const first = CORNERS[0];
  if (!first) return Object.freeze(out);
  let cumulative = 0;
  out.push({ point: first, cumulativeDistance: 0 });
  for (let i = 1; i < CORNERS.length; i++) {
    const prev = CORNERS[i - 1];
    const curr = CORNERS[i];
    if (!prev || !curr) continue;
    const dx = Math.sign(curr.x - prev.x);
    const dy = Math.sign(curr.y - prev.y);
    let cx = prev.x;
    let cy = prev.y;
    while (cx !== curr.x || cy !== curr.y) {
      cx += dx;
      cy += dy;
      cumulative += 1;
      out.push({ point: { x: cx, y: cy }, cumulativeDistance: cumulative });
    }
  }
  return Object.freeze(out);
}

const WAYPOINTS = buildWaypoints();
const LAST_WAYPOINT = WAYPOINTS[WAYPOINTS.length - 1];
const PATH_LENGTH = LAST_WAYPOINT ? LAST_WAYPOINT.cumulativeDistance : 0;
const FALLBACK: Point = { x: 0, y: 0 };

// Per-tick memoization: positionAt is called ~200K times/sec at R20+ with the
// same distance values repeated many times (once per balloon per tower per
// targeting call, once per balloon per projectile collision, etc.). Return
// the same object for the same distance until the cache is cleared. The sim
// loop clears at the top of each simTick, so cached objects reflect current
// balloon distances since distances only advance in advanceBalloons.
// Callers MUST treat returned Points as immutable.
const posCache = new Map<number, Point>();
export function resetPositionCache(): void {
  posCache.clear();
}

export function getPath(): readonly PathPoint[] {
  return WAYPOINTS;
}

export function getPathLength(): number {
  return PATH_LENGTH;
}

export function positionAt(distance: number): Point {
  const cached = posCache.get(distance);
  if (cached) return cached;
  bumpPosition();
  if (WAYPOINTS.length === 0) return FALLBACK;
  const d = Math.max(0, Math.min(distance, PATH_LENGTH));
  const first = WAYPOINTS[0];
  const last = WAYPOINTS[WAYPOINTS.length - 1];
  if (!first || !last) return FALLBACK;
  if (d <= 0) { posCache.set(distance, first.point); return first.point; }
  if (d >= PATH_LENGTH) { posCache.set(distance, last.point); return last.point; }
  // Waypoints are baked one-per-tile with cumulative = 0,1,2,...; index equals floor(d).
  const idx = Math.floor(d);
  const a = WAYPOINTS[idx];
  const b = WAYPOINTS[idx + 1] ?? a;
  if (!a || !b) return FALLBACK;
  const t = d - idx;
  const result: Point = { x: a.point.x + (b.point.x - a.point.x) * t, y: a.point.y + (b.point.y - a.point.y) * t };
  posCache.set(distance, result);
  return result;
}

export function isOnPath(tile: Point, thresholdTiles = 0.5): boolean {
  for (const wp of WAYPOINTS) {
    const dx = wp.point.x - tile.x;
    const dy = wp.point.y - tile.y;
    if (Math.hypot(dx, dy) <= thresholdTiles) return true;
  }
  return false;
}

export function getEntryPoint(): Point {
  const first = WAYPOINTS[0];
  return first ? first.point : FALLBACK;
}

export function getExitPoint(): Point {
  const last = WAYPOINTS[WAYPOINTS.length - 1];
  return last ? last.point : FALLBACK;
}
