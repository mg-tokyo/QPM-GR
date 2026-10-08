import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TileDataLike } from '../types';

const keys = new Map<string, string>();
const calls = { n: 0 };
vi.mock('../../../sprite-v2/gameTextures', () => ({
  getKeysByFrame: () => { calls.n++; return new Map(keys); },
  getGameTexture: () => null,
}));

const { RECT, SCAN_RETRY_MS, checkTileLayout, hideRects, restoreRects, scanTiles, skyStrip } = await import('./tileArt');

// One rect: atlas frame (0, 0), standing art at offset 0.
const td = (): TileDataLike => ({ pointsBuf: new Float32Array(14), rects_count: 1 });

/** A live-shaped rect buffer (live 1419: u, v, x, y, w, h, rotate, animX, animY, texIdx, animCountX/Y 1024, divisor 1, alpha). */
const rects = (list: Array<{ x: number; y: number; w?: number; h?: number; rotate?: number; alpha?: number }>): number[] =>
  list.flatMap((r) => [0, 0, r.x, r.y, r.w ?? 256, r.h ?? 256, r.rotate ?? 0, 0, 0, 0, 1024, 1024, 1, r.alpha ?? 1]);
const grid = (n: number): Array<{ x: number; y: number }> => Array.from({ length: n }, (_, i) => ({ x: (i % 10) * 256, y: Math.floor(i / 10) * 256 }));

describe('checkTileLayout (A V8)', () => {
  it('accepts the live layout: 14 floats a rect, mostly whole tiles, mirrored standing art', () => {
    const pb = rects([...grid(30), { x: 0, y: 0, w: 385, h: 817, rotate: 12 }, { x: 256, y: 0, w: 256, h: 341, rotate: 4 }]);
    expect(checkTileLayout(pb)).toEqual({ rects: 32, bad: 0, tiles: 30, verdict: 'ok' });
  });

  it('an empty buffer proves nothing', () => {
    expect(checkTileLayout([]).verdict).toBe('unknown');
  });

  it('flags a changed stride, a moved alpha, or a different tile size', () => {
    const live = rects(grid(40));
    const wider = live.flatMap((v, i) => (i % 14 === 13 ? [v, 0] : [v]));
    expect(checkTileLayout(wider).verdict).toBe('drift');
    const alphaMoved = live.map((v, i) => (i % 14 === 13 ? 255 : v));
    expect(checkTileLayout(alphaMoved).verdict).toBe('drift');
    expect(checkTileLayout(rects(grid(40).map((r) => ({ ...r, w: 128, h: 128 })))).verdict).toBe('drift');
  });

  it('one odd rect in a hundred is not drift', () => {
    const pb = rects([...grid(99), { x: 0, y: 0, alpha: 2 }]);
    expect(checkTileLayout(pb)).toMatchObject({ bad: 1, verdict: 'ok' });
  });
});

describe('skyStrip (A V8)', () => {
  it('derives the live strip: the sky band from its top, one period of the sky art wide', () => {
    // Live 1419: Sky 256 tiles, StarsTile 768 every 3 tiles, SkyTile 1536 every 6 tiles, the band 10 rows tall.
    const pb = rects([
      { x: 0, y: 0 }, { x: 256, y: 0 }, { x: 25856, y: 2304 },
      { x: 0, y: 0, w: 768, h: 768 }, { x: 768, y: 0, w: 768, h: 768 },
      { x: 0, y: 1024, w: 1536, h: 1536 }, { x: 24576, y: 1024, w: 1536, h: 1536 },
    ]);
    const sky = [0, 1, 2, 3, 4, 5, 6].map((i) => i * RECT.STRIDE);
    expect(skyStrip(pb, sky, 8192)).toEqual({ x0: 0, y0: 0, w: 1536, h: 2560 });
  });

  it('follows a band that moved or changed period, and caps the width', () => {
    const pb = rects([{ x: 512, y: 256, w: 1280, h: 1280 }, { x: 512, y: 256, w: 768, h: 768 }, { x: 40000, y: 256 }]);
    expect(skyStrip(pb, [0, 14, 28], 8192)).toEqual({ x0: 512, y0: 256, w: 3840, h: 1280 });
    expect(skyStrip(pb, [0, 14, 28], 2048)).toMatchObject({ w: 2048 });
  });

  it('no sky rects: null (the band is gone or its keys were renamed)', () => {
    expect(skyStrip(rects(grid(4)), [], 8192)).toBeNull();
  });
});

describe('hideRects / restoreRects', () => {
  it('zeroes the alphas for one render, forces the rebuild, and puts them back', () => {
    const t: TileDataLike = { pointsBuf: rects([{ x: 0, y: 0, alpha: 0.5 }, { x: 256, y: 0 }, { x: 512, y: 0, alpha: 0.25 }]), rects_count: 3 };
    const offs = [0, 2 * RECT.STRIDE];
    const saved = hideRects(t, offs);
    expect([t.pointsBuf[RECT.ALPHA], t.pointsBuf[RECT.STRIDE + RECT.ALPHA], t.pointsBuf[2 * RECT.STRIDE + RECT.ALPHA]]).toEqual([0, 1, 0]);
    expect(t.rects_count).toBe(0);
    t.rects_count = 3;
    restoreRects(t, offs, saved);
    expect([t.pointsBuf[RECT.ALPHA], t.pointsBuf[2 * RECT.STRIDE + RECT.ALPHA]]).toEqual([0.5, 0.25]);
    expect(t.rects_count).toBe(0);
  });
});

describe('scanTiles (A PF6)', () => {
  beforeEach(() => { keys.clear(); calls.n = 0; });

  it('a good scan is reused for the same buffer', () => {
    keys.set('0,0', 'tile/PineTree');
    const t = td();
    const a = scanTiles(t, null, 0);
    expect(a.standing).toEqual([0]);
    expect(scanTiles(t, a, 10)).toBe(a);
    expect(calls.n).toBe(1);
  });

  it('without atlas keys: one provisional scan, the same object until the retry, no texture walk per call', () => {
    const t = td();
    const a = scanTiles(t, null, 0);
    expect(a.len).toBeLessThan(0);
    for (let i = 1; i < 50; i++) expect(scanTiles(t, a, i)).toBe(a);
    expect(calls.n).toBe(1);
    // Still empty at the retry: the same object again, so decor and fences do not rebuild.
    expect(scanTiles(t, a, SCAN_RETRY_MS)).toBe(a);
    expect(calls.n).toBe(2);
  });

  it('keys that arrive are picked up at the next retry as a new scan', () => {
    const t = td();
    const a = scanTiles(t, null, 0);
    keys.set('0,0', 'tile/PineTree');
    expect(scanTiles(t, a, SCAN_RETRY_MS - 1)).toBe(a);
    const b = scanTiles(t, a, SCAN_RETRY_MS);
    expect(b).not.toBe(a);
    expect(b.len).toBe(14);
    expect(b.standing).toEqual([0]);
  });
});
