import { describe, expect, it } from 'vitest';
import type { DecorCatalogEntry } from '../../../catalogs/types';
import { TILE } from '../constants';
import { createSideDecorPass, createSideDecorSource, sideViewOf, sideWall } from './sideDecor';

// Live v1847 (2026-11-02) catalog shapes: an arch turns to a side sprite at 90/270; a bench maps 180 to a back view.
const ARCH: DecorCatalogEntry = {
  art: 'sprite/decor/WoodArch', coinPrice: 0, creditPrice: 0,
  rotationVariants: { 90: { sprite: 'sprite/decor/WoodArchSide', flipH: true }, 180: { sprite: 'sprite/decor/WoodArch', flipH: true }, 270: { sprite: 'sprite/decor/WoodArchSide' } },
};
const BENCH: DecorCatalogEntry = {
  art: 'sprite/decor/WoodBench', coinPrice: 0, creditPrice: 0,
  rotationVariants: { 90: { sprite: 'sprite/decor/WoodBenchSideways', flipH: true }, 180: { sprite: 'sprite/decor/WoodBenchBackwards' }, 270: { sprite: 'sprite/decor/WoodBenchSideways' } },
};
const STATUE: DecorCatalogEntry = { art: 'sprite/decor/Statue', coinPrice: 0, creditPrice: 0 };
const SAME: DecorCatalogEntry = { art: 'sprite/decor/Rock', coinPrice: 0, creditPrice: 0, rotationVariants: { 90: { sprite: 'sprite/decor/Rock' } } };
// literal-list-justified: test fake of the decor catalog (getDecor stand-in)
const CAT: Record<string, DecorCatalogEntry> = { WoodArch: ARCH, WoodBench: BENCH, Statue: STATUE, Rock: SAME };
const getDecor = (id: string): DecorCatalogEntry | null => CAT[id] ?? null;

describe('sideViewOf', () => {
  it('turns 90 and 270 into the front art, flipped as the side variant is', () => {
    expect(sideViewOf(ARCH, 90)).toEqual({ art: 'sprite/decor/WoodArch', flip: true });
    expect(sideViewOf(ARCH, 270)).toEqual({ art: 'sprite/decor/WoodArch', flip: false });
  });
  it('normalises -360, 450 and -90', () => {
    expect(sideViewOf(ARCH, -360)).toBeNull();
    expect(sideViewOf(ARCH, 450)).toEqual({ art: 'sprite/decor/WoodArch', flip: true });
    expect(sideViewOf(ARCH, -90)).toEqual({ art: 'sprite/decor/WoodArch', flip: false });
  });
  it('excludes a back view at 180 and anything unrotated', () => {
    expect(sideViewOf(BENCH, 180)).toBeNull();
    expect(sideViewOf(BENCH, 0)).toBeNull();
    expect(sideViewOf(BENCH, 270)).toEqual({ art: 'sprite/decor/WoodBench', flip: false });
  });
  it('is null without a variant, with a variant equal to the art, or without a catalog entry', () => {
    expect(sideViewOf(STATUE, 90)).toBeNull();
    expect(sideViewOf(SAME, 90)).toBeNull();
    expect(sideViewOf(null, 90)).toBeNull();
    expect(sideViewOf(ARCH, Number.NaN)).toBeNull();
    expect(sideViewOf({ coinPrice: 0, creditPrice: 0, rotationVariants: ARCH.rotationVariants! }, 90)).toBeNull();
  });
});

type View = { displayObject: { label: string; children: unknown[] }; worldPosition: { x: number; y: number }; tileObject: Record<string, unknown> };
function view(x: number, y: number, decorId: string, rotation: number, objectType = 'decor'): View {
  return { displayObject: { label: `Tile (${x}, ${y})`, children: [] }, worldPosition: { x, y }, tileObject: { objectType, decorId, rotation } };
}

describe('createSideDecorSource', () => {
  it('lists the side-view tiles at their tile centres', () => {
    const views = new Map<unknown, unknown>([[1, view(50, 36, 'WoodArch', 90)], [2, view(3, 4, 'WoodBench', 180)], [3, view(5, 6, 'Statue', 90)], [4, view(7, 8, 'WoodArch', 0, 'plant')]]);
    const src = createSideDecorSource({ tileViews: views }, getDecor);
    src.rescan();
    expect(src.tiles()).toHaveLength(1);
    const t = src.tiles()[0]!;
    expect(t).toMatchObject({ cx: 50 * TILE + TILE / 2, cz: 36 * TILE + TILE / 2, art: 'sprite/decor/WoodArch', flip: true });
    expect(t.node).toBe((views.get(1) as View).displayObject);
    expect(src.isSide(t.node)).toBe(true);
    expect(src.isSide((views.get(2) as View).displayObject as never)).toBe(false);
  });

  it('keeps its version across a rescan with no change and moves it on a change', () => {
    const arch = view(50, 36, 'WoodArch', 90);
    const views = new Map<unknown, unknown>([[1, arch], [2, view(3, 4, 'WoodBench', 0)]]);
    const src = createSideDecorSource({ tileViews: views }, getDecor);
    src.rescan();
    const v0 = src.version();
    src.rescan();
    expect(src.version()).toBe(v0);
    // A non-side rotation change on another tile leaves the set alone.
    (views.get(2) as View).tileObject.rotation = 180;
    src.rescan();
    expect(src.version()).toBe(v0);
    arch.tileObject.rotation = 270;
    src.rescan();
    const v1 = src.version();
    expect(v1).not.toBe(v0);
    expect(src.tiles()[0]!.flip).toBe(false);
    views.set(3, view(9, 9, 'WoodBench', 90));
    src.rescan();
    expect(src.version()).not.toBe(v1);
    expect(src.tiles()).toHaveLength(2);
    const v2 = src.version();
    views.delete(1);
    src.rescan();
    expect(src.version()).not.toBe(v2);
    expect(src.isSide(arch.displayObject as never)).toBe(false);
  });

  it('the pass rescans on its first frame, on a full or rolling re-cull, and again after a drop', () => {
    const views = new Map<unknown, unknown>();
    const src = createSideDecorSource({ tileViews: views }, getDecor);
    const pass = createSideDecorPass(src);
    const ctx = (reCull: boolean, roll: number) => ({ reCull, roll }) as never;
    views.set(1, view(1, 1, 'WoodArch', 90));
    pass.pre(ctx(false, -1));
    expect(src.tiles()).toHaveLength(1);
    views.set(2, view(2, 2, 'WoodArch', 90));
    pass.pre(ctx(false, 3));
    expect(src.tiles()).toHaveLength(1);
    pass.pre(ctx(false, 0));
    expect(src.tiles()).toHaveLength(2);
    views.delete(2);
    pass.pre(ctx(true, -1));
    expect(src.tiles()).toHaveLength(1);
    views.set(3, view(3, 3, 'WoodArch', 90));
    pass.drop();
    pass.pre(ctx(false, -1));
    expect(src.tiles()).toHaveLength(2);
  });

  it('remembers every node that was ever a side view (its card fade must be re-run once it is not)', () => {
    const arch = view(1, 1, 'WoodArch', 90);
    const src = createSideDecorSource({ tileViews: new Map<unknown, unknown>([[1, arch]]) }, getDecor);
    src.rescan();
    arch.tileObject.rotation = 0;
    src.rescan();
    expect(src.isSide(arch.displayObject as never)).toBe(false);
    expect(src.wasSide(arch.displayObject as never)).toBe(true);
  });

  it('skips views of the wrong shape and works without the garden system', () => {
    const views = new Map<unknown, unknown>([[1, null], [2, { tileObject: { objectType: 'decor', decorId: 'WoodArch', rotation: 90 } }], [3, { ...view(1, 1, 'WoodArch', 90), worldPosition: { x: '1', y: 1 } }]]);
    const src = createSideDecorSource({ tileViews: views }, getDecor);
    src.rescan();
    expect(src.tiles()).toHaveLength(0);
    const none = createSideDecorSource(null, getDecor);
    none.rescan();
    expect(none.tiles()).toHaveLength(0);
  });
});

// Live v1847 front art: WoodArch 296×376, anchor (0.5, 0.816); MarbleBridge 286×300 with trim y 8, anchor y 0.78.
describe('sideWall', () => {
  const tile = (flip: boolean) => ({ node: {} as never, cx: 1000, cz: 2000, art: 'a', flip });
  it('stands the front art on the tile N-S line, anchor x on the tile centre, up to its ground row', () => {
    const arch = { frame: { width: 296, height: 376 }, orig: { width: 296, height: 376 }, defaultAnchor: { x: 0.5, y: 0.816 } };
    expect(sideWall(tile(false), arch)).toEqual({ w: 296, base: 307, ax: 1000, az: 2000 - 148, bx: 1000, bz: 2000 + 148 });
  });
  it('reads the ground row and the anchor column through the trim, capped at the frame', () => {
    const bridge = { frame: { width: 280, height: 290 }, orig: { width: 286, height: 300 }, trim: { x: 6, y: 8 }, defaultAnchor: { x: 0.5, y: 0.78 } };
    expect(sideWall(tile(false), bridge)).toEqual({ w: 280, base: 226, ax: 1000, az: 2000 - 137, bx: 1000, bz: 2000 + 143 });
    const deep = { frame: { width: 100, height: 50 }, orig: { width: 100, height: 100 }, defaultAnchor: { x: 0.5, y: 1 } };
    expect(sideWall(tile(false), deep)!.base).toBe(50);
  });
  it('flip swaps the ends (the texture runs the other way along the line)', () => {
    const bridge = { frame: { width: 280, height: 290 }, orig: { width: 286, height: 300 }, trim: { x: 6, y: 8 }, defaultAnchor: { x: 0.5, y: 0.78 } };
    expect(sideWall(tile(true), bridge)).toEqual({ w: 280, base: 226, ax: 1000, az: 2000 + 137, bx: 1000, bz: 2000 - 143 });
  });
  it('without a default anchor the art stands on its bottom row, centred; nothing to stand is null', () => {
    expect(sideWall(tile(false), { frame: { width: 200, height: 100 }, orig: { width: 200, height: 100 } })).toEqual({ w: 200, base: 100, ax: 1000, az: 1900, bx: 1000, bz: 2100 });
    expect(sideWall(tile(false), { frame: { width: 200, height: 100 }, orig: { width: 200, height: 100 }, defaultAnchor: { x: 0.5, y: 0 } })).toBeNull();
    expect(sideWall(tile(false), { frame: { width: 0, height: 100 }, orig: { width: 0, height: 100 } })).toBeNull();
  });
  it('a rotated atlas frame (sprite-v2/atlas.ts packs some rotated) gets no wall: its panel would read sideways', () => {
    const art = { frame: { width: 296, height: 376 }, orig: { width: 296, height: 376 }, defaultAnchor: { x: 0.5, y: 0.816 } };
    expect(sideWall(tile(false), { ...art, rotate: 2 })).toBeNull();
    expect(sideWall(tile(false), { ...art, rotate: 0 })).not.toBeNull();
  });
});
