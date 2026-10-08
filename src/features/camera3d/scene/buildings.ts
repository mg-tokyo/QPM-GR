import { TILE } from '../constants';
import { BUILDING_DECAL_Z, SORT_Z_SCALE, buildingShift, standLine, wallBetween } from '../math/depth';
import type { FrameCtx } from '../frame/frame';
import type { Caps, MovementMapLike, Node3, TexLike } from '../types';
import { holdThroughOnRender, newPlacement, type BuildingPlacer, type PlaceFn, type PlaceOpts, type Placement } from './entities';
import { spriteScreenRect, type ScreenRect } from './fades';
import { createFlatPlacer, type FlatPlacer } from './flat';

export { standLine };

export type PartFade = (ctx: FrameCtx, part: Node3, key: number, groundX: number, groundY: number) => void;

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
    // Only a piece still showing our clone gets its texture back: one the game set since is newer.
    drop() {
      for (const [p, c] of clips) { if (p.texture === c.own) swap(p, c.game); c.own.destroy(false); }
      clips.clear();
    },
  };
}

interface Anchor extends Placement { x0: number; x1: number }
interface Rect { x0: number; x1: number; top: number; cx: number; cy: number }
const newRect = (): Rect => ({ x0: 0, x1: 0, top: 0, cx: 0, cy: 0 });

/** Into `out`; null for a piece without a texture and anchor. */
function pieceRect(p: Node3, out: Rect): Rect | null {
  if (!p.texture || !p.anchor) return null;
  const w = p.texture.orig.width * p.scale.x, h = p.texture.orig.height * p.scale.y;
  const x0 = p.x - p.anchor.x * w, top = p.y - p.anchor.y * h;
  out.x0 = Math.min(x0, x0 + w); out.x1 = Math.max(x0, x0 + w); out.top = top; out.cx = x0 + w / 2; out.cy = top + h / 2;
  return out;
}
const decalRect = newRect();
// A piece whose sort y is its own top edge is a floor decal (the weather-shop rugs).
function isDecal(c: Node3, gz: number): boolean {
  let n = 0;
  for (const p of c.children) {
    if (!p.texture || !p.anchor) continue;
    const r = pieceRect(p, decalRect);
    if (!r || Math.abs(gz / SORT_Z_SCALE - r.top) >= 1) return false;
    n++;
  }
  return n > 0;
}

const scratch: ScreenRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
const canCover = (ctx: FrameCtx): boolean => !ctx.exactKeys && !!ctx.avatarUpper && ctx.avatarKey !== null && !!ctx.avatarGround;
const inRect = (ctx: FrameCtx, r: ScreenRect | null): boolean => {
  const u = ctx.avatarUpper!;
  return !!r && u.x >= r.x0 && u.x <= r.x1 && u.y >= r.y0 && u.y <= r.y1;
};
/** A roof piece's screen rect where the later pass will draw it (anchor position, scaled with its base). */
function roofRect(q: Node3, A: Anchor): ScreenRect | null {
  if (!q.texture || !q.anchor) return null;
  const w = q.texture.orig.width * q.scale.x * A.mm, h = q.texture.orig.height * q.scale.y * A.mm;
  const x0 = A.sx + (q.x - A.fx) * A.mm - q.anchor.x * w, y0 = A.sy + (q.y - A.fy2d) * A.mm - q.anchor.y * h;
  scratch.x0 = Math.min(x0, x0 + w); scratch.y0 = Math.min(y0, y0 + h); scratch.x1 = Math.max(x0, x0 + w); scratch.y1 = Math.max(y0, y0 + h);
  return scratch;
}
const overlaps = (a: Anchor, rc: Rect): boolean => a.x1 > rc.x0 && a.x0 < rc.x1;
function anchorOver(list: readonly Anchor[] | undefined, rc: Rect): Anchor | null {
  if (list) for (const a of list) if (overlaps(a, rc)) return a;
  return null;
}
function avatarShift(ctx: FrameCtx, zMin: number, zMax: number, x0: number, x1: number, wallY: number): number {
  const g = ctx.avatarGround!, C = ctx.basis.C;
  return buildingShift(zMin, zMax, ctx.avatarKey!, wallBetween(g.x, g.y, C[0], C[2], x0, x1, wallY));
}

export function createBuildingPlacer(fade: PartFade | null, flat: FlatPlacer = createFlatPlacer(null)): BuildingPlacer {
  // Per base zIndex: the anchors its pieces drew at this frame. Lists and records are reused (A PF4); an empty list
  // reads as no anchors.
  const anchors = new Map<number, Anchor[]>();
  const bases = new Set<number>();
  const baseCs: Node3[] = [], later: Node3[] = [];
  // One building's drawn pieces, reused every frame.
  const shownCh: Node3[] = [], shownLp: Placement[] = [], shownDepth: number[] = [];
  const lpPool: Placement[] = [], anPool: Anchor[] = [];
  let lpN = 0, anN = 0;
  const nextLp = (): Placement => (lpPool[lpN++] ??= newPlacement());
  const nextAnchor = (lp: Placement, x0: number, x1: number): Anchor => {
    const a = (anPool[anN++] ??= { ...newPlacement(), x0: 0, x1: 0 });
    a.sx = lp.sx; a.sy = lp.sy; a.px = lp.px; a.mm = lp.mm; a.fx = lp.fx; a.x2d = lp.x2d; a.fy2d = lp.fy2d; a.key = lp.key; a.gdy = lp.gdy;
    a.x0 = x0; a.x1 = x1;
    return a;
  };
  const po: PlaceOpts = { isTile: false, standY: 0, artY: 0, depthY: 0, tiebreak: 0, artRow: false };
  const rcA = newRect(), rcB = newRect();

  // A roof (a fractional zIndex on this base) can cover the avatar where the card under it does not.
  function roofCovers(ctx: FrameCtx, base: number, list: Anchor[], from: number): boolean {
    for (const r of later) {
      if (Math.floor(ctx.ov.gameValue<number>('zIndex', r)) !== base) continue;
      for (const q of r.children) {
        const rc = pieceRect(q, rcB);
        if (!rc) continue;
        for (let i = from; i < list.length; i++) if (overlaps(list[i]!, rc)) { if (inRect(ctx, roofRect(q, list[i]!))) return true; break; }
      }
    }
    return false;
  }
  let clipper: Clipper | null = null;
  let walkIns = new WeakMap<Node3, boolean>();
  const walkIn = (ctx: FrameCtx, ch: Node3, rc: Rect, sortY: number): boolean => {
    let w = walkIns.get(ch);
    if (w === undefined) { w = isWalkIn(ctx.caps.systems.map, rc.x0, rc.x1, sortY, ch.y); walkIns.set(ch, w); }
    return w;
  };

  function placeBase(ctx: FrameCtx, c: Node3, place: PlaceFn): void {
    const base = ctx.ov.gameValue<number>('zIndex', c);
    const sortY = base / SORT_Z_SCALE;
    bases.add(base);
    let list = anchors.get(base);
    if (!list) { list = []; anchors.set(base, list); }
    const from = list.length;
    let zMin = Infinity, zMax = -Infinity, wx0 = Infinity, wx1 = -Infinity, covers = false;
    const test = canCover(ctx);
    shownCh.length = 0; shownLp.length = 0; shownDepth.length = 0;
    for (const ch of c.children) {
      const rc = pieceRect(ch, rcA);
      const lp = nextLp();
      // Depth always from the sort line (D6): a player on the shop mat stays in front of the card at s = 0.
      const depthY = sortY < ch.y ? sortY : ch.y;
      const standY = standLine(ch.y, sortY, ctx.params.pitch);
      // One card can't stand the gazebo's front and side pillars on the ground at once: a walk-in structure sinks
      // to its stand line and the art below it is hidden (user 2026-10-03: "clipped into the ground").
      const sink = !!rc && sortY < ch.y && walkIn(ctx, ch, rc, sortY) && (clipper ??= createClipper(ctx.caps)).clip(ch, standY);
      po.standY = standY; po.artY = standY; po.depthY = depthY; po.artRow = sink;
      const z = place(ctx, ch, po, lp);
      if (z === null) continue;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
      if (rc) { wx0 = Math.min(wx0, rc.x0); wx1 = Math.max(wx1, rc.x1); list.push(nextAnchor(lp, rc.x0, rc.x1)); }
      if (test && !covers) covers = inRect(ctx, spriteScreenRect(ch, scratch));
      shownCh.push(ch); shownLp.push(lp); shownDepth.push(depthY);
    }
    if (test && !covers && list.length > from) covers = roofCovers(ctx, base, list, from);
    // A card turns about its centre, so beside a wide shop it covered an avatar its wall does not hide (live
    // 2026-10-05: ghosted from yaw 90 on the seed-shop mat; the wall is between them only from ~125° to ~235°).
    const shift = covers ? avatarShift(ctx, zMin, zMax, wx0, wx1, sortY) : 0;
    for (let i = from; i < list.length; i++) list[i]!.key += shift;
    for (let i = 0; i < shownCh.length; i++) {
      const ch = shownCh[i]!, lp = shownLp[i]!;
      if (shift) { lp.key += shift; ctx.ov.put('zIndex', ch, lp.key); }
      fade?.(ctx, ch, lp.key, lp.fx, shownDepth[i]!);
    }
    if (zMax > -Infinity) ctx.ov.put('zIndex', c, zMax + shift);
    else ctx.ov.drop('zIndex', c);
  }

  return {
    place(ctx, blds, place) {
      for (const list of anchors.values()) list.length = 0;
      bases.clear();
      baseCs.length = 0; later.length = 0;
      lpN = 0; anN = 0;
      for (const c of blds) {
        const gz = ctx.ov.gameValue<number>('zIndex', c);
        if (isDecal(c, gz)) {
          for (const p of c.children) { const r = pieceRect(p, rcA); if (r) flat.place(ctx, p, r.cx, r.cy, BUILDING_DECAL_Z, Math.hypot((r.x1 - r.x0) / 2, r.cy - r.top)); }
          ctx.ov.put('zIndex', c, BUILDING_DECAL_Z + Math.floor(gz) / SORT_Z_SCALE);
          continue;
        }
        (gz !== Math.floor(gz) ? later : baseCs).push(c);
      }
      for (const c of baseCs) placeBase(ctx, c, place);
      // A fractional zIndex attaches a piece (roof, flag) to the piece with the same integer key: keep its 2D offset
      // from that base, scaled with it, so the composite stays one card.
      for (const c of later) {
        const gz = ctx.ov.gameValue<number>('zIndex', c);
        const base = Math.floor(gz);
        let zMax = -Infinity;
        for (const q of c.children) {
          const rc = pieceRect(q, rcA);
          const A = rc ? anchorOver(anchors.get(base), rc) : null;
          if (!A) {
            if (rc && bases.has(base)) { ctx.ov.put('visible', q, false); continue; }
            po.standY = q.y; po.artY = q.y; po.depthY = q.y; po.artRow = false;
            const z = place(ctx, q, po, nextLp());
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
    drop() { anchors.clear(); bases.clear(); clipper?.drop(); walkIns = new WeakMap(); flat.drop(); },
  };
}
