import { PLOT_COLS, PLOT_ROWS } from '../constants';
import { bakeWaypoints } from '../tracks/bake';
import { resolveTrack } from '../tracks/registry';
import { TOWER_MAP_COLORS } from '../data/towerMapColors';
import type { Point, Tower } from '../types';
import type { SaveEntry } from './types';

// Canvas-2D palette (not CSS) — the token rule covers stylesheets; the minimap
// must read on any theme, so it carries its own colours like the PIXI renderers.
const GROUND = '#5b4632';
const BOARDWALK = '#8c7452';
const PATH = 'rgba(255, 255, 255, 0.30)';
const TOWER_OUTLINE = 'rgba(0, 0, 0, 0.55)';
const ENTRY_FILL = '#38d97e';
const EXIT_FILL = '#ff5a5a';
const ARROW_OUTLINE = 'rgba(0, 0, 0, 0.65)';
// Boardwalk bands per constants.ts:7-9 (perimeter + the col-11 gap).
const BOARDWALK_COLS: ReadonlySet<number> = new Set([0, 11, PLOT_COLS - 1]);
const BOARDWALK_ROWS: ReadonlySet<number> = new Set([0, PLOT_ROWS - 1]);

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  size: number,
  fill: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.7);
  ctx.lineTo(-size * 0.3, 0);
  ctx.lineTo(-size * 0.7, size * 0.7);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.strokeStyle = ARROW_OUTLINE;
  ctx.stroke();
  ctx.restore();
}

function drawEndpointArrows(
  ctx: CanvasRenderingContext2D,
  waypoints: readonly { readonly point: { readonly x: number; readonly y: number } }[],
  tile: number,
): void {
  const len = waypoints.length;
  if (len < 2) return;
  const first = waypoints[0]!;
  const second = waypoints[1]!;
  const last = waypoints[len - 1]!;
  const prevLast = waypoints[len - 2]!;
  const size = tile * 0.85;
  const entryAngle = Math.atan2(second.point.y - first.point.y, second.point.x - first.point.x);
  const exitAngle = Math.atan2(last.point.y - prevLast.point.y, last.point.x - prevLast.point.x);
  drawArrow(ctx, (first.point.x + 0.5) * tile, (first.point.y + 0.5) * tile, entryAngle, size, ENTRY_FILL);
  drawArrow(ctx, (last.point.x + 0.5) * tile, (last.point.y + 0.5) * tile, exitAngle, size, EXIT_FILL);
}

export interface BoardThumbnailOptions {
  readonly corners: readonly Point[];
  readonly towers: readonly Tower[];
  readonly width: number;
}

// Draws the 23×12 board with the given track and one square per tower.
// Regenerated on demand — nothing image-like is stored anywhere.
export function renderBoardThumbnail(opts: BoardThumbnailOptions): HTMLCanvasElement | null {
  const tile = opts.width / PLOT_COLS;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(opts.width);
  canvas.height = Math.round(tile * PLOT_ROWS);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = BOARDWALK;
  for (const c of BOARDWALK_COLS) ctx.fillRect(c * tile, 0, tile, canvas.height);
  for (const r of BOARDWALK_ROWS) ctx.fillRect(0, r * tile, canvas.width, tile);

  const waypoints = bakeWaypoints(opts.corners);
  ctx.fillStyle = PATH;
  for (const wp of waypoints) {
    ctx.fillRect(wp.point.x * tile, wp.point.y * tile, tile, tile);
  }

  drawEndpointArrows(ctx, waypoints, tile);

  const inset = tile * 0.15;
  const size = tile - inset * 2;
  ctx.lineWidth = 1;
  for (const t of opts.towers) {
    const x = t.tile.x * tile + inset;
    const y = t.tile.y * tile + inset;
    ctx.fillStyle = TOWER_MAP_COLORS[t.kind];
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = TOWER_OUTLINE;
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
  }
  return canvas;
}

export function renderSaveThumbnail(entry: SaveEntry, width: number): HTMLCanvasElement | null {
  return renderBoardThumbnail({
    corners: resolveTrack(entry).corners,
    towers: entry.snapshot.towers,
    width,
  });
}
