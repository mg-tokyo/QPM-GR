import { describe, expect, it } from 'vitest';
import { TILE } from '../constants';
import type { XY } from './camera';
import { StepFollower } from './follow';
import { STEP_OF, StepPlanner, steerStep, walkHeading } from './walk';
import { viewForS } from './zoomCurve';

/** Seeded frame clock: frame lengths 12–25 ms like the live ticker (2026-10-06). */
function frames(from: number, to: number, seed = 7): number[] {
  let s = seed;
  const out: number[] = [];
  for (let t = from; t < to;) {
    out.push(t);
    s = (s * 16807) % 2147483647;
    t += 12 + (s % 1300) / 100;
  }
  return out;
}

interface Step { at: number; x: number; y: number }

/** Steps land on the 100 ms grid; the follower sees each on the first frame at or after it (the game's input tick). */
function run(steps: Step[], times: number[], raw: ((t: number) => XY) | null = null): Array<XY & { t: number }> {
  const f = new StepFollower();
  const out: Array<XY & { t: number }> = [];
  const o = { x: 0, y: 0 };
  let k = -1;
  const start = { x: steps[0]!.x, y: steps[0]!.y };
  for (const t of times) {
    let moved = false;
    while (k + 1 < steps.length && steps[k + 1]!.at <= t) { k++; moved = true; }
    const tg = k >= 0 ? steps[k]! : start;
    // The game point: by default it has reached the current tile (the glide is not modelled here).
    f.update(tg.x, tg.y, moved, false, raw ? raw(t) : { x: tg.x, y: tg.y }, t, o);
    out.push({ x: o.x, y: o.y, t });
  }
  return out;
}

function speeds(out: Array<XY & { t: number }>, from: number, to: number): number[] {
  const seg = out.filter((p) => p.t >= from && p.t <= to);
  return seg.slice(1).map((p, i) => Math.hypot(p.x - seg[i]!.x, p.y - seg[i]!.y) / (p.t - seg[i]!.t));
}

const ripple = (sp: number[]): number => {
  const mean = sp.reduce((a, b) => a + b, 0) / sp.length;
  return (Math.max(...sp) - Math.min(...sp)) / mean;
};

/** A walk from the tile at the origin: the first step at 0, the game's 300 ms pause, then a step every 100 ms. */
function train(n: number, dx: number, dy: number, origin: XY = { x: TILE / 2, y: TILE / 2 }): Step[] {
  const out: Step[] = [{ at: -1000, x: origin.x, y: origin.y }];
  for (let i = 1; i <= n; i++) out.push({ at: i === 1 ? 0 : 100 + i * 100, x: origin.x + dx * i * TILE, y: origin.y + dy * i * TILE });
  return out;
}

describe('StepFollower (M3, P16 a)', () => {
  it('a regular 100 ms step train moves the follow point at a steady speed (ripple ≤ 10 %)', () => {
    const out = run(train(20, 0, -1), frames(-1000, 3000));
    const sp = speeds(out, 800, 2000);
    expect(ripple(sp)).toBeLessThanOrEqual(0.1);
    // 10 tiles a second.
    expect(sp.reduce((a, b) => a + b, 0) / sp.length).toBeCloseTo(TILE / 100, 1);
  });

  it('never moves backwards along a walk, through the first-step pause and the stop', () => {
    for (const seed of [3, 7, 11, 19]) {
      const out = run(train(12, 0, -1), frames(-1000, 2500, seed));
      for (let i = 1; i < out.length; i++) expect(out[i]!.y).toBeLessThanOrEqual(out[i - 1]!.y + 1e-6);
    }
  });

  it('planned points along a 30° line play back on that line at a steady speed', () => {
    const d = { x: 0.366, y: -0.634 };
    const out = run(train(24, d.x, d.y), frames(-1000, 3500, 11));
    const sp = speeds(out, 800, 2300);
    expect(ripple(sp)).toBeLessThanOrEqual(0.1);
    const n = Math.hypot(d.x, d.y);
    for (const p of out.filter((q) => q.t > 0)) {
      const off = ((p.x - TILE / 2) * d.y - (p.y - TILE / 2) * d.x) / n;
      expect(Math.abs(off)).toBeLessThan(2);
    }
  });

  it('steps landing up to ~35 ms late (frame plus tick jitter) cause no stop-and-go', () => {
    const steps = train(20, 1, 0);
    let s = 3;
    for (const st of steps.slice(3)) { s = (s * 48271) % 2147483647; st.at += s % 10; }
    const sp = speeds(run(steps, frames(-1000, 3000, 5)), 800, 2000);
    expect(ripple(sp)).toBeLessThanOrEqual(0.1);
  });

  it('settles on the last tile when steps stop, then passes the game point through exactly', () => {
    const steps = train(6, 0, -1);
    const last = steps[steps.length - 1]!;
    const out = run(steps, frames(-1000, 2500));
    const tail = out.filter((p) => p.t > 1400);
    expect(tail.length).toBeGreaterThan(10);
    for (const p of tail) { expect(p.x).toBe(last.x); expect(p.y).toBe(last.y); }
  });

  it('snaps on a jump of more than one tile, like the game camera', () => {
    const steps = train(5, 1, 0);
    const far = { at: 1200, x: steps[5]!.x + 6 * TILE, y: steps[5]!.y };
    steps.push(far);
    const out = run(steps, frames(-1000, 1500), (t) => (t >= 1200 ? { x: far.x, y: far.y } : { x: steps[5]!.x, y: steps[5]!.y }));
    const after = out.find((p) => p.t >= 1200)!;
    expect(after.x).toBe(far.x);
    expect(after.y).toBe(far.y);
  });

  it('a step does not wait behind an on-the-spot move that has not started (a target flicker)', () => {
    const f = new StepFollower();
    const o = { x: 0, y: 0 };
    const raw = { x: 128, y: 128 };
    let t = 0;
    f.update(128, 128, false, false, raw, t, o);
    // A steady walk east, then one frame where the target falls back to the tile centre, then the next step.
    for (let i = 1; i <= 6; i++) {
      for (let k = 0; k < 6; k++) { t += 100 / 6; f.update(128 + i * 256 + 40, 128, k === 0, true, raw, t, o); }
    }
    const before = f.stats().queued;
    t += 16; f.update(128 + 6 * 256, 128, false, false, raw, t, o);
    t += 16; f.update(128 + 7 * 256 + 40, 128, true, true, raw, t, o);
    expect(f.stats().queued).toBeLessThanOrEqual(before + 1);
  });

  /** A camera-steered walk as engine/movement.ts drives it: each step's target is the planner's shown point on its tile
   * while the keys are held; at `upAt` the keys come up and the target falls back to the tile centre. */
  function steered(yawDeg: number, keys: readonly string[], upAt: number, open: (x: number, y: number) => boolean, until: number, seed = 7) {
    const p = new StepPlanner();
    const h = { x: 0, y: 0 };
    walkHeading(yawDeg * (Math.PI / 180), keys, h);
    const at = { x: 0, y: 0 };
    const steps: Array<{ at: number; tile: XY; shown: XY; took: boolean }> = [];
    for (let i = 1; ; i++) {
      const t = i === 1 ? 0 : 100 + i * 100;
      if (t >= upAt) break;
      const took = steerStep(p, h.x, h.y, (d) => {
        const s = STEP_OF[d];
        if (!open(at.x + s.x, at.y + s.y)) return false;
        at.x += s.x; at.y += s.y;
        return true;
      }) !== null;
      steps.push({ at: t, tile: { x: at.x, y: at.y }, shown: { x: at.x + p.ox, y: at.y + p.oy }, took });
    }
    const f = new StepFollower();
    const o = { x: 0, y: 0 };
    const out: Array<XY & { t: number; q: number }> = [];
    let k = -1, tile = { x: 0, y: 0 };
    for (const t of frames(-500, until, seed)) {
      while (k + 1 < steps.length && steps[k + 1]!.at <= t) k++;
      const st = k >= 0 ? steps[k]! : null;
      const now = st ? st.tile : { x: 0, y: 0 };
      const stepped = now.x !== tile.x || now.y !== tile.y;
      tile = now;
      const steering = st !== null && st.took && t < upAt;
      const c = { x: (tile.x + 0.5) * TILE, y: (tile.y + 0.5) * TILE };
      const tg = steering ? { x: st.shown.x * TILE + TILE / 2, y: st.shown.y * TILE + TILE / 2 } : c;
      f.update(tg.x, tg.y, stepped, steering, c, t, o);
      out.push({ x: o.x, y: o.y, t, q: f.stats().queued });
    }
    return { out, h, last: tile };
  }

  it('keys up mid-walk at an angle: one glide onto the last tile, no hook back (live 2026-10-06: 26° → −41°)', () => {
    for (const [yaw, keys] of [[30, ['KeyW']], [0, ['KeyW', 'KeyD']], [75, ['KeyW']]] as const) {
      for (const upAt of [1150, 1185, 1230]) {
        const { out, h, last } = steered(yaw, keys, upAt, () => true, 2600);
        // Ending on the tile centre, up to half a tile off the heading line, takes one bend (≤ ~45°): never a turn back
        // along the heading, never a bend one way and then the other.
        let worst = 0, side = 0, flips = 0;
        for (let i = 1; i < out.length; i++) {
          const a = out[i - 1]!, b = out[i]!;
          if (b.t <= upAt) continue;
          const vx = b.x - a.x, vy = b.y - a.y, sp = Math.hypot(vx, vy) / (b.t - a.t);
          if (sp < 0.3 * TILE / 1000) continue;
          worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, (vx * h.x + vy * h.y) / Math.hypot(vx, vy)))) / (Math.PI / 180));
          const lat = (vx * h.y - vy * h.x) / Math.hypot(vx, vy);
          if (Math.abs(lat) > 0.05) { if (side !== 0 && Math.sign(lat) !== side) flips++; side = Math.sign(lat); }
        }
        expect(worst).toBeLessThan(60);
        expect(flips).toBe(0);
        expect(Math.max(...out.map((p) => p.q))).toBeLessThanOrEqual(2);
        const end = out[out.length - 1]!;
        expect(end.x).toBe((last.x + 0.5) * TILE); expect(end.y).toBe((last.y + 0.5) * TILE);
      }
    }
  });

  it('a step seen a frame after the keys came up re-aims the glide instead of queueing behind it', () => {
    const f = new StepFollower();
    const o = { x: 0, y: 0 };
    let t = 0;
    const c = (i: number): number => 128 + i * 256;
    f.update(c(0), 128, false, false, { x: c(0), y: 128 }, t, o);
    for (let i = 1; i <= 6; i++) {
      for (let k = 0; k < 6; k++) { t += 100 / 6; f.update(c(i) + 60, 128 - 60, k === 0, true, { x: c(i), y: 128 }, t, o); }
    }
    // Keys up on a step frame: the avatar view still shows tile 6, then tile 7 a frame later.
    t += 16; f.update(c(6), 128, false, false, { x: c(6), y: 128 }, t, o);
    t += 16; f.update(c(7), 128, true, false, { x: c(7), y: 128 }, t, o);
    expect(f.stats().queued).toBe(1);
    let x = o.x;
    for (let k = 0; k < 40; k++) { t += 16; f.update(c(7), 128, false, false, { x: c(7), y: 128 }, t, o); expect(o.x).toBeGreaterThanOrEqual(x - 1e-6); x = o.x; }
    expect(o.x).toBe(c(7));
  });

  /** Six steered steps east, each target 60 px off its tile centre (a heading line), 6 frames per step. */
  function steeredEast(f: StepFollower, o: XY): number {
    const c = (i: number): number => 128 + i * 256;
    let t = 0;
    f.update(c(0), 128, false, false, { x: c(0), y: 128 }, t, o);
    for (let i = 1; i <= 6; i++) {
      for (let k = 0; k < 6; k++) { t += 100 / 6; f.update(c(i) + 60, 128 - 60, k === 0, true, { x: c(i), y: 128 }, t, o); }
    }
    return t;
  }

  it('keys up between a step and the frame that shows it: still one glide (review 2026-10-06)', () => {
    const f = new StepFollower();
    const o = { x: 0, y: 0 };
    let t = steeredEast(f, o);
    const c = (i: number): number => 128 + i * 256;
    // Step 7 is taken, but the view still shows tile 6: the target holds tile 6's point. Then keys up, and tile 7 shows.
    t += 16; f.update(c(6) + 60, 128 - 60, false, true, { x: c(6), y: 128 }, t, o);
    t += 16; f.update(c(7), 128, true, false, { x: c(7), y: 128 }, t, o);
    expect(f.stats().queued).toBe(1);
  });

  it('a walk without steering right after keys up (the D-pad) plays on the step cadence again (review 2026-10-06)', () => {
    const f = new StepFollower();
    const o = { x: 0, y: 0 };
    let t = steeredEast(f, o);
    const c = (i: number): number => 128 + i * 256;
    t += 16; f.update(c(6), 128, false, false, { x: c(6), y: 128 }, t, o);
    const out: Array<XY & { t: number }> = [];
    let maxQ = 0;
    for (let i = 7; i <= 26; i++) {
      for (let k = 0; k < 6; k++) {
        t += 100 / 6;
        f.update(c(i), 128, k === 0, false, { x: c(i), y: 128 }, t, o);
        out.push({ x: o.x, y: o.y, t });
        if (i >= 10) maxQ = Math.max(maxQ, f.stats().queued);
      }
    }
    // Scheduled behind the glide, the steps queue on their ticks (a glide re-aimed at every step never queues).
    expect(maxQ).toBeGreaterThanOrEqual(2);
    const t0 = out[0]!.t;
    expect(ripple(speeds(out, t0 + 800, t0 + 1800))).toBeLessThanOrEqual(0.1);
  });

  it('W+D along a wall: the follow point runs straight down the row at a steady speed', () => {
    // A north wall at y = -4: four diagonal steps reach it, then the walk slides east.
    const { out } = steered(0, ['KeyW', 'KeyD'], 3000, (_x, y) => y >= -4, 3200, 5);
    const sp = speeds(out, 1500, 2900);
    expect(ripple(sp)).toBeLessThanOrEqual(0.1);
    for (const p of out.filter((q) => q.t >= 1500 && q.t <= 2900)) expect(Math.abs(p.y - (-4 + 0.5) * TILE)).toBeLessThan(0.02 * TILE);
  });

  it('before any step it is the game point, wherever that is', () => {
    const f = new StepFollower();
    const o = { x: 0, y: 0 };
    f.update(128, 128, false, false, { x: 140, y: 90 }, 0, o);
    expect(o).toEqual({ x: 140, y: 90 });
  });

  it('the camera target at s = 0 is exactly the game view whatever the followed point', () => {
    const v = viewForS({ s: 0, W: 800, H: 600, k: 0.3, viewCentre: { x: 1000, y: 2000 }, ground: { x: 5000, y: 7000 }, userYawDeg: 40, userPitchDeg: 0, fovDeg: 70, far: 31000 });
    expect(v.target).toEqual({ x: 1000, y: 2000 });
    expect(v.tilt).toBe(0);
  });
});
