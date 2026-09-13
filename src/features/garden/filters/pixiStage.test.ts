import { describe, it, expect } from 'vitest';
import { setTileDim } from './pixiStage';
import { DIM_ALPHA } from './constants';

function fakeTile(childCount = 1) {
  const children = Array.from({ length: childCount }, (_, i) => ({
    label: i === 0 ? 'Delphinium Plant View' : `Extra ${i}`,
    alpha: 1,
  }));
  return { label: 'Tile (22, 21)', alpha: 1, children };
}

describe('setTileDim', () => {
  it('dims every child, never the tile', () => {
    const tile = fakeTile(2);
    setTileDim(tile, true);
    expect(tile.alpha).toBe(1);
    expect(tile.children.map(c => c.alpha)).toEqual([DIM_ALPHA, DIM_ALPHA]);
  });

  it('heals a tile dimmed by an older build', () => {
    const tile = fakeTile();
    tile.alpha = DIM_ALPHA; // legacy container dim
    setTileDim(tile, true);
    expect(tile.alpha).toBe(1);
    expect(tile.children[0]!.alpha).toBe(DIM_ALPHA);
  });

  it('undim restores children and tile', () => {
    const tile = fakeTile();
    setTileDim(tile, true);
    setTileDim(tile, false);
    expect(tile.alpha).toBe(1);
    expect(tile.children[0]!.alpha).toBe(1);
  });

  it('tolerates a childless tile', () => {
    const tile = { label: 'Tile (1, 1)', alpha: 0.1, children: [] as unknown[] };
    setTileDim(tile, true);
    expect(tile.alpha).toBe(1);
  });
});
