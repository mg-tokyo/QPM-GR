import { describe, expect, it } from 'vitest';
import type { XY } from './camera';
import { STEP_OF, StepPlanner, steerStep, walkHeading, type StepDir } from './walk';

const D = Math.PI / 180;
const KEY_SETS: ReadonlyArray<readonly string[]> = [['KeyW'], ['KeyA'], ['KeyS'], ['KeyD'], ['KeyW', 'KeyD'], ['KeyW', 'KeyA'], ['KeyS', 'KeyD'], ['KeyS', 'KeyA']];

/** Walks `n` steps from (0,0) with every step open; returns the tiles visited. */
function walk(yawDeg: number, keys: readonly string[], n: number, open: (x: number, y: number) => boolean = () => true): XY[] {
  const h = { x: 0, y: 0 };
  const p = new StepPlanner();
  const at = { x: 0, y: 0 };
  const path: XY[] = [{ x: 0, y: 0 }];
  for (let i = 0; i < n; i++) {
    if (!walkHeading(yawDeg * D, keys, h)) break;
    steerStep(p, h.x, h.y, (d) => {
      const s = STEP_OF[d];
      if (!open(at.x + s.x, at.y + s.y)) return false;
      at.x += s.x; at.y += s.y;
      return true;
    });
    path.push({ x: at.x, y: at.y });
  }
  return path;
}

describe('walkHeading (P15 a: free heading)', () => {
  it('W walks where the camera looks, D to its right; yaw turns both clockwise', () => {
    const h = { x: 0, y: 0 };
    expect(walkHeading(0, ['KeyW'], h)).toBe(true);
    expect(h.x).toBeCloseTo(0); expect(h.y).toBeCloseTo(-1);
    walkHeading(0, ['KeyD'], h);
    expect(h.x).toBeCloseTo(1); expect(h.y).toBeCloseTo(0);
    // The old quarter rule at an exact quarter (yaw 90: W → ArrowRight) is the same direction.
    walkHeading(90 * D, ['ArrowUp'], h);
    expect(h.x).toBeCloseTo(1); expect(h.y).toBeCloseTo(0);
    walkHeading(30 * D, ['KeyW'], h);
    expect(Math.atan2(h.x, -h.y) / D).toBeCloseTo(30);
  });

  it('two keys walk the diagonal between them', () => {
    const h = { x: 0, y: 0 };
    walkHeading(0, ['KeyW', 'KeyD'], h);
    expect(h.x).toBeCloseTo(Math.SQRT1_2); expect(h.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it('opposite keys cancel, and other keys are ignored', () => {
    const h = { x: 0, y: 0 };
    expect(walkHeading(0, ['KeyW', 'KeyS'], h)).toBe(false);
    expect(walkHeading(0, ['KeyW', 'ArrowDown'], h)).toBe(false);
    expect(walkHeading(0, [], h)).toBe(false);
    expect(walkHeading(0, ['ShiftLeft'], h)).toBe(false);
    expect(walkHeading(0, ['KeyW', 'KeyS', 'KeyD'], h)).toBe(true);
    expect(h.x).toBeCloseTo(1);
  });
});

describe('StepPlanner (M1, M2)', () => {
  it('stays within one tile of the heading line over 50 steps at every 15° of yaw, single keys and diagonals', () => {
    const h = { x: 0, y: 0 };
    let worst = 0;
    for (let yaw = 0; yaw < 360; yaw += 15) {
      for (const keys of KEY_SETS) {
        walkHeading(yaw * D, keys, h);
        const path = walk(yaw, keys, 50);
        expect(path).toHaveLength(51);
        for (const p of path) {
          const off = Math.abs(p.x * h.y - p.y * h.x);
          worst = Math.max(worst, off);
          expect(off).toBeLessThanOrEqual(1);
        }
        const end = path[path.length - 1]!;
        // Every step goes forward along the line, and the walk averages the requested heading.
        expect(end.x * h.x + end.y * h.y).toBeGreaterThan(30);
        expect(Math.abs(Math.atan2(end.x * h.y - end.y * h.x, end.x * h.x + end.y * h.y)) / D).toBeLessThan(2);
      }
    }
    expect(worst).toBeGreaterThan(0.2);
  });

  it('W at yaw 30° walks a staircase averaging 30°; W+D at yaw 0 walks the diagonal', () => {
    const p30 = walk(30, ['KeyW'], 60);
    const e30 = p30[p30.length - 1]!;
    expect(Math.atan2(e30.x, -e30.y) / D).toBeCloseTo(30, 0);
    const xs = p30.slice(1).map((p, i) => p.x - p30[i]!.x);
    expect(xs.filter((v) => v !== 0).length).toBeGreaterThan(15);
    const pd = walk(0, ['KeyW', 'KeyD'], 40);
    expect(pd[40]).toEqual({ x: 20, y: -20 });
  });

  it('a reversal starts the line afresh: no leftover step sideways', () => {
    const p = new StepPlanner();
    const h = { x: 0, y: 0 };
    walkHeading(30 * D, ['KeyW'], h);
    steerStep(p, h.x, h.y, () => true);
    walkHeading(30 * D, ['KeyS'], h);
    p.plan(h.x, h.y);
    expect(p.ax).toBe(0); expect(p.ay).toBe(0);
  });

  it('a quarter-turn key switch never steps against the held keys (review: W+D → S+D stepped west)', () => {
    const p = new StepPlanner();
    const h = { x: 0, y: 0 };
    walkHeading(0, ['KeyW', 'KeyD'], h);
    expect(steerStep(p, h.x, h.y, () => true)).toBe('right');
    walkHeading(0, ['KeyS', 'KeyD'], h);
    const took = steerStep(p, h.x, h.y, () => true)!;
    expect(STEP_OF[took].x * h.x + STEP_OF[took].y * h.y).toBeGreaterThan(0);
  });

  it('every step goes with the heading, through any sequence of key sets and turns', () => {
    const p = new StepPlanner();
    const h = { x: 0, y: 0 };
    let s = 5;
    for (let i = 0; i < 2000; i++) {
      s = (s * 16807) % 2147483647;
      if (s % 4 === 0) p.reset();
      walkHeading((s % 360) * D, KEY_SETS[s % KEY_SETS.length]!, h);
      const took = steerStep(p, h.x, h.y, () => s % 7 !== 0)!;
      if (took) expect(STEP_OF[took].x * h.x + STEP_OF[took].y * h.y).toBeGreaterThan(0);
    }
  });

  it('the accumulated error stays within a tile on each axis', () => {
    const p = new StepPlanner();
    const h = { x: 0, y: 0 };
    for (let i = 0; i < 200; i++) {
      walkHeading(((i * 7) % 360) * D, ['KeyW'], h);
      steerStep(p, h.x, h.y, () => true);
      expect(Math.abs(p.ax)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.ay)).toBeLessThanOrEqual(1);
    }
  });
});

describe('steerStep collision (the game decides each step)', () => {
  const northWall = (_x: number, y: number): boolean => y >= 0;

  it('a blocked step takes the other axis when it is open: W+D into a north wall slides east', () => {
    const path = walk(0, ['KeyW', 'KeyD'], 10, northWall);
    expect(path[10]).toEqual({ x: 10, y: 0 });
  });

  it('a heading within ~14° of the wall normal stops at the wall, like 2D; 30° slides', () => {
    expect(walk(0, ['KeyW'], 10, northWall)[10]).toEqual({ x: 0, y: 0 });
    expect(walk(10, ['KeyW'], 10, northWall)[10]).toEqual({ x: 0, y: 0 });
    expect(walk(30, ['KeyW'], 10, northWall)[10]).toEqual({ x: 10, y: 0 });
  });

  it('stops when both axes are blocked (a corner), and the planned point never enters the wall', () => {
    const corner = (x: number, y: number): boolean => y >= 0 && x <= 0;
    const p = new StepPlanner();
    const h = { x: 0, y: 0 };
    walkHeading(0, ['KeyW', 'KeyD'], h);
    const taken: Array<StepDir | null> = [];
    for (let i = 0; i < 5; i++) taken.push(steerStep(p, h.x, h.y, (d) => corner(STEP_OF[d].x, STEP_OF[d].y)));
    expect(taken).toEqual([null, null, null, null, null]);
    expect(p.ax).toBe(0); expect(p.ay).toBe(0);
  });

  /** Steps W+D at yaw 0 through `open`; returns each step's tile plus the shown point (tile + ox, oy). */
  function slide(n: number, open: (x: number, y: number) => boolean, keysAt: (i: number) => readonly string[] = () => ['KeyW', 'KeyD']) {
    const p = new StepPlanner();
    const h = { x: 0, y: 0 };
    const at = { x: 0, y: 0 };
    const out: Array<{ tile: XY; shown: XY; wall: StepDir | null }> = [];
    for (let i = 0; i < n; i++) {
      walkHeading(0, keysAt(i), h);
      steerStep(p, h.x, h.y, (d) => {
        const s = STEP_OF[d];
        if (!open(at.x + s.x, at.y + s.y)) return false;
        at.x += s.x; at.y += s.y;
        return true;
      });
      out.push({ tile: { x: at.x, y: at.y }, shown: { x: at.x + p.ox, y: at.y + p.oy }, wall: p.wall });
    }
    return out;
  }

  it('sliding along a wall shows the tile centres, one tile apart (live 2026-10-06: 1.5 / 0.5 tiles, a zig-zag)', () => {
    const s = slide(12, northWall);
    for (let i = 2; i < s.length; i++) {
      expect(s[i]!.tile.y).toBe(0);
      expect(s[i]!.shown.y).toBe(0);
      expect(s[i]!.shown.x - s[i - 1]!.shown.x).toBe(1);
      expect(s[i]!.wall).toBe('up');
    }
  });

  it('leaves the wall where it ends (a gate): the step goes through and the shown point is back on the line', () => {
    // A one-row fence at y = -1 with a gate at x = 5, open ground beyond.
    const gate = (x: number, y: number): boolean => y !== -1 || x === 5;
    const s = slide(16, gate);
    const through = s.findIndex((q) => q.tile.y < 0);
    expect(through).toBeGreaterThan(0);
    expect(s[through]!.tile.x).toBe(5);
    expect(s[through]!.wall).toBeNull();
    expect(s.slice(through).some((q) => q.shown.x !== q.tile.x || q.shown.y !== q.tile.y)).toBe(true);
  });

  it('turning to run along the wall (W+D → D) leaves the wall state and starts the line afresh', () => {
    const s = slide(8, northWall, (i) => (i < 4 ? ['KeyW', 'KeyD'] : ['KeyD']));
    expect(s[3]!.wall).toBe('up');
    for (const q of s.slice(4)) { expect(q.wall).toBeNull(); expect(q.shown).toEqual(q.tile); }
  });

  it('a rider whose mount ignores collision is not stopped: no QPM pre-check, only the game\'s answer', () => {
    // The game's movePlayer passes every step for a mapBoundsOnly mount; the planner never refuses one itself.
    expect(walk(30, ['KeyW'], 20)[20]!.y).toBeLessThan(-10);
  });
});
