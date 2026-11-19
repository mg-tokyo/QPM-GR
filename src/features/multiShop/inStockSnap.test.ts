import { describe, expect, it } from 'vitest';
import { fitWidth, isFitWidth, readGridSizing, snapShopWidth, snapStops, type GridSizing } from './inStockSnap';

// A stand-in for the game's ShopGrid at the desktop breakpoint, following beta grid/ShopGrid.ts:341-360, 945-985.
const BASE = 70;
const GAP = 8;
const IN_GAP = 20;
const PAD = 20;
const SCALE = 1.28;

function fillRow(usable: number, target: number, gap: number, min: number): number {
  const filled = (n: number): number => Math.floor((usable - (n - 1) * gap) / n);
  const atTarget = Math.max(1, Math.floor((usable + gap) / (target + gap)));
  const fewer = filled(atTarget);
  const more = filled(atTarget + 1);
  if (more < min) return Math.max(min, fewer);
  return Math.max(min, Math.abs(more - target) < Math.abs(fewer - target) ? more : fewer);
}

class FakeGrid {
  viewportWidthPx = 0;
  getUsableWidthPx(): number { return Math.max(0, this.viewportWidthPx - PAD * 2); }
  resolveTileSizePx(): number { return BASE; }
  resolveSectionTileSizePx(id: string): number {
    if (id !== 'inStock') return BASE;
    const target = BASE * SCALE;
    if (this.viewportWidthPx <= 0) return Math.round(target);
    const usable = this.getUsableWidthPx();
    return usable < BASE ? BASE : fillRow(usable, target, IN_GAP, BASE);
  }
  resolveSectionGapPx(id: string): number {
    const nominal = id === 'inStock' ? IN_GAP : GAP;
    if (this.viewportWidthPx <= 0) return nominal;
    const tile = this.resolveSectionTileSizePx(id);
    const usable = this.getUsableWidthPx();
    const n = Math.max(1, Math.floor((usable + nominal) / (tile + nominal)));
    return n === 1 ? nominal : (usable - n * tile) / (n - 1);
  }
}

function shopView(shown: number, list: unknown = new FakeGrid()): Record<string, unknown> {
  return { list, modalScreenW: shown };
}

function sizing(): GridSizing {
  const read = readGridSizing(shopView(578));
  if (!read) throw new Error('no sizing');
  return read;
}

describe('multi-shop in-stock snap: reading the grid', () => {
  it('reads tile, gap, inset and target from the grid without writing it', () => {
    const grid = new FakeGrid();
    grid.viewportWidthPx = 266;
    const read = readGridSizing(shopView(266, grid));
    expect(read).toMatchObject({ basePx: 70, gapPx: 8, insetPx: 20, targetPx: 90 });
    expect(read?.inStockAt(266)).toEqual({ columns: 2, tilePx: 103 });
    expect(grid.viewportWidthPx).toBe(266);
    expect(Object.keys(grid)).toEqual(['viewportWidthPx']);
  });

  it('is null in the row-list view or when a grid method is missing', () => {
    expect(readGridSizing({ list: null })).toBeNull();
    const partial = { viewportWidthPx: 0, resolveTileSizePx: () => 70 };
    expect(readGridSizing({ list: partial })).toBeNull();
  });
});

describe('multi-shop in-stock snap: stops', () => {
  it('gives one width per in-stock column count, nearest the target, from two columns up', () => {
    // Up to 7 sold-out columns: the widest shop the game draws (beta shopConstants.ts:18, 600 px).
    const stops = snapStops(sizing(), 700);
    // 2 sold-out columns draw one oversized in-stock tile (the L1 report) and 6 repeat 4 columns at 100 px.
    expect(stops.map(s => [s.soldOutColumns, s.columns, s.tilePx])).toEqual([[3, 2, 103], [4, 3, 88], [5, 4, 80], [7, 5, 91]]);
    expect(stops[0]).toMatchObject({ viewportW: 266, cellW: 313 });
  });

  it('places each cell so the game fits exactly that many sold-out columns with its 10 px side padding', () => {
    const s = sizing();
    for (const stop of snapStops(s, 1278)) {
      const avail = stop.cellW - 20 - 2 * PAD;
      expect(Math.floor(avail / (BASE + GAP))).toBe(stop.soldOutColumns);
      expect(fitWidth(s, stop.soldOutColumns)).toBe(stop.viewportW);
    }
  });

  it('keeps every stop inside the screen', () => {
    expect(snapStops(sizing(), 400).map(s => s.cellW)).toEqual([313, 391]);
    expect(snapStops(sizing(), 300)).toEqual([]);
  });
});

describe('multi-shop in-stock snap: snapShopWidth', () => {
  it('widens anything narrower than two in-stock columns to the first stop', () => {
    expect(snapShopWidth(shopView(188), 260, 1278)).toBe(313);
    expect(snapShopWidth(shopView(188), 120, 1278)).toBe(313);
  });

  it('steps by whole in-stock columns, skipping the sold-out width that repeats one', () => {
    expect(snapShopWidth(shopView(266), 380, 1278)).toBe(391);
    expect(snapShopWidth(shopView(266), 520, 1278)).toBe(469);
    expect(snapShopWidth(shopView(266), 560, 1278)).toBe(625);
  });

  it('leaves the width alone when the shop is not sized the way the model says, or has no grid', () => {
    expect(snapShopWidth(shopView(300), 260, 1278)).toBe(260);
    expect(snapShopWidth({ list: null, modalScreenW: 266 }, 260, 1278)).toBe(260);
    expect(snapShopWidth(shopView(266), 260, 300)).toBe(260);
  });

  it('accepts only whole sold-out column widths as a model match', () => {
    const s = sizing();
    expect(isFitWidth(s, 188)).toBe(true);
    expect(isFitWidth(s, 578)).toBe(true);
    expect(isFitWidth(s, 590)).toBe(false);
  });
});
