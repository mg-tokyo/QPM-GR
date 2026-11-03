import type { DecorCatalogEntry } from '../../../catalogs/types';
import { isRecord } from '../../../utils/typeGuards';
import { TILE } from '../constants';
import type { Pass } from '../frame/frame';
import type { GardenTilesLike, Node3 } from '../types';

export interface SideView { art: string; flip: boolean }

/** A turned wall's depth key sits this far back along the view (world px): whatever stands on its tile (an avatar on a
 * bridge or bench) sorts in front from both sides, the 32 px quantize step of walker keys included (depth.ts). */
export const SIDE_WALL_BACK = TILE / 2 + 32;
/** A decor tile drawn from the side in 2D: node is its World `Tile (x, y)` view, (cx, cz) its tile centre (world px). */
export interface SideTile extends SideView { node: Node3; cx: number; cz: number }
/** A turned wall drawn on the last frame (fences.ts), for picking: ground line A→B and height (world px), the panel it
 * draws (u along A→B, v from its top), the tile view it stands for and the mesh that drew it (draw order). */
export interface DrawnSideWall {
  node: Node3; mesh: Node3; ax: number; az: number; bx: number; bz: number; h: number;
  tex: { uvs?: { x0: number; y0: number; x1: number; y1: number; x3: number; y3: number }; source: { style: unknown; width?: number; height?: number } };
}

/** Side view = a quarter turn whose variant sprite is not the front art. "Differs from art" alone is wrong: benches map
 * 180 to a back view (live v1847). */
export function sideViewOf(entry: DecorCatalogEntry | null | undefined, rotation: number): SideView | null {
  if (!entry || typeof entry.art !== 'string' || !Number.isFinite(rotation)) return null;
  const r = ((rotation % 360) + 360) % 360;
  if (r !== 90 && r !== 270) return null;
  const v = entry.rotationVariants?.[String(r)];
  if (!isRecord(v) || typeof v.sprite !== 'string' || v.sprite === entry.art) return null;
  return { art: entry.art, flip: v.flipH === true };
}

export interface SideDecorSource {
  rescan(): void;
  tiles(): readonly SideTile[];
  /** Moves only when the side-view set changes (a tile added, removed, turned or re-arted). */
  version(): number;
  isSide(n: Node3): boolean;
  /** Was a side view at any rescan since creation: its card alpha may be stale and must be re-faded. */
  wasSide(n: Node3): boolean;
}

/** The front art's texture fields a wall needs (PIXI Texture: trim and defaultAnchor are optional). */
export interface ArtTexLike {
  frame: { width: number; height: number }; orig: { width: number; height: number };
  trim?: { x: number; y: number } | null; defaultAnchor?: { x: number; y: number } | null;
  /** groupD8; non-zero for a frame packed rotated (sprite-v2/atlas.ts:69). */
  rotate?: number;
}
export interface SideWallGeom { w: number; base: number; ax: number; az: number; bx: number; bz: number }

/** The front art upright on the tile's N-S centre line: its anchor column on the tile centre, cut at its ground row
 * (anchor y in orig px, less the trim; at most the frame). flip runs the texture south to north. A rotated frame is
 * null: the panel (tileArt.ts subTexture) cuts the atlas unrotated. */
export function sideWall(t: SideTile, tex: ArtTexLike): SideWallGeom | null {
  if (tex.rotate) return null;
  const w = tex.frame.width, an = tex.defaultAnchor ?? { x: 0.5, y: 1 };
  const base = Math.min(tex.frame.height, Math.round(an.y * tex.orig.height) - (tex.trim?.y ?? 0));
  if (!(w > 0) || !(base > 0)) return null;
  const a0 = an.x * tex.orig.width - (tex.trim?.x ?? 0);
  return t.flip ? { w, base, ax: t.cx, az: t.cz + a0, bx: t.cx, bz: t.cz + a0 - w } : { w, base, ax: t.cx, az: t.cz - a0, bx: t.cx, bz: t.cz - a0 + w };
}

/** Rescans on the rolling re-cull (live v1847: ≈0.02 ms for 1.2k views), on entry, and never on other frames. Runs
 * before the entity pass, which fades side cards. */
export function createSideDecorPass(src: SideDecorSource): Pass {
  let fresh = false;
  return {
    name: 'sideDecor',
    pre(ctx) { if (!fresh || ctx.reCull || ctx.roll === 0) { src.rescan(); fresh = true; } },
    drop() { fresh = false; },
    destroy() { fresh = false; },
    stats: () => ({ side: src.tiles().length, version: src.version() }),
  };
}

const sameTile = (a: SideTile, b: SideTile): boolean => a.node === b.node && a.cx === b.cx && a.cz === b.cz && a.art === b.art && a.flip === b.flip;

function tileOf(v: unknown, getDecor: (id: string) => DecorCatalogEntry | null): SideTile | null {
  if (!isRecord(v)) return null;
  const to = v.tileObject, wp = v.worldPosition, node = v.displayObject;
  if (!isRecord(to) || to.objectType !== 'decor' || typeof to.decorId !== 'string' || typeof to.rotation !== 'number') return null;
  if (!isRecord(wp) || typeof wp.x !== 'number' || typeof wp.y !== 'number' || !isRecord(node)) return null;
  const side = sideViewOf(getDecor(to.decorId), to.rotation);
  return side && { node: node as unknown as Node3, cx: (wp.x + 0.5) * TILE, cz: (wp.y + 0.5) * TILE, art: side.art, flip: side.flip };
}

/** The game's garden tile views (gardenObject.tileViews, live v1847), shape-checked per view as avatarSource.ts does. */
export function createSideDecorSource(garden: GardenTilesLike | null, getDecor: (id: string) => DecorCatalogEntry | null): SideDecorSource {
  let list: SideTile[] = [];
  let nodes = new Set<Node3>();
  const ever = new WeakSet<Node3>();
  let ver = 0;
  return {
    rescan() {
      const next: SideTile[] = [];
      if (garden) for (const v of garden.tileViews.values()) { const t = tileOf(v, getDecor); if (t) next.push(t); }
      if (next.length === list.length && next.every((t, i) => sameTile(t, list[i]!))) return;
      list = next;
      nodes = new Set(next.map((t) => t.node));
      for (const n of nodes) ever.add(n);
      ver++;
    },
    tiles: () => list,
    version: () => ver,
    isSide: (n) => nodes.has(n),
    wasSide: (n) => ever.has(n),
  };
}
