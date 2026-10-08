import { describe, expect, it } from 'vitest';
import type { FrameCtx } from '../frame/frame';
import { FakeNode } from '../__test__/fakeNode';
import { OCCLUDE_ALPHA, createFader, easeAlpha, fadeTarget, spriteScreenRect } from './fades';

const D = Math.PI / 180;

describe('createFader', () => {
  // tilt 1 unless given: every test below is a tilted view.
  const ctxAt = (frameNo: number, now: number, pitchDeg: number, tilt = pitchDeg >= 80 ? 0 : 1) =>
    ({ frameNo, now, basis: { C: [1000, 500, 2000], F: [0, -1, 0] }, params: { pitch: pitchDeg * D }, tilt, avatarKey: null, avatarUpper: null }) as unknown as FrameCtx;
  const card = new FakeNode().node;

  it('leaves a card under the camera alone straight down', () => {
    expect(createFader().factor(ctxAt(1, 1000, 90), card, 0, 1000, 2000)).toBe(1);
  });
  it('weights the fade by the view tilt (s), never by the rendered pitch (A V2)', () => {
    // First person looking down 80°: fully tilted, so the plant you stand in fades like any near card.
    const fpDown = { ...ctxAt(1, 1000, 80, 1), hideSelf: true } as FrameCtx;
    expect(createFader().factor(fpDown, card, 0, 1000, 2000)).toBeLessThan(0.9);
    // The 2D match at a low rendered pitch (the raw debug camera's case) still draws nothing faded.
    expect(createFader().factor(ctxAt(1, 1000, 30, 0), card, 0, 1000, 2000)).toBe(1);
    // Half tilted: halfway to the proximity target (here 0), eased from 1.
    const half = createFader().factor(ctxAt(1, 1000, 70, 0.5), card, 0, 1000, 2000);
    expect(half).toBeCloseTo(0.5 + 0.5 * Math.exp(-16 / 150), 6);
  });
  it('proximity-only (every billboard): ignores the occlusion fade, keeps far cards at 1 without tracking them', () => {
    const covering = new FakeNode(50, 100).withTexture(100, 100, 1).node;
    const occl = { ...ctxAt(1, 1000, 30), avatarKey: 0, avatarUpper: { x: 50, y: 50 } } as unknown as FrameCtx;
    expect(createFader().factor(occl, covering, 10, 1000, 5000, true)).toBeLessThan(1);
    expect(createFader().factor(occl, covering, 10, 1000, 5000, false)).toBe(1);
    expect(createFader().factor(occl, covering, 10, 1000, 2000, false)).toBeLessThan(1);
  });
  it('restarts its frame clock on drop, so a new session does not ease with a stale gap', () => {
    const f = createFader();
    const first = f.factor(ctxAt(1, 1000, 30), card, 0, 1000, 2000);
    expect(first).toBeCloseTo(Math.exp(-16 / 150), 6);
    f.drop();
    expect(f.factor(ctxAt(2, 5000, 30), card, 0, 1000, 2000)).toBeCloseTo(first, 6);
  });
  it('keeps easing a card across frames, and prune forgets a destroyed or detached card mid-fade (A R4)', () => {
    const f = createFader();
    const root = new FakeNode();
    const a = root.addChild(new FakeNode()), b = root.addChild(new FakeNode()), c = root.addChild(new FakeNode());
    const k = Math.exp(-16 / 150);
    for (const n of [a, b, c]) expect(f.factor(ctxAt(1, 1000, 30), n.node, 0, 1000, 2000)).toBeCloseTo(k, 6);
    expect(f.factor(ctxAt(2, 1016, 30), a.node, 0, 1000, 2000)).toBeCloseTo(k * k, 6);
    expect(f.size()).toBe(3);
    b.destroyed = true;
    root.removeChild(c);
    f.prune();
    expect(f.size()).toBe(1);
    // A pruned card that comes back eases again from 1, as a new one does.
    root.addChild(c);
    expect(f.factor(ctxAt(3, 1032, 30), c.node, 0, 1000, 2000)).toBeCloseTo(k, 6);
  });
  it('perf 4: isFading is true only while a card eases, and ticks the frame clock like factor', () => {
    const f = createFader();
    const a = new FakeNode().node, b = new FakeNode().node, far = new FakeNode().node;
    expect(f.factor(ctxAt(1, 1000, 30), far, 0, 1000, 9000)).toBe(1);
    expect(f.factor(ctxAt(1, 1000, 30), a, 0, 1000, 2000)).toBeLessThan(1);
    expect([f.isFading(ctxAt(2, 1016, 30), a), f.isFading(ctxAt(2, 1016, 30), far)]).toEqual([true, false]);
    // Frames where every card was skipped still advance the clock: a fade starting next eases by one frame.
    for (let i = 3; i <= 6; i++) f.isFading(ctxAt(i, 1000 + 16 * (i - 1), 30), far);
    expect(f.factor(ctxAt(7, 1096, 30), b, 0, 1000, 2000)).toBeCloseTo(Math.exp(-16 / 150), 6);
  });
  it('perf 4: a card whose target sits just under 1 stays fading-pending: a slow frame would start it', () => {
    const f = createFader();
    const n = new FakeNode().node;
    const edge = 1000 + 128 + 0.96 * 256; // proximity target 0.96: a 16 ms step rounds to 1, a 33 ms one does not
    expect(f.factor(ctxAt(1, 1000, 30), n, 0, edge, 2000)).toBe(1);
    expect(f.isFading(ctxAt(2, 1016, 30), n)).toBe(true);
    expect(f.factor(ctxAt(3, 1049, 30), n, 0, edge, 2000)).toBeLessThan(1);
    // Out of the band (target 1): settled whatever the frame time.
    f.factor(ctxAt(4, 1065, 30), n, 0, 9000, 2000);
    for (let i = 5; i < 60; i++) f.factor(ctxAt(i, 1065 + 16 * (i - 4), 30), n, 0, 9000, 2000);
    expect(f.isFading(ctxAt(60, 2000, 30), n)).toBe(false);
  });
});

const rect = { x0: 0, y0: 0, x1: 100, y1: 100 };

describe('fades', () => {
  it('proximity ramps from 0 at half a tile to 1 at 1.5 tiles', () => {
    expect(fadeTarget(null, 0, null, null, 100)).toBe(0);
    expect(fadeTarget(null, 0, null, null, 256)).toBeCloseTo(0.5, 6);
    expect(fadeTarget(null, 0, null, null, 400)).toBe(1);
  });
  it('first person fades only what the camera stands in: a neighbour one tile away stays opaque', () => {
    expect(fadeTarget(null, 0, null, null, 20, true)).toBe(0);
    expect(fadeTarget(null, 0, null, null, 96, true)).toBeCloseTo((96 - 0.15 * 256) / (0.45 * 256), 6);
    expect(fadeTarget(null, 0, null, null, 160, true)).toBe(1);
    expect(fadeTarget(null, 0, null, null, 256, true)).toBe(1);
  });
  it('the fader uses the first-person band while the view hides the avatar', () => {
    const fp = { frameNo: 1, now: 1000, basis: { C: [0, 170, 0], F: [0, -Math.sin(2 * D), -Math.cos(2 * D)] }, params: { pitch: 2 * D }, tilt: 1, hideSelf: true, avatarKey: null, avatarUpper: null } as unknown as FrameCtx;
    expect(createFader().factor(fp, new FakeNode().node, 0, 0, -256)).toBe(1);
    expect(createFader().factor({ ...fp, hideSelf: false } as FrameCtx, new FakeNode().node, 0, 0, -256)).toBeLessThan(1);
  });
  // Live 2026-10-05 (v1419): first person at yaw 150, Tile (28, 22) 2.2 tiles away but 41 px deep drew 8732 px tall.
  it('fades a card standing beside the lens, which the ground-distance bands miss', () => {
    const fp = { frameNo: 1, now: 1000, basis: { C: [0, 200, 0], F: [0, 0, -1] }, params: { pitch: 0 }, tilt: 1, hideSelf: true, avatarKey: null, avatarUpper: null } as unknown as FrameCtx;
    expect(createFader().factor(fp, new FakeNode().node, 0, 560, -40)).toBeLessThan(1);
    expect(createFader().factor(fp, new FakeNode().node, 0, 560, -300)).toBe(1);
  });
  it('lens band: 0 at 0.2 tiles of view depth, 1 from 0.4 tiles, whatever the ground distance', () => {
    expect(fadeTarget(null, 0, null, null, 600, true, 40)).toBe(0);
    expect(fadeTarget(null, 0, null, null, 600, true, 0.3 * 256)).toBeCloseTo(0.5, 6);
    expect(fadeTarget(null, 0, null, null, 600, false, 0.4 * 256)).toBe(1);
    expect(fadeTarget(null, 0, null, null, 100, false, 1000)).toBe(0);
  });
  it('occludes only a card in front of the avatar that covers its upper body', () => {
    expect(fadeTarget(rect, 10, 5, { x: 50, y: 50 }, 1000)).toBe(OCCLUDE_ALPHA);
    expect(fadeTarget(rect, 1, 5, { x: 50, y: 50 }, 1000)).toBe(1);
    expect(fadeTarget(rect, 10, 5, { x: 150, y: 50 }, 1000)).toBe(1);
    expect(fadeTarget(rect, 10, null, { x: 50, y: 50 }, 1000)).toBe(1);
  });
  it('takes the stronger of the two fades', () => {
    expect(fadeTarget(rect, 10, 5, { x: 50, y: 50 }, 200)).toBeCloseTo(Math.min(OCCLUDE_ALPHA, (200 - 128) / 256), 6);
  });
  it('eases toward the target and never overshoots', () => {
    const a = easeAlpha(1, 0, 150);
    expect(a).toBeCloseTo(Math.exp(-1), 6);
    expect(easeAlpha(1, 0, 1e6)).toBeCloseTo(0, 9);
    expect(easeAlpha(0.2, 0.2, 16)).toBe(0.2);
  });
});

describe('spriteScreenRect', () => {
  it('is the texture box about the anchor, scaled, and ordered when a scale mirrors it', () => {
    const n = new FakeNode(500, 400, 2).withTexture(100, 50, 1);
    expect(spriteScreenRect(n.node)).toEqual({ x0: 400, y0: 300, x1: 600, y1: 400 });
    n.scale.set(-2, 2);
    expect(spriteScreenRect(n.node)).toEqual({ x0: 400, y0: 300, x1: 600, y1: 400 });
  });

  it('fills the given rect, and gives null without a texture or anchor', () => {
    const out = { x0: 0, y0: 0, x1: 0, y1: 0 };
    expect(spriteScreenRect(new FakeNode(0, 0).withTexture(10, 10, 0.5).node, out)).toBe(out);
    expect(spriteScreenRect(new FakeNode(0, 0).node)).toBeNull();
  });
});
