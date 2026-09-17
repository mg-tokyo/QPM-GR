import { describe, it, expect, vi } from 'vitest';

const alphaGuardMocks = vi.hoisted(() => ({
  installVisibleGuard: vi.fn(),
  removeVisibleGuard: vi.fn(),
  pruneStaleGuards: vi.fn(),
}));

vi.mock('./alphaGuard', () => alphaGuardMocks);
vi.mock('../../../core/pixiCapture', () => ({
  getPixiCapture: () => null,
  getCaptureGeneration: () => 0,
}));

import { setTileDim, applyFiltersToStage, applyFiltersToTiles } from './pixiStage';
import { DIM_ALPHA } from './constants';
import type { CachedFilterSets, TileNode } from './types';

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

describe('applyFiltersToStage — childless-tile guard release', () => {
  it('releases a guard when the tile lost its child view', () => {
    alphaGuardMocks.removeVisibleGuard.mockReset();
    const tile = { label: 'Tile (5, 5)', alpha: 1, children: [] as unknown[] };
    const stats = { visible: 0, dimmed: 0, withData: 0, withoutData: 0 };
    applyFiltersToStage(tile, new Set(['Carrot']), new Set(), new Set(), new Set(), stats, 0, 0);
    expect(alphaGuardMocks.removeVisibleGuard).toHaveBeenCalledWith(tile);
  });
});

describe('applyFiltersToTiles', () => {
  it('prunes guards for the tile list it just processed', () => {
    alphaGuardMocks.pruneStaleGuards.mockReset();
    const tiles: TileNode[] = [
      { node: { label: 'Tile (0, 0)', alpha: 1, children: [] }, x: 0, y: 0 },
      { node: { label: 'Tile (1, 0)', alpha: 1, children: [] }, x: 1, y: 0 },
    ];
    const sets: CachedFilterSets = {
      speciesKeysToShow: new Set(),
      mutationsToShow: new Set(),
      eggTypesToShow: new Set(),
      growthStatesToShow: new Set(),
    };
    const stats = { visible: 0, dimmed: 0, withData: 0, withoutData: 0 };
    applyFiltersToTiles(tiles, sets, stats);
    expect(alphaGuardMocks.pruneStaleGuards).toHaveBeenCalledTimes(1);
    expect(alphaGuardMocks.pruneStaleGuards).toHaveBeenCalledWith(tiles);
  });
});
