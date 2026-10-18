import { describe, expect, it } from 'vitest';
import type { SpectatorPose } from '../state';
import { createFlyTo, flyToDurationMs, panPose2d, stepFlight2d, zoomStepFor, type Flight2dCtx, type FlightInput } from './flight';

const pose = (x: number, y: number, alt = 60, yaw = 0, pitch = 0): SpectatorPose => ({ x, y, alt, yaw, pitch });
const ctx = (over: Partial<Flight2dCtx> = {}): Flight2dCtx =>
  ({ tilePx: 60, viewW: 1278, viewH: 632, mapCols: 101, mapRows: 60, speedCssPxPerSec: 600, ...over });
const input = (over: Partial<FlightInput> = {}): FlightInput => ({ fx: 0, fy: 0, up: 0, fast: false, ...over });
const ZERO = { x: 0, y: 0 };

function run(p: SpectatorPose, v: { x: number; y: number }, i: FlightInput, c: Flight2dCtx, steps: number, dt: number) {
  let s = { pose: p, vel: v };
  for (let n = 0; n < steps; n++) s = stepFlight2d(s.pose, s.vel, i, dt, c);
  return s;
}

describe('stepFlight2d', () => {
  it('holds the on-screen speed across tile sizes, under the map-fit floor too', () => {
    const cases: Array<[Flight2dCtx, number]> = [
      [ctx({ tilePx: 16 }), 16],
      [ctx({ tilePx: 60 }), 60],
      [ctx({ tilePx: 128 }), 128],
      [ctx({ tilePx: 384 }), 384],
      // y binds the map-fit floor (1600 / 60 rows > 16), so x still has room to fly
      [ctx({ tilePx: 16, viewH: 1600 }), 1600 / 60],
    ];
    for (const [c, screenTile] of cases) {
      const s = stepFlight2d(pose(50, 30), { x: 600, y: 0 }, input({ fx: 1 }), 10, c);
      expect((s.pose.x - 50) * screenTile).toBeCloseTo(6, 9);
      expect(s.vel.x).toBeCloseTo(600, 9);
    }
  });

  it('W flies north, D east, and a diagonal is no faster than a straight line', () => {
    const north = stepFlight2d(pose(50, 30), { x: 0, y: -600 }, input({ fy: 1 }), 10, ctx());
    expect(north.pose.y).toBeLessThan(30);
    expect(north.pose.x).toBe(50);
    const diag = run(pose(50, 30), ZERO, input({ fx: 1, fy: 1 }), ctx(), 100, 10);
    expect(Math.hypot(diag.vel.x, diag.vel.y)).toBeCloseTo(600, 6);
    expect(diag.vel.x).toBeCloseTo(-diag.vel.y, 9);
  });

  it('ramps up and down within 120 ms, independent of the frame rate', () => {
    const up = run(pose(50, 30), ZERO, input({ fx: 1 }), ctx(), 12, 10);
    expect(up.vel.x).toBeGreaterThanOrEqual(0.95 * 600);
    expect(up.vel.x).toBeLessThanOrEqual(600);
    const early = run(pose(50, 30), ZERO, input({ fx: 1 }), ctx(), 3, 10);
    expect(early.vel.x).toBeGreaterThan(0);
    expect(early.vel.x).toBeLessThan(0.95 * 600);
    const down = run(pose(50, 30), { x: 600, y: 0 }, input(), ctx(), 12, 10);
    expect(Math.abs(down.vel.x)).toBeLessThanOrEqual(0.05 * 600);
    const coarse = run(pose(50, 30), ZERO, input({ fx: 1 }), ctx(), 1, 40);
    const fine = run(pose(50, 30), ZERO, input({ fx: 1 }), ctx(), 4, 10);
    expect(coarse.vel.x).toBeCloseTo(fine.vel.x, 9);
  });

  it('settles exactly on the target speed and exactly at rest', () => {
    expect(run(pose(50, 30), ZERO, input({ fx: 1 }), ctx(), 100, 10).vel.x).toBe(600);
    expect(run(pose(50, 30), { x: 600, y: 0 }, input(), ctx(), 100, 10).vel).toEqual(ZERO);
  });

  it('fast is three times the speed and reaches it within the same ramp', () => {
    const fast = run(pose(50, 30), { x: 600, y: 0 }, input({ fx: 1, fast: true }), ctx(), 12, 10);
    expect(fast.vel.x).toBeGreaterThanOrEqual(600 + 0.95 * 1200);
    const steady = stepFlight2d(pose(50, 30), { x: 1800, y: 0 }, input({ fx: 1, fast: true }), 10, ctx());
    expect((steady.pose.x - 50) * 60).toBeCloseTo(18, 9);
  });

  it('clamps to the band the game can centre on at all four edges and stops pushing into them', () => {
    // live 1448 view 1278×632 at 60 px/tile: half view 10.65 × 5.27 tiles; grid g renders at world (g + 0.5) × 256
    const c = ctx();
    const halfW = 1278 / 120, halfH = 632 / 120;
    const west = stepFlight2d(pose(halfW - 0.5 + 0.001, 30), { x: -600, y: 0 }, input({ fx: -1 }), 10, c);
    expect(west.pose.x).toBe(halfW - 0.5);
    expect(west.vel.x).toBe(0);
    const east = stepFlight2d(pose(101 - halfW - 0.5 - 0.001, 30), { x: 600, y: 0 }, input({ fx: 1 }), 10, c);
    expect(east.pose.x).toBe(101 - halfW - 0.5);
    expect(east.vel.x).toBe(0);
    const north = stepFlight2d(pose(50, halfH - 0.5 + 0.001), { x: 0, y: -600 }, input({ fy: 1 }), 10, c);
    expect(north.pose.y).toBe(halfH - 0.5);
    expect(north.vel.y).toBe(0);
    const south = stepFlight2d(pose(50, 60 - halfH - 0.5 - 0.001), { x: 0, y: 600 }, input({ fy: -1 }), 10, c);
    expect(south.pose.y).toBe(60 - halfH - 0.5);
    expect(south.vel.y).toBe(0);
  });

  it('pulls a pose left outside the band by a zoom-out back in, and pins the axis the map only just fills', () => {
    expect(stepFlight2d(pose(0, 0), ZERO, input(), 10, ctx()).pose).toMatchObject({ x: 1278 / 120 - 0.5, y: 632 / 120 - 0.5 });
    // The game zooms in until the map fills the view on its tighter axis (computeProjection): x = 1278 / 10 px per tile.
    const tiny = stepFlight2d(pose(3, 3), ZERO, input(), 10, ctx({ mapCols: 10, mapRows: 5, tilePx: 16, viewW: 1278, viewH: 632 }));
    expect(tiny.pose.x).toBeCloseTo(4.5, 9);
    expect(tiny.pose.y).toBeCloseTo(5 - 632 / 255.6 - 0.5, 9);
  });

  it('caps a long frame so a hitch never teleports the camera', () => {
    const s = stepFlight2d(pose(50, 30), { x: 600, y: 0 }, input({ fx: 1 }), 5000, ctx());
    expect((s.pose.x - 50) * 60).toBeCloseTo(60, 6);
  });

  it('keeps alt, yaw and pitch, never mutates its inputs, and survives bad numbers', () => {
    const p = pose(50, 30, 77, 12, 34);
    const v = { x: 0, y: 0 };
    const s = stepFlight2d(p, v, input({ fx: 1 }), 16, ctx());
    expect(s.pose).toMatchObject({ alt: 77, yaw: 12, pitch: 34 });
    expect(p).toEqual(pose(50, 30, 77, 12, 34));
    expect(v).toEqual(ZERO);
    for (const dt of [0, -5, Number.NaN]) {
      const same = stepFlight2d(p, { x: 100, y: 0 }, input({ fx: 1 }), dt, ctx());
      expect(same.pose).toEqual(p);
      expect(same.vel).toEqual({ x: 100, y: 0 });
    }
    const broken = stepFlight2d(p, { x: 100, y: 0 }, input({ fx: 1 }), 16, ctx({ tilePx: Number.NaN, viewW: 0, viewH: 0 }));
    expect(broken.pose).toEqual(p);
    expect(broken.vel).toEqual(ZERO);
    const wild = stepFlight2d(p, ZERO, input({ fx: Number.NaN, fy: 5 }), 10, ctx());
    expect(Number.isFinite(wild.pose.x) && Number.isFinite(wild.pose.y)).toBe(true);
    expect(Math.hypot(wild.vel.x, wild.vel.y)).toBeLessThanOrEqual(600);
    // a view not measured yet must never put NaN into the camera target
    const unmeasured = stepFlight2d(p, ZERO, input({ fx: 1 }), 10, ctx({ viewW: Number.NaN, viewH: Number.NaN }));
    expect(Number.isFinite(unmeasured.pose.x) && Number.isFinite(unmeasured.pose.y)).toBe(true);
  });
});

describe('zoomStepFor', () => {
  it('maps E (up) to the game zoom-out step and Q (down) to zoom-in', () => {
    expect(zoomStepFor(1)).toBe(-1);
    expect(zoomStepFor(-1)).toBe(1);
    expect(zoomStepFor(0.4)).toBe(-1);
    expect(zoomStepFor(0)).toBe(0);
    expect(zoomStepFor(Number.NaN)).toBe(0);
  });
});

describe('flyToDurationMs', () => {
  it('runs 250…900 ms, monotone in distance', () => {
    expect(flyToDurationMs(0)).toBe(250);
    expect(flyToDurationMs(1)).toBeGreaterThan(250);
    expect(flyToDurationMs(1)).toBeLessThan(400);
    expect(flyToDurationMs(10)).toBeGreaterThan(flyToDurationMs(1));
    expect(flyToDurationMs(10)).toBeLessThan(600);
    expect(flyToDurationMs(116)).toBe(900);
    expect(flyToDurationMs(10_000)).toBe(900);
    let prev = 0;
    for (let d = 0; d <= 130; d += 0.5) {
      const ms = flyToDurationMs(d);
      expect(ms).toBeGreaterThanOrEqual(prev);
      prev = ms;
    }
    expect(flyToDurationMs(-3)).toBe(250);
    expect(flyToDurationMs(Number.NaN)).toBe(250);
  });
});

describe('createFlyTo', () => {
  const from = pose(10, 20, 60, 0, 30);
  const to = pose(40, 60, 120, 90, 60);
  const dur = flyToDurationMs(50);

  it('starts and ends exactly on its endpoints and is done at its duration', () => {
    const f = createFlyTo(from, to, 1000);
    expect(f.at(1000)).toEqual(from);
    expect(f.at(500)).toEqual(from);
    expect(f.at(1000 + dur)).toEqual(to);
    expect(f.at(1000 + dur + 5000)).toEqual(to);
    expect(f.done(1000 + dur - 1)).toBe(false);
    expect(f.done(1000 + dur)).toBe(true);
  });

  it('eases in and out', () => {
    const f = createFlyTo(from, to, 0);
    const u = (t: number): number => (f.at(t * dur).x - from.x) / (to.x - from.x);
    expect(u(0.5)).toBeCloseTo(0.5, 9);
    expect(u(0.25)).toBeLessThan(0.25);
    expect(u(0.75)).toBeGreaterThan(0.75);
    expect(f.at(0.5 * dur)).toMatchObject({ y: 40, pitch: 45, yaw: 45 });
  });

  it('blends alt as a scale, so a zoom looks even all the way', () => {
    const f = createFlyTo(pose(0, 0, 16), pose(0, 0, 384), 0);
    const half = flyToDurationMs(0) / 2;
    expect(f.at(half).alt).toBeCloseTo(Math.sqrt(16 * 384), 9);
    const flat = createFlyTo(pose(0, 0, 0), pose(0, 0, 100), 0);
    expect(flat.at(half).alt).toBeCloseTo(50, 9);
  });

  it('ends at the destination on a broken clock instead of hanging', () => {
    const f = createFlyTo(from, to, Number.NaN);
    expect(f.done(1000)).toBe(true);
    expect(f.at(1000)).toEqual(to);
    const g = createFlyTo(from, to, 0);
    expect(g.done(Number.NaN)).toBe(true);
    expect(g.at(Number.NaN)).toEqual(to);
  });

  it('turns the short way round', () => {
    const f = createFlyTo(pose(0, 0, 60, 170), pose(0, 0, 60, -170), 0);
    expect(Math.abs(f.at(flyToDurationMs(0) / 2).yaw)).toBeCloseTo(180, 9);
    expect(f.at(flyToDurationMs(0)).yaw).toBe(-170);
  });

  it('copies its endpoints and hands out fresh poses', () => {
    const a = pose(1, 2), b = pose(3, 4);
    const f = createFlyTo(a, b, 0);
    a.x = 99;
    b.x = 99;
    const end = f.at(10_000);
    expect(end.x).toBe(3);
    end.x = 42;
    expect(f.at(10_000).x).toBe(3);
  });
});

describe('createFlyTo toward a moving destination (follow lock-on)', () => {
  const from = pose(10, 20, 60);
  const dur = flyToDurationMs(Math.hypot(30, 40));

  it('lands exactly on wherever the destination is at the end, with no jump', () => {
    const f = createFlyTo(from, pose(40, 60, 60), 0);
    const walked = pose(43.5, 61.25, 60);
    expect(f.at(dur, walked)).toEqual(walked);
    expect(f.at(0, walked)).toEqual(from);
    const mid = f.at(dur / 2, walked);
    expect(mid.x).toBeCloseTo((from.x + walked.x) / 2, 9);
    expect(mid.y).toBeCloseTo((from.y + walked.y) / 2, 9);
  });

  it('keeps the duration it was created with', () => {
    const f = createFlyTo(from, pose(40, 60, 60), 0);
    expect(f.done(dur - 1)).toBe(false);
    expect(f.done(dur)).toBe(true);
    expect(f.at(dur - 1, pose(11, 21, 60)).x).toBeLessThan(11);
  });
});

describe('panPose2d (grab and pan)', () => {
  it('moves the camera against the drag at the on-screen scale', () => {
    const p = panPose2d(pose(50, 30), 120, -60, ctx());
    expect(p.x).toBeCloseTo(48, 9);
    expect(p.y).toBeCloseTo(31, 9);
  });

  it('uses the map-fit floor like the flight, and clamps to the same band', () => {
    expect(panPose2d(pose(50, 30), 1600 / 60, 0, ctx({ tilePx: 16, viewH: 1600 })).x).toBeCloseTo(49, 9);
    expect(panPose2d(pose(12, 30), 10_000, 0, ctx()).x).toBe(1278 / 120 - 0.5);
    expect(panPose2d(pose(50, 30), 0, -10_000, ctx()).y).toBe(60 - 632 / 120 - 0.5);
  });

  it('keeps alt, yaw and pitch and ignores bad numbers', () => {
    const p = pose(50, 30, 77, 12, 34);
    expect(panPose2d(p, 6, 0, ctx())).toMatchObject({ alt: 77, yaw: 12, pitch: 34 });
    expect(panPose2d(p, Number.NaN, Number.POSITIVE_INFINITY, ctx())).toEqual(p);
    expect(panPose2d(p, 60, 0, ctx({ tilePx: Number.NaN, viewW: 0, viewH: 0 }))).toEqual(p);
  });
});
