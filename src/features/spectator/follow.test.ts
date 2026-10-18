import { describe, expect, it } from 'vitest';
import { AVATAR_HEADROOM, bodyPointOf, canFollowViews, drawnGridOf, followPointOf, followSourceFor, pickPlayerAt, predictNatural } from './follow';

describe('followPointOf', () => {
  it('frames the drawn position with the game headroom', () => {
    expect(AVATAR_HEADROOM).toBe(0.25);
    // live 1448: avatar on tile {24,24} → cameraTarget {24, 23.75}
    expect(followPointOf({ x: 24, y: 24 }, null)).toEqual({ x: 24, y: 23.75 });
    expect(followPointOf({ x: 24.5, y: 30.75 }, { x: 24, y: 31 })).toEqual({ x: 24.5, y: 30.5 });
  });

  it('falls back to the slot tile with the same framing, so switching sources never jumps', () => {
    expect(followPointOf(null, { x: 7, y: 9 })).toEqual({ x: 7, y: 8.75 });
    expect(followPointOf({ x: Number.NaN, y: 3 }, { x: 7, y: 9 })).toEqual({ x: 7, y: 8.75 });
    expect(followPointOf({ x: 7, y: Number.POSITIVE_INFINITY }, { x: 7, y: 9 })).toEqual({ x: 7, y: 8.75 });
  });

  it('is null when neither source is usable', () => {
    expect(followPointOf(null, null)).toBeNull();
    expect(followPointOf({ x: Number.NaN, y: 0 }, { x: 0, y: Number.NaN })).toBeNull();
  });

  it('returns a fresh point', () => {
    const drawn = { x: 1, y: 2 };
    const p = followPointOf(drawn, null);
    expect(p).not.toBe(drawn);
    expect(drawn).toEqual({ x: 1, y: 2 });
  });
});

// A stand-in for the game's TileStepSmoothing: advance(now) moves its own fields, like the real one.
class FakeSmoothing {
  goalLerpWorldX = 0;
  goalLerpWorldY = 0;
  isGoalInterpolating = false;
  startMs = 0;
  fromY = 0;
  lastGoalWorldY = 0;
  get isInterpolating(): boolean { return this.isGoalInterpolating; }
  advance(now: number): { x: number; y: number } {
    if (!this.isGoalInterpolating) return { x: this.goalLerpWorldX, y: this.goalLerpWorldY };
    const t = Math.min(1, (now - this.startMs) / 140);
    this.goalLerpWorldY = this.fromY + (this.lastGoalWorldY - this.fromY) * t;
    if (t >= 1) this.isGoalInterpolating = false;
    return { x: this.goalLerpWorldX, y: this.goalLerpWorldY };
  }
}

interface FakeView {
  naturalContainerX: number; naturalContainerY: number; gridPosition: { x: number; y: number } | null;
  isInViewport: boolean; container: { x: number; y: number }; positionSmoothing: FakeSmoothing;
}

function view(gx: number, gy: number, ncx: number, ncy: number, lastGoalY = ncy, inViewport = true): FakeView {
  const ps = new FakeSmoothing();
  ps.goalLerpWorldX = ncx;
  ps.goalLerpWorldY = ncy;
  ps.lastGoalWorldY = lastGoalY;
  return { naturalContainerX: ncx, naturalContainerY: ncy, gridPosition: { x: gx, y: gy }, isInViewport: inViewport, container: { x: ncx, y: ncy }, positionSmoothing: ps };
}

describe('drawnGridOf (recorded live, game 1448)', () => {
  it('takes the rest offset and lift off the drawn position', () => {
    expect(drawnGridOf(view(41, 13, 10624, 3264))).toEqual({ x: 41, y: 13 });
    expect(drawnGridOf(view(22, 19, 5760, 4800))).toEqual({ x: 22, y: 19 });
    // Marlow stands 102.4 px lower (drawOffsetYPixels): the offset comes from the goal, so it cancels too.
    expect(drawnGridOf(view(55, 31, 14208, 7974.4))).toEqual({ x: 55, y: 31 });
  });

  it('keeps the glide between tiles (a remote step from y 13 to 14)', () => {
    const v = view(41, 14, 10624, 3444.355, 3520);
    expect(drawnGridOf(v, { x: 10624, y: 3485.393 })?.y).toBeCloseTo(13.86482, 5);
    expect(drawnGridOf(v)?.y).toBeCloseTo((3444.355 + 192) / 256 - 0.5, 9);
  });

  it('is null without a tile', () => {
    expect(drawnGridOf({ ...view(1, 1, 384, 192), gridPosition: null })).toBeNull();
  });
});

describe('predictNatural (the game glide at this frame time, without touching the view)', () => {
  it('advances a copy of the smoothing, never the view', () => {
    const v = view(41, 14, 10624, 3264, 3520);
    Object.assign(v.positionSmoothing, { isGoalInterpolating: true, startMs: 1000, fromY: 3264 });
    expect(predictNatural(v, 1070)).toEqual({ x: 10624, y: 3392 });
    expect(v.positionSmoothing.goalLerpWorldY).toBe(3264);
    expect(v.positionSmoothing.isInterpolating).toBe(true);
  });

  it('a smoothing with a nested field is never copied (the copy would advance the live one)', () => {
    const v = view(41, 14, 10624, 3264, 3520);
    Object.assign(v.positionSmoothing, { isGoalInterpolating: true, startMs: 1000, fromY: 3264, goal: { y: 3264 } });
    expect(predictNatural(v, 1070)).toBeNull();
    expect(canFollowViews(new Map<string, unknown>([['ff', v]]), 0)).toBe(false);
  });

  it('a view at rest is its drawn position; a smoothing that cannot be copied is null', () => {
    expect(predictNatural(view(41, 13, 10624, 3264), 5000)).toEqual({ x: 10624, y: 3264 });
    const v = view(41, 14, 10624, 3264, 3520);
    v.positionSmoothing.isGoalInterpolating = true;
    v.positionSmoothing.advance = function (this: FakeSmoothing) { if (this !== v.positionSmoothing) throw new TypeError('private'); return { x: 0, y: 0 }; };
    expect(predictNatural(v, 5000)).toBeNull();
  });
});

describe('followSourceFor', () => {
  const sys = (views: Array<[string, unknown]>, tiles: Array<[string, { x: number; y: number }]> = []) =>
    ({ views: new Map<unknown, unknown>(views), userPositions: new Map<unknown, unknown>(tiles) });

  it('follows the predicted glide of a view on screen, framed with the headroom', () => {
    const v = view(41, 14, 10624, 3264, 3520);
    Object.assign(v.positionSmoothing, { isGoalInterpolating: true, startMs: 1000, fromY: 3264 });
    const p = followSourceFor('ff', sys([['ff', v]]))(1070);
    expect(p?.x).toBe(41);
    expect(p?.y).toBeCloseTo((3392 + 192) / 256 - 0.5 - 0.25, 9);
  });

  it('a culled view (the game stops updating it) falls back to its runtime tile', () => {
    const culled = { ...view(0, 0, 0, 0), gridPosition: null, isInViewport: false };
    expect(followSourceFor('ff', sys([['ff', culled]], [['ff', { x: 50, y: 24 }]]))(0)).toEqual({ x: 50, y: 23.75 });
    const stale = view(10, 10, 2688, 2496, 2496, false);
    expect(followSourceFor('ff', sys([['ff', stale]], [['ff', { x: 50, y: 24 }]]))(0)).toEqual({ x: 50, y: 23.75 });
  });

  it('re-reads the view every frame, so a rebuilt view is never stale', () => {
    const s = sys([['ff', view(41, 13, 10624, 3264)]]);
    const src = followSourceFor('ff', s);
    expect(src(0)).toEqual({ x: 41, y: 12.75 });
    s.views.set('ff', view(42, 13, 10880, 3264));
    expect(src(0)).toEqual({ x: 42, y: 12.75 });
  });

  it('a prediction that fails uses the drawn position; a misshaped view or no position at all is null', () => {
    const v = view(41, 14, 10624, 3444.355, 3520);
    v.positionSmoothing.isGoalInterpolating = true;
    v.positionSmoothing.advance = () => { throw new Error('drift'); };
    expect(followSourceFor('ff', sys([['ff', v]]))(0)?.y).toBeCloseTo((3444.355 + 192) / 256 - 0.5 - 0.25, 9);
    expect(followSourceFor('ff', sys([['ff', { container: {} }]]))(0)).toBeNull();
    expect(followSourceFor('gone', sys([]))(0)).toBeNull();
  });
});

describe('pickPlayerAt (click to follow)', () => {
  const at = (id: string, x: number, y: number) => ({ id, point: { x, y } });

  it('takes the nearest body within 0.6 tiles of the click', () => {
    const c = [at('a', 10, 10), at('b', 10.5, 10)];
    expect(pickPlayerAt({ x: 10.3, y: 10 }, c)).toBe('b');
    expect(pickPlayerAt({ x: 10.2, y: 10 }, c)).toBe('a');
    expect(pickPlayerAt({ x: 10, y: 10.59 }, c)).toBe('a');
    expect(pickPlayerAt({ x: 10, y: 10.61 }, c)).toBeNull();
    expect(pickPlayerAt({ x: 10, y: 10 }, [])).toBeNull();
  });

  it('the drawn body is the container point (the sprite is centred on it, live 1448)', () => {
    expect(bodyPointOf(view(22, 19, 5760, 4800))).toEqual({ x: 22, y: 18.25 });
  });
});

describe('canFollowViews (entry check)', () => {
  it('needs one view with the follow shape whose smoothing can be copied and advanced', () => {
    expect(canFollowViews(new Map<string, unknown>([['npc', { container: {} }], ['me', view(22, 19, 5760, 4800)]]), 0)).toBe(true);
    const locked = view(22, 19, 5760, 4800);
    locked.positionSmoothing.advance = function (this: FakeSmoothing) { if (this !== locked.positionSmoothing) throw new TypeError('private'); return { x: 0, y: 0 }; };
    expect(canFollowViews(new Map([['me', locked]]), 0)).toBe(false);
    expect(canFollowViews(new Map([['npc', { container: {} }]]), 0)).toBe(false);
    expect(canFollowViews(new Map(), 0)).toBe(false);
  });
});
