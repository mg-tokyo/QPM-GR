import { describe, expect, it, vi } from 'vitest';
import { cullOf } from '../__test__/cullOf';
import { FakeNode, FakePoint, type FakeTexture } from '../__test__/fakeNode';
import { LEGACY_CULL } from '../constants';
import { legacyShow } from '../frame/cull';
import { RING_PX, type FrameCtx } from '../frame/frame';
import { makeBasis, project, type CamParams } from '../math/camera';
import type { Caps, Node3 } from '../types';
import { createDecor } from './decor';
import type { Fader } from './fades';
import { IDLE_FRAMES } from './flipGate';
import type { TileScan } from './tileArt';

const ART_H = 150;
// The card art comes from the sprite system and a GPU base-row extract: stand-ins (the live rect layout, tileArt.ts).
vi.mock('./tileArt', () => ({
  RECT: { STRIDE: 14, X: 2, Y: 3, W: 4, H: 5, ROTATE: 6, ALPHA: 13 },
  D8_MIRROR_H: 12,
  artBaseRow: () => 150,
  subTexture: (_c: unknown, _k: string, x: number, y: number, w: number, h: number) => ({
    orig: { width: w, height: h }, frame: { x, y, width: w, height: h }, source: { style: null }, destroy: () => undefined,
  }),
}));

const D = Math.PI / 180;
const W = 1280, H = 656, TY = 5600;
const PARAMS: CamParams = { yaw: 0, pitch: 30 * D, dist: 1500, fov: 50 * D, lookH: 120, yOff: 0, near: 40, far: 31000 };

class FakeSprite extends FakeNode {
  eventMode = 'auto';
  constructor(tex: FakeTexture) { super(); this.texture = tex; this.anchor = new FakePoint(0.5, 0.5); }
}

// One rock on tile (19, 19): its card stands at x 4992, on the art's base row (y 4864 + 150).
const PB = new Float32Array(14);
PB[2] = 4864; PB[3] = 4864; PB[4] = 256; PB[5] = 256;
const SCAN: TileScan = { pb: PB, len: 14, at: 0, sky: [], standing: [0], fence: new Map(), keyAt: new Map([[0, 'tile/Rock']]), missing: [] };
const FX = 4992, FY = 4864 + ART_H;
const fader: Fader = { factor: () => 1, isFading: () => false, prune: () => undefined, size: () => 0, drop: () => undefined };

function setup(fd: Fader = fader) {
  const world = new FakeNode();
  const rg = world.renderGroup as { structureDidChange?: boolean };
  const caps = { scene: { world: world.node }, classes: { Sprite: FakeSprite } } as unknown as Caps;
  const pass = createDecor(caps, new WeakSet(), fd, () => SCAN);
  const card = (): Node3 => world.children.find((n) => n.label === 'qpm3d-decor')!.node;
  let flips = 0;
  const watch = (): void => {
    const c = card();
    let v = c.visible;
    Object.defineProperty(c, 'visible', { configurable: true, get: () => v, set: (x: boolean) => { if (x !== v) flips++; v = x; } });
  };
  return { pass, rg, card, watch, flips: () => flips };
}

/** Frame `f` with the camera target at (tx, TY): `check` re-decides the card (rolling slice 0), `reCull` re-decides all. */
function frame(tx: number, f: number, o: { check?: boolean; reCull?: boolean } = {}): FrameCtx {
  return {
    params: PARAMS, basis: makeBasis(PARAMS, tx, TY, W, H), out: [0, 0, 0], W, H, cull: cullOf(makeBasis(PARAMS, tx, TY, W, H), PARAMS, W, H),
    dx: 0, dz: -1, tilt: 1, exactKeys: false, reCull: o.reCull ?? false, roll: o.check ? 0 : -1, frameNo: f, now: f * 16,
  } as unknown as FrameCtx;
}

// The card's foot on screen and its art's half width there, with the target at x tx; kept: inside the fixed margins
// (frame/cull.ts; the ring is off in these frames).
function footAt(tx: number): { sx: number; hw: number; kept: boolean } {
  const o = [0, 0, 0], b = makeBasis(PARAMS, tx, TY, W, H);
  project(b, FX, 0, FY, o);
  return { sx: o[0]!, hw: (128 * b.fpx) / o[2]!, kept: legacyShow(cullOf(b, PARAMS, W, H), o[0]!, o[1]!, o[2]!, LEGACY_CULL.art.above, LEGACY_CULL.art.below) };
}
// Moving the target east slides the card west across the screen.
function targetWhere(pred: (sx: number, hw: number, kept: boolean) => boolean): number {
  for (let tx = FX; tx < FX + 20000; tx += 4) { const { sx, hw, kept } = footAt(tx); if (pred(sx, hw, kept)) return tx; }
  throw new Error('no such target');
}
const ON = FX;
const CULLED = targetWhere((_sx, _hw, kept) => !kept) + 200;
// Inside the cull bounds, its whole art left of the screen.
const IN_MARGIN = targetWhere((sx, hw, kept) => kept && sx + hw < -200);
// Its art's right edge just over the left screen edge, the foot still off screen.
const EDGE = targetWhere((sx, hw) => sx < 0 && sx + hw > 4 && sx + hw < 30);

describe('createDecor visibility flips (perf Task 1, A PA1)', () => {
  it('a card culled on a frame that does not rebuild World keeps visible and is parked at scale 0', () => {
    const t = setup();
    t.pass.pre(frame(ON, 1, { reCull: true }));
    expect(t.card().visible).toBe(true);
    expect(t.card().scale.x).toBeGreaterThan(0);
    t.watch();
    t.pass.pre(frame(CULLED, 2, { check: true }));
    expect([t.card().visible, t.card().scale.x, t.card().scale.y]).toEqual([true, 0, 0]);
    for (let f = 3; f < 60; f++) t.pass.pre(frame(CULLED, f));
    expect(t.flips()).toBe(0);
    expect(t.pass.stats?.()).toMatchObject({ forced: 0, parked: 1 });
  });

  it('a parked card is hidden on a frame that rebuilds anyway once idle, not before', () => {
    const t = setup();
    t.pass.pre(frame(ON, 1, { reCull: true }));
    t.pass.pre(frame(CULLED, 2, { check: true }));
    t.watch();
    t.rg.structureDidChange = true;
    t.pass.pre(frame(CULLED, 3));
    expect(t.card().visible).toBe(true);
    t.pass.pre(frame(CULLED, 2 + IDLE_FRAMES + 1));
    expect(t.card().visible).toBe(false);
    expect(t.flips()).toBe(1);
    expect(t.pass.stats?.()).toMatchObject({ forced: 0 });
  });

  it('the idle threshold hides it on the shared sweep frame even when nothing else rebuilds', () => {
    const t = setup();
    t.pass.pre(frame(ON, 1, { reCull: true }));
    t.pass.pre(frame(CULLED, 2, { check: true }));
    for (let f = 3; f < 2 * IDLE_FRAMES; f++) t.pass.pre(frame(CULLED, f));
    expect(t.card().visible).toBe(true);
    t.pass.pre(frame(CULLED, 2 * IDLE_FRAMES));
    expect(t.card().visible).toBe(false);
    expect(t.pass.stats?.()).toMatchObject({ forced: 1 });
  });

  it('a parked card back in view un-parks by scale and never touches visible', () => {
    const t = setup();
    t.pass.pre(frame(ON, 1, { reCull: true }));
    const placed = t.card().scale.x;
    t.pass.pre(frame(CULLED, 2, { check: true }));
    t.watch();
    t.pass.pre(frame(ON, 3, { check: true }));
    expect(t.card().scale.x).toBeCloseTo(placed, 9);
    expect(t.flips()).toBe(0);
  });

  it('a hidden card back in view waits hidden while its art is off screen, and shows on the frame its art reaches the screen', () => {
    const t = setup();
    t.pass.pre(frame(ON, 1, { reCull: true }));
    t.pass.pre(frame(CULLED, 2, { check: true }));
    t.rg.structureDidChange = true;
    t.pass.pre(frame(CULLED, 2 + IDLE_FRAMES));
    t.rg.structureDidChange = false;
    expect(t.card().visible).toBe(false);
    t.watch();
    t.pass.pre(frame(IN_MARGIN, 200, { check: true }));
    expect(t.card().visible).toBe(false);
    expect(t.pass.stats?.()).toMatchObject({ pending: 1 });
    t.pass.pre(frame(IN_MARGIN, 201));
    expect(t.card().visible).toBe(false);
    t.pass.pre(frame(EDGE, 202));
    expect(t.card().visible).toBe(true);
    const { sx } = footAt(EDGE);
    expect(t.card().x).toBeCloseTo(sx, 6);
    expect(t.card().scale.x).toBeGreaterThan(0);
    expect(t.flips()).toBe(1);
  });

  it('a waiting card shows on the next frame that rebuilds World anyway, wherever it is', () => {
    const t = setup();
    t.pass.pre(frame(ON, 1, { reCull: true }));
    t.pass.pre(frame(CULLED, 2, { check: true }));
    t.rg.structureDidChange = true;
    t.pass.pre(frame(CULLED, 2 + IDLE_FRAMES));
    t.rg.structureDidChange = false;
    t.pass.pre(frame(IN_MARGIN, 200, { check: true }));
    expect(t.card().visible).toBe(false);
    t.rg.structureDidChange = true;
    t.pass.pre(frame(IN_MARGIN, 201));
    expect(t.card().visible).toBe(true);
    expect(t.pass.stats?.()).toMatchObject({ pending: 0 });
  });

  it('perf 5 ring: a card near the camera culled off screen is re-decided on the next moving frame outside its slice', () => {
    const t = setup();
    // Its art just left of the screen, ~2,500 px from the camera (inside the ring less a cap): the screen culls it.
    const near = targetWhere((sx, hw) => sx + hw < -20);
    const ring = (tx: number, f: number, o: { reCull?: boolean; still?: boolean } = {}): FrameCtx =>
      ({ ...frame(tx, f, o), camStill: o.still ?? false, capMask: 0, cull: cullOf(makeBasis(PARAMS, tx, TY, W, H), PARAMS, W, H, 0.75, RING_PX) }) as FrameCtx;
    t.pass.pre(ring(near, 1, { reCull: true }));
    expect(t.card().visible).toBe(false);
    t.pass.pre(ring(ON, 2, { still: true }));
    expect(t.card().visible).toBe(false);
    t.pass.pre(ring(ON, 3));
    expect(t.card().visible).toBe(true);
  });

  it('drop hides and detaches every card and forgets what was in view', () => {
    const t = setup();
    t.pass.pre(frame(ON, 1, { reCull: true }));
    const c = t.card();
    t.pass.drop();
    expect(c.visible).toBe(false);
    expect(c.parent).toBeNull();
    t.pass.pre(frame(IN_MARGIN, 2));
    expect(c.visible).toBe(false);
  });
});

describe('createDecor on a still camera (perf Task 4)', () => {
  const counting = () => {
    const st = { calls: 0, fading: false };
    const fd: Fader = { factor: () => { st.calls++; return 1; }, isFading: () => st.fading, prune: () => undefined, size: () => 0, drop: () => undefined };
    return { fd, st };
  };
  type Occ = { avatarKey?: number | null; avatarUpper?: { x: number; y: number } | null };
  const at = (tx: number, f: number, still: boolean, o: { check?: boolean; reCull?: boolean } & Occ = {}): FrameCtx =>
    ({ ...frame(tx, f, o), camStill: still, avatarKey: o.avatarKey ?? null, avatarUpper: o.avatarUpper ?? null }) as unknown as FrameCtx;
  // A settled card in view on frames 1-2; then a sentinel x shows whether the pass wrote it again.
  const settled = (o: Occ = {}) => {
    const c = counting();
    const t = setup(c.fd);
    t.pass.pre(at(ON, 1, false, { reCull: true, ...o }));
    t.pass.pre(at(ON, 2, true, o));
    t.card().position.x = -1;
    c.st.calls = 0;
    return { ...t, ...c };
  };

  it('a settled card in view is left alone: no write, no fade', () => {
    const t = settled();
    for (let f = 3; f < 8; f++) t.pass.pre(at(ON, f, true));
    expect([t.card().x, t.st.calls]).toEqual([-1, 0]);
    expect(t.card().visible).toBe(true);
  });

  it('a card still easing keeps its fade every frame', () => {
    const t = settled();
    t.st.fading = true;
    t.pass.pre(at(ON, 3, true));
    expect(t.st.calls).toBe(1);
  });

  it('the avatar moving under a still camera re-decides the occlusion fade', () => {
    const t = settled({ avatarKey: 5, avatarUpper: { x: 10, y: 10 } });
    t.pass.pre(at(ON, 3, true, { avatarKey: 5, avatarUpper: { x: 10, y: 10 } }));
    expect(t.st.calls).toBe(0);
    t.pass.pre(at(ON, 4, true, { avatarKey: 5, avatarUpper: { x: 12, y: 10 } }));
    expect(t.st.calls).toBe(1);
  });

  it('a moved camera, or the card in its re-check slice, places it again', () => {
    const t = settled();
    t.pass.pre(at(ON, 3, true, { check: true }));
    expect(t.card().x).toBeCloseTo(footAt(ON).sx, 6);
    t.card().position.x = -1;
    t.pass.pre(at(ON + 8, 4, false));
    expect(t.card().x).toBeCloseTo(footAt(ON + 8).sx, 6);
  });
});
