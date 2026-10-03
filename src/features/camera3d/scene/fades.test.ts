import { describe, expect, it } from 'vitest';
import type { FrameCtx } from '../frame/frame';
import { FakeNode } from '../__test__/fakeNode';
import { OCCLUDE_ALPHA, createFader, easeAlpha, fadeTarget, fadeWeight } from './fades';

const D = Math.PI / 180;

describe('fade weight by pitch', () => {
  it('is zero from EXACT_PITCH up (s = 0 matches 2D) and full at or below 60°', () => {
    expect(fadeWeight(90 * D)).toBe(0);
    expect(fadeWeight(80 * D)).toBe(0);
    expect(fadeWeight(70 * D)).toBeCloseTo(0.5, 6);
    expect(fadeWeight(60 * D)).toBe(1);
    expect(fadeWeight(30 * D)).toBe(1);
  });
});

describe('createFader', () => {
  const ctxAt = (frameNo: number, now: number, pitchDeg: number) =>
    ({ frameNo, now, basis: { C: [1000, 500, 2000] }, params: { pitch: pitchDeg * D }, avatarKey: null, avatarUpper: null }) as unknown as FrameCtx;
  const card = new FakeNode().node;

  it('leaves a card under the camera alone straight down', () => {
    expect(createFader().factor(ctxAt(1, 1000, 90), card, 0, 1000, 2000)).toBe(1);
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
    const fp = { frameNo: 1, now: 1000, basis: { C: [0, 170, 0] }, params: { pitch: 2 * D }, hideSelf: true, avatarKey: null, avatarUpper: null } as unknown as FrameCtx;
    expect(createFader().factor(fp, new FakeNode().node, 0, 0, -256)).toBe(1);
    expect(createFader().factor({ ...fp, hideSelf: false } as FrameCtx, new FakeNode().node, 0, 0, -256)).toBeLessThan(1);
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
