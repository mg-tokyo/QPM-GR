import { BUILDING_DECAL_Z, SORT_Z_SCALE, standLine } from '../math/depth';
import type { FrameCtx } from '../frame/frame';
import type { Caps, MovementMapLike, Node3, TexLike } from '../types';
import { holdThroughOnRender, newPlacement, type BuildingPlacer, type Placement } from './entities';
import { placeFlat } from './flat';

export { standLine };

export type PartFade = (ctx: FrameCtx, part: Node3, key: number, groundX: number, groundY: number) => void;

const TILE = 256;

/** No collision between the sort line and the art bottom: that art is the floor of a walk-in structure (the gazebo
 * and the weather stalls that replace it; every shop, station and the well collide there, live 2026-10-03). */
export function isWalkIn(map: MovementMapLike, x0: number, x1: number, sortY: number, footY: number): boolean {
  const c0 = Math.max(0, Math.floor(x0 / TILE)), c1 = Math.min(map.cols - 1, Math.floor((x1 - 1) / TILE));
  const r0 = Math.max(0, Math.floor(sortY / TILE)), r1 = Math.min(map.rows - 1, Math.floor((footY - 1) / TILE));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (map.collisionTiles.has(r * map.cols + c)) return false;
  return true;
}

interface Box { x: number; y: number; width: number; height: number }
type ClipTex = TexLike & { trim?: Box | null; rotate?: number; label?: string; update(): void };
interface Clip { game: ClipTex; own: ClipTex; trim: Box; rows: number }
export interface Clipper { clip(p: Node3, groundY: number): boolean; drop(): void }

// The game sizes building sprites by width/height, so PIXI rescales them on a texture swap from orig: the clone keeps
// the game's orig and only trims the drawn rows, and the scale is re-set after every swap anyway. Kept while 3D is
// live (no game read or write of a building texture in 15 s of play, live 2026-10-03), so hover picking sees the clip.
export function createClipper(caps: Caps): Clipper {
  const clips = new Map<Node3, Clip>();
  const swap = (p: Node3, t: ClipTex): void => {
    if (p.destroyed || p.texture === t) return;
    const sx = p.scale.x, sy = p.scale.y;
    p.texture = t;
    p.scale.set(sx, sy);
  };
  return {
    /** Hides the art rows below 2D y groundY; at or past the art bottom the game texture is back. False: this art
     * can't be clipped (a rotated frame), so it must not be sunk either. */
    clip(p, groundY) {
      let c = clips.get(p);
      const cur = p.texture as ClipTex | null | undefined;
      if (c && cur !== c.own && cur !== c.game) { c.own.destroy(false); clips.delete(p); c = undefined; }
      const game = c ? c.game : cur;
      if (!game || !p.anchor || game.rotate || !(p.scale.y > 0)) { if (c) swap(p, c.game); return false; }
      const tr = game.trim ?? { x: 0, y: 0, width: game.frame.width, height: game.frame.height };
      const top = p.y - p.anchor.y * game.orig.height * p.scale.y;
      const rows = Math.max(1, Math.round((groundY - top) / p.scale.y - tr.y));
      if (rows >= tr.height) { if (c) swap(p, c.game); return true; }
      if (!c) {
        const R = caps.classes.Rectangle;
        const trim = new R(tr.x, tr.y, tr.width, rows);
        const own = new caps.classes.Texture({ source: game.source, label: game.label, frame: new R(game.frame.x, game.frame.y, game.frame.width, rows), orig: game.orig, trim, dynamic: true }) as ClipTex;
        c = { game, own, trim, rows };
        clips.set(p, c);
      } else if (c.rows !== rows) {
        c.own.frame.height = rows;
        c.trim.height = rows;
        c.rows = rows;
        c.own.update();
      }
      swap(p, c.own);
      return true;
    },
    drop() {
      for (const [p, c] of clips) { swap(p, c.game); c.own.destroy(false); }
      clips.clear();
    },
  };
}

interface Anchor extends Placement { x0: number; x1: number }
interface Rect { x0: number; x1: number; top: number; cx: number; cy: number }

function pieceRect(p: Node3): Rect | null {
  if (!p.texture || !p.anchor) return null;
  const w = p.texture.orig.width * p.scale.x, h = p.texture.orig.height * p.scale.y;
  const x0 = p.x - p.anchor.x * w, top = p.y - p.anchor.y * h;
  return { x0: Math.min(x0, x0 + w), x1: Math.max(x0, x0 + w), top, cx: x0 + w / 2, cy: top + h / 2 };
}
const parts = (c: Node3): Node3[] => c.children.filter((p) => !!p.texture && !!p.anchor);
// A piece whose sort y is its own top edge is a floor decal (the weather-shop rugs).
const isDecal = (c: Node3, gz: number): boolean => {
  const ps = parts(c);
  return ps.length > 0 && ps.every((p) => { const r = pieceRect(p); return !!r && Math.abs(gz / SORT_Z_SCALE - r.top) < 1; });
};

export function createBuildingPlacer(fade: PartFade | null): BuildingPlacer {
  const anchors = new Map<number, Anchor[]>();
  const bases = new Set<number>();
  let clipper: Clipper | null = null;
  const walkIns = new Map<Node3, boolean>();
  const walkIn = (ctx: FrameCtx, ch: Node3, rc: Rect, sortY: number): boolean => {
    let w = walkIns.get(ch);
    if (w === undefined) { w = isWalkIn(ctx.caps.systems.map, rc.x0, rc.x1, sortY, ch.y); walkIns.set(ch, w); }
    return w;
  };

  return {
    place(ctx, blds, place) {
      anchors.clear();
      bases.clear();
      const later: Node3[] = [];
      for (const c of blds) {
        const gz = ctx.ov.gameValue<number>('zIndex', c);
        const base = Math.floor(gz);
        const sortY = base / SORT_Z_SCALE;
        if (isDecal(c, gz)) {
          for (const p of parts(c)) { const r = pieceRect(p); if (r) placeFlat(ctx, p, r.cx, r.cy); }
          ctx.ov.put('zIndex', c, BUILDING_DECAL_Z + sortY);
          continue;
        }
        if (gz !== base) { later.push(c); continue; }
        bases.add(base);
        let zMax = -Infinity;
        for (const ch of c.children) {
          const rc = pieceRect(ch);
          const lp = newPlacement();
          // Depth always from the sort line (D6): a player on the shop mat stays in front of the card at s = 0.
          const depthY = sortY < ch.y ? sortY : ch.y;
          const standY = standLine(ch.y, sortY, ctx.params.pitch);
          // One card can't stand the gazebo's front and side pillars on the ground at once: a walk-in structure sinks
          // to its stand line and the art below it is hidden (user 2026-10-03: "clipped into the ground").
          const sink = !!rc && sortY < ch.y && walkIn(ctx, ch, rc, sortY) && (clipper ??= createClipper(ctx.caps)).clip(ch, standY);
          const z = place(ctx, ch, { isTile: false, standY, artY: standY, depthY, tiebreak: 0, artRow: sink }, lp);
          if (z === null) continue;
          if (z > zMax) zMax = z;
          if (rc) {
            let l = anchors.get(base);
            if (!l) { l = []; anchors.set(base, l); }
            l.push({ ...lp, x0: rc.x0, x1: rc.x1 });
          }
          fade?.(ctx, ch, z, lp.fx, depthY);
        }
        if (zMax > -Infinity) ctx.ov.put('zIndex', c, zMax);
        else ctx.ov.drop('zIndex', c);
      }
      // A fractional zIndex attaches a piece (roof, flag) to the piece with the same integer key: keep its 2D offset
      // from that base, scaled with it, so the composite stays one card.
      for (const c of later) {
        const gz = ctx.ov.gameValue<number>('zIndex', c);
        const base = Math.floor(gz);
        let zMax = -Infinity;
        for (const q of c.children) {
          const rc = pieceRect(q);
          const A = rc ? (anchors.get(base) ?? []).find((a) => a.x1 > rc.x0 && a.x0 < rc.x1) : undefined;
          if (!A) {
            if (rc && bases.has(base)) { ctx.ov.put('visible', q, false); continue; }
            const lp = newPlacement();
            const z = place(ctx, q, { isTile: false, standY: q.y, depthY: q.y, tiebreak: 0, artRow: false }, lp);
            if (z !== null && z > zMax) zMax = z;
            continue;
          }
          ctx.ov.drop('visible', q);
          if (!ctx.ov.raw<boolean>('visible', q)) continue;
          const osx = q.scale.x, osy = q.scale.y;
          const px = A.sx + (q.x - A.fx) * A.mm, py = A.sy + (q.y - A.fy2d) * A.mm;
          ctx.drawn.push(q, q.x, q.y, osx, osy, px, py, A.mm);
          q.position.set(px, py);
          q.scale.set(osx * A.mm, osy * A.mm);
          holdThroughOnRender(ctx, q, px, py, osx * A.mm, osy * A.mm);
          const key = A.key + (gz - base);
          zMax = Math.max(zMax, key);
          fade?.(ctx, q, key, A.fx, A.fy2d);
        }
        if (zMax > -Infinity) ctx.ov.put('zIndex', c, zMax);
        else ctx.ov.drop('zIndex', c);
      }
    },
    drop() { anchors.clear(); bases.clear(); clipper?.drop(); walkIns.clear(); },
  };
}
