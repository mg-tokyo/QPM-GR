import { describe, expect, it, vi } from 'vitest';

vi.mock('../../core/gameState', () => ({ readSync: () => null }));
vi.mock('../../core/pixiScene', () => ({ walkScene: () => undefined }));

const {
  cellRenderer, checkFirstView, checkStorageSystem, panelIdFor, withoutPouchCell, withoutPouchPresentation,
} = await import('./gameHooks');
type GameRenderer = import('./gameHooks').GameRenderer;
type GridMetrics = import('./gameHooks').GridMetrics;
type LayoutFn = import('./gameHooks').LayoutFn;

class FakeContainer { children: unknown[] = []; addChild(): void { /* fake */ } }
class FakeStorageSystem {
  uiContainer = new FakeContainer();
  renderer = { width: 1600, height: 900 };
  batchRenderer = {};
  modalView = null;
  closingView = null;
  activeStorageType = null;
  onModalChanged(): void { /* fake */ }
  draw(): void { /* fake */ }
  forceCloseViews(): void { /* fake */ }
  destroy(): void { /* fake */ }
}

describe('checkStorageSystem', () => {
  it('accepts a system with every handle', () => {
    const sys = new FakeStorageSystem();
    const check = checkStorageSystem(sys);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.SystemClass).toBe(FakeStorageSystem);
      expect(check.proto).toBe(FakeStorageSystem.prototype);
    }
  });

  it('names each missing handle', () => {
    const sys = new FakeStorageSystem() as unknown as Record<string, unknown>;
    sys.forceCloseViews = undefined;
    sys.batchRenderer = null;
    sys.renderer = { width: Number.NaN, height: 900 };
    expect(checkStorageSystem(sys)).toEqual({ ok: false, missing: ['forceCloseViews', 'renderer', 'batchRenderer'] });
  });

  it('wants the open-panel method on the prototype and the state fields on the instance', () => {
    class Bare { uiContainer = new FakeContainer(); renderer = { width: 1, height: 1 }; batchRenderer = {}; draw(): void {} forceCloseViews(): void {} destroy(): void {} }
    expect(checkStorageSystem(new Bare())).toEqual({ ok: false, missing: ['onModalChanged', 'modalView', 'closingView', 'activeStorageType'] });
  });

  it('rejects a missing system or a plain object', () => {
    expect(checkStorageSystem(null)).toEqual({ ok: false, missing: ['system'] });
    const plain = checkStorageSystem({});
    expect(plain.ok).toBe(false);
    if (!plain.ok) expect(plain.missing).toContain('constructor');
  });
});

describe('checkFirstView', () => {
  it('accepts a built sheet', () => {
    expect(checkFirstView({ itemSheet: { body: {}, widthPx: 480, lastViewportRevision: -1 } })).toEqual([]);
  });

  it('names what a changed sheet lacks', () => {
    expect(checkFirstView(null)).toEqual(['view']);
    expect(checkFirstView({})).toEqual(['view.itemSheet']);
    expect(checkFirstView({ itemSheet: { body: null } })).toEqual([
      'view.itemSheet.body', 'view.itemSheet.widthPx', 'view.itemSheet.lastViewportRevision',
    ]);
  });
});

describe('panelIdFor', () => {
  const panels = ['petHutch', 'seedSilo', 'feedingTrough'];

  it('matches the building id to the game panel id', () => {
    expect(panelIdFor('PetHutch', panels)).toBe('petHutch');
    expect(panelIdFor('FeedingTrough', panels)).toBe('feedingTrough');
  });

  it('is null for a storage with no panel', () => {
    expect(panelIdFor('DecorShed', panels)).toBeNull();
  });
});

describe('cellRenderer', () => {
  const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 450 }), id: 'game' } as unknown as HTMLCanvasElement;
  const real = { width: 1600, height: 900, canvas, resolution: 2, scale(this: { resolution: number }) { return this.resolution; } };

  it('reports the cell size and shrinks the canvas rect by the same ratio', () => {
    const cell = { x: 0, y: 0, w: 400, h: 450 };
    const r = cellRenderer(real as GameRenderer, cell);
    expect([r.width, r.height]).toEqual([400, 450]);
    const rect = r.canvas?.getBoundingClientRect();
    expect(rect && [rect.left, rect.top, rect.width, rect.height]).toEqual([10, 20, 200, 225]);
    // renderer.width / rect.width is unchanged, so mouse conversion still lands on screen pixels.
    expect(rect && r.width / rect.width).toBe(real.width / 800);
  });

  it('follows the cell when it changes and passes everything else through', () => {
    const cell = { x: 0, y: 0, w: 400, h: 450 };
    const r = cellRenderer(real as GameRenderer, cell) as GameRenderer & typeof real;
    cell.w = 500;
    expect(r.width).toBe(500);
    expect(r.canvas).toBe(r.canvas);
    expect((r.canvas as unknown as { id: string }).id).toBe('game');
    expect(r.scale()).toBe(2);
  });

  it('writes through to the real renderer', () => {
    const target = { ...real };
    const r = cellRenderer(target as GameRenderer, { x: 0, y: 0, w: 1, h: 1 }) as GameRenderer & typeof real;
    r.resolution = 3;
    expect(target.resolution).toBe(3);
  });
});

describe('tool pouch cell', () => {
  const metrics: GridMetrics = { columns: 3, cellSizePx: 50, gapPx: 4, paddingXPx: 8, paddingTopPx: 6 };
  const cellAt = (i: number) => ({ x: 8 + (i % 3) * 54, y: 6 + Math.floor(i / 3) * 54, sizePx: 50 });
  // The game reserves the first cell: four items land in cells 1..4.
  const reserved: LayoutFn = () => ({ cells: [1, 2, 3, 4].map(cellAt), contentHeightPx: 104 });

  it('re-lays the bag from the first cell', () => {
    const placement = withoutPouchCell(reserved, metrics)([]);
    expect(placement.cells).toEqual([0, 1, 2, 3].map(cellAt));
    expect(placement.contentHeightPx).toBe(cellAt(3).y + 50);
  });

  it('leaves a layout that already starts at the first cell alone, and reuses the wrapper', () => {
    const plain: LayoutFn = () => ({ cells: [0, 1].map(cellAt) });
    expect(withoutPouchCell(plain, metrics)([]).cells).toEqual([0, 1].map(cellAt));
    expect(withoutPouchCell(reserved, metrics)).toBe(withoutPouchCell(reserved, metrics));
  });

  it('sizes the bag section for its own items and drops the leading empty cell', () => {
    const presentation = {
      sections: [
        { entries: [1], layout: () => reserved },
        { entries: [1, 2, 3, 4], layout: () => reserved, heightPx: 999 },
      ],
      emptyState: [null, { leadingCellCount: 1, text: 'empty' }],
    };
    const next = withoutPouchPresentation(presentation, metrics);
    expect(next.sections[0]).toBe(presentation.sections[0]);
    expect(next.sections[1]?.heightPx).toBe(6 + 2 * 50 + 4);
    expect(next.sections[1]?.layout('grid')([]).cells[0]).toEqual(cellAt(0));
    expect(next.emptyState[1]).toEqual({ leadingCellCount: 0, text: 'empty' });
    expect(presentation.sections[1]?.heightPx).toBe(999);
  });
});
