import { describe, expect, it } from 'vitest';
import { ringPieces, staggerBakes, type RingPiece } from './floorRing';

const mod = (v: number, n: number): number => ((v % n) + n) % n;

/** World tiles each piece paints, keyed "x,y"; fails on an overlap or a texture tile off the toroidal mapping. */
function painted(pieces: RingPiece[], n: number): Set<string> {
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const p of pieces) {
    if (!(p.w > 0 && p.h > 0 && p.tx + p.w <= n && p.ty + p.h <= n)) bad.push(`shape ${JSON.stringify(p)}`);
    for (let i = 0; i < p.w; i++) {
      for (let j = 0; j < p.h; j++) {
        if (p.tx + i !== mod(p.wx + i, n) || p.ty + j !== mod(p.wy + j, n)) bad.push(`map ${JSON.stringify(p)}`);
        const k = `${p.wx + i},${p.wy + j}`;
        if (seen.has(k)) bad.push(`overlap ${k}`);
        seen.add(k);
      }
    }
  }
  expect(bad.slice(0, 3)).toEqual([]);
  return seen;
}

function windowTiles(a: number, b: number, n: number): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s.add(`${a + i},${b + j}`);
  return s;
}

describe('ringPieces', () => {
  it('paints the whole window once on the first bake, split at the wrap', () => {
    const n = 13;
    const pieces = ringPieces(null, { a: 18, b: -5 }, n);
    expect(painted(pieces, n)).toEqual(windowTiles(18, -5, n));
    expect(pieces.length).toBeLessThanOrEqual(4);
  });

  it('paints nothing when the window did not move', () => {
    expect(ringPieces({ a: 4, b: 9 }, { a: 4, b: 9 }, 13)).toEqual([]);
  });

  it('paints only the tiles that entered the window, for every shift up to a full window', () => {
    let seed = 7;
    const rnd = (k: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % k; };
    for (const n of [13, 55]) {
      for (let t = 0; t < 300; t++) {
        const prev = { a: rnd(120) - 30, b: rnd(80) - 30 };
        const next = { a: prev.a + rnd(2 * n + 3) - n - 1, b: prev.b + rnd(2 * n + 3) - n - 1 };
        const pieces = ringPieces(prev, next, n);
        const old = windowTiles(prev.a, prev.b, n);
        const want = new Set([...windowTiles(next.a, next.b, n)].filter((k) => !old.has(k)));
        expect(painted(pieces, n)).toEqual(want);
        expect(pieces.length).toBeLessThanOrEqual(8);
      }
    }
  });

  it('repaints the whole window when it jumped a window or more', () => {
    const n = 13;
    const pieces = ringPieces({ a: 0, b: 0 }, { a: 13, b: 2 }, n);
    expect(painted(pieces, n)).toEqual(windowTiles(13, 2, n));
  });
});

describe('staggerBakes', () => {
  it('bakes whichever level is due when only one is', () => {
    expect(staggerBakes(true, false, false)).toEqual({ near: true, far: false });
    expect(staggerBakes(false, true, false)).toEqual({ near: false, far: true });
    expect(staggerBakes(false, false, true)).toEqual({ near: false, far: false });
  });

  it('never bakes both on one frame: near first, far on a later frame', () => {
    expect(staggerBakes(true, true, false)).toEqual({ near: true, far: false });
  });

  it('bakes an urgent far level with the near one (no bake yet, or the camera ran far past its slack)', () => {
    expect(staggerBakes(true, true, true)).toEqual({ near: true, far: true });
  });
});
