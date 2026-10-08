import { describe, expect, it } from 'vitest';
import { cullOf } from '../__test__/cullOf';
import { makeBasis, project, type CamParams } from '../math/camera';
import { CameraStamp, CullRoll, IDLE_ROLL_FRAMES, MOVE_PX, MoveCheck, RING_PX, ROLL_SLICES, TRAVEL_CAP_PX, epochKey, mayBeSeen, nearCamera, recheck, ringDue, type FrameCtx } from './frame';

const D2R = Math.PI / 180;
const base: CamParams = { yaw: 30 * D2R, pitch: 28 * D2R, dist: 1600, fov: 55 * D2R, lookH: 120, yOff: 0.12, near: 40, far: 31000 };
const at = (o: Partial<CamParams> = {}): string => epochKey({ ...base, ...o }, 1600, 900);

describe('epochKey', () => {
  it('keeps the epoch while the camera orbits inside one yaw step', () => {
    expect(at({ yaw: 26 * D2R })).toBe(at({ yaw: 37 * D2R }));
  });

  it('changes on a yaw step, a zoom bucket and a resize', () => {
    expect(at({ yaw: 38 * D2R })).not.toBe(at());
    expect(at({ dist: 1600 * 1.6 })).not.toBe(at());
    expect(at({ pitch: 40 * D2R })).not.toBe(at());
    expect(epochKey(base, 1601, 900)).not.toBe(at());
  });

  it('ignores small distance and pitch drift', () => {
    expect(at({ dist: 1610, pitch: 28.5 * D2R })).toBe(at());
  });
});

describe('CullRoll', () => {
  const walk = (r: CullRoll, xs: number[]): Array<[boolean, number]> => xs.map((x) => { r.step(x, 7700, false); return [r.full, r.roll]; });

  it('re-culls everything on the first frame and stays idle while the target is still', () => {
    const r = new CullRoll();
    expect(walk(r, [12900, 12900, 12900])).toEqual([[true, -1], [false, -1], [false, -1]]);
  });

  it('a 2-tile move re-decides each slice once over the next frames, then stops', () => {
    const r = new CullRoll();
    r.step(12900, 7700, false);
    const rows = walk(r, Array.from({ length: ROLL_SLICES + 2 }, (_, i) => 12900 + 512 + i));
    expect(rows.every(([full]) => !full)).toBe(true);
    expect(rows.map(([, roll]) => roll)).toEqual([...Array.from({ length: ROLL_SLICES }, (_, i) => i), -1, -1]);
  });

  it('a view change or a jump re-culls at once and cancels a running pass', () => {
    const r = new CullRoll();
    r.step(12900, 7700, false);
    r.step(13500, 7700, false);
    expect(r.roll).toBe(0);
    r.step(13500, 7700, true);
    expect([r.full, r.roll]).toEqual([true, -1]);
    r.step(13510, 7700, false);
    expect(r.roll).toBe(-1);
    r.step(13510 + 1536, 7700, false);
    expect([r.full, r.roll]).toEqual([true, -1]);
  });

  it('a still target starts a slow idle roll every IDLE_ROLL_FRAMES frames (A V1)', () => {
    const r = new CullRoll();
    const rows = walk(r, Array.from({ length: 1 + IDLE_ROLL_FRAMES + ROLL_SLICES + 2 }, () => 12900));
    const rolls = rows.map(([, roll]) => roll);
    expect(rows[0]).toEqual([true, -1]);
    expect(rolls.slice(1, IDLE_ROLL_FRAMES).every((x) => x === -1)).toBe(true);
    expect(rolls.slice(IDLE_ROLL_FRAMES, IDLE_ROLL_FRAMES + ROLL_SLICES)).toEqual(Array.from({ length: ROLL_SLICES }, (_, i) => i));
    expect(rolls.slice(IDLE_ROLL_FRAMES + ROLL_SLICES)).toEqual([-1, -1, -1]);
    expect(rows.every(([full], i) => i === 0 || !full)).toBe(true);
  });

  it('reset() makes the next frame a full re-cull', () => {
    const r = new CullRoll();
    r.step(12900, 7700, false);
    r.reset();
    r.step(12900, 7700, false);
    expect(r.full).toBe(true);
  });
});

describe('CullRoll travel cap (perf Task 5)', () => {
  /** Steps the roll along x and tracks where each slice was last re-checked; returns the worst staleness seen after a
   * step (what a rendered frame can hold) and the full re-culls after the first frame. */
  const run = (r: CullRoll, xs: number[]): { worst: number; fulls: number; capped: number } => {
    const at = new Array<number>(ROLL_SLICES).fill(NaN);
    let worst = 0, fulls = 0, capped = 0;
    xs.forEach((x, i) => {
      r.step(x, 7700, false);
      if (r.full) { at.fill(x); if (i > 0) fulls++; }
      if (r.roll >= 0) at[r.roll] = x;
      for (let k = 0; k < ROLL_SLICES; k++) if ((r.capMask >> k) & 1) { at[k] = x; capped++; }
      for (const a of at) worst = Math.max(worst, Math.abs(x - a));
    });
    return { worst, fulls, capped };
  };

  it('a slice is re-checked on the frame its target travel since its last check reaches the cap', () => {
    const r = new CullRoll();
    r.step(0, 7700, false);
    r.step(600, 7700, false);
    expect([r.full, r.roll, r.capMask]).toEqual([false, 0, 0]);
    r.step(TRAVEL_CAP_PX + 10, 7700, false);
    // Slice 0 was re-checked at 600; the others not since the full at 0. Slice 1 is the pass's own this frame.
    expect([r.full, r.roll]).toEqual([false, 1]);
    expect(r.capMask).toBe(0xff & ~0b11);
  });

  it('a target moving 320 px a frame (an ~8 fps walk) never leaves a slice staler than the cap, without full re-culls', () => {
    const xs = Array.from({ length: 80 }, (_, i) => i * 320);
    const cap = run(new CullRoll(), xs);
    expect(cap.worst).toBeLessThan(TRAVEL_CAP_PX);
    expect(cap.fulls).toBeLessThanOrEqual(1);
    // The old anchor rule (debug lever capPx 0) re-culled everything every ~5 frames and left slices staler than that.
    const old = new CullRoll();
    old.capPx = 0;
    const legacy = run(old, xs);
    expect(legacy.fulls).toBeGreaterThanOrEqual(10);
    expect(legacy.worst).toBeGreaterThan(TRAVEL_CAP_PX);
  });

  it('a walk at 30 fps (85 px a frame) keeps the rolling cadence: no full re-culls, the cap tops up a few slices per turn', () => {
    const xs = Array.from({ length: 240 }, (_, i) => Math.abs(((i * 85) % 7240) - 3620));
    const res = run(new CullRoll(), xs);
    expect(res.worst).toBeLessThan(TRAVEL_CAP_PX);
    expect(res.fulls).toBe(0);
    // Five turns in 240 frames; a slice checked just before a turn is past the cap before the next pass reaches it.
    expect(res.capped).toBeLessThanOrEqual(ROLL_SLICES * 5);
  });

  it('a jump past the cap for every slice is one full re-cull', () => {
    const r = new CullRoll();
    r.step(0, 7700, false);
    r.step(TRAVEL_CAP_PX * 2, 7700, false);
    expect([r.full, r.roll, r.capMask]).toEqual([true, -1, 0]);
  });
});

describe('MoveCheck', () => {
  it('a node is due on first sight, then again only after moving MOVE_PX since its last check', () => {
    const m = new MoveCheck();
    const n = {};
    expect(m.due(n, 100, 100)).toBe(true);
    m.note(n, 100, 100);
    expect(m.due(n, 100 + MOVE_PX - 1, 100)).toBe(false);
    expect(m.due(n, 100 + MOVE_PX / 2, 100 + MOVE_PX / 2)).toBe(true);
    m.note(n, 100 + MOVE_PX / 2, 100 + MOVE_PX / 2);
    expect(m.due(n, 100 + MOVE_PX / 2, 100 + MOVE_PX / 2)).toBe(false);
  });

  it('a still walker is also due once the camera target has travelled the cap since its last check (perf Task 5)', () => {
    const m = new MoveCheck();
    const n = {};
    m.note(n, 100, 100, 0, 0);
    expect(m.due(n, 100, 100, TRAVEL_CAP_PX - 1, 0, TRAVEL_CAP_PX)).toBe(false);
    expect(m.due(n, 100, 100, 0, TRAVEL_CAP_PX, TRAVEL_CAP_PX)).toBe(true);
    expect(m.due(n, 100, 100, 0, 5 * TRAVEL_CAP_PX, 0)).toBe(false);
    m.note(n, 100, 100, 0, TRAVEL_CAP_PX);
    expect(m.due(n, 100, 100, 0, TRAVEL_CAP_PX, TRAVEL_CAP_PX)).toBe(false);
  });
});

describe('near ring (perf Task 5, PC9)', () => {
  // First person at FOV 70, 1280×632 (A §1).
  const fp: CamParams = { yaw: 0.4, pitch: 2 * D2R, dist: 1, fov: 70 * D2R, lookH: 170, yOff: 0, near: 40, far: 31000 };
  const W = 1280, H = 632;
  const basis = makeBasis(fp, 6000, 6000, W, H);
  const ctxWith = (legacy: number, ring: number, camStill = false): FrameCtx =>
    ({ basis, W, H, params: fp, camStill, cull: cullOf(basis, fp, W, H, legacy, ring) }) as unknown as FrameCtx;
  const hf = Math.hypot(basis.F[0], basis.F[2]);
  const ground = (d: number, s: number): [number, number] =>
    [basis.C[0] + (basis.F[0] / hf) * d + basis.R[0] * s, basis.C[2] + (basis.F[2] / hf) * d + basis.R[2] * s];
  // A ground point d ahead of the camera whose foot projects `past` px right of the screen (negative: on screen).
  const foot = (d: number, past: number) => {
    const o = [0, 0, 0];
    const [x0, z0] = ground(d, 0);
    project(basis, x0, 0, z0, o);
    const [gx, gz] = ground(d, ((W + past - o[0]!) * o[2]!) / basis.fpx);
    project(basis, gx, 0, gz, o);
    return { gx, gz, sx: o[0]!, sy: o[1]!, cz: o[2]!, r: Math.hypot(gx - basis.C[0], gz - basis.C[2]) };
  };
  const seen = (ctx: FrameCtx, f: ReturnType<typeof foot>): boolean => mayBeSeen(ctx, f.gx, f.gz, f.sx, f.sy, f.cz, 0, 0, 0, 0, false);

  it('without the travel cap (lever capPx 0) nothing in the ring is decided against the exact screen: no slice cadence bounds it', () => {
    const inner = foot(1300, 50);
    const ctx = { ...ctxWith(0.75, RING_PX), cull: { ...cullOf(basis, fp, W, H, 0.75, RING_PX), cap: 0 } } as FrameCtx;
    expect(seen(ctx, inner)).toBe(true);
  });

  it('ringDue: inside the ring, on a moving frame, with the ring on', () => {
    const [ix, iz] = ground(RING_PX - 10, 0), [ox, oz] = ground(RING_PX + 10, 0);
    expect([ringDue(ctxWith(0.75, RING_PX), ix, iz), ringDue(ctxWith(0.75, RING_PX), ox, oz)]).toEqual([true, false]);
    expect(ringDue(ctxWith(0.75, RING_PX, true), ix, iz)).toBe(false);
    expect(ringDue(ctxWith(0.75, 0), ix, iz)).toBe(false);
  });

  it('mayBeSeen: a cap inside the ring, the screen as it is; farther, the fixed margins', () => {
    const inner = foot(1300, 50), band = foot(1700, 50), far = foot(3200, 50);
    expect(inner.r).toBeLessThan(RING_PX - TRAVEL_CAP_PX);
    expect(band.r).toBeGreaterThan(RING_PX - TRAVEL_CAP_PX);
    expect(band.r).toBeLessThan(RING_PX);
    expect(far.r).toBeGreaterThan(RING_PX);
    expect([seen(ctxWith(0.75, RING_PX), inner), seen(ctxWith(0.75, 0), inner)]).toEqual([false, true]);
    expect(seen(ctxWith(0.75, RING_PX), foot(1300, -50))).toBe(true);
    // The band may leave the ring before its next re-check: margins decide it.
    expect([seen(ctxWith(0.75, RING_PX), band), seen(ctxWith(0.75, RING_PX), far)]).toEqual([true, true]);
    expect(seen(ctxWith(0.75, RING_PX), foot(3200, 1000))).toBe(false);
  });

  it('perf Task 7 (PC12): with the show-ahead band a foot inside the ring just past the screen is decided in view', () => {
    const banded = { ...ctxWith(0.75, RING_PX), cull: cullOf(basis, fp, W, H, 0.75, RING_PX, { yaw: 6 * D2R, pitch: 0, frames: 8 }) } as FrameCtx;
    // 50 px past the right edge is ~2° at FOV 70; 400 px is ~12° (900 px ahead: still well inside the ring).
    expect([seen(ctxWith(0.75, RING_PX), foot(1300, 50)), seen(banded, foot(1300, 50))]).toEqual([false, true]);
    expect(foot(900, 400).r).toBeLessThan(RING_PX - TRAVEL_CAP_PX);
    expect(seen(banded, foot(900, 400))).toBe(false);
  });
});

describe('nearCamera', () => {
  it('keeps items within 3 tiles of the camera ground point, whatever their depth', () => {
    const basis = makeBasis(base, 12900, 7700, 1600, 900);
    const ctx = { basis } as FrameCtx;
    const [cx, cz] = [basis.C[0], basis.C[2]];
    expect(nearCamera(ctx, cx + 500, cz + 500)).toBe(true);
    expect(nearCamera(ctx, cx, cz + 760)).toBe(true);
    expect(nearCamera(ctx, cx + 800, cz)).toBe(false);
  });
});

describe('recheck', () => {
  it('a rolling pass covers every slot exactly once; a full re-cull covers all of them', () => {
    const slots = Array.from({ length: 40 }, (_, i) => i * 7 + 3);
    const seen = new Map<number, number>();
    for (let roll = 0; roll < ROLL_SLICES; roll++) {
      const ctx = { reCull: false, roll } as FrameCtx;
      for (const s of slots) if (recheck(ctx, s)) seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    expect(slots.every((s) => seen.get(s) === 1)).toBe(true);
    expect(slots.every((s) => !recheck({ reCull: false, roll: -1 } as FrameCtx, s))).toBe(true);
    expect(slots.every((s) => recheck({ reCull: true, roll: -1 } as FrameCtx, s))).toBe(true);
  });

  it('also covers the slices the travel cap re-checks this frame', () => {
    const ctx = { reCull: false, roll: -1, capMask: 0b100100 } as FrameCtx;
    expect(Array.from({ length: ROLL_SLICES }, (_, k) => recheck(ctx, 16 + k))).toEqual([false, false, true, false, false, true, false, false]);
  });
});

describe('CameraStamp (perf Task 4: ctx.camStill)', () => {
  const view = (o: Partial<CamParams> = {}, tx = 12900, W = 1600) => ({ ...base, ...o, basis: makeBasis({ ...base, ...o }, tx, 7700, W, 900) });
  const still = (s: CameraStamp, v = view(), dx = 0.5, dz = -0.8, tilt = 1, hideSelf = false): boolean => s.still(v.basis, v, dx, dz, tilt, hideSelf);

  it('the first frame is never still; the same camera again is', () => {
    const s = new CameraStamp();
    expect([still(s), still(s), still(s)]).toEqual([false, true, true]);
  });

  it('any input a placement reads moves it once, then the new camera is still', () => {
    const changes: Array<(s: CameraStamp) => boolean> = [
      (s) => still(s, view({ yaw: 31 * D2R })),
      (s) => still(s, view({ pitch: 29 * D2R })),
      (s) => still(s, view({ dist: 1601 })),
      (s) => still(s, view({ fov: 56 * D2R })),
      (s) => still(s, view({ lookH: 121 })),
      (s) => still(s, view({ yOff: 0.13 })),
      (s) => still(s, view({ near: 41 })),
      (s) => still(s, view({ far: 31001 })),
      (s) => still(s, view({}, 12901)),
      (s) => still(s, view({}, 12900, 1601)),
      (s) => still(s, view(), 0.6),
      (s) => still(s, view(), 0.5, -0.7),
      (s) => still(s, view(), 0.5, -0.8, 0.9),
      (s) => still(s, view(), 0.5, -0.8, 1, true),
    ];
    for (const change of changes) {
      const s = new CameraStamp();
      still(s);
      expect([change(s), change(s)]).toEqual([false, true]);
    }
  });

  it('reset() makes the next frame a moved one (3D left, epoch reset)', () => {
    const s = new CameraStamp();
    still(s);
    s.reset();
    expect([still(s), still(s)]).toEqual([false, true]);
  });
});
