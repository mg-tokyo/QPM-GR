import type { Point } from '../types';
import { bumpPosition } from '../debug/perfCounters';
import { bakeWaypoints, type PathPoint } from '../tracks/bake';
import { getClassicTrack } from '../tracks/builtins';
import type { TrackDef } from '../tracks/types';

export type { PathPoint } from '../tracks/bake';

const FALLBACK: Point = { x: 0, y: 0 };

function lengthOf(wps: readonly PathPoint[]): number {
  const last = wps[wps.length - 1];
  return last ? last.cumulativeDistance : 0;
}

// Only tracks/active.ts applyTrack() swaps these (together with state.trackId).
// Baked to classic at import so pre-tracks behaviour is unchanged.
let activeTrack: TrackDef = getClassicTrack();
let WAYPOINTS: readonly PathPoint[] = bakeWaypoints(activeTrack.corners);
let PATH_LENGTH = lengthOf(WAYPOINTS);

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

export function setActiveTrack(track: TrackDef): boolean {
  const baked = bakeWaypoints(track.corners);
  if (baked.length < 2) return false;
  activeTrack = track;
  WAYPOINTS = baked;
  PATH_LENGTH = lengthOf(baked);
  posCache.clear();
  return true;
}

export function getActiveTrack(): TrackDef {
  return activeTrack;
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

export function nearestPathPointInRange(from: Point, range: number): Point | null {
  if (PATH_LENGTH <= 0) return null;
  const rSq = range * range;
  let bestD = -1;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let d = 0; d <= PATH_LENGTH; d += 0.25) {
    const p = positionAt(d);
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const ds = dx * dx + dy * dy;
    if (ds < bestDistSq) { bestDistSq = ds; bestD = d; }
  }
  if (bestDistSq > rSq) return null;
  const lo = Math.max(0, bestD - 0.25);
  const hi = Math.min(PATH_LENGTH, bestD + 0.25);
  for (let d = lo; d <= hi; d += 0.05) {
    const p = positionAt(d);
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const ds = dx * dx + dy * dy;
    if (ds < bestDistSq) { bestDistSq = ds; bestD = d; }
  }
  return positionAt(bestD);
}

// Pick a uniform-random point along the path within `range` of `from`. Two
// passes: gather in-range distances at 0.5-tile resolution, then jitter the
// chosen distance by ±0.25 for finer coverage. Returns null if no path point
// is in range. Piles that always land at the same coord read as a stack, not
// spread — that's what nearestPathPointInRange did.
export function randomPathPointInRange(from: Point, range: number): Point | null {
  if (PATH_LENGTH <= 0) return null;
  const rSq = range * range;
  const candidates: number[] = [];
  for (let d = 0; d <= PATH_LENGTH; d += 0.5) {
    const p = positionAt(d);
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    if (dx * dx + dy * dy <= rSq) candidates.push(d);
  }
  if (candidates.length === 0) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  const base = candidates[idx] ?? 0;
  const jitter = (Math.random() - 0.5) * 0.5;
  const picked = Math.max(0, Math.min(PATH_LENGTH, base + jitter));
  return positionAt(picked);
}

export function farthestPathPointInRange(from: Point, range: number): Point | null {
  if (PATH_LENGTH <= 0) return null;
  const rSq = range * range;
  let bestD = -1;
  let bestDistSq = -1;
  for (let d = 0; d <= PATH_LENGTH; d += 0.25) {
    const p = positionAt(d);
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const ds = dx * dx + dy * dy;
    if (ds <= rSq && ds > bestDistSq) { bestDistSq = ds; bestD = d; }
  }
  if (bestD < 0) return null;
  const lo = Math.max(0, bestD - 0.25);
  const hi = Math.min(PATH_LENGTH, bestD + 0.25);
  for (let d = lo; d <= hi; d += 0.05) {
    const p = positionAt(d);
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const ds = dx * dx + dy * dy;
    if (ds <= rSq && ds > bestDistSq) { bestDistSq = ds; bestD = d; }
  }
  return positionAt(bestD);
}
