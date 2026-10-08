import { describe, expect, it } from 'vitest';
import type { AvatarViewLike, XY } from '../types';
import { createAvatarSource, liftOfView } from './avatarSource';

// Live 2026-10-05 (v1419): decorCatalog avatarNudgeY StoneBench −0.18, WoodBridge −0.44; building nudges −40 / −70 px.
const NUDGE: Record<string, number> = { StoneBench: -0.18, WoodBridge: -0.44 };
const nudgeOf = (id: string): unknown => NUDGE[id];

function view(o: { tile?: unknown; building?: unknown; air?: boolean } = {}): AvatarViewLike {
  return {
    container: {}, gridPosition: { x: 20, y: 13 }, naturalContainerY: 0, lastTileData: o.tile, isAirborneMount: o.air ?? false,
    positionSmoothing: { isInterpolating: false, goalSourceWorldY: 0, lastGoalWorldY: 0 },
    buildingDataProvider: { getBuildingAt: (_p: XY) => o.building ?? null },
  };
}

describe('avatar source', () => {
  it('lifts like the game: decor nudge first, else the building nudge, never on an airborne mount', () => {
    const bench = { objectType: 'decor', decorId: 'StoneBench' };
    expect(liftOfView(view({ tile: bench }), nudgeOf)).toBeCloseTo(46.08, 9);
    expect(liftOfView(view({ tile: { objectType: 'decor', decorId: 'WoodBridge' } }), nudgeOf)).toBeCloseTo(112.64, 9);
    expect(liftOfView(view({ building: { avatarYNudgePixels: -40 } }), nudgeOf)).toBe(40);
    // A decor with no nudge (a statue) and a plant tile fall through to the building, as the game does.
    expect(liftOfView(view({ tile: { objectType: 'decor', decorId: 'Statue' }, building: { avatarYNudgePixels: -70 } }), nudgeOf)).toBe(70);
    expect(liftOfView(view({ tile: { objectType: 'plant' }, building: { avatarYNudgePixels: -70 } }), nudgeOf)).toBe(70);
    expect(liftOfView(view({ tile: bench, air: true, building: { avatarYNudgePixels: -40 } }), nudgeOf)).toBe(0);
    expect(liftOfView(view(), nudgeOf)).toBe(0);
  });

  it('finds the view by its container and rejects a view whose glide fields drifted', () => {
    const a = {}, b = {};
    const good = { ...view(), container: a };
    const drifted = { container: b, naturalContainerY: 0, positionSmoothing: { lastGoalWorldY: 0 } };
    const src = createAvatarSource({ views: new Map<unknown, unknown>([['p1', good], ['p2', drifted]]) }, () => undefined);
    expect(src.viewOf(a as never)).toBe(good);
    expect(src.viewOf(b as never)).toBeNull();
    expect(src.viewOf({} as never)).toBeNull();
    expect(createAvatarSource(null, () => undefined).viewOf(a as never)).toBeNull();
  });

  it('remembers a miss: a drifted view is not looked up again every frame', () => {
    const b = {};
    let reads = 0;
    const views = new Map<unknown, unknown>([['p2', { container: b, naturalContainerY: 0, positionSmoothing: {} }]]);
    const sys = { views: { values: () => { reads++; return views.values(); } } as unknown as Map<unknown, unknown> };
    const src = createAvatarSource(sys, () => undefined);
    for (let i = 0; i < 5; i++) src.viewOf(b as never);
    expect(reads).toBe(1);
  });
});
