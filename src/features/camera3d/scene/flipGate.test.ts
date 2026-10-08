import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { FrameCtx } from '../frame/frame';
import { FlipGate, IDLE_FRAMES, rectOnScreen } from './flipGate';

const W = 1280, H = 656;
const worldWith = (dirty: boolean) => { const w = new FakeNode(); (w.renderGroup as { structureDidChange?: boolean }).structureDidChange = dirty; return w.node; };
const ctxAt = (frameNo: number, reCull = false): FrameCtx => ({ frameNo, reCull, W, H } as unknown as FrameCtx);

describe('FlipGate (perf Task 1)', () => {
  it('shows a hidden card at once when it is on screen, else only on a frame that rebuilds World anyway', () => {
    const g = new FlipGate(worldWith(false));
    g.begin(ctxAt(5));
    expect(g.canShow(ctxAt(5), true)).toBe(true);
    expect(g.canShow(ctxAt(5), false)).toBe(false);
    expect(g.canShow(ctxAt(5, true), false)).toBe(true);
    expect(new FlipGate(worldWith(true)).canShow(ctxAt(5), false)).toBe(true);
  });

  it('a flip this frame makes later flips free', () => {
    const g = new FlipGate(worldWith(false));
    const n = new FakeNode().node;
    g.begin(ctxAt(5));
    g.set(n, false);
    expect(n.visible).toBe(false);
    expect(g.canShow(ctxAt(5), false)).toBe(true);
    g.end();
    expect(g.forced).toBe(1);
    g.begin(ctxAt(6));
    expect(g.canShow(ctxAt(6), false)).toBe(false);
  });

  it('hides a parked card only once idle, on a frame that rebuilds anyway or on the shared sweep frame', () => {
    const g = new FlipGate(worldWith(false));
    const notSweep = IDLE_FRAMES + 1;
    g.begin(ctxAt(notSweep));
    expect(g.canHide(ctxAt(notSweep, true), IDLE_FRAMES - 1)).toBe(false);
    expect(g.canHide(ctxAt(notSweep, true), IDLE_FRAMES)).toBe(true);
    expect(g.canHide(ctxAt(notSweep), IDLE_FRAMES)).toBe(false);
    expect(g.canHide(ctxAt(2 * IDLE_FRAMES), IDLE_FRAMES)).toBe(true);
    expect(g.canHide(ctxAt(2 * IDLE_FRAMES), IDLE_FRAMES - 1)).toBe(false);
  });

  it('counts a flip as forced only when the frame was not rebuilding already', () => {
    const g = new FlipGate(worldWith(true));
    const n = new FakeNode().node;
    g.begin(ctxAt(1));
    g.set(n, false);
    g.end();
    g.begin(ctxAt(2));
    g.set(n, false);
    g.end();
    expect(g.forced).toBe(0);
  });

  it('rectOnScreen: any overlap with the screen counts; a rect wholly past an edge does not', () => {
    const c = ctxAt(1);
    expect(rectOnScreen(c, -50, 100, -10, 200)).toBe(false);
    expect(rectOnScreen(c, -50, 100, 1, 200)).toBe(true);
    expect(rectOnScreen(c, W + 10, 100, W + 50, 200)).toBe(false);
    expect(rectOnScreen(c, 100, H + 3, 200, H + 90)).toBe(false);
    expect(rectOnScreen(c, 100, -90, 200, -3)).toBe(false);
    expect(rectOnScreen(c, -5000, -5000, 5000, 5000)).toBe(true);
  });
});
