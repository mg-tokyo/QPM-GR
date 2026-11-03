import { rayDir, type Basis } from '../math/camera';
import type { DrawnSideWall } from '../scene/sideDecor';
import type { Node3, XY } from '../types';
import type { Texel } from './alphaProbe';

/** Turned walls take taps once they are the more visible half of the card crossfade (wall alpha t, card 1 − t). */
export const WALL_PICK_TILT = 0.5;

/** u along A→B and v from the wall top (its panel's uv); sprite: the same height above ground on the 2D card at `foot`. */
export interface WallHit { u: number; v: number; depth: number; sprite: XY }

/** The walls under screen (sx, sy), each hit on its tile view at posOf (its 2D position), and the cards those drawn walls
 * replace (skipped, so a nearly faded card never takes a tap the wall's art, or its arch opening, should decide). */
export function sideWallHits(
  b: Basis, tilt: number, sx: number, sy: number, walls: readonly DrawnSideWall[], posOf: (n: Node3) => XY,
): { hits: Array<WallHit & { wall: DrawnSideWall }>; cards: Set<Node3> } {
  const hits: Array<WallHit & { wall: DrawnSideWall }> = [], cards = new Set<Node3>();
  if (tilt < WALL_PICK_TILT) return { hits, cards };
  for (const w of walls) {
    cards.add(w.node);
    const h = wallHitAt(b, sx, sy, w, posOf(w.node));
    if (h) hits.push({ ...h, wall: w });
  }
  return { hits, cards };
}

/** Where the ray through screen (sx, sy) crosses the wall's upright quad, or null. `foot`: its tile view's 2D position. */
export function wallHitAt(b: Basis, sx: number, sy: number, w: DrawnSideWall, foot: XY): WallHit | null {
  const d = rayDir(b, sx, sy), C = b.C;
  const ex = w.bx - w.ax, ez = w.bz - w.az, len2 = ex * ex + ez * ez;
  const den = d[0] * ez - d[2] * ex;
  if (!(len2 > 0) || !(w.h > 0) || Math.abs(den) < 1e-9) return null;
  const t = -((C[0] - w.ax) * ez - (C[2] - w.az) * ex) / den;
  if (!(t > 0)) return null;
  const px = C[0] + t * d[0], pz = C[2] + t * d[2], y = C[1] + t * d[1];
  const u = ((px - w.ax) * ex + (pz - w.az) * ez) / len2;
  if (!(u >= 0 && u < 1 && y > 0 && y <= w.h)) return null;
  return { u, v: 1 - y / w.h, depth: t * b.fpx, sprite: { x: foot.x, y: foot.y - y } };
}

/** The atlas pixel under panel (u, v), through the texture's uvs as picking.ts texelAt reads a card leaf. */
export function panelTexel(tex: DrawnSideWall['tex'], u: number, v: number, out: Texel): boolean {
  const U = tex.uvs, sw = tex.source.width, sh = tex.source.height;
  if (!U || !sw || !sh) return false;
  const sx = (U.x0 + u * (U.x1 - U.x0) + v * (U.x3 - U.x0)) * sw, sy = (U.y0 + u * (U.y1 - U.y0) + v * (U.y3 - U.y0)) * sh;
  out.source = tex.source;
  out.x = Math.min(sw - 1, Math.max(0, Math.floor(sx)));
  out.y = Math.min(sh - 1, Math.max(0, Math.floor(sy)));
  return true;
}
