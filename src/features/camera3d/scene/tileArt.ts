import { getGameTexture, getKeysByFrame } from '../../../sprite-v2/gameTextures';
import { TILE } from '../constants';
import type { Overrides } from '../frame/overrides';
import type { Caps, DriftVerdict, Node3, TexLike, TileDataLike } from '../types';

// literal-list-justified: render-only tile-art classification; an unknown or renamed key stays flat on the floor
export const SKY_KEYS: readonly string[] = ['tile/Sky', 'tile/StarsTile', 'tile/SkyTile'];
// literal-list-justified: render-only tile-art classification; an unknown or renamed key stays flat on the floor
export const STAND_KEYS: readonly string[] = ['tile/PineTree', 'tile/RockBoulder_01', 'tile/RockBoulder_02', 'tile/RockPile_A', 'tile/RockPile_B', 'tile/Hedge_A', 'tile/Hedge_B', 'tile/Hedge_C', 'tile/Hedge_Top'];
// literal-list-justified: render-only tile-art classification; an unknown or renamed key stays flat on the floor
export const FENCE_KEYS = { H: 'tile/WoodFence_Horizontal', V: 'tile/WoodFence_Vertical', T: 'tile/WoodFence_CornerT', R: 'tile/WoodFence_CornerTopRight' } as const;
export type FenceKind = keyof typeof FENCE_KEYS;

// The tilemap's rect buffer (live 1419: u, v, x, y, w, h, rotate, animX, animY, texture, animCountX/Y, divisor, alpha);
// checkTileLayout() validates it at install.
export const RECT = { STRIDE: 14, X: 2, Y: 3, W: 4, H: 5, ROTATE: 6, ALPHA: 13 } as const;
/** groupD8 MIRROR_HORIZONTAL. Standing art uses only it and 0 (live 1419; rotations 4 and 8 are ground tiles only). */
export const D8_MIRROR_H = 12;
const D8_MAX = 15;
const { STRIDE, ALPHA } = RECT;

export interface TileLayoutCheck { rects: number; bad: number; tiles: number; verdict: DriftVerdict }

/** The rect buffer still has the layout RECT reads (a changed stride or field order misreads every rect), and its rects
 * are mostly whole TILE squares (live 1419: 7,692 of 9,928). Up to 1 % odd rects are tolerated. */
export function checkTileLayout(pb: ArrayLike<number>): TileLayoutCheck {
  const rects = Math.floor(pb.length / STRIDE);
  let bad = 0, tiles = 0;
  for (let o = 0; o + STRIDE <= pb.length; o += STRIDE) {
    const w = pb[o + RECT.W]!, h = pb[o + RECT.H]!, rot = pb[o + RECT.ROTATE]!, a = pb[o + ALPHA]!;
    if (!(w > 0 && h > 0 && a >= 0 && a <= 1 && Number.isInteger(rot) && rot >= 0 && rot <= D8_MAX)) bad++;
    else if (w === TILE && h === TILE) tiles++;
  }
  if (rects === 0) return { rects, bad, tiles, verdict: 'unknown' };
  const ok = pb.length % STRIDE === 0 && bad * 100 <= rects && tiles * 2 >= rects;
  return { rects, bad, tiles, verdict: ok ? 'ok' : 'drift' };
}

export interface StripRect { x0: number; y0: number; w: number; h: number }
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** The horizon strip: the sky band's top-left, its height, and one period of its art wide (the least common multiple
 * of the sky rect widths: live 1419 256 / 768 / 1536 → 1536 × 2560), at most maxW. Null without sky rects. */
export function skyStrip(pb: ArrayLike<number>, sky: readonly number[], maxW: number): StripRect | null {
  if (sky.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, period = 1;
  for (const o of sky) {
    const x = pb[o + RECT.X]!, y = pb[o + RECT.Y]!, w = Math.round(pb[o + RECT.W]!), h = pb[o + RECT.H]!;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    if (w > 0 && period <= maxW) period = (period / gcd(period, w)) * w;
  }
  return { x0, y0, w: Math.min(period, x1 - x0, maxW), h: y1 - y0 };
}

/** `at`: when a provisional scan (no atlas keys yet, len −1) last looked for them. */
export interface TileScan { pb: TileDataLike['pointsBuf']; len: number; at: number; sky: number[]; standing: number[]; fence: Map<number, FenceKind>; keyAt: Map<number, string>; missing: string[] }

/** A provisional scan looks for the atlas keys again this often, not on every call (A PF6). */
export const SCAN_RETRY_MS = 2000;

export function scanTiles(td: TileDataLike, prev: TileScan | null, now = performance.now()): TileScan {
  const pb = td.pointsBuf;
  if (prev && prev.pb === pb && prev.len === pb.length) return prev;
  // Without keys every call walked the whole texture map and returned a new scan, so decor and fences rebuilt each frame.
  const retry = !!prev && prev.pb === pb && prev.len < 0;
  if (retry && now - prev.at < SCAN_RETRY_MS) return prev;
  const byFrame = getKeysByFrame('tile/');
  if (retry && byFrame.size === 0) { prev.at = now; return prev; }
  const known = new Set(byFrame.values());
  const fenceOf = new Map<string, FenceKind>();
  for (const [k, v] of Object.entries(FENCE_KEYS)) fenceOf.set(v, k as FenceKind);
  const sky = new Set(SKY_KEYS), stand = new Set([...STAND_KEYS, ...Object.values(FENCE_KEYS)]);
  // Sprite textures not loaded yet: len -1 keeps this scan from being reused, so the next call scans again.
  const scan: TileScan = { pb, len: byFrame.size ? pb.length : -1, at: now, sky: [], standing: [], fence: new Map(), keyAt: new Map(), missing: [...sky, ...stand].filter((k) => !known.has(k)) };
  for (let o = 0; o < pb.length; o += STRIDE) {
    const key = byFrame.get(`${pb[o]!},${pb[o + 1]!}`);
    if (!key) continue;
    if (sky.has(key)) scan.sky.push(o);
    else if (stand.has(key)) {
      scan.standing.push(o);
      scan.keyAt.set(o, key);
      const f = fenceOf.get(key);
      if (f) scan.fence.set(o, f);
    }
  }
  return scan;
}

/** Sets the tilemap's raw visibility by way of the opposite value. The tilemap rebuilds its vertex buffer only when
 *  Ground rebuilds its instructions, which this flip forces on Ground's next render. Live 2026-10-04: in 2D (tilemap
 *  already shown) bakes drew the stale buffer, and a rebuild that fell mid-hide kept the sky out of every later bake. */
export function setTilemapShown(ov: Overrides, tilemap: Node3, shown: boolean): void {
  ov.rawSet('visible', tilemap, !shown);
  ov.rawSet('visible', tilemap, shown);
}

/** Zeroes rect alphas for one render; rects_count = 0 makes the tilemap rebuild once Ground re-instructs (setTilemapShown). */
export function hideRects(td: TileDataLike, offsets: readonly number[]): Float32Array {
  const saved = new Float32Array(offsets.length);
  for (let i = 0; i < offsets.length; i++) { const o = offsets[i]! + ALPHA; saved[i] = td.pointsBuf[o]!; td.pointsBuf[o] = 0; }
  td.rects_count = 0;
  return saved;
}

export function restoreRects(td: TileDataLike, offsets: readonly number[], saved: Float32Array): void {
  for (let i = 0; i < offsets.length; i++) td.pointsBuf[offsets[i]! + ALPHA] = saved[i]!;
  td.rects_count = 0;
}

/** A sub-texture of a game atlas texture (same source), via the sprite system's texture map. */
export function subTexture(caps: Caps, key: string, x: number, y: number, w: number, h: number): TexLike | null {
  const t = getGameTexture(key) as TexLike | null;
  if (!t) return null;
  return new caps.classes.Texture({ source: t.source, frame: new caps.classes.Rectangle(t.frame.x + x, t.frame.y + y, w, h) });
}

const baseRows = new Map<string, number>();
/** Lowest art row (alpha ≥ 0.5) of a texture, measured once per id by GPU extract (the atlas is GPU-only). */
export function baseRowOf(caps: Caps, id: string, tex: TexLike, h: number, resolution = 1): number {
  const known = baseRows.get(id);
  if (known !== undefined) return known;
  const s = new caps.classes.Sprite(tex);
  const ex = caps.scene.renderer.extract.pixels({ target: s, resolution });
  let row = h;
  outer: for (let y = ex.height - 1; y >= 0; y--) for (let x = 0; x < ex.width; x++) if (ex.pixels[(y * ex.width + x) * 4 + 3]! >= 128) { row = Math.min(h, Math.round(((y + 1) * h) / ex.height)); break outer; }
  s.destroy();
  const use = row < h - 8 ? row : h;
  baseRows.set(id, use);
  return use;
}

/** Lowest art row of a tile frame (see baseRowOf). */
export function artBaseRow(caps: Caps, key: string, w: number, h: number): number {
  const id = `${key}:${w}x${h}`;
  const known = baseRows.get(id);
  if (known !== undefined) return known;
  const tex = subTexture(caps, key, 0, 0, w, h);
  if (!tex) return h;
  const row = baseRowOf(caps, id, tex, h);
  tex.destroy(false);
  return row;
}
