import { describe, expect, it } from 'vitest';
import { DETAIL_PRESETS } from '../settings';
import { DETAIL_RADIUS, applyDetail, tileWindow, type TileWindow } from './viewport';

const win = (): TileWindow => ({ minTileX: 0, minTileY: 0, maxTileX: 0, maxTileY: 0 });

describe('tileWindow (the game cull box while 3D is live)', () => {
  it('covers the ground footprint plus one tile each side, in map tiles', () => {
    expect(tileWindow({ x0: 1000, y0: 2000, x1: 3000, y1: 2600 }, 101, 60, win())).toEqual({ minTileX: 2, minTileY: 6, maxTileX: 13, maxTileY: 12 });
  });

  it('clamps to the map', () => {
    expect(tileWindow({ x0: -9000, y0: -9000, x1: 1e6, y1: 1e6 }, 101, 60, win())).toEqual({ minTileX: 0, minTileY: 0, maxTileX: 100, maxTileY: 59 });
  });

  it('fills the given window', () => {
    const out = win();
    expect(tileWindow({ x0: 0, y0: 0, x1: 256, y1: 256 }, 101, 60, out)).toBe(out);
  });
});

describe('applyDetail', () => {
  it('sets the cull radius from the preset (P12: "Pets & players distance")', () => {
    const r = { px: 0 };
    applyDetail(r, 'near');
    expect(r.px).toBe(DETAIL_RADIUS.near);
    applyDetail(r, 'far');
    expect(r.px).toBe(DETAIL_RADIUS.far);
  });

  it('closest is Low\'s ~10-tile step (perf PC16)', () => {
    const r = { px: 0 };
    applyDetail(r, 'closest');
    expect(r.px).toBe(2600);
  });

  it('the card\'s pill order (DETAIL_PRESETS) runs from the shortest radius to the longest', () => {
    const radii = DETAIL_PRESETS.map((p) => DETAIL_RADIUS[p]);
    expect([...radii].sort((a, b) => a - b)).toEqual(radii);
    expect(new Set(radii).size).toBe(radii.length);
  });
});
