import { describe, expect, it } from 'vitest';
import { FakeMatrix } from '../__test__/fakeMatrix';
import { FakeNode } from '../__test__/fakeNode';
import { makeBasis, project } from '../math/camera';
import { DrawnTable, FullSaves } from '../frame/drawn';
import type { FrameCtx } from '../frame/frame';
import { applyLift, createLifter, liftUnits, RESCAN_FRAMES, RESCAN_PER_FRAME, scanEntity } from './lift';

// The live Tile shape (spec §17): Tile → an inner (0,0) container chain → positioned `<Species> slot-N` → sprite leaf.
const leaf = (): FakeNode => new FakeNode().withTexture(200, 100, 0.88);
const tileWith = (...kids: FakeNode[]): FakeNode => new FakeNode(5000, 4000, 1, [new FakeNode(0, 0, 1, kids)]);
const M = FakeMatrix as never;
const noLayer = (): boolean => false;

describe('scanEntity / liftUnits', () => {
  it('lifts a slot attached at or below the stand row whose art hangs below it (Emberbloom patch); tree slots stay', () => {
    const ground = new FakeNode(0, 150, 1, [leaf()]);
    const tree = new FakeNode(0, -300, 1, [leaf()]);
    const scan = scanEntity(tileWith(ground, tree).node, M, noLayer);
    expect(scan.base).toBeNull();
    const units = liftUnits(scan, 0, 32);
    expect(units.length).toBe(1);
    expect(units[0]!.node).toBe(ground.node);
    // Art bottom: slot y 150 + (1 − 0.88) × 100.
    expect(units[0]!.foot.y).toBeCloseTo(162, 6);
  });

  it('keeps a slot attached above the stand row on the card even when its tip hangs below it (Burro\'s Tail)', () => {
    const trellis = new FakeNode().withTexture(205, 195, 0.8);
    const tail = new FakeNode(0, -116, 1, [new FakeNode().withTexture(157, 250, 0.12)]);
    const scan = scanEntity(tileWith(trellis, tail).node, M, noLayer);
    expect(scan.base).toBeCloseTo(39, 6);
    expect(scan.cands.length).toBe(1);
    expect(scan.cands[0]!.foot.y).toBeCloseTo(104, 6);
    expect(liftUnits(scan, scan.base!, 32).length).toBe(0);
  });

  it('stands a tile on its largest base sprite: a mutation icon at the crop origin does not move it', () => {
    const crop = new FakeNode().withTexture(446, 1280, 0.95);
    const icon = new FakeNode(0, 0, 1.5).withTexture(290, 232, 0.47);
    const scan = scanEntity(tileWith(new FakeNode(0, 0, 1, [crop, icon])).node, M, noLayer);
    expect(scan.base).toBeCloseTo(64, 6);
  });

  it('ignores hidden, transparent and layer sprites for the base', () => {
    const hidden = new FakeNode().withTexture(400, 400, 0);
    hidden.visible = false;
    const clear = new FakeNode().withTexture(400, 400, 0);
    clear.alpha = 0;
    const dirt = new FakeNode().withTexture(400, 400, 0.5);
    const body = new FakeNode().withTexture(100, 100, 0.8);
    const scan = scanEntity(tileWith(hidden, clear, dirt, body).node, M, (n) => n === dirt.node);
    expect(scan.base).toBeCloseTo(20, 6);
  });

  it('skips a Graphics on the (0,0) chain: its `texture` is the draw method (TramRoot stencil mask, live 2026-10-03)', () => {
    const mask = new FakeNode();
    (mask as unknown as { texture: unknown }).texture = () => undefined;
    const body = new FakeNode().withTexture(100, 100, 0.8);
    const scan = scanEntity(new FakeNode(3000, 8000, 1, [mask, body]).node, M, noLayer);
    expect(scan.base).toBeCloseTo(20, 6);
    expect(scan.baseNode).toBe(body.node);
  });

  it('measures from the stand row, not the origin (an avatar stands 200 px below its origin)', () => {
    const scan = scanEntity(tileWith(new FakeNode(0, 200, 1, [leaf()])).node, M, noLayer);
    expect(liftUnits(scan, 200, 32).length).toBe(0);
    expect(liftUnits(scan, 100, 32).length).toBe(1);
  });

  it('is exact straight down: the lifted slot keeps its own 2D local transform', () => {
    const W = 1000, H = 600, k = 1.5, fov = (20 * Math.PI) / 180;
    const fpx = H / 2 / Math.tan(fov / 2);
    const basis = makeBasis({ yaw: 0, pitch: Math.PI / 2, dist: fpx / k, fov, lookH: 0, yOff: 0, near: 40, far: 9000 }, 5000, 4000, W, H);
    const slot = new FakeNode(0, 150, 1, [leaf()]);
    const tile = tileWith(slot);
    const units = liftUnits(scanEntity(tile.node, M, noLayer), 0, 32);
    expect(units.length).toBe(1);
    // Billboard the tile the way placeBillboard does, then lift its slot.
    const out = [0, 0, 0];
    project(basis, 5000, 0, 4000, out);
    const mm = basis.fpx / out[2]!;
    tile.position.set(out[0]!, out[1]!);
    tile.scale.set(mm, mm);
    const ctx = { basis, out, params: { near: 40 }, dx: 0, dz: -1, saves: new FullSaves(), drawn: new DrawnTable(), caps: { classes: { Matrix: FakeMatrix } } } as unknown as FrameCtx;
    applyLift(ctx, tile.node, { sx: out[0]!, sy: out[1]!, px: out[0]!, mm, fx: 5000, x2d: 5000, fy2d: 4000, key: 0, gdy: 0 }, units);
    const set = slot.lastSet!;
    expect(set.a).toBeCloseTo(1, 6);
    expect(set.tx).toBeCloseTo(0, 4);
    expect(set.ty).toBeCloseTo(150, 4);
  });

  it('moves a lifted slot with its card when the card stands off its art row (tile centring, gdy)', () => {
    const W = 1000, H = 600, fov = (50 * Math.PI) / 180;
    const basis = makeBasis({ yaw: 0, pitch: (30 * Math.PI) / 180, dist: 1500, fov, lookH: 0, yOff: 0, near: 40, far: 9000 }, 5000, 4000, W, H);
    const lifted = (gdy: number): FakeMatrix => {
      const slot = new FakeNode(0, 150, 1, [leaf()]);
      const tile = tileWith(slot);
      const units = liftUnits(scanEntity(tile.node, M, noLayer), 0, 32);
      const ctx = { basis, out: [0, 0, 0], params: { near: 40 }, dx: 0, dz: -1, saves: new FullSaves(), drawn: new DrawnTable(), caps: { classes: { Matrix: FakeMatrix } } } as unknown as FrameCtx;
      applyLift(ctx, tile.node, { sx: 0, sy: 0, px: 0, mm: 1, fx: 5000, x2d: 5000, fy2d: 4000, key: 0, gdy }, units);
      return slot.lastSet!;
    };
    // The slot's art bottom (slot-local y 12, tile-local 162) stands on the ground point 100 px north of its 2D foot.
    const out = [0, 0, 0];
    project(basis, 5000, 0, 4162 - 100, out);
    const foot = lifted(-100).apply({ x: 0, y: 12 });
    expect(foot.x).toBeCloseTo(out[0]! - 5000, 3);
    expect(foot.y).toBeCloseTo(out[1]! - 4000, 3);
    project(basis, 5000, 0, 4162, out);
    expect(lifted(0).apply({ x: 0, y: 12 }).y).toBeCloseTo(out[1]! - 4000, 3);
  });

  it('records each lifted unit\'s own screen map for picking (A I6); a unit behind the lens is recorded as not drawn', () => {
    const basis = makeBasis({ yaw: 0, pitch: (30 * Math.PI) / 180, dist: 1500, fov: (50 * Math.PI) / 180, lookH: 0, yOff: 0, near: 40, far: 9000 }, 5000, 4000, 1000, 600);
    const slot = new FakeNode(0, 150, 1, [leaf()]);
    const tile = tileWith(slot);
    const units = liftUnits(scanEntity(tile.node, M, noLayer), 0, 32);
    const drawn = new DrawnTable();
    const ctx = { basis, out: [0, 0, 0], params: { near: 40 }, dx: 0, dz: -1, saves: new FullSaves(), drawn, caps: { classes: { Matrix: FakeMatrix } } } as unknown as FrameCtx;
    applyLift(ctx, tile.node, { sx: 0, sy: 0, px: 0, mm: 1, fx: 5000, x2d: 5000, fy2d: 4000, key: 0, gdy: -100 }, units);
    const out = [0, 0, 0];
    project(basis, 5000, 0, 4062, out);
    const e = drawn.liftFor(slot.node)!;
    expect(e.owner).toBe(tile.node);
    expect([e.x, e.y]).toEqual([5000, 4162]);
    expect(e.px).toBeCloseTo(out[0]!, 6);
    expect(e.py).toBeCloseTo(out[1]!, 6);
    expect(e.mm).toBeCloseTo(basis.fpx / out[2]!, 9);
    // The map agrees with the transform the unit was drawn with: its art foot (slot-local y 12) lands on (px, py).
    const drawnFoot = slot.lastSet!.apply({ x: 0, y: 12 });
    expect(drawnFoot.x + 5000).toBeCloseTo(e.px, 3);
    expect(drawnFoot.y + 4000).toBeCloseTo(e.py, 3);

    const behind = new DrawnTable();
    // Looking north from 3840: the unit's ground point (y 4162) is behind the lens.
    const far = makeBasis({ yaw: 0, pitch: (5 * Math.PI) / 180, dist: 40, fov: (50 * Math.PI) / 180, lookH: 0, yOff: 0, near: 40, far: 9000 }, 5000, 3800, 1000, 600);
    const ctx2 = { ...ctx, basis: far, drawn: behind, saves: new FullSaves() } as unknown as FrameCtx;
    applyLift(ctx2, tile.node, { sx: 0, sy: 0, px: 0, mm: 1, fx: 5000, x2d: 5000, fy2d: 4000, key: 0, gdy: 0 }, units);
    // Scaled to 0 there; through its card map picking would still find it where it would sit unlifted.
    expect(behind.liftFor(slot.node)?.mm).toBe(0);
    expect(behind.hasLifts(tile.node)).toBe(true);
  });
});

describe('createLifter', () => {
  const D = Math.PI / 180;
  const run = (pitchDeg: number, gameZ: number, opts: { avatar?: boolean; base?: boolean } = {}) => {
    const basis = makeBasis({ yaw: 0, pitch: pitchDeg * D, dist: 1600, fov: 55 * D, lookH: 0, yOff: 0, near: 40, far: 9000 }, 5000, 4000, 1000, 600);
    const slot = new FakeNode(0, 150, 1, [leaf()]);
    const tile = opts.base ? tileWith(new FakeNode().withTexture(400, 400, 0.6), slot) : tileWith(slot);
    const puts: number[] = [];
    const ov = { gameValue: () => gameZ, put: (_k: string, _n: object, v: number) => { puts.push(v); } };
    const ctx = { basis, out: [0, 0, 0], params: { near: 40 }, dx: 0, dz: -1, exactKeys: pitchDeg >= 80, reCull: true, frameNo: 1, ov, saves: new FullSaves(), drawn: new DrawnTable(), caps: { classes: { Matrix: FakeMatrix } } } as unknown as FrameCtx;
    const lifter = createLifter(noLayer, () => !!opts.avatar);
    const standY = lifter.standRow(ctx, tile.node, 4000);
    const out = [0, 0, 0];
    project(basis, 5000, 0, standY, out);
    const mm = basis.fpx / out[2]!;
    tile.position.set(out[0]!, out[1]!);
    tile.scale.set(mm, mm);
    lifter.afterPlace(ctx, tile.node, { sx: out[0]!, sy: out[1]!, px: out[0]!, mm, fx: 5000, x2d: 5000, fy2d: 4000, key: 4000e4, gdy: 0 }, standY);
    return { puts, lifted: slot.lastSet !== null, standY };
  };

  it('keeps the game key straight down (s = 0 order) and raises it to the lifted foot when tilted', () => {
    expect(run(90, 4000e4 + 3)).toEqual({ puts: [], lifted: true, standY: 4000 });
    const tilted = run(30, 4000e4 + 3);
    expect(tilted.lifted).toBe(true);
    expect(tilted.puts.length).toBe(1);
    expect(tilted.puts[0]!).toBeCloseTo(4162e4, -1);
  });

  it('stands a tile with a base sprite on its art bottom; a slot attached above it stays on the card', () => {
    expect(run(30, 4000e4 + 3, { base: true })).toEqual({ puts: [], lifted: false, standY: 4160 });
  });

  it('never lifts an avatar', () => {
    expect(run(30, (4000 + 200) * 1e4 + 2, { avatar: true }).lifted).toBe(false);
  });
});

describe('lifter re-scan policy', () => {
  const at = (frameNo: number, reCull = true): FrameCtx => ({ frameNo, reCull, caps: { classes: { Matrix: FakeMatrix } } }) as unknown as FrameCtx;
  const baseTile = () => { const base = new FakeNode().withTexture(400, 400, 0.6); return { base, tile: tileWith(base) }; };
  const grow = (base: FakeNode): void => { base.texture!.orig.height = 500; };

  it('keeps a scan across reCull frames until it is RESCAN_FRAMES old', () => {
    const { base, tile } = baseTile();
    const l = createLifter(noLayer, () => false);
    expect(l.standRow(at(1), tile.node, 4000)).toBe(4160);
    grow(base);
    expect(l.standRow(at(2), tile.node, 4000)).toBe(4160);
    expect(l.standRow(at(1 + RESCAN_FRAMES), tile.node, 4000)).toBe(4160);
    expect(l.standRow(at(2 + RESCAN_FRAMES, false), tile.node, 4000)).toBe(4200);
  });

  it('re-scans at most RESCAN_PER_FRAME stale entities per frame', () => {
    const tiles = Array.from({ length: RESCAN_PER_FRAME + 5 }, baseTile);
    const l = createLifter(noLayer, () => false);
    for (const t of tiles) l.standRow(at(1), t.tile.node, 4000);
    for (const t of tiles) grow(t.base);
    const f = 2 + RESCAN_FRAMES;
    const fresh = (frame: number): number => tiles.filter((t) => l.standRow(at(frame), t.tile.node, 4000) === 4200).length;
    expect(fresh(f)).toBe(RESCAN_PER_FRAME);
    expect(fresh(f + 1)).toBe(tiles.length);
  });

  it('re-scans at once when the base sprite was swapped or detached', () => {
    const { base, tile } = baseTile();
    const l = createLifter(noLayer, () => false);
    l.standRow(at(1), tile.node, 4000);
    base.withTexture(400, 300, 0.6);
    expect(l.standRow(at(2, false), tile.node, 4000)).toBe(4120);
    tile.children[0]!.removeChild(base);
    expect(l.standRow(at(3, false), tile.node, 4000)).toBe(4000);
  });

  // PIXI 8 (live v1431): visible/alpha setters call _onUpdate (_didContainerChangeTick++), a texture or anchor change
  // calls onViewUpdate (_didViewChangeTick++). A base sprite carrying both ticks, counting its getter reads.
  const tickedBase = () => {
    const base = new FakeNode().withTexture(400, 400, 0.6) as FakeNode & { _didContainerChangeTick: number; _didViewChangeTick: number };
    base._didContainerChangeTick = 0;
    base._didViewChangeTick = 0;
    let reads = 0, tex = base.texture, alpha = 1;
    Object.defineProperty(base, 'texture', { configurable: true, get: () => { reads++; return tex; }, set: (v: typeof tex) => { tex = v; base._didViewChangeTick++; } });
    Object.defineProperty(base, 'alpha', { configurable: true, get: () => { reads++; return alpha; }, set: (v: number) => { alpha = v; base._didContainerChangeTick++; } });
    return { base, tile: tileWith(base), reads: () => reads };
  };

  it('perf 4: unchanged base ticks skip the base sprite checks; the rescan schedule is unchanged', () => {
    const { base, tile, reads } = tickedBase();
    const l = createLifter(noLayer, () => false);
    expect(l.standRow(at(1), tile.node, 4000)).toBe(4160);
    l.standRow(at(2, false), tile.node, 4000);
    const n = reads();
    for (let f = 3; f < 20; f++) l.standRow(at(f, false), tile.node, 4000);
    expect(reads()).toBe(n);
    grow(base);
    expect(l.standRow(at(2 + RESCAN_FRAMES, false), tile.node, 4000)).toBe(4200);
  });

  it('perf 4: a texture swap (view tick) or a fade to 0 (container tick) re-scans at once', () => {
    const swap = tickedBase(), fade = tickedBase();
    const l = createLifter(noLayer, () => false);
    for (const t of [swap, fade]) { l.standRow(at(1), t.tile.node, 4000); l.standRow(at(2, false), t.tile.node, 4000); }
    swap.base.withTexture(400, 300, 0.6);
    fade.base.alpha = 0;
    expect(l.standRow(at(3, false), swap.tile.node, 4000)).toBe(4120);
    expect(l.standRow(at(3, false), fade.tile.node, 4000)).toBe(4000);
  });

  it('perf 4: scanOf is the stand token: the same scan while valid, a new one once re-scanned', () => {
    const { base, tile } = tickedBase();
    const l = createLifter(noLayer, () => false);
    const first = l.scanOf(at(1), tile.node);
    expect(l.scanOf(at(2, false), tile.node)).toBe(first);
    base.withTexture(400, 300, 0.6);
    expect(l.scanOf(at(3, false), tile.node)).not.toBe(first);
  });
});
