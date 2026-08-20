import type { Point } from '../types';

export interface PathPoint {
  readonly point: Point;
  readonly cumulativeDistance: number;
}

// One waypoint per tile with cumulative 0,1,2… — engine/path.ts positionAt
// relies on index === floor(distance). Non-axis-aligned segments are skipped
// (never stepped) so a bad corner list can't spin this loop forever; the
// validator rejects such lists before they reach here.
export function bakeWaypoints(corners: readonly Point[]): readonly PathPoint[] {
  const out: PathPoint[] = [];
  const first = corners[0];
  if (!first) return Object.freeze(out);
  let cumulative = 0;
  out.push({ point: first, cumulativeDistance: 0 });
  for (let i = 1; i < corners.length; i++) {
    const prev = corners[i - 1];
    const curr = corners[i];
    if (!prev || !curr) continue;
    const dx = Math.sign(curr.x - prev.x);
    const dy = Math.sign(curr.y - prev.y);
    if (dx !== 0 && dy !== 0) continue;
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
