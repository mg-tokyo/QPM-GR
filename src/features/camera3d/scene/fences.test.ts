import { describe, expect, it } from 'vitest';
import { makeBasis, project, type CamParams } from '../math/camera';
import { columnAlpha, type EdgeRows } from './fences';

const D = Math.PI / 180;
const W = 1278, H = 656, NEAR = 40, WALL_H = 150;
// s ≈ 0.16 at max zoom (live 2026-10-03, the wedge report): pitch 39°, fov 47°.
const P: CamParams = { yaw: 0, pitch: 39 * D, dist: 1400, fov: 47 * D, lookH: 110, yOff: 0.12, near: NEAR, far: 9000 };
const b = makeBasis(P, 5000, 5000, W, H);

const rows = (n: number): EdgeRows => ({
  gx: new Float64Array(n), gy: new Float64Array(n), gz: new Float64Array(n),
  hx: new Float64Array(n), hy: new Float64Array(n), hz: new Float64Array(n),
});

/** One 64 px column of an east-west wall at ground row z, from x to x + 64. */
function column(x: number, z: number): EdgeRows {
  const e = rows(2), o = [0, 0, 0];
  for (let i = 0; i < 2; i++) {
    project(b, x + 64 * i, 0, z, o); e.gx[i] = o[0]!; e.gy[i] = o[1]!; e.gz[i] = o[2]!;
    project(b, x + 64 * i, WALL_H, z, o); e.hx[i] = o[0]!; e.hy[i] = o[1]!; e.hz[i] = o[2]!;
  }
  return e;
}

/** Ground row whose camera depth is cz (yaw 0: depth falls as z grows towards the camera). */
const rowAtDepth = (cz: number): number => b.C[2] + (b.C[1] * Math.sin(P.pitch) - cz) / Math.cos(P.pitch);

describe('columnAlpha', () => {
  it('draws a column in view at ordinary depth', () => {
    expect(columnAlpha(column(4970, 4900), 0, NEAR, W, H)).toBe(1);
  });

  it('hides a column whose top is behind the near plane although both bottom corners are past it (the wedge)', () => {
    const e = column(b.C[0] - 32, rowAtDepth(80));
    expect(Math.min(e.gz[0]!, e.gz[1]!)).toBeGreaterThanOrEqual(NEAR);
    expect(e.hz[0]!).toBeLessThan(NEAR);
    expect(columnAlpha(e, 0, NEAR, W, H)).toBe(0);
  });

  it('hides a column whose true quad lies wholly below the screen', () => {
    const e = column(b.C[0] - 32, rowAtDepth(300));
    expect(Math.min(e.gz[0]!, e.gz[1]!, e.hz[0]!, e.hz[1]!)).toBeGreaterThanOrEqual(NEAR);
    expect(Math.min(e.gy[0]!, e.gy[1]!, e.hy[0]!, e.hy[1]!)).toBeGreaterThan(H);
    expect(columnAlpha(e, 0, NEAR, W, H)).toBe(0);
  });

  it('fades by how far the affine fourth corner drifts from the true one, relative to the column height', () => {
    const e = rows(2);
    // B0 (0,100), B1 (50,100), T0 (0,0): the affine puts T1 at (50,0).
    e.gx.set([0, 50]); e.gy.set([100, 100]); e.gz.set([500, 500]);
    e.hx.set([0, 50]); e.hy.set([0, 0]); e.hz.set([500, 500]);
    expect(columnAlpha(e, 0, NEAR, W, H)).toBe(1);
    e.hy[1] = 17.5;
    expect(columnAlpha(e, 0, NEAR, W, H)).toBeCloseTo(0.5, 6);
    e.hy[1] = 30;
    expect(columnAlpha(e, 0, NEAR, W, H)).toBe(0);
  });
});
