import { describe, expect, it, vi } from 'vitest';
import { cullOf } from '../__test__/cullOf';
import { FakeNode } from '../__test__/fakeNode';
import { PixiNode } from '../__test__/fakePixi';
import { DrawnTable, FullSaves } from '../frame/drawn';
import { ROLL_SLICES, cullSlot, type FrameCtx } from '../frame/frame';
import { PersistTable } from '../frame/persist';
import { makeBasis } from '../math/camera';
import type { Node3 } from '../types';
import { createEntityPass, type EntityDeps, type LayerHandler } from './entities';

// Perf Task 4: on a still camera a tile view whose inputs did not change is replayed from its last placement.
const W = 1000, H = 600, fov = (20 * Math.PI) / 180;
const fpx = H / 2 / Math.tan(fov / 2);

interface Calls { stand: Node3[]; after: Node3[]; areas: Node3[]; fade: Array<[Node3, number, number, number]>; zWrites: Node3[] }

function scene(o: { persist?: boolean } = {}) {
  const world = new FakeNode();
  const tiles = [new PixiNode(5000, 4000, 1), new PixiNode(5256, 4000, 1), new PixiNode(5000, 4256, 1)];
  tiles.forEach((t, i) => { t.label = `Tile (${19 + i}, 15)`; });
  const pet = new PixiNode(5100, 4100, 1);
  pet.label = 'Pet: Turtle';
  for (const n of [...tiles, pet]) (world.children as unknown[]).push(n);
  const calls: Calls = { stand: [], after: [], areas: [], fade: [], zWrites: [] };
  const gz = new Map<Node3, number>();
  const tokens = new Map<Node3, object>();
  const fading = new Set<Node3>();
  // The zIndex override per node, written (and logged) only on a change, as overrides.ts does; lifted: afterPlace raises
  // these tiles' keys by 5, as lift.ts does for drawn produce.
  const z = new Map<Node3, number>();
  const lifted = new Set<Node3>();
  const ov = {
    put: (k: string, n: Node3, v: unknown) => { if (k === 'zIndex' && z.get(n) !== v) { z.set(n, v as number); calls.zWrites.push(n); } },
    drop: () => undefined,
    raw: (k: string) => (k === 'visible' ? true : k === 'alpha' ? 1 : 0),
    gameValue: (k: string, n: Node3) => (k === 'zIndex' ? gz.get(n) ?? 0 : k === 'visible' ? true : 1),
  };
  const layers = {
    adopt: () => undefined, isLayerNode: () => false, isOverlayNode: () => false, placeMarker: () => undefined, isAreaMark: () => false,
    layAreas: (_c: FrameCtx, owner: Node3) => { calls.areas.push(owner); }, finishAreas: () => undefined, prune: () => undefined,
    stats: () => ({}), drop: () => undefined,
  } as unknown as LayerHandler;
  const STAND = {};
  const deps: EntityDeps = {
    skip: new WeakSet(), buildings: null, layers, held: null, placeMask: null,
    standRow: (_c, n, sortY) => { calls.stand.push(n); return sortY + 40; },
    standKey: (_c, n) => tokens.get(n) ?? STAND,
    afterPlace: (_c, n, lp) => { calls.after.push(n); if (lifted.has(n)) ov.put('zIndex', n, lp.key + 5); },
    fade: (_c, n, key, gx, gy) => { calls.fade.push([n, key, gx, gy]); },
    isFading: (_c, n) => fading.has(n),
  };
  const pass = createEntityPass(deps);
  const persist = new PersistTable(o.persist ?? true);
  const apply = vi.spyOn(persist, 'apply');
  const drawn = new DrawnTable();
  const params = { yaw: 0.4, pitch: 0.6, dist: fpx / 1.5, fov, lookH: 0, yOff: 0, near: 40, far: 90000 };
  /** One frame as the runner drives it: pre, the render, then post's restore and persist finish. */
  const frame = (f: number, c: { still?: boolean; tx?: number; roll?: number; reCull?: boolean } = {}): FrameCtx => {
    for (const k of Object.keys(calls) as Array<keyof Calls>) calls[k].length = 0;
    apply.mockClear();
    drawn.reset();
    persist.begin(f);
    const ctx = {
      caps: { scene: { world: world.node }, classes: { Texture: { WHITE: {} } } }, ov, saves: new FullSaves(), persist, drawn,
      W, H, params, basis: makeBasis(params, c.tx ?? 5000, 4000, W, H), target: { x: c.tx ?? 5000, y: 4000 }, dx: Math.sin(0.4), dz: -Math.cos(0.4), tilt: 1, exactKeys: false,
      reCull: c.reCull ?? f === 1, roll: c.roll ?? -1, cull: cullOf(makeBasis(params, c.tx ?? 5000, 4000, W, H), params, W, H), hideSelf: false, selfAlpha: 1, hand: 0,
      frameNo: f, now: f * 16, avatar: null, avatarKey: null, avatarUpper: null, avatarGround: null, selfShift: { x: 0, y: 0 },
      out: [0, 0, 0], camStill: c.still ?? f > 1,
    } as unknown as FrameCtx;
    pass.pre(ctx);
    for (const n of [...tiles, pet]) n.render();
    drawn.restore();
    persist.finish();
    return ctx;
  };
  const entries = () => Array.from({ length: drawn.len }, (_, i) => { const e = drawn.entries[i]!; return [e.node, e.x, e.y, e.sx, e.sy, e.px, e.py, e.mm, e.held]; });
  return { tiles, pet, calls, gz, tokens, fading, z, lifted, frame, entries, apply, pass };
}

describe('still tiles (perf Task 4: ctx.camStill fast path)', () => {
  it('an unchanged tile on a still camera does no placement work: no stand row, no persist write, no zIndex put', () => {
    const s = scene();
    s.frame(1);
    s.frame(2);
    const before = s.tiles.map((t) => [t.updates, t.walks]);
    s.frame(3);
    expect(s.calls.stand).toEqual([s.pet.node]);
    expect(s.apply.mock.calls.length).toBe(0);
    expect(s.calls.zWrites.filter((n) => n !== s.pet.node)).toEqual([]);
    expect(s.tiles.map((t) => [t.updates, t.walks])).toEqual(before);
  });

  it('a replayed frame draws, records and hands on exactly what the full path did', () => {
    const s = scene();
    s.frame(1);
    s.frame(2);
    const full = s.entries(), after = [...s.calls.after], areas = [...s.calls.areas], drawn3d = s.tiles.map((t) => t.drawn());
    s.frame(3);
    expect(s.entries()).toEqual(full);
    expect([s.calls.after, s.calls.areas]).toEqual([after, areas]);
    expect(s.tiles.map((t) => t.drawn())).toEqual(drawn3d);
    expect(s.tiles.map((t) => t.fields())).toEqual([[5000, 4000, 1, 1], [5256, 4000, 1, 1], [5000, 4256, 1, 1]]);
    expect(s.pass.stats!().shown).toBe(4);
  });

  it('a changed 2D base, game zIndex, texture or stand input re-places that tile only', () => {
    const changes: Array<(s: ReturnType<typeof scene>, t: PixiNode) => void> = [
      (_s, t) => { t.position.set(5010, 4000); },
      (s, t) => { s.gz.set(t.node, 41e7); },
      (_s, t) => { (t as unknown as { texture: unknown }).texture = { orig: { width: 64, height: 64 } }; },
      (s, t) => { s.tokens.set(t.node, {}); },
    ];
    for (const change of changes) {
      const s = scene();
      s.frame(1);
      s.frame(2);
      change(s, s.tiles[1]!);
      s.frame(3);
      expect(s.calls.stand).toEqual([s.tiles[1]!.node, s.pet.node]);
    }
  });

  it('a camera change re-places every tile; the next still frame does too, then they replay', () => {
    const s = scene();
    s.frame(1);
    s.frame(2);
    s.frame(3, { still: false, tx: 5010 });
    expect(s.calls.stand).toHaveLength(4);
    s.frame(4, { tx: 5010 });
    expect(s.calls.stand).toHaveLength(4);
    s.frame(5, { tx: 5010 });
    expect(s.calls.stand).toEqual([s.pet.node]);
  });

  it('a walking pet is re-placed alone; the tiles around it replay', () => {
    const s = scene();
    s.frame(1);
    s.frame(2);
    for (let f = 3; f < 6; f++) {
      s.pet.position.set(5100 + 8 * f, 4100);
      s.frame(f);
      expect(s.calls.stand).toEqual([s.pet.node]);
    }
  });

  it('a tile re-decides its visibility in its own rolling slice and on a full re-cull: the full path runs there', () => {
    const s = scene();
    s.frame(1);
    s.frame(2);
    s.frame(3, { roll: cullSlot(5256, 4000) & (ROLL_SLICES - 1) });
    expect(s.calls.stand).toContain(s.tiles[1]!.node);
    s.frame(4, { reCull: true });
    expect(s.calls.stand).toHaveLength(4);
  });

  it('a tile still easing keeps its fade every frame, with the same key and ground point; a settled one is skipped', () => {
    const s = scene();
    s.frame(1);
    s.fading.add(s.tiles[0]!.node);
    s.frame(2);
    const fade0 = s.calls.fade.find((c) => c[0] === s.tiles[0]!.node);
    s.frame(3);
    expect(s.calls.fade.filter((c) => c[0] !== s.pet.node)).toEqual([fade0]);
  });

  it('a lifted tile keeps its raised key while replayed and drops back to its own key once the lift is gone', () => {
    const s = scene();
    const t = s.tiles[0]!.node;
    s.lifted.add(t);
    s.frame(1);
    s.frame(2);
    const raised = s.z.get(t)!;
    s.frame(3);
    expect(s.calls.stand).toEqual([s.pet.node]);
    expect(s.z.get(t)).toBe(raised);
    // The produce is harvested: the scan and the tile's own fields are unchanged, so it still replays.
    s.lifted.delete(t);
    s.frame(4);
    expect(s.calls.stand).toEqual([s.pet.node]);
    expect(s.z.get(t)).toBe(raised - 5);
  });

  it('without dual state (persist off) nothing replays', () => {
    const s = scene({ persist: false });
    s.frame(1);
    s.frame(2);
    s.frame(3);
    expect(s.calls.stand).toHaveLength(4);
  });

  it('a tile with an onRender hook is placed by the full path every frame', () => {
    const s = scene();
    (s.tiles[2] as unknown as { _onRender: () => void })._onRender = () => undefined;
    s.frame(1);
    s.frame(2);
    s.frame(3);
    expect(s.calls.stand).toEqual([s.tiles[2]!.node, s.pet.node]);
    s.pass.drop();
  });
});

