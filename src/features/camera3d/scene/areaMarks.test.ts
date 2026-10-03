import { describe, expect, it } from 'vitest';
import { FakeMatrix } from '../__test__/fakeMatrix';
import { FakeNode } from '../__test__/fakeNode';
import { DrawnTable, FullSaves } from '../frame/drawn';
import type { FrameCtx } from '../frame/frame';
import { makeBasis, project } from '../math/camera';
import type { Mat, Node3 } from '../types';
import { createAreaMarks, isAreaGrid } from './areaMarks';
import { newPlacement, placeBillboard } from './entities';

const W = 1000, H = 600;

// Live 1381 shape: Tile (x,y) → <Species> View → Morph → <Species> Visual → AreaIndicator → 8 sprites on the tile grid,
// each attached to AboveGround (AreaTileIndicator, groundMark band).
function binderTile(layer: FakeNode, shown = true) {
  const world = new FakeNode();
  const tile = world.addChild(new FakeNode(5120, 3840));
  const view = tile.addChild(new FakeNode());
  const morph = view.addChild(new FakeNode());
  const visual = morph.addChild(new FakeNode());
  const area = visual.addChild(new FakeNode());
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
    const s = area.addChild(new FakeNode(dx * 256, dy * 256).withTexture(256, 256, 0.5));
    Object.assign(s, { parentRenderLayer: layer, visible: shown });
  }
  return { world, tile, area };
}

function ctxAt(pitchDeg: number, world: FakeNode, k = 1.5) {
  const fov = (20 * Math.PI) / 180, fpx = H / 2 / Math.tan(fov / 2);
  const params = { yaw: 0, pitch: (pitchDeg * Math.PI) / 180, dist: fpx / k, fov, lookH: 0, yOff: 0, near: 40, far: 9000 };
  const puts: Array<[string, unknown, unknown]> = [];
  const drops: Array<[string, unknown]> = [];
  const ov = {
    put: (key: string, n: unknown, v: unknown) => { puts.push([key, n, v]); },
    drop: (key: string, n: unknown) => { drops.push([key, n]); },
    raw: (key: string) => (key === 'alpha' ? 1 : true),
    gameValue: (key: string, n: FakeNode) => (key === 'visible' ? n.visible : 0),
  };
  const ctx = {
    W, H, params, basis: makeBasis(params, 5000, 4000, W, H), out: [0, 0, 0], ov, saves: new FullSaves(), drawn: new DrawnTable(),
    reCull: false, roll: -1, marginX: W * 0.75, marginTop: H * 0.75, dx: 0, dz: -1, frameNo: 7, exactKeys: false,
    caps: { scene: { world: world.node }, classes: { Matrix: FakeMatrix } },
  } as unknown as FrameCtx;
  return { ctx, puts, drops };
}

describe('isAreaGrid', () => {
  it('matches the game area indicator and nothing else on the ground layer', () => {
    const layer = new FakeNode();
    const { area } = binderTile(layer);
    expect(isAreaGrid(area.node, layer.node)).toBe(true);
    const dirt = new FakeNode();
    Object.assign(dirt.addChild(new FakeNode(0, 0).withTexture(144, 127, 0.5)), { parentRenderLayer: layer });
    expect(isAreaGrid(dirt.node, layer.node)).toBe(false);
    area.children[2]!.x = 300;
    expect(isAreaGrid(area.node, layer.node)).toBe(false);
  });
});

describe('createAreaMarks', () => {
  it('straight down, every shown tile lands exactly where 2D draws it', () => {
    const layer = new FakeNode();
    const { world, tile, area } = binderTile(layer);
    const { ctx } = ctxAt(90, world);
    const marks = createAreaMarks();
    expect(marks.claim(area.children[0]!.node, layer.node, world.node)).toBe(true);
    const lp = newPlacement();
    placeBillboard(ctx, tile.node, { isTile: true, standY: 3840, depthY: 3840, tiebreak: 0, artRow: true }, lp);
    marks.lay(ctx, tile.node, lp);
    for (const s of area.children) {
      const at = s.lastSet!.apply({ x: 0, y: 0 });
      expect(at.x).toBeCloseTo(W / 2 + 1.5 * (5120 + s.x - 5000), 6);
      expect(at.y).toBeCloseTo(H / 2 + 1.5 * (3840 + s.y - 4000), 6);
      expect(s.lastSet!.a).toBeCloseTo(1.5, 6);
    }
    // The container is counter-transformed to screen space: the tile's billboard no longer moves it.
    const inv = area.lastSet!;
    expect(inv.a).toBeCloseTo(1 / tile.scale.x, 9);
  });

  it('tilted, each tile centre is the ground projection of its own tile', () => {
    const layer = new FakeNode();
    const { world, tile, area } = binderTile(layer);
    const { ctx } = ctxAt(35, world);
    const marks = createAreaMarks();
    marks.claim(area.children[0]!.node, layer.node, world.node);
    const lp = newPlacement();
    placeBillboard(ctx, tile.node, { isTile: true, standY: 3840, depthY: 3840, tiebreak: 0, artRow: true }, lp);
    marks.lay(ctx, tile.node, lp);
    const o = [0, 0, 0];
    for (const s of area.children) {
      project(ctx.basis, 5120 + s.x, 0, 3840 + s.y, o);
      const at = s.lastSet!.apply({ x: 0, y: 0 });
      expect(at.x).toBeCloseTo(o[0]!, 6);
      expect(at.y).toBeCloseTo(o[1]!, 6);
    }
  });

  it('leaves hidden tiles alone and hides the marks of an owner that was not drawn', () => {
    const layer = new FakeNode();
    const { world, tile, area } = binderTile(layer, false);
    const { ctx, puts, drops } = ctxAt(35, world);
    const marks = createAreaMarks();
    marks.claim(area.children[0]!.node, layer.node, world.node);
    marks.finish(ctx);
    expect(puts.filter(([k, , v]) => k === 'visible' && v === false)).toHaveLength(8);
    const lp = newPlacement();
    placeBillboard(ctx, tile.node, { isTile: true, standY: 3840, depthY: 3840, tiebreak: 0, artRow: true }, lp);
    marks.lay(ctx, tile.node, lp);
    expect(drops.filter(([k]) => k === 'visible')).toHaveLength(8);
    expect(area.children.every((s) => s.lastSet === null)).toBe(true);
    marks.finish(ctx);
    expect(puts.filter(([k, , v]) => k === 'visible' && v === false)).toHaveLength(8);
  });

  it('tilted, a perspective sink gets every shown tile at its 2D world place, each pinned hidden once', () => {
    const layer = new FakeNode();
    const { world, tile, area } = binderTile(layer);
    const { ctx, puts } = ctxAt(35, world);
    const got: Array<{ x: number; y: number; alpha: number }> = [];
    const sink = { add: (_c: FrameCtx, s: Node3, w2: Mat, alpha: number) => { const p = w2.apply(s.position); got.push({ x: p.x, y: p.y, alpha }); return true; } };
    const marks = createAreaMarks(sink);
    marks.claim(area.children[0]!.node, layer.node, world.node);
    const lp = newPlacement();
    placeBillboard(ctx, tile.node, { isTile: true, standY: 3840, depthY: 3840, tiebreak: 0, artRow: true }, lp);
    marks.lay(ctx, tile.node, lp);
    marks.lay(ctx, tile.node, lp);
    expect(got).toHaveLength(16);
    area.children.forEach((s, i) => { expect([got[i]!.x, got[i]!.y, got[i]!.alpha]).toEqual([5120 + s.x, 3840 + s.y, 1]); });
    expect(puts.filter(([k, , v]) => k === 'visible' && v === false)).toHaveLength(8);
    expect(area.lastSet).toBeNull();
    expect(area.children.every((s) => s.lastSet === null)).toBe(true);
  });

  it('straight down (or when the sink declines) it keeps the sprite path and hands the pins back', () => {
    const layer = new FakeNode();
    const { world, tile, area } = binderTile(layer);
    const { ctx, drops } = ctxAt(35, world);
    let accept = true, calls = 0;
    const marks = createAreaMarks({ add: () => { calls++; return accept; } });
    marks.claim(area.children[0]!.node, layer.node, world.node);
    const lp = newPlacement();
    placeBillboard(ctx, tile.node, { isTile: true, standY: 3840, depthY: 3840, tiebreak: 0, artRow: true }, lp);
    marks.lay(ctx, tile.node, lp);
    marks.lay({ ...ctx, exactKeys: true, frameNo: 8 } as FrameCtx, tile.node, lp);
    expect(calls).toBe(8);
    expect(drops.filter(([k]) => k === 'visible')).toHaveLength(8);
    expect(area.children.every((s) => s.lastSet !== null)).toBe(true);
    accept = false;
    marks.lay({ ...ctx, frameNo: 9 } as FrameCtx, tile.node, lp);
    expect(calls).toBe(16);
    expect(drops.filter(([k]) => k === 'visible')).toHaveLength(8);
  });

  it('keeps a World-level grid on the marker path and forgets a destroyed container', () => {
    const layer = new FakeNode();
    const world = new FakeNode();
    const top = world.addChild(new FakeNode());
    const s = top.addChild(new FakeNode(256, 0).withTexture(256, 256, 0.5));
    Object.assign(top.addChild(new FakeNode(0, 256).withTexture(256, 256, 0.5)), { parentRenderLayer: layer });
    Object.assign(s, { parentRenderLayer: layer });
    const marks = createAreaMarks();
    expect(marks.claim(s.node, layer.node, world.node)).toBe(false);
    const b = binderTile(layer);
    const m2 = createAreaMarks();
    m2.claim(b.area.children[0]!.node, layer.node, b.world.node);
    expect(m2.count()).toBe(1);
    expect(m2.isMark(b.area.children[3]!.node)).toBe(true);
    b.area.destroyed = true;
    m2.finish(ctxAt(35, b.world).ctx);
    expect(m2.count()).toBe(0);
    expect(m2.isMark(b.area.children[3]!.node)).toBe(false);
  });
});
