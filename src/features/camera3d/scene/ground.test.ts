import { describe, expect, it } from 'vitest';
import { FakeNode } from '../__test__/fakeNode';
import type { AvatarViewLike } from '../types';
import { createGroundTracker, heightAlong, type GroundTracker } from './ground';

const avatar = (x: number, y: number): FakeNode => { const n = new FakeNode(x, y); n.label = 'AvatarContainer (p1)'; return n; };
const pet = (x: number, y: number): FakeNode => { const n = new FakeNode(x, y); n.label = 'Pet: Phoenix'; return n; };

/** An avatar learns the walker rest offset 192 at (6272, 5312) on tile row 5504. */
function walkerAtRest(): { g: ReturnType<typeof createGroundTracker>; a: FakeNode } {
  const g = createGroundTracker();
  const a = avatar(6272, 5312);
  for (let i = 0; i < 8; i++) g.groundY(a.node, 5504.0002, i);
  return { g, a };
}

describe('ground tracker', () => {
  it('keeps every non-avatar on its sort y', () => {
    const g = createGroundTracker();
    const tile = new FakeNode(100, 200);
    tile.label = 'Tile (0, 0)';
    expect(g.groundY(tile.node, 4000, 0)).toBe(4000);
    expect(g.isAvatar(tile.node)).toBe(false);
  });

  it('glides an avatar on y + its rest offset while the game sort y steps a whole tile (live 2026-10-03)', () => {
    const g = createGroundTracker();
    const a = avatar(6272, 5312);
    for (let i = 0; i < 8; i++) g.groundY(a.node, 5504, i);
    expect(g.groundY(a.node, 5504, 8)).toBe(5504);
    // Walking south: the sort y jumps to the next tile at the start of the step, the container glides.
    a.y = 5318.4;
    expect(g.groundY(a.node, 5760, 9)).toBeCloseTo(5510.4, 6);
    a.y = 5488;
    expect(g.groundY(a.node, 5760, 10)).toBeCloseTo(5680, 6);
    a.y = 5532.9;
    expect(g.groundY(a.node, 6016, 11)).toBeCloseTo(5724.9, 6);
  });

  it('does not learn the offset from a step start, when the sort y moved but the container has not yet', () => {
    const g = createGroundTracker();
    const a = avatar(6272, 5312);
    for (let i = 0; i < 8; i++) g.groundY(a.node, 5504, i);
    g.groundY(a.node, 5760, 8);
    g.groundY(a.node, 5760, 9);
    a.y = 5400;
    expect(g.groundY(a.node, 5760, 10)).toBeCloseTo(5592, 6);
  });

  it('falls back to the sort y until an avatar was seen at rest', () => {
    const g = createGroundTracker();
    expect(g.groundY(avatar(0, 5310).node, 5760, 0)).toBe(5760);
  });

  // Live 2026-10-04, Phoenix: the saddle lift puts the container 400 px above its tile row and bobs it ±17 px.
  it('stands a riding avatar on its tile row, whatever the saddle lift and bob', () => {
    const { g, a } = walkerAtRest();
    a.y = 5360;
    expect(g.groundY(a.node, 5504.0006, 100)).toBe(5504);
    a.y = 5377;
    expect(g.groundY(a.node, 5504.0006, 133)).toBe(5504);
  });

  it('eases a rider to the next tile row like the game step glide, and snaps a teleport', () => {
    const { g, a } = walkerAtRest();
    g.groundY(a.node, 5504.0006, 100);
    const mid = g.groundY(a.node, 5760.0006, 130);
    expect(mid).toBeGreaterThan(5504);
    expect(mid).toBeLessThan(5760);
    expect(g.groundY(a.node, 5760.0006, 600)).toBeCloseTo(5760, 1);
    expect(g.groundY(a.node, 8320.0006, 633)).toBe(8320);
  });

  it('stands the mount on its rider ground: same tile row, x locked to the rider', () => {
    const { g, a } = walkerAtRest();
    a.y = 5360;
    g.groundY(a.node, 5504.0006, 100);
    const mount = pet(6272, 5849);
    expect(g.groundY(mount.node, 5504.0007, 100)).toBe(5504);
    expect(g.riderOf(mount.node)).toBe(a.node);
    const other = pet(6272 + 256, 5849);
    expect(g.groundY(other.node, 5504.0007, 100)).toBe(5504.0007);
    expect(g.riderOf(other.node)).toBeNull();
  });

  it('after a dismount keeps the rider ground until the walker ground agrees, then hands over', () => {
    const { g, a } = walkerAtRest();
    a.y = 5104;
    g.groundY(a.node, 5504.0006, 100);
    // Dismounted: the lift slews back, the container is still 208 px high.
    expect(g.groundY(a.node, 5504.0002, 133)).toBeCloseTo(5504, 3);
    a.y = 5312;
    expect(g.groundY(a.node, 5504.0002, 166)).toBeCloseTo(5504, 3);
    a.y = 5300;
    expect(g.groundY(a.node, 5504.0002, 199)).toBeCloseTo(5492, 3);
    const mount = pet(6272, 5849);
    expect(g.groundY(mount.node, 5504.0007, 199)).toBe(5504.0007);
  });
});

// Live 2026-10-05 (v1419): the avatar's game view. Natural y = tile centre − 192 − lift; the container adds the saddle and
// the peek lift. A StoneBench lifts 0.18 tile (46.08 px).
const BENCH = 46.08;
interface FakeView {
  container: unknown; gridPosition: { x: number; y: number } | null; naturalContainerY: number; lastTileData: unknown;
  isAirborneMount: boolean; currentRidingNudgePixels: number;
  positionSmoothing: { isInterpolating: boolean; goalSourceWorldY: number; lastGoalWorldY: number };
}
const centre = (row: number): number => row * 256 + 128;
const benchTile = { objectType: 'decor', decorId: 'StoneBench' };

interface Rig { g: GroundTracker; a: FakeNode; v: FakeView; drifts: unknown[]; rest(row: number, tile?: unknown): void; step(row: number, tile: unknown, natY: number): void }
function viewRig(): Rig {
  const a = avatar(5248, 0);
  const v: FakeView = {
    container: a.node, gridPosition: null, naturalContainerY: 0, lastTileData: undefined, isAirborneMount: false, currentRidingNudgePixels: 0,
    positionSmoothing: { isInterpolating: false, goalSourceWorldY: 0, lastGoalWorldY: 0 },
  };
  const drifts: unknown[] = [];
  const liftOf = (x: AvatarViewLike): number => (x.lastTileData === benchTile && !x.isAirborneMount ? BENCH : 0);
  const g = createGroundTracker({ viewOf: (n) => (n === a.node ? (v as unknown as AvatarViewLike) : null), liftOf, drift: (i) => { drifts.push(i); } });
  const target = (row: number, tile: unknown): number => centre(row) - 192 - (tile === benchTile ? BENCH : 0);
  return {
    g, a, v, drifts,
    rest(row, tile = undefined) {
      v.gridPosition = { x: 20, y: row }; v.lastTileData = tile;
      v.naturalContainerY = a.y = v.positionSmoothing.lastGoalWorldY = target(row, tile);
      v.positionSmoothing.isInterpolating = false;
    },
    step(row, tile, natY) {
      if (!v.positionSmoothing.isInterpolating) v.positionSmoothing.goalSourceWorldY = v.naturalContainerY;
      v.gridPosition = { x: 20, y: row }; v.lastTileData = tile;
      v.positionSmoothing.lastGoalWorldY = target(row, tile);
      v.positionSmoothing.isInterpolating = true;
      v.naturalContainerY = a.y = natY;
    },
  };
}

describe('ground tracker with the game avatar view', () => {
  it('a hop onto a bench glides exactly one tile of ground; the lift is height (live 2026-10-05, StoneBench)', () => {
    const r = viewRig();
    r.rest(14);
    expect(r.g.groundY(r.a.node, centre(14) + 0.0002, 0)).toBeCloseTo(centre(14), 6);
    // Mid-glide sample from the live trace: natural y 3377.67 between 3520 and 3217.92.
    r.step(13, benchTile, 3377.67);
    const f = (3377.67 - 3520) / (3217.92 - 3520);
    expect(r.g.groundY(r.a.node, centre(14) + 0.0002, 16)).toBeCloseTo(centre(14) - 256 * f, 6);
    expect(r.g.feetH(r.a.node)).toBeCloseTo(BENCH * f, 6);
    r.rest(13, benchTile);
    expect(r.g.groundY(r.a.node, centre(13) + 0.0002, 140)).toBeCloseTo(centre(13), 6);
    expect(r.g.feetH(r.a.node)).toBeCloseTo(BENCH, 6);
    expect(r.g.eyeH(r.a.node)).toBeCloseTo(BENCH, 6);
    expect(r.drifts).toEqual([]);
  });

  it('stepping east off a bench keeps the ground row; only the height comes down', () => {
    const r = viewRig();
    r.rest(13, benchTile);
    r.g.groundY(r.a.node, centre(13) + 0.0002, 0);
    for (const natY of [3225, 3240, 3260]) {
      r.step(13, undefined, natY);
      expect(r.g.groundY(r.a.node, centre(13) + 0.0002, 16)).toBeCloseTo(centre(13), 6);
    }
    expect(r.g.feetH(r.a.node)).toBeCloseTo(3264 - 3260, 6);
  });

  it('a bench picked up from under the feet drops the avatar at once, as the game snaps it', () => {
    const r = viewRig();
    r.rest(13, benchTile);
    r.g.groundY(r.a.node, centre(13) + 0.0002, 0);
    r.rest(13);
    expect(r.g.groundY(r.a.node, centre(13) + 0.0002, 16)).toBeCloseTo(centre(13), 6);
    expect(r.g.feetH(r.a.node)).toBeCloseTo(0, 6);
  });

  it('a step that starts mid-glide carries the ground and height the avatar has at its new source', () => {
    const r = viewRig();
    r.rest(14);
    r.g.groundY(r.a.node, centre(14), 0);
    r.step(13, benchTile, 3400);
    const g0 = r.g.groundY(r.a.node, centre(14), 16);
    const h0 = r.g.feetH(r.a.node);
    expect(h0).toBeGreaterThan(0);
    expect(h0).toBeLessThan(BENCH);
    // The next step (north again, flat) starts from the current lerp, so ground and height are continuous there.
    r.v.positionSmoothing.goalSourceWorldY = 3400;
    r.step(12, undefined, 3400);
    expect(r.g.groundY(r.a.node, centre(13), 32)).toBeCloseTo(g0, 6);
    expect(r.g.feetH(r.a.node)).toBeCloseTo(h0, 6);
    r.rest(12);
    expect(r.g.groundY(r.a.node, centre(12), 200)).toBeCloseTo(centre(12), 6);
    expect(r.g.feetH(r.a.node)).toBeCloseTo(0, 6);
  });

  it('peek lift and saddle are drawn height; the eye follows the surface and the settled saddle only', () => {
    const r = viewRig();
    r.rest(13, benchTile);
    r.a.y = r.v.naturalContainerY - 60; // peek lift (2D: 2 s fully behind a plant)
    expect(r.g.groundY(r.a.node, centre(13) + 0.0002, 0)).toBeCloseTo(centre(13), 6);
    expect(r.g.feetH(r.a.node)).toBeCloseTo(BENCH + 60, 6);
    expect(r.g.eyeH(r.a.node)).toBeCloseTo(BENCH, 6);
    // Mounted on a ground pet: the saddle settles at −217 and bobs; the rider stands on its row.
    r.v.currentRidingNudgePixels = -217;
    r.a.y = r.v.naturalContainerY - 217 - 12;
    expect(r.g.groundY(r.a.node, centre(13) + 0.0006, 100)).toBe(centre(13));
    expect(r.g.feetH(r.a.node)).toBeCloseTo(BENCH + 229, 6);
    expect(r.g.eyeH(r.a.node)).toBeCloseTo(BENCH + 217, 6);
  });

  it('a resting avatar whose rest offset moves (a lift QPM does not model) reports drift once', () => {
    const r = viewRig();
    r.rest(13);
    r.g.groundY(r.a.node, centre(13), 0);
    r.v.naturalContainerY = r.a.y = r.v.positionSmoothing.lastGoalWorldY = centre(13) - 192 - 40;
    r.v.gridPosition = { x: 21, y: 13 };
    r.g.groundY(r.a.node, centre(13), 16);
    r.g.groundY(r.a.node, centre(13), 32);
    expect(r.drifts).toHaveLength(1);
  });

  it('an avatar without a game view falls back to the walker and reports once', () => {
    const drifts: unknown[] = [];
    const g = createGroundTracker({ viewOf: () => null, liftOf: () => 0, drift: (i) => { drifts.push(i); } });
    const a = avatar(6272, 5312);
    for (let i = 0; i < 8; i++) g.groundY(a.node, 5504, i);
    expect(g.groundY(a.node, 5504, 8)).toBe(5504);
    expect(g.eyeH(a.node)).toBe(0);
    expect(drifts).toHaveLength(1);
  });
});

describe('heightAlong', () => {
  it('runs linearly in the natural y from the source height to the target height, clamped at both ends', () => {
    const g = { srcY: 1000, tgtY: 1256, hS: 0, hT: 46 };
    expect([heightAlong(g, 1000), heightAlong(g, 1128), heightAlong(g, 1256)]).toEqual([0, 23, 46]);
    expect([heightAlong(g, 900), heightAlong(g, 1400)]).toEqual([0, 46]);
    expect(heightAlong({ srcY: 1256, tgtY: 1000, hS: 46, hT: 0 }, 1064)).toBeCloseTo(11.5, 9);
  });

  it('no glide (under a pixel): the target height', () => {
    expect(heightAlong({ srcY: 1000, tgtY: 1000.5, hS: 10, hT: 46 }, 1000)).toBe(46);
  });
});
