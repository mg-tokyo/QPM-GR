import { describe, expect, it } from 'vitest';
import { makeBasis, project, type CamParams } from './math/camera';
import { AppearTracker, cameraCut, onScreenPoint, screenBefore } from './debugAppear';

const W = 1600, H = 900;
const A = { id: 'a' }, B = { id: 'b' }, C = { id: 'c' };

/** One frame: every node in `drawn` is seen; new ones appear as tiles at (px, py). */
function frame(t: AppearTracker, n: number, drawn: object[], o: { cut?: boolean; px?: number; py?: number; kind?: 'tile' | 'card' | 'other'; near?: boolean; spawned?: boolean; key?: number; wasOn?: boolean } = {}): void {
  t.begin(n, o.cut ?? false);
  for (const node of drawn) {
    if (!t.seen(node, o.key)) continue;
    const px = o.px ?? 800, py = o.py ?? 450;
    t.appeared(o.kind ?? 'tile', 'Tile (3,4)', px, py, onScreenPoint(px, py, W, H), o.near ?? false, o.spawned ?? false, o.key, o.wasOn);
  }
}

describe('AppearTracker: late vs entered (perf Task 5)', () => {
  it('counts an appearance only if its point was on screen the frame before; one sliding in this frame is entered', () => {
    const t = new AppearTracker();
    frame(t, 1, [A]);
    frame(t, 2, [A, B], { wasOn: false });
    frame(t, 3, [A, B, C], { wasOn: true });
    const s = t.read();
    expect(s).toMatchObject({ count: 1, entered: 1 });
    expect(s.samples).toHaveLength(1);
  });

  it('screenBefore re-projects a drawn point through the previous camera', () => {
    const p: CamParams = { yaw: 0.7, pitch: 0.3, dist: 900, fov: 1.1, lookH: 150, yOff: 0.05, near: 40, far: 31000 };
    const b1 = makeBasis(p, 6000, 5000, W, H), b0 = makeBasis({ ...p, yaw: 0.66 }, 5940, 5030, W, H);
    const o1 = [0, 0, 0], o0 = [0, 0, 0], got = [0, 0, 0];
    project(b1, 6400, 220, 4700, o1);
    project(b0, 6400, 220, 4700, o0);
    screenBefore(b1, b0, o1[0]!, o1[1]!, o1[2]!, got);
    got.forEach((v, i) => expect(v).toBeCloseTo(o0[i]!, 6));
  });
});

describe('AppearTracker', () => {
  it('counts nothing on the first frame: there is no previous frame to compare with', () => {
    const t = new AppearTracker();
    frame(t, 1, [A, B]);
    expect(t.read().count).toBe(0);
  });

  it('counts a node that became drawn on screen between two consecutive frames', () => {
    const t = new AppearTracker();
    frame(t, 1, [A]);
    frame(t, 2, [A, B]);
    const s = t.read();
    expect(s.count).toBe(1);
    expect(s.samples[0]).toMatchObject({ kind: 'tile', px: 800, py: 450, frame: 2 });
  });

  it('never counts a node that stayed drawn', () => {
    const t = new AppearTracker();
    frame(t, 1, [A, B]);
    frame(t, 2, [A, B]);
    frame(t, 3, [B, A]);
    expect(t.read().count).toBe(0);
  });

  it('ignores an appearance off screen (the cull margins did their job)', () => {
    const t = new AppearTracker();
    frame(t, 1, [A]);
    frame(t, 2, [A, B], { px: -5 });
    frame(t, 3, [A, B, C], { py: H + 1 });
    expect(t.read().count).toBe(0);
  });

  it('treats a frame-number gap and a camera cut as a new start', () => {
    const t = new AppearTracker();
    frame(t, 1, [A]);
    frame(t, 3, [A, B]);
    frame(t, 4, [A, B, C], { cut: true });
    const s = t.read();
    expect(s.count).toBe(0);
    expect(s.cuts).toBe(2);
  });

  it('reset() drops the previous frame', () => {
    const t = new AppearTracker();
    frame(t, 1, [A]);
    t.reset();
    frame(t, 2, [A, B]);
    expect(t.read().count).toBe(0);
  });

  it('keeps near-lens, spawned and game-shown appearances out of the count', () => {
    const t = new AppearTracker();
    frame(t, 1, [A]);
    frame(t, 2, [A, B], { near: true });
    frame(t, 3, [A, B, C], { spawned: true });
    const D = {};
    frame(t, 4, [A, B, C, D], { kind: 'other' });
    const s = t.read();
    expect(s).toMatchObject({ count: 0, near: 1, spawned: 1, others: 1 });
    expect(s.samples).toHaveLength(1);
  });

  it('does not count a fence strip taking over from its perspective quad (same depth key last frame)', () => {
    const t = new AppearTracker();
    const strip = {}, persp = {};
    frame(t, 1, [persp], { key: 7 });
    frame(t, 2, [strip], { key: 7, kind: 'card' });
    frame(t, 3, [strip, C], { key: 9, kind: 'card' });
    const s = t.read();
    expect(s.switches).toBe(1);
    expect(s.count).toBe(1);
  });

  it('read() resets the totals', () => {
    const t = new AppearTracker();
    frame(t, 1, [A]);
    frame(t, 2, [A, B]);
    expect(t.count()).toBe(1);
    expect(t.read().count).toBe(1);
    expect(t.read()).toMatchObject({ count: 0, frames: 0, samples: [] });
  });

  it('caps the samples', () => {
    const t = new AppearTracker();
    frame(t, 1, []);
    const many = Array.from({ length: 60 }, () => ({}));
    frame(t, 2, many);
    const s = t.read();
    expect(s.count).toBe(60);
    expect(s.samples.length).toBeLessThan(60);
  });
});

describe('cameraCut', () => {
  const D = Math.PI / 180;
  it('is a cut with no previous camera (NaN) or after a big jump in position or yaw', () => {
    expect(cameraCut(NaN, NaN, 0, NaN)).toBe(true);
    expect(cameraCut(1600, 0, 0, 0)).toBe(true);
    expect(cameraCut(0, 0, 30 * D, 0)).toBe(true);
  });
  it('is motion for a small step, including a turn through ±180° (yaw wraps)', () => {
    expect(cameraCut(100, -100, 5 * D, 0)).toBe(false);
    expect(cameraCut(0, 0, -179 * D, 179 * D)).toBe(false);
    expect(cameraCut(0, 0, 179 * D, -179 * D)).toBe(false);
  });
});

describe('onScreenPoint', () => {
  it('is inclusive of the screen edges', () => {
    expect(onScreenPoint(0, 0, W, H)).toBe(true);
    expect(onScreenPoint(W, H, W, H)).toBe(true);
    expect(onScreenPoint(W + 0.5, 10, W, H)).toBe(false);
    expect(onScreenPoint(10, -0.5, W, H)).toBe(false);
  });
});
