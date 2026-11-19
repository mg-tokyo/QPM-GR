import { describe, expect, it } from 'vitest';
import {
  HEADER_HEIGHT_PX, MIN_PANEL_WIDTH_PX, STORAGE_FIT, cellContains, cellForScreen, cellFromSaved, cellToSaved, clampCell, defaultCells,
  frontOrder, minPanelSize, movedCell, previewCells, raiseToFront, rankedLayout, rescaleCell, resizedSize, startingCells,
  type PanelFit,
} from './layout';

const WIDE = { w: 1600, h: 900 };
const NARROW = { w: 600, h: 700 };

describe('multi-storage default cells', () => {
  it('gives one panel the whole usable width', () => {
    expect(defaultCells(1, 100, WIDE)).toEqual([{ x: 100, y: 0, w: 1500, h: 900 }]);
  });

  it('puts three and five panels side by side without overlap on a wide screen', () => {
    for (const count of [3, 5]) {
      const cells = defaultCells(count, 100, WIDE);
      expect(cells).toHaveLength(count);
      const w = Math.floor(1500 / count);
      cells.forEach((cell, i) => expect(cell).toEqual({ x: 100 + i * w, y: 0, w, h: 900 }));
    }
  });

  it('overlaps evenly on a narrow screen, keeping the minimum width and the right edge on screen', () => {
    const cells = defaultCells(5, 0, NARROW);
    expect(cells.every(cell => cell.w === MIN_PANEL_WIDTH_PX)).toBe(true);
    expect(cells.map(cell => cell.x)).toEqual([0, 95, 190, 285, 380]);
    const last = cells[4];
    expect(last && last.x + last.w).toBe(NARROW.w);
  });

  it('returns nothing for no panels and never exceeds a screen narrower than the minimum', () => {
    expect(defaultCells(0, 0, WIDE)).toEqual([]);
    expect(defaultCells(2, 0, { w: 150, h: 400 })).toEqual([{ x: 0, y: 0, w: 150, h: 400 }, { x: 0, y: 0, w: 150, h: 400 }]);
  });
});

describe('multi-storage clamp', () => {
  const sheet = { left: 40, width: 300, top: 200 };

  it('holds the minimum size: 220 wide, half the screen tall with a 320 floor', () => {
    expect(minPanelSize(WIDE)).toEqual({ w: 220, h: 450 });
    expect(minPanelSize({ w: 1000, h: 500 })).toEqual({ w: 220, h: 320 });
    expect(minPanelSize({ w: 100, h: 200 })).toEqual({ w: 100, h: 200 });
    expect(clampCell({ x: 0, y: 0, w: 50, h: 50 }, WIDE, null)).toMatchObject({ w: 220, h: 450 });
    expect(clampCell({ x: 0, y: 0, w: 5000, h: 5000 }, WIDE, null)).toMatchObject({ w: 1600, h: 900 });
  });

  it('stops the visible panel at the left and right edges', () => {
    expect(clampCell({ x: -500, y: 0, w: 380, h: 900 }, WIDE, sheet).x).toBe(-40);
    expect(clampCell({ x: 5000, y: 0, w: 380, h: 900 }, WIDE, sheet).x).toBe(1600 - 40 - 300);
  });

  it('stops the header at the top edge and the bottom strip at the bottom edge', () => {
    expect(clampCell({ x: 0, y: -900, w: 380, h: 600 }, WIDE, sheet).y).toBe(HEADER_HEIGHT_PX - sheet.top);
    expect(clampCell({ x: 0, y: 900, w: 380, h: 600 }, WIDE, sheet).y).toBe(300);
    // A sheet whose top is nearer the cell top than the header's height cannot go above y = 0.
    expect(clampCell({ x: 0, y: -900, w: 380, h: 600 }, WIDE, { ...sheet, top: 10 }).y).toBe(0);
  });

  it('allows up to half the cell above the screen while the panel top is unknown, and does not mutate', () => {
    const cell = { x: 10, y: -900, w: 380, h: 600 };
    expect(clampCell(cell, WIDE, null)).toEqual({ x: 10, y: -300, w: 380, h: 600 });
    expect(cell.y).toBe(-900);
  });
});

describe('multi-storage saved fractions', () => {
  it('round-trips a cell on one screen and scales it to another', () => {
    const cell = { x: 400, y: 90, w: 800, h: 450 };
    const saved = cellToSaved(cell, WIDE, 2);
    expect(saved).toEqual({ x: 0.25, y: 0.1, w: 0.5, h: 0.5, z: 2 });
    expect(cellFromSaved(saved, WIDE)).toEqual(cell);
    expect(cellFromSaved(saved, { w: 800, h: 600 })).toEqual({ x: 200, y: 60, w: 400, h: 300 });
    expect(rescaleCell(cell, WIDE, { w: 800, h: 600 })).toEqual({ x: 200, y: 60, w: 400, h: 320 });
  });

  it('rejects unusable saved values and a zero-sized screen', () => {
    expect(cellFromSaved(null, WIDE)).toBeNull();
    expect(cellFromSaved({ x: 0, y: 0, w: 0, h: 0.5 }, WIDE)).toBeNull();
    expect(cellFromSaved({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 }, WIDE)).toBeNull();
    expect(cellToSaved({ x: 0, y: 0, w: 10, h: 10 }, { w: 0, h: 0 }, 0)).toBeNull();
  });

  it('starts each storage from its saved place, or its default cell when none is saved', () => {
    const saved = { SeedSilo: { x: 0.5, y: 0, w: 0.25, h: 1, z: 0 }, PetHutch: { x: 0, y: 0, w: -1, h: 1 } };
    const cells = startingCells(['PetHutch', 'SeedSilo'], saved, 0, WIDE);
    expect(cells).toEqual([{ x: 0, y: 0, w: 800, h: 900 }, { x: 800, y: 0, w: 400, h: 900 }]);
  });
});

describe('multi-storage front order', () => {
  it('orders by saved rank, falling back to the open position', () => {
    expect(frontOrder(['a', 'b', 'c'], {})).toEqual(['a', 'b', 'c']);
    const saved = { a: { x: 0, y: 0, w: 1, h: 1, z: 2 }, b: { x: 0, y: 0, w: 1, h: 1, z: 0 }, c: { x: 0, y: 0, w: 1, h: 1, z: 1 } };
    expect(frontOrder(['a', 'b', 'c'], saved)).toEqual(['b', 'c', 'a']);
  });

  it('raises a panel to the front and reports no change when it is already there', () => {
    expect(raiseToFront(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    expect(raiseToFront(['a', 'b', 'c'], 'c')).toBeNull();
    expect(raiseToFront(['a', 'b'], 'x')).toBeNull();
  });

  it('saves every open panel with its rank in the front order, and restores that order', () => {
    const places = new Map([['a', { x: 0, y: 0, w: 0.5, h: 1, z: 7 }], ['b', { x: 0.5, y: 0.1, w: 0.25, h: 0.5 }]]);
    const saved = rankedLayout(places, ['b', 'a']);
    expect(saved).toEqual({ a: { x: 0, y: 0, w: 0.5, h: 1, z: 1 }, b: { x: 0.5, y: 0.1, w: 0.25, h: 0.5, z: 0 } });
    expect(frontOrder(['a', 'b'], saved)).toEqual(['b', 'a']);
  });
});

describe('multi-storage window resize', () => {
  it('returns a panel to its intended place after the window shrinks and grows back', () => {
    const cell = { x: 1300, y: 0, w: 300, h: 900 };
    const intended = cellToSaved(cell, WIDE, 0);
    const small = cellForScreen(intended, cell, WIDE, NARROW);
    // Clamped on the small window: minimum width, right edge on screen.
    expect(small).toEqual({ x: 380, y: 0, w: 220, h: 700 });
    expect(cellForScreen(intended, small, NARROW, WIDE)).toEqual(cell);
    // Scaling the clamped cell instead would have drifted it.
    expect(rescaleCell(small, NARROW, WIDE)).not.toEqual(cell);
  });

  it('falls back to scaling the current cell when no intended place is known', () => {
    const cell = { x: 400, y: 90, w: 800, h: 450 };
    expect(cellForScreen(null, cell, WIDE, { w: 800, h: 600 })).toEqual(rescaleCell(cell, WIDE, { w: 800, h: 600 }));
  });
});

describe('multi-storage pointer maths', () => {
  it('hit-tests a rect including its edges', () => {
    const rect = { x: 10, y: 20, w: 100, h: 50 };
    expect(cellContains(rect, { x: 10, y: 20 })).toBe(true);
    expect(cellContains(rect, { x: 110, y: 70 })).toBe(true);
    expect(cellContains(rect, { x: 111, y: 40 })).toBe(false);
    expect(cellContains(rect, { x: 50, y: 19 })).toBe(false);
  });

  it('resizes from the grip within the minimum size, the screen width and the screen bottom', () => {
    const start = { x: 100, y: 300, w: 400, h: 500 };
    expect(resizedSize(start, 50, 40, WIDE)).toEqual({ w: 450, h: 540 });
    expect(resizedSize(start, -1000, -1000, WIDE)).toEqual({ w: 220, h: 450 });
    expect(resizedSize(start, 5000, 5000, WIDE)).toEqual({ w: 1600, h: 600 });
    // A panel already lower than the minimum height allows keeps the minimum rather than shrinking past it.
    expect(resizedSize({ ...start, y: 700 }, 0, 100, WIDE).h).toBe(450);
  });
});

describe('panel fit (shared with multi-shop)', () => {
  const SHOPS: PanelFit = { minWidthPx: 260, minHeightPx: 320, minHeightFraction: 0, unplacedAboveShare: 0, shortenAtBottom: true };

  it('defaults every function to the storage fit', () => {
    expect(STORAGE_FIT).toMatchObject({ minWidthPx: MIN_PANEL_WIDTH_PX, minHeightFraction: 0.5, shortenAtBottom: false });
    expect(minPanelSize(WIDE, STORAGE_FIT)).toEqual(minPanelSize(WIDE));
  });

  it('uses the given minimum size in defaults, clamp and resize', () => {
    expect(minPanelSize(WIDE, SHOPS)).toEqual({ w: 260, h: 320 });
    expect(defaultCells(5, 0, NARROW, SHOPS).every(cell => cell.w === 260)).toBe(true);
    expect(clampCell({ x: 0, y: 0, w: 50, h: 50 }, WIDE, null, SHOPS)).toMatchObject({ w: 260, h: 320 });
    expect(resizedSize({ x: 0, y: 0, w: 400, h: 500 }, -1000, -1000, WIDE, SHOPS)).toEqual({ w: 260, h: 320 });
  });

  it('keeps an unplaced shop cell from sitting above the screen', () => {
    expect(clampCell({ x: 10, y: -900, w: 380, h: 600 }, WIDE, null, SHOPS).y).toBe(0);
    expect(startingCells(['a'], { a: { x: 0, y: -0.5, w: 0.25, h: 0.5 } }, 0, WIDE, SHOPS)[0]?.y).toBe(0);
  });

  it('moves without changing size when the fit does not shorten', () => {
    expect(movedCell({ x: 100, y: 100, w: 300, h: 800 }, 50, 300, WIDE)).toEqual({ x: 150, y: 400, w: 300, h: 800 });
  });

  it('shortens a shop pushed past the bottom edge, never below the minimum, and grows it back to its start height', () => {
    const start = { x: 100, y: 0, w: 300, h: 800 };
    expect(movedCell(start, 0, 300, WIDE, SHOPS)).toEqual({ x: 100, y: 300, w: 300, h: 600 });
    expect(movedCell(start, 0, 800, WIDE, SHOPS).h).toBe(320);
    expect(movedCell(start, 0, 50, WIDE, SHOPS).h).toBe(800);
    expect(movedCell(start, 0, -50, WIDE, SHOPS).h).toBe(800);
    // After the clamp a shortened shop's bottom edge stays on screen.
    const clamped = clampCell(movedCell(start, 0, 300, WIDE, SHOPS), WIDE, null, SHOPS);
    expect(clamped.y + clamped.h).toBeLessThanOrEqual(WIDE.h);
  });
});

describe('multi-storage layout preview', () => {
  it('shows default cells as screen shares in open order when nothing is saved', () => {
    const cells = previewCells(['A', 'B'], {}, 100, WIDE);
    expect(cells.map(c => c.storageId)).toEqual(['A', 'B']);
    expect(cells[0]).toEqual({ storageId: 'A', x: 100 / 1600, y: 0, w: 750 / 1600, h: 1 });
    expect(cells[1]?.x).toBeCloseTo(850 / 1600);
  });

  it('uses saved places and lists them back to front', () => {
    const saved = { A: { x: 0.5, y: 0.1, w: 0.25, h: 0.6, z: 1 }, B: { x: 0.1, y: 0.2, w: 0.3, h: 0.7, z: 0 } };
    const cells = previewCells(['A', 'B'], saved, 0, WIDE);
    expect(cells.map(c => c.storageId)).toEqual(['B', 'A']);
    expect(cells[1]).toEqual({ storageId: 'A', x: 0.5, y: 0.1, w: 0.25, h: 0.6 });
  });

  it('is empty for an unknown screen', () => {
    expect(previewCells(['A'], {}, 0, { w: 0, h: 0 })).toEqual([]);
  });
});
