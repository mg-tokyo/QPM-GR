import { TILE } from '../constants';
import type { XY } from '../types';

const INSET = 40;

/** A picked billboard in 2D World space: `sprite` is the cursor's pixel on it, `foot` its own tile's sort line. */
export interface TapHit { building: boolean; sprite: XY; foot: XY }

const tileOf = (p: XY): XY => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });

// The game routes a tap by geometry claims at the 2D point, never by draw order (beta 3668 WorldTapRouter; live 1395
// resolveClaimAt). A non-building claim (the focused plant, a storage decor) exists only on the player's own tile, so a
// claimed pixel elsewhere belongs to something drawn over this one in 2D: the tap goes to an unclaimed point of its tile.
export function chooseTapPoint(h: TapHit, playerTile: XY | null, claimed: ((p: XY) => boolean) | null): XY {
  if (h.building) return h.sprite;
  if (!claimed) return h.foot;
  const t = tileOf(h.foot);
  // On your own tile a claimed foot is the plant's own body hit area, so the foot picks the plant.
  if (playerTile && t.x === playerTile.x && t.y === playerTile.y) return claimed(h.sprite) ? h.sprite : h.foot;
  if (!claimed(h.foot)) return h.foot;
  const x0 = t.x * TILE, y0 = t.y * TILE, x1 = x0 + TILE - INSET, y1 = y0 + TILE - INSET;
  const cands: XY[] = [
    { x: x0 + TILE / 2, y: y0 + TILE / 2 },
    { x: x0 + INSET, y: y0 + INSET }, { x: x1, y: y0 + INSET }, { x: x0 + INSET, y: y1 }, { x: x1, y: y1 },
  ];
  for (const c of cands) if (!claimed(c)) return c;
  return h.foot;
}
