import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { FrameCtx } from '../frame/frame';
import { createOverrides, type Overrides } from '../frame/overrides';
import type { Node3 } from '../types';
import { IDLE_FRAMES } from './flipGate';
import { ART_REACH, GameCull } from './gameCull';

const W = 1280, H = 656;

// The World render group of the test running: a visibility flip dirties it, as PIXI's setter does.
let worldGroup: { structureDidChange?: boolean } | null = null;

// PIXI keeps visible/alpha behind prototype accessors; the overrides shadow them per node.
class Base {
  private v = true; private a = 1; private z = 0;
  destroyed = false;
  parent: object | null = {};
  flips = 0;
  get visible(): boolean { return this.v; }
  set visible(x: boolean) { if (x !== this.v) { this.flips++; if (worldGroup) worldGroup.structureDidChange = true; } this.v = x; }
  get alpha(): number { return this.a; } set alpha(x: number) { this.a = x; }
  get zIndex(): number { return this.z; } set zIndex(x: number) { this.z = x; }
}
class GameNode extends Base {}
const as3 = (n: GameNode): Node3 => n as unknown as Node3;

function setup() {
  const world = new FakeNode();
  const rg = world.renderGroup as { structureDidChange?: boolean };
  rg.structureDidChange = false;
  worldGroup = rg;
  const ov: Overrides = createOverrides(new GameNode());
  const cull = new GameCull();
  const frame = (frameNo: number, o: { reCull?: boolean } = {}): FrameCtx =>
    ({ caps: { scene: { world: world.node } }, ov, frameNo, reCull: o.reCull ?? false, W, H, basis: { fpx: 600 }, params: { near: 40 } }) as unknown as FrameCtx;
  // One frame of the entity pass: begin, the body, end, then the render's rebuild clears the flag.
  const run = (ctx: FrameCtx, body: () => void): void => { cull.begin(ctx); body(); cull.end(ctx); rg.structureDidChange = false; };
  return { rg, ov, cull, frame, run };
}

// A foot far off the right edge (its art cannot reach the screen) and one in the middle of the screen.
const OFF = { sx: W + 50 * ART_REACH.side, sy: H / 2, cz: 600 };
const ON = { sx: W / 2, sy: H / 2, cz: 600 };

describe('GameCull (perf Task 1b)', () => {
  it('a node culled on a frame that would not rebuild World is parked by alpha and keeps visible', () => {
    const { ov, cull, frame, run } = setup();
    const n = new GameNode();
    const ctx = frame(5);
    run(ctx, () => cull.cull(ctx, as3(n)));
    expect(n.flips).toBe(0);
    expect(ov.raw<boolean>('visible', n)).toBe(true);
    expect(ov.raw<number>('alpha', n)).toBe(0);
    expect(n.alpha).toBe(1);
    expect(cull.isParked(ctx, as3(n))).toBe(true);
    expect(cull.forced).toBe(0);
  });

  it('a node culled on a frame that rebuilds anyway is hidden at once', () => {
    const { ov, rg, cull, frame, run } = setup();
    const a = new GameNode(), b = new GameNode();
    const re = frame(5, { reCull: true });
    run(re, () => cull.cull(re, as3(a)));
    rg.structureDidChange = true;
    const dirty = frame(6);
    run(dirty, () => cull.cull(dirty, as3(b)));
    for (const n of [a, b]) {
      expect(ov.raw<boolean>('visible', n)).toBe(false);
      expect(ov.raw<number>('alpha', n)).toBe(1);
    }
    expect(cull.forced).toBe(0);
  });

  it('a parked node is hidden on the next frame that rebuilds anyway, and its alpha handed back', () => {
    const { ov, rg, cull, frame, run } = setup();
    const n = new GameNode();
    const f1 = frame(5);
    run(f1, () => cull.cull(f1, as3(n)));
    run(frame(6), () => undefined);
    expect(ov.raw<boolean>('visible', n)).toBe(true);
    rg.structureDidChange = true;
    const f7 = frame(7);
    run(f7, () => undefined);
    expect(ov.raw<boolean>('visible', n)).toBe(false);
    expect(ov.raw<number>('alpha', n)).toBe(1);
    expect(cull.isParked(f7, as3(n))).toBe(false);
    expect(cull.forced).toBe(0);
  });

  it('on the shared sweep frame a parked node is hidden only once idle (one forced rebuild)', () => {
    const { ov, cull, frame, run } = setup();
    const old = new GameNode(), fresh = new GameNode();
    const f0 = frame(IDLE_FRAMES - 10);
    run(f0, () => cull.cull(f0, as3(old)));
    const f1 = frame(2 * IDLE_FRAMES - 5);
    run(f1, () => cull.cull(f1, as3(fresh)));
    run(frame(2 * IDLE_FRAMES - 1), () => undefined);
    expect(ov.raw<boolean>('visible', old)).toBe(true);
    run(frame(2 * IDLE_FRAMES), () => undefined);
    expect(ov.raw<boolean>('visible', old)).toBe(false);
    // The sweep's flip rebuilds World: the fresh one rides it.
    expect(ov.raw<boolean>('visible', fresh)).toBe(false);
    expect(cull.forced).toBe(1);
  });

  it('a parked node back in view is un-parked without a flip, with the alpha the game wrote meanwhile', () => {
    const { ov, cull, frame, run } = setup();
    const n = new GameNode();
    const f1 = frame(5);
    run(f1, () => cull.cull(f1, as3(n)));
    n.alpha = 0.5;
    expect(ov.raw<number>('alpha', n)).toBe(0);
    const f2 = frame(6);
    let drawn = false;
    run(f2, () => { drawn = cull.show(f2, as3(n), false, OFF.sx, OFF.sy, OFF.cz); });
    expect(drawn).toBe(true);
    expect(n.flips).toBe(0);
    expect(ov.raw<number>('alpha', n)).toBe(0.5);
    expect(cull.isParked(f2, as3(n))).toBe(false);
  });

  it('a hidden node in view waits while its art is off screen, and shows at once on screen or on a rebuild frame', () => {
    const { ov, rg, cull, frame, run } = setup();
    const n = new GameNode();
    const re = frame(1, { reCull: true });
    run(re, () => cull.cull(re, as3(n)));
    expect(ov.raw<boolean>('visible', n)).toBe(false);
    const f2 = frame(2);
    let drawn = true;
    run(f2, () => { drawn = cull.show(f2, as3(n), true, OFF.sx, OFF.sy, OFF.cz); });
    expect(drawn).toBe(false);
    expect(cull.isWaiting(as3(n))).toBe(true);
    const f3 = frame(3);
    run(f3, () => { drawn = cull.show(f3, as3(n), true, ON.sx, ON.sy, ON.cz); });
    expect(drawn).toBe(true);
    expect(ov.raw<boolean>('visible', n)).toBe(true);
    expect(cull.isWaiting(as3(n))).toBe(false);
    expect(cull.forced).toBe(1);

    const m = new GameNode();
    const re4 = frame(4, { reCull: true });
    run(re4, () => cull.cull(re4, as3(m)));
    rg.structureDidChange = true;
    const f5 = frame(5);
    run(f5, () => { drawn = cull.show(f5, as3(m), true, OFF.sx, OFF.sy, OFF.cz); });
    expect(drawn).toBe(true);
    expect(cull.forced).toBe(1);
    expect(cull.stats()).toMatchObject({ urgent: 1, urgentWaited: 1 });
  });

  it('a node still waiting on the shared sweep frame is shown (a still camera never waits for long)', () => {
    const { ov, cull, frame, run } = setup();
    const n = new GameNode();
    const re = frame(IDLE_FRAMES - 3, { reCull: true });
    run(re, () => cull.cull(re, as3(n)));
    const f1 = frame(IDLE_FRAMES - 1);
    let drawn = true;
    run(f1, () => { drawn = cull.show(f1, as3(n), true, OFF.sx, OFF.sy, OFF.cz); });
    expect(drawn).toBe(false);
    expect(cull.canShow(f1, OFF.sx, OFF.sy, OFF.cz)).toBe(false);
    const sweep = frame(IDLE_FRAMES);
    expect(cull.canShow(sweep, OFF.sx, OFF.sy, OFF.cz)).toBe(true);
    run(sweep, () => { drawn = cull.show(sweep, as3(n), true, OFF.sx, OFF.sy, OFF.cz); });
    expect(drawn).toBe(true);
    expect(ov.raw<boolean>('visible', n)).toBe(true);
  });

  it('a parked node whose alpha another writer handed back is forgotten, not hidden', () => {
    const { ov, rg, cull, frame, run } = setup();
    const n = new GameNode(), gone = new GameNode();
    const f1 = frame(5);
    run(f1, () => { cull.cull(f1, as3(n)); cull.cull(f1, as3(gone)); });
    ov.drop('alpha', n);
    gone.destroyed = true;
    rg.structureDidChange = true;
    const f2 = frame(6);
    run(f2, () => undefined);
    expect(ov.raw<boolean>('visible', n)).toBe(true);
    expect(gone.flips).toBe(0);
    expect(cull.stats().parked).toBe(0);
  });

  it('a parked node whose alpha another writer took over (a building piece drawn by its anchor, faded) keeps that alpha', () => {
    const { ov, rg, cull, frame, run } = setup();
    const n = new GameNode();
    const f1 = frame(5);
    run(f1, () => cull.cull(f1, as3(n)));
    ov.put('alpha', n, 0.4);
    rg.structureDidChange = true;
    run(frame(6), () => undefined);
    expect(ov.raw<number>('alpha', n)).toBe(0.4);
    expect(ov.raw<boolean>('visible', n)).toBe(true);
    expect(cull.stats().parked).toBe(0);
  });

  it('art reaching the screen from a foot past the edge counts as on screen', () => {
    const { cull, frame, run } = setup();
    const n = new GameNode();
    const re = frame(1, { reCull: true });
    run(re, () => cull.cull(re, as3(n)));
    // mm = fpx / cz = 1: the art's top reaches ART_REACH.up px above a foot just under the bottom edge.
    const f2 = frame(2);
    let drawn = false;
    run(f2, () => { drawn = cull.show(f2, as3(n), true, W / 2, H + ART_REACH.up - 10, 600); });
    expect(drawn).toBe(true);
  });

  it('out of view again, a waiting node just stops waiting', () => {
    const { cull, frame, run } = setup();
    const n = new GameNode();
    const re = frame(1, { reCull: true });
    run(re, () => cull.cull(re, as3(n)));
    const f2 = frame(2);
    run(f2, () => { cull.show(f2, as3(n), true, OFF.sx, OFF.sy, OFF.cz); });
    const f3 = frame(3);
    run(f3, () => cull.cull(f3, as3(n)));
    expect(cull.isWaiting(as3(n))).toBe(false);
    expect(n.flips).toBe(1);
  });

  it('a non-tile in view takes the game value: hidden by the game, it neither shows nor waits', () => {
    const { ov, cull, frame, run } = setup();
    const n = new GameNode();
    const re = frame(1, { reCull: true });
    run(re, () => cull.cull(re, as3(n)));
    n.visible = false;
    const f2 = frame(2);
    let drawn = true;
    run(f2, () => { drawn = cull.show(f2, as3(n), false, ON.sx, ON.sy, ON.cz); });
    expect(drawn).toBe(false);
    expect(cull.isWaiting(as3(n))).toBe(false);
    expect(ov.raw<boolean>('visible', n)).toBe(false);
  });

  it('exit: drop() forgets everything and dropAll hands every node its own visibility and alpha', () => {
    const { ov, cull, frame, run } = setup();
    const parked = new GameNode(), hidden = new GameNode(), waiting = new GameNode();
    const re = frame(1, { reCull: true });
    run(re, () => { cull.cull(re, as3(hidden)); cull.cull(re, as3(waiting)); });
    const f2 = frame(2);
    run(f2, () => { cull.cull(f2, as3(parked)); cull.show(f2, as3(waiting), true, OFF.sx, OFF.sy, OFF.cz); });
    parked.alpha = 0.7;
    cull.drop();
    ov.dropAll();
    expect(cull.stats()).toEqual({ parked: 0, waiting: 0, forced: 0, urgent: 0, urgentWaited: 0 });
    for (const n of [parked, hidden, waiting]) expect(ov.raw<boolean>('visible', n)).toBe(true);
    expect(ov.raw<number>('alpha', parked)).toBe(0.7);
    expect(ov.count()).toBe(0);
  });

  it('forgets destroyed and detached nodes on prune, handing a detached one its alpha back', () => {
    const { ov, cull, frame, run } = setup();
    const gone = new GameNode(), off = new GameNode();
    const f1 = frame(1);
    run(f1, () => { cull.cull(f1, as3(gone)); cull.cull(f1, as3(off)); });
    gone.destroyed = true;
    off.parent = null;
    cull.prune(frame(2));
    expect(cull.stats().parked).toBe(0);
    expect(ov.raw<number>('alpha', off)).toBe(1);
  });

  it('without a frame begun (a direct placeBillboard call) every flip happens at once', () => {
    const { ov, frame } = setup();
    const cull = new GameCull();
    const n = new GameNode();
    cull.cull(frame(1), as3(n));
    expect(ov.raw<boolean>('visible', n)).toBe(false);
  });
});
