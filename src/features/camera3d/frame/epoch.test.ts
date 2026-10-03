import { describe, expect, it } from 'vitest';
import { makeBasis, type CamParams } from '../math/camera';
import { CullRoll, ROLL_SLICES, epochKey, nearCamera, recheck, type FrameCtx } from './frame';

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

  it('reset() makes the next frame a full re-cull', () => {
    const r = new CullRoll();
    r.step(12900, 7700, false);
    r.reset();
    r.step(12900, 7700, false);
    expect(r.full).toBe(true);
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
});
