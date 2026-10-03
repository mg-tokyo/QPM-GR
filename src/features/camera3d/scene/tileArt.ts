import { getGameTexture, getKeysByFrame } from '../../../sprite-v2/gameTextures';
import type { Caps, TexLike, TileDataLike } from '../types';

// literal-list-justified: render-only tile-art classification; an unknown or renamed key stays flat on the floor
export const SKY_KEYS: readonly string[] = ['tile/Sky', 'tile/StarsTile', 'tile/SkyTile'];
// literal-list-justified: render-only tile-art classification; an unknown or renamed key stays flat on the floor
export const STAND_KEYS: readonly string[] = ['tile/PineTree', 'tile/RockBoulder_01', 'tile/RockBoulder_02', 'tile/RockPile_A', 'tile/RockPile_B', 'tile/Hedge_A', 'tile/Hedge_B', 'tile/Hedge_C', 'tile/Hedge_Top'];
// literal-list-justified: render-only tile-art classification; an unknown or renamed key stays flat on the floor
export const FENCE_KEYS = { H: 'tile/WoodFence_Horizontal', V: 'tile/WoodFence_Vertical', T: 'tile/WoodFence_CornerT', R: 'tile/WoodFence_CornerTopRight' } as const;
export type FenceKind = keyof typeof FENCE_KEYS;

const STRIDE = 14; // tilemap rect buffer: u, v, x, y, w, h, rotate, …, alpha at 13
const ALPHA = 13;

export interface TileScan { pb: Float32Array; len: number; sky: number[]; standing: number[]; fence: Map<number, FenceKind>; keyAt: Map<number, string>; missing: string[] }

export function scanTiles(td: TileDataLike, prev: TileScan | null): TileScan {
  const pb = td.pointsBuf;
  if (prev && prev.pb === pb && prev.len === pb.length) return prev;
  const byFrame = getKeysByFrame('tile/');
  const known = new Set(byFrame.values());
  const fenceOf = new Map<string, FenceKind>();
  for (const [k, v] of Object.entries(FENCE_KEYS)) fenceOf.set(v, k as FenceKind);
  const sky = new Set(SKY_KEYS), stand = new Set([...STAND_KEYS, ...Object.values(FENCE_KEYS)]);
  // Sprite textures not loaded yet: len -1 keeps this scan from being reused, so the next call scans again.
  const scan: TileScan = { pb, len: byFrame.size ? pb.length : -1, sky: [], standing: [], fence: new Map(), keyAt: new Map(), missing: [...sky, ...stand].filter((k) => !known.has(k)) };
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

/** Zeroes rect alphas for one render; rects_count = 0 forces the tilemap to rebuild its vertex buffer. */
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
