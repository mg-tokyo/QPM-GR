import type { Point } from '../types';
import { PLOT_COLS, PLOT_ROWS } from '../constants';
import { bakeWaypoints } from './bake';
import { MIN_TRACK_TILES } from './types';

export type TrackValidationError =
  | 'too_few_corners'
  | 'out_of_bounds'
  | 'not_axis_aligned'
  | 'repeated_tile'
  | 'too_short'
  | 'entry_not_on_edge'
  | 'exit_not_on_edge';

export type ValidationResult =
  | { readonly ok: true; readonly lengthTiles: number }
  | { readonly ok: false; readonly error: TrackValidationError };

export function isOuterRing(tile: Point): boolean {
  return tile.x === 0 || tile.x === PLOT_COLS - 1 || tile.y === 0 || tile.y === PLOT_ROWS - 1;
}

export function isAdjacent4(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function isPlotTile(p: Point): boolean {
  return Number.isInteger(p.x) && Number.isInteger(p.y)
    && p.x >= 0 && p.x < PLOT_COLS && p.y >= 0 && p.y < PLOT_ROWS;
}

export function validateCorners(
  corners: readonly Point[],
  opts?: { readonly allowInteriorExit?: boolean },
): ValidationResult {
  if (corners.length < 2) return { ok: false, error: 'too_few_corners' };
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i];
    if (!c || !isPlotTile(c)) return { ok: false, error: 'out_of_bounds' };
    const prev = corners[i - 1];
    if (prev && ((prev.x !== c.x && prev.y !== c.y) || (prev.x === c.x && prev.y === c.y))) {
      return { ok: false, error: 'not_axis_aligned' };
    }
  }
  const baked = bakeWaypoints(corners);
  const seen = new Set<string>();
  for (const wp of baked) {
    const key = `${wp.point.x},${wp.point.y}`;
    if (seen.has(key)) return { ok: false, error: 'repeated_tile' };
    seen.add(key);
  }
  const first = baked[0];
  const last = baked[baked.length - 1];
  if (!first || !last) return { ok: false, error: 'too_few_corners' };
  const lengthTiles = last.cumulativeDistance;
  if (lengthTiles < MIN_TRACK_TILES) return { ok: false, error: 'too_short' };
  if (!isOuterRing(first.point)) return { ok: false, error: 'entry_not_on_edge' };
  if (!opts?.allowInteriorExit && !isOuterRing(last.point)) return { ok: false, error: 'exit_not_on_edge' };
  return { ok: true, lengthTiles };
}

// Collapses a 4-connected tile walk to its direction-change corners — the
// storage form for recorded tracks (P2) and the input bakeWaypoints expects.
export function compressToCorners(tiles: readonly Point[]): Point[] {
  const out: Point[] = [];
  const first = tiles[0];
  if (!first) return out;
  out.push(first);
  for (let i = 1; i < tiles.length - 1; i++) {
    const a = tiles[i - 1];
    const b = tiles[i];
    const c = tiles[i + 1];
    if (!a || !b || !c) continue;
    const dir1 = `${Math.sign(b.x - a.x)},${Math.sign(b.y - a.y)}`;
    const dir2 = `${Math.sign(c.x - b.x)},${Math.sign(c.y - b.y)}`;
    if (dir1 !== dir2) out.push(b);
  }
  const last = tiles[tiles.length - 1];
  if (last && tiles.length > 1) out.push(last);
  return out;
}
