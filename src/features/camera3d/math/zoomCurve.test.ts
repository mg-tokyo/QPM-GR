import { describe, expect, it } from 'vitest';
import { makeBasis, project } from './camera';
import { CURVE_KEYS, curveAt, distForScale, viewForS } from './zoomCurve';

describe('zoom curve', () => {
  it('s = 0 is the first key exactly and s >= 1 is first person', () => {
    expect(curveAt(0)).toMatchObject({ pitch: 90, fov: 20, m: 1, lookH: 0, yOff: 0, follow: 0, orbit: 0 });
    expect(curveAt(1)).toBeNull();
  });

  it('pitch never increases along s', () => {
    let last = Infinity;
    for (let s = 0; s < 1; s += 0.01) {
      const k = curveAt(s)!;
      expect(k.pitch).toBeLessThanOrEqual(last + 1e-9);
      last = k.pitch;
    }
  });

  it('hits every key at its own s', () => {
    for (const key of CURVE_KEYS) expect(curveAt(key.s)!.m).toBeCloseTo(key.m, 9);
  });

  it('distForScale gives fpx/k straight down with no look height', () => {
    expect(distForScale(1000, 2, 1, 0, Math.PI / 2)).toBeCloseTo(500, 9);
  });

  it('viewForS(0) reproduces the 2D view (scale k about the view centre), with no yaw even if the user turned', () => {
    const W = 1280, H = 720, k = 1.5, vc = { x: 6000, y: 5000 };
    const v = viewForS({ s: 0, W, H, k, viewCentre: vc, ground: { x: 6100, y: 5100 }, userYawDeg: 120, userPitchDeg: -20 });
    expect(v.params.yaw).toBe(0);
    expect(v.target).toEqual(vc);
    const b = makeBasis(v.params, v.target.x, v.target.y, W, H);
    const out = [0, 0, 0];
    project(b, 6200, 0, 4900, out);
    expect(out[0]).toBeCloseTo(W / 2 + k * 200, 4);
    expect(out[1]).toBeCloseTo(H / 2 - k * 100, 4);
  });

  it('first person hides the avatar and follows the ground point', () => {
    const v = viewForS({ s: 1, W: 1280, H: 720, k: 1.5, viewCentre: { x: 0, y: 0 }, ground: { x: 10, y: 20 }, userYawDeg: 90, userPitchDeg: 200 });
    expect(v.hideSelf).toBe(true);
    expect(v.target).toEqual({ x: 10, y: 20 });
    expect(v.params.pitch).toBeCloseTo(80 * Math.PI / 180, 9);
  });
});
