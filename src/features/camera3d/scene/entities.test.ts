import { describe, expect, it } from 'vitest';
import { cullOf } from '../__test__/cullOf';
import { FakeNode } from '../__test__/fakeNode';
import { PixiNode } from '../__test__/fakePixi';
import { DrawnTable, FullSaves } from '../frame/drawn';
import { MOVE_PX, RING_PX, ROLL_SLICES, cullSlot, type FrameCtx } from '../frame/frame';
import { PersistTable } from '../frame/persist';
import { makeBasis, project } from '../math/camera';
import { createEntityPass, holdThroughOnRender, newPlacement, placeBillboard } from './entities';

const W = 1000, H = 600, k = 1.5, fov = (20 * Math.PI) / 180;

function topDownCtx(): FrameCtx {
  const fpx = H / 2 / Math.tan(fov / 2);
  const params = { yaw: 0, pitch: Math.PI / 2, dist: fpx / k, fov, lookH: 0, yOff: 0, near: 40, far: 9000 };
  // reCull false: placeBillboard keeps the game's visibility, so only raw() and put() are reached on `ov`.
  const ov = { put: () => undefined, drop: () => undefined, raw: () => true };
  return {
    basis: makeBasis(params, 5000, 4000, W, H), target: { x: 5000, y: 4000 }, params, out: [0, 0, 0], ov, reCull: false, roll: -1, W, H,
    cull: cullOf(makeBasis(params, 5000, 4000, W, H), params, W, H), drawn: new DrawnTable(), saves: new FullSaves(), dx: 0, dz: -1, frameNo: 1,
    persist: new PersistTable(false),
  } as unknown as FrameCtx;
}

describe('placeBillboard (art-row formula)', () => {
  it('straight down, every stand row puts the node exactly where 2D draws it', () => {
    for (const standY of [3900, 4100, 4500]) {
      const n = new FakeNode(5100, 3900).withTexture(100, 100, 1);
      n.anchor!.set(0.2, 1);
      const key = placeBillboard(topDownCtx(), n.node, { isTile: false, standY, depthY: standY, tiebreak: 0, artRow: true }, newPlacement());
      expect(key).not.toBeNull();
      expect(n.x).toBeCloseTo(W / 2 + k * (5100 - 5000), 6);
      expect(n.y).toBeCloseTo(H / 2 + k * (3900 - 4000), 6);
      expect(n.scale.x).toBeCloseTo(k, 9);
    }
  });

  it('tilted, a separate art row stands on the ground point and the placement keeps the shift', () => {
    const ctx = topDownCtx();
    const params = { ...ctx.params, pitch: (30 * Math.PI) / 180 };
    const tilted = { ...ctx, params, basis: makeBasis(params, 5000, 4000, W, H) } as FrameCtx;
    const n = new FakeNode(5100, 3900).withTexture(100, 100, 1);
    const lp = newPlacement();
    placeBillboard(tilted, n.node, { isTile: true, standY: 3900, artY: 4100, depthY: 3900, tiebreak: 0, artRow: true }, lp);
    const out = [0, 0, 0];
    project(tilted.basis, 5100, 0, 3900, out);
    const mm = tilted.basis.fpx / out[2]!;
    expect(n.y).toBeCloseTo(out[1]! - (4100 - 3900) * mm, 6);
    expect(lp.gdy).toBe(-200);
  });

  it('the entity pass visits the game children only and picks up a child added later', () => {
    const world = new FakeNode();
    const a = world.addChild(new FakeNode(5000, 4000)), qpm = world.addChild(new FakeNode(5100, 4000));
    const seen: unknown[] = [];
    const skip = new WeakSet<object>([qpm.node]);
    const pass = createEntityPass({ skip, buildings: null, layers: null, standRow: (_c: unknown, n: unknown, y: number) => { seen.push(n); return y; }, afterPlace: null, fade: null, placeMask: null } as never);
    const ctx = topDownCtx();
    const ov = { put: () => undefined, drop: () => undefined, raw: () => true, gameValue: () => 0 };
    const frame = { ...ctx, ov, reCull: true, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } } } as unknown as FrameCtx;
    pass.pre(frame);
    expect(seen).toEqual([a.node]);
    frame.drawn.restore(); // post() between frames
    const b = world.addChild(new FakeNode(5200, 4000));
    seen.length = 0;
    pass.pre(frame);
    expect(seen).toEqual([a.node, b.node]);
  });

  it('between full re-culls a hidden tile is re-decided only in its own rolling slice', () => {
    const world = new FakeNode();
    world.addChild(new FakeNode(5000, 4000)).label = 'Tile (19, 15)';
    const b = world.addChild(new FakeNode(5200, 4000));
    b.label = 'Tile (20, 15)';
    const seen: unknown[] = [];
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: (_c: unknown, n: unknown, y: number) => { seen.push(n); return y; }, afterPlace: null, fade: null, placeMask: null } as never);
    const ov = { put: () => undefined, drop: () => undefined, raw: () => false, gameValue: () => 0 };
    const at = (roll: number): FrameCtx => ({ ...topDownCtx(), ov, roll, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } } }) as unknown as FrameCtx;
    pass.pre(at(-1));
    expect(seen).toEqual([]);
    pass.pre(at(cullSlot(5200, 4000) & (ROLL_SLICES - 1)));
    expect(seen).toEqual([b.node]);
  });

  it('a re-checked entity outside the view is culled before its stand row', () => {
    const world = new FakeNode();
    const near = world.addChild(new FakeNode(5100, 4000));
    world.addChild(new FakeNode(50000, 4000));
    const seen: unknown[] = [];
    const hidden: unknown[] = [];
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: (_c: unknown, n: unknown, y: number) => { seen.push(n); return y; }, afterPlace: null, fade: null, placeMask: null } as never);
    const ov = { put: (k: string, n: unknown, v: unknown) => { if (k === 'visible' && v === false) hidden.push(n); }, drop: () => undefined, raw: () => true, gameValue: () => 0 };
    pass.pre({ ...topDownCtx(), ov, reCull: true, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } } } as unknown as FrameCtx);
    expect(seen).toEqual([near.node]);
    expect(hidden).toHaveLength(1);
  });

  // A stateful override fake: visibility per node (absent = the game's value, visible), zIndex writes logged.
  const statefulOv = () => {
    const vis = new Map<unknown, boolean>();
    const z: number[] = [];
    return {
      z,
      ov: {
        put: (k: string, n: unknown, v: unknown) => { if (k === 'visible') vis.set(n, v as boolean); if (k === 'zIndex') z.push(v as number); },
        drop: (k: string, n: unknown) => { if (k === 'visible') vis.delete(n); },
        raw: (k: string, n: unknown) => (k === 'visible' ? vis.get(n) ?? true : 0),
        gameValue: () => 0,
      },
    };
  };
  const scene = (world: FakeNode) => ({ scene: { world: world.node }, classes: { Texture: { WHITE: {} } } });

  it('a culled walker that moves into a still view is re-checked and drawn; a tile or a small move is not (A V1)', () => {
    const world = new FakeNode();
    // 8,000 px left of the view: past the cull bounds (frame/cull.ts) even with a walker's own move.
    const pet = world.addChild(new FakeNode(-3000, 4000));
    const tile = world.addChild(new FakeNode(-3000, 4256));
    tile.label = 'Tile (11, 16)';
    const seen: unknown[] = [];
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: (_c: unknown, n: unknown, y: number) => { seen.push(n); return y; }, afterPlace: null, fade: null, placeMask: null } as never);
    const { ov } = statefulOv();
    const frame = (reCull: boolean): FrameCtx => ({ ...topDownCtx(), ov, reCull, roll: -1, caps: scene(world) }) as unknown as FrameCtx;
    pass.pre(frame(true));
    expect(seen).toEqual([]);
    for (const n of [pet, tile]) n.x = 5000;
    pet.x = -3000 + MOVE_PX / 2;
    pass.pre(frame(false));
    expect(seen).toEqual([]);
    pet.x = 5000;
    pass.pre(frame(false));
    expect(seen).toEqual([pet.node]);
  });

  it('perf 5 ring: a tile near the camera culled off screen is re-decided on the next moving frame outside its slice; a still one is not', () => {
    // Straight down at depth factor 0.25: the screen spans ±2,000 px of the target; the tile's art (ART_REACH 576 each
    // side) is 74 px past the right edge, 2,650 px from the camera (inside the ring less a cap).
    const world = new FakeNode();
    const tile = world.addChild(new FakeNode(5000 + 2650, 4000).withTexture(100, 100, 1));
    tile.label = 'Tile (29, 15)';
    const rows: unknown[] = [];
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: (_c: unknown, n: unknown, y: number) => { rows.push(n); return y; }, afterPlace: null, fade: null, placeMask: null, held: null } as never);
    const { ov } = cullOv();
    const at = (tx: number, f: number, o: { reCull?: boolean; camStill?: boolean } = {}): number => {
      const c = cullFrame(world, ov, tx, f, { reCull: o.reCull ?? false, kk: 0.25 });
      const ctx = { ...c, camStill: o.camStill ?? false, capMask: 0, cull: cullOf(c.basis, c.params, W, H, 0.75, RING_PX) } as FrameCtx;
      pass.pre(ctx);
      ctx.drawn.restore();
      return ctx.drawn.len;
    };
    expect(at(5000, 1, { reCull: true })).toBe(0);
    rows.length = 0;
    expect(at(5000, 2, { camStill: true })).toBe(0);
    expect(rows).toEqual([]);
    expect(at(5200, 3)).toBe(1);
  });

  it('tilted at a diagonal yaw, a walker rewrites its key once per 32 px along the view axis, not every frame (A PF2)', () => {
    const world = new FakeNode();
    const pet = world.addChild(new FakeNode(5000, 4000));
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: null, afterPlace: null, fade: null, placeMask: null } as never);
    const { ov, z } = statefulOv();
    const base = topDownCtx();
    const yaw = (40 * Math.PI) / 180;
    const params = { ...base.params, yaw, pitch: (30 * Math.PI) / 180 };
    const ctx = { ...base, params, basis: makeBasis(params, 5000, 4000, W, H), dx: Math.sin(yaw), dz: -Math.cos(yaw), exactKeys: false, ov, reCull: true, caps: scene(world) } as unknown as FrameCtx;
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      pet.x = 5000 + 4 * i;
      pass.pre(ctx);
      ctx.drawn.restore();
      ctx.drawn.reset();
    }
    const distinct = new Set(z).size;
    const travel = 4 * (steps - 1) * Math.sin(yaw);
    expect(distinct).toBeLessThanOrEqual(Math.ceil(travel / 32) + 1);
    expect(distinct).toBeGreaterThan(1);
  });

  // Live 2026-10-05 (v1419): the avatar on a StoneBench, game z 34560002 over the bench's 34560001.17 in 2D.
  it('tilted, an avatar at rest on a ground-decor tile sorts over it at every yaw, whichever way it walked in', () => {
    const base = topDownCtx();
    for (const from of [256, -256]) {
      for (let deg = 0; deg < 360; deg += 15) {
        const world = new FakeNode();
        const tile = world.addChild(new FakeNode(5248, 3456));
        tile.label = 'Tile (20, 13)';
        const avatar = world.addChild(new FakeNode(5248, 3217.92));
        avatar.label = 'AvatarContainer (p1)';
        const gz = new Map<unknown, number>([[tile.node, 34560001.1715229], [avatar.node, 34560002]]);
        const z = new Map<unknown, number>();
        const ov = { put: (k: string, n: unknown, v: unknown) => { if (k === 'zIndex') z.set(n, v as number); }, drop: () => undefined, raw: () => true, gameValue: (_k: string, n: unknown) => gz.get(n) ?? 0 };
        let ground = 0;
        const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: (_c: unknown, n: unknown, y: number) => (n === avatar.node ? ground : y), afterPlace: null, fade: null, placeMask: null } as never);
        const yaw = (deg * Math.PI) / 180;
        const params = { ...base.params, yaw, pitch: (28 * Math.PI) / 180 };
        const ctx = { ...base, params, basis: makeBasis(params, 5248, 3456, W, H), dx: Math.sin(yaw), dz: -Math.cos(yaw), exactKeys: false, ov, reCull: true, caps: scene(world) } as unknown as FrameCtx;
        for (let i = 0; i <= 35; i++) {
          ground = 3456 + from * Math.max(0, 1 - i / 32);
          pass.pre(ctx);
          ctx.drawn.restore();
          ctx.drawn.reset();
        }
        expect({ from, deg, over: z.get(avatar.node)! > z.get(tile.node)! }).toEqual({ from, deg, over: true });
      }
    }
  });

  // Perf Task 1b: raw visible/alpha per node (absent = the game's value); visibility flips logged.
  const cullOv = () => {
    const vis = new Map<unknown, boolean>(), alpha = new Map<unknown, number>();
    const flips: string[] = [];
    const ov = {
      put: (k: string, n: unknown, v: unknown) => {
        if (k === 'visible') { if ((vis.get(n) ?? true) !== v) flips.push(`visible:${String(v)}`); vis.set(n, v as boolean); }
        if (k === 'alpha') alpha.set(n, v as number);
      },
      drop: (k: string, n: unknown) => {
        if (k === 'visible') { if (vis.get(n) === false) flips.push('visible:true'); vis.delete(n); }
        if (k === 'alpha') alpha.delete(n);
      },
      raw: (k: string, n: unknown) => (k === 'visible' ? vis.get(n) ?? true : k === 'alpha' ? alpha.get(n) ?? 1 : 0),
      gameValue: (k: string) => (k === 'visible' ? true : k === 'alpha' ? 1 : 0),
    };
    return { ov, flips, alpha: (n: unknown) => ov.raw('alpha', n), visible: (n: unknown) => ov.raw('visible', n) };
  };
  /** Straight down on (tx, 4000) at depth factor kk; roll: the rolling slice re-checked (-1 none). */
  const cullFrame = (world: FakeNode, ov: unknown, tx: number, frameNo: number, o: { reCull?: boolean; roll?: number; kk?: number } = {}): FrameCtx => {
    const kk = o.kk ?? k;
    const fpx = H / 2 / Math.tan(fov / 2);
    const params = { yaw: 0, pitch: Math.PI / 2, dist: fpx / kk, fov, lookH: 0, yOff: 0, near: 40, far: 90000 };
    return {
      ...topDownCtx(), params, basis: makeBasis(params, tx, 4000, W, H), target: { x: tx, y: 4000 }, cull: cullOf(makeBasis(params, tx, 4000, W, H), params, W, H), ov, frameNo,
      reCull: o.reCull ?? false, roll: o.roll ?? -1, caps: scene(world),
    } as unknown as FrameCtx;
  };
  // pre() then the 2D restore post() does; `rows` logs every stand-row scan.
  const plainPass = (rows: unknown[] = []) => {
    const standRow = (_c: unknown, n: unknown, y: number): number => { rows.push(n); return y; };
    const p = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow, afterPlace: null, fade: null, placeMask: null, held: null } as never);
    return { pre: (ctx: FrameCtx): void => { p.pre(ctx); ctx.drawn.restore(); }, stats: () => p.stats!() };
  };

  it('perf 1b: an entity culled on a frame that would not rebuild World is parked by alpha, then hidden on a rebuild frame', () => {
    const world = new FakeNode();
    const pet = world.addChild(new FakeNode(5000, 4000).withTexture(100, 100, 1));
    const { ov, flips, alpha, visible } = cullOv();
    const pass = plainPass();
    const slot = cullSlot(5000, 4000) & (ROLL_SLICES - 1);
    pass.pre(cullFrame(world, ov, 5000, 1, { reCull: true }));
    pass.pre(cullFrame(world, ov, 30000, 2, { roll: slot }));
    expect(flips).toEqual([]);
    expect(visible(pet.node)).toBe(true);
    expect(alpha(pet.node)).toBe(0);
    pass.pre(cullFrame(world, ov, 30000, 3));
    expect(flips).toEqual([]);
    (world.renderGroup as { structureDidChange?: boolean }).structureDidChange = true;
    pass.pre(cullFrame(world, ov, 30000, 4));
    expect(flips).toEqual(['visible:false']);
    expect(alpha(pet.node)).toBe(1);
  });

  it('perf 1b: a parked entity back in view is drawn again by alpha, with no visibility flip', () => {
    const world = new FakeNode();
    const pet = world.addChild(new FakeNode(5000, 4000).withTexture(100, 100, 1));
    const { ov, flips, alpha } = cullOv();
    const pass = plainPass();
    const slot = cullSlot(5000, 4000) & (ROLL_SLICES - 1);
    pass.pre(cullFrame(world, ov, 5000, 1, { reCull: true }));
    pass.pre(cullFrame(world, ov, 30000, 2, { roll: slot }));
    const back = cullFrame(world, ov, 5000, 3, { roll: slot });
    pass.pre(back);
    expect(flips).toEqual([]);
    expect(alpha(pet.node)).toBe(1);
    expect(back.drawn.len).toBe(1);
    expect(pass.stats().parked).toBe(0);
  });

  it('perf 1b: a hidden tile back in view waits while its art is off screen, then shows as it reaches the screen', () => {
    const world = new FakeNode();
    const tile = world.addChild(new FakeNode(5000, 4000).withTexture(100, 100, 1));
    tile.label = 'Tile (19, 15)';
    const { ov, flips, visible } = cullOv();
    const pass = plainPass();
    const slot = cullSlot(5000, 4000) & (ROLL_SLICES - 1);
    const kk = 0.3;
    pass.pre(cullFrame(world, ov, 40000, 1, { reCull: true, kk }));
    expect(flips).toEqual(['visible:false']);
    // Its foot 600 px past the right edge: inside the side margin (0.75 W), its art ≤ ART_REACH.side × 0.3 px wide.
    const past = 5000 - (W / 2 + 600) / kk;
    pass.pre(cullFrame(world, ov, past, 2, { roll: slot, kk }));
    expect(visible(tile.node)).toBe(false);
    expect(pass.stats().waiting).toBe(1);
    pass.pre(cullFrame(world, ov, 5000 - W / 2 / kk, 3, { kk }));
    expect(flips).toEqual(['visible:false', 'visible:true']);
    expect(pass.stats().waiting).toBe(0);
  });

  it('perf 1b: between its checks a waiting tile skips the stand-row scan while its art stays off screen', () => {
    const world = new FakeNode();
    const tile = world.addChild(new FakeNode(5000, 4000).withTexture(100, 100, 1));
    tile.label = 'Tile (19, 15)';
    const { ov } = cullOv();
    const rows: unknown[] = [];
    const pass = plainPass(rows);
    const slot = cullSlot(5000, 4000) & (ROLL_SLICES - 1);
    const kk = 0.3;
    const past = 5000 - (W / 2 + 600) / kk;
    pass.pre(cullFrame(world, ov, 40000, 1, { reCull: true, kk }));
    pass.pre(cullFrame(world, ov, past, 2, { roll: slot, kk }));
    expect(pass.stats().waiting).toBe(1);
    rows.length = 0;
    for (let f = 3; f < 10; f++) pass.pre(cullFrame(world, ov, past, f, { kk }));
    expect(rows).toEqual([]);
    expect(pass.stats().waiting).toBe(1);
  });

  it('records the 2D transform so post() can restore it', () => {
    const ctx = topDownCtx();
    const n = new FakeNode(5100, 3900).withTexture(100, 100, 1);
    placeBillboard(ctx, n.node, { isTile: false, standY: 4100, depthY: 4100, tiebreak: 0, artRow: true }, newPlacement());
    ctx.drawn.restore();
    expect([n.x, n.y, n.scale.x]).toEqual([5100, 3900, 1]);
  });

  // pre, a PIXI render, then post's restore + finish, as the frame runner does.
  const persistFrame = (pass: { pre(ctx: FrameCtx): void }, persist: PersistTable, nodes: PixiNode[], ctx: FrameCtx): void => {
    persist.begin(ctx.frameNo);
    pass.pre(ctx);
    for (const n of nodes) n.render();
    ctx.drawn.restore();
    persist.finish();
  };

  it('perf 3: a still camera leaves a tile view clean (2D in its fields, 3D in the render cache); a walker is set and restored', () => {
    const world = new FakeNode();
    const tile = new PixiNode(5000, 4000, 1), pet = new PixiNode(5100, 4000, 1);
    tile.label = 'Tile (19, 15)';
    for (const n of [tile, pet]) (world.children as unknown[]).push(n);
    const persist = new PersistTable(true);
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: null, afterPlace: null, fade: null, placeMask: null, held: null } as never);
    const ov = { put: () => undefined, drop: () => undefined, raw: () => true, gameValue: () => 0 };
    const at = (n: number): FrameCtx => ({ ...topDownCtx(), ov, persist, reCull: n === 1, frameNo: n, caps: scene(world) }) as unknown as FrameCtx;
    persistFrame(pass, persist, [tile, pet], at(1));
    const drawn3d = tile.drawn(), tileWork = [tile.updates, tile.walks], petWalks = pet.walks;
    const last = at(3);
    persistFrame(pass, persist, [tile, pet], at(2));
    persistFrame(pass, persist, [tile, pet], last);
    expect([tile.updates, tile.walks]).toEqual(tileWork);
    expect(tile.drawn()).toEqual(drawn3d);
    expect(drawn3d).not.toEqual(tile.fields());
    expect(tile.fields()).toEqual([5000, 4000, 1, 1]);
    expect(pet.walks).toBe(petWalks + 2);
    expect(pet.fields()).toEqual([5100, 4000, 1, 1]);
    expect([last.drawn.entryFor(tile.node)?.held, last.drawn.entryFor(pet.node)?.held]).toEqual([true, false]);
  });

  it('perf 3: a tile behind the lens stays parked across frames with no write; a walker there is parked and restored each frame', () => {
    const tile = new PixiNode(5000, 4000, 1), pet = new PixiNode(5000, 4000, 1);
    const persist = new PersistTable(true);
    const behind = (n: number): FrameCtx => {
      const c = topDownCtx();
      return { ...c, persist, frameNo: n, params: { ...c.params, near: 1e9 } } as unknown as FrameCtx;
    };
    const opts = (isTile: boolean) => ({ isTile, standY: 4000, depthY: 4000, tiebreak: 0, artRow: true });
    const walks: number[][] = [];
    for (let f = 1; f <= 3; f++) {
      const ctx = behind(f);
      persist.begin(f);
      expect(placeBillboard(ctx, tile.node, opts(true), newPlacement())).toBeNull();
      expect(placeBillboard(ctx, pet.node, opts(false), newPlacement())).toBeNull();
      tile.render(); pet.render();
      ctx.saves.restoreAll();
      persist.finish();
      walks.push([tile.walks, pet.walks]);
    }
    expect(walks.map((w) => w[0])).toEqual([2, 2, 2]);
    expect(walks.map((w) => w[1])).toEqual([2, 3, 4]);
    expect(tile.drawn()).toEqual([-1e5, -1e5, 0, 0]);
    expect(tile.fields()).toEqual([5000, 4000, 1, 1]);
    expect(pet.fields()).toEqual([5000, 4000, 1, 1]);
  });

  it('first person hands the avatar to the held handler, and hides it only when the handler declines', () => {
    const world = new FakeNode();
    const avatar = world.addChild(new FakeNode(5000, 4000));
    const puts: unknown[][] = [];
    const ov = { put: (...a: unknown[]) => { puts.push(a); }, drop: () => undefined, raw: () => true, gameValue: () => 0 };
    let accept = true;
    const calls: string[] = [];
    const held = {
      begin: () => { calls.push('begin'); }, firstPerson: () => { calls.push('fp'); return accept; },
      release: () => { calls.push('release'); }, drop: () => undefined, stats: () => ({}),
    };
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: null, afterPlace: null, fade: null, placeMask: null, held } as never);
    const frame = { ...topDownCtx(), ov, hideSelf: true, avatar: avatar.node, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } } } as unknown as FrameCtx;
    pass.pre(frame);
    expect(calls).toEqual(['begin', 'fp']);
    expect(puts).not.toContainEqual(['visible', avatar.node, false]);
    accept = false;
    pass.pre(frame);
    expect(puts).toContainEqual(['visible', avatar.node, false]);
  });

  it('during the push-in the avatar stays a billboard and the held handler gets its fade (P2 a)', () => {
    const world = new FakeNode();
    const avatar = world.addChild(new FakeNode(5000, 4000).withTexture(100, 100, 1));
    const ov = { put: () => undefined, drop: () => undefined, raw: () => true, gameValue: () => 0 };
    const fades: number[] = [];
    const calls: string[] = [];
    const held = {
      begin: () => undefined, firstPerson: () => { calls.push('fp'); return true; }, release: () => { calls.push('release'); },
      fadeSelf: (_c: unknown, n: unknown, a: number) => { if (n === avatar.node) fades.push(a); }, drop: () => undefined, stats: () => ({}),
    };
    const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: null, afterPlace: null, fade: null, placeMask: null, held } as never);
    const frame = (selfAlpha: number): FrameCtx => ({ ...topDownCtx(), ov, reCull: true, hideSelf: false, selfAlpha, hand: 0, avatar: avatar.node, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } } }) as unknown as FrameCtx;
    pass.pre(frame(0.4));
    pass.pre(frame(1));
    expect(fades).toEqual([0.4, 1]);
    expect(calls).toEqual(['release', 'release']);
  });

  it('your avatar and its mount are drawn on the follow point (shift × tilt); others, and straight down, are not (P16 a)', () => {
    const tiltedFrame = (world: FakeNode, avatar: unknown, tilt: number, shift: { x: number; y: number }): FrameCtx => {
      const c = topDownCtx();
      const params = { ...c.params, pitch: (30 * Math.PI) / 180 };
      const ov = { put: () => undefined, drop: () => undefined, raw: () => true, gameValue: () => 0 };
      return {
        ...c, params, basis: makeBasis(params, 5000, 4000, W, H), ov, reCull: true, tilt, exactKeys: tilt <= 0, selfShift: shift,
        hideSelf: false, selfAlpha: 1, hand: 0, avatar, caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } },
      } as unknown as FrameCtx;
    };
    const drawn = (x: number, y: number, self: boolean, tilt: number): number[] => {
      const world = new FakeNode();
      const n = world.addChild(new FakeNode(x, y).withTexture(100, 100, 1));
      const mount = world.addChild(new FakeNode(x, y + 1).withTexture(100, 100, 1));
      const isSelf = self ? (_c: FrameCtx, e: unknown) => e === n.node || e === mount.node : null;
      const pass = createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: null, afterPlace: null, fade: null, placeMask: null, held: null, isSelf } as never);
      pass.pre(tiltedFrame(world, self ? n.node : null, tilt, { x: 100, y: -50 }));
      return [n.x, n.y, n.scale.x, mount.x, mount.y];
    };
    const near = (a: number[], b: number[]): void => { a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6)); };
    near(drawn(5000, 4000, true, 1), drawn(5100, 3950, false, 1));
    near(drawn(5000, 4000, true, 0.5), drawn(5050, 3975, false, 0.5));
    near(drawn(5000, 4000, true, 0), drawn(5000, 4000, false, 0));
  });
});

describe('holdThroughOnRender restores (A V9)', () => {
  type Hook = ((...a: unknown[]) => unknown) | null;
  // PIXI v8: the onRender setter stores the hook in _onRender.
  function hooked(): FakeNode {
    const n = new FakeNode(10, 20);
    let fn: Hook = null;
    Object.defineProperty(n, 'onRender', { get: () => fn, set: (f: Hook) => { fn = f; }, configurable: true });
    Object.defineProperty(n, '_onRender', { get: () => fn, configurable: true });
    return n;
  }
  const passFor = () => createEntityPass({ skip: new WeakSet(), buildings: null, layers: null, standRow: null, afterPlace: null, fade: null, placeMask: null, held: null } as never);
  const ctx = { frameNo: 7 } as FrameCtx;

  it('hands the game hook back on drop', () => {
    const n = hooked(), game = (): void => undefined;
    n.node.onRender = game;
    holdThroughOnRender(ctx, n.node, 1, 2, 3, 3);
    expect(n.node._onRender).not.toBe(game);
    passFor().drop();
    expect(n.node._onRender).toBe(game);
  });
  it('wraps a hook the game replaced, and never puts back a hook the game has since replaced', () => {
    const n = hooked(), first = (): void => undefined, second = (): void => undefined, third = (): void => undefined;
    n.node.onRender = first;
    holdThroughOnRender(ctx, n.node, 1, 2, 3, 3);
    n.node.onRender = second;
    holdThroughOnRender(ctx, n.node, 1, 2, 3, 3);
    expect(n.node._onRender).not.toBe(second);
    passFor().drop();
    expect(n.node._onRender).toBe(second);
    holdThroughOnRender(ctx, n.node, 1, 2, 3, 3);
    n.node.onRender = third;
    passFor().drop();
    expect(n.node._onRender).toBe(third);
  });
});
