import { describe, expect, it } from 'vitest';
import { groundFootprint, groundRay, makeBasis, project, type CamParams } from './camera';

const D = Math.PI / 180;
const topDown = (k: number, H: number, fov = 20 * D): CamParams => {
  const fpx = (H / 2) / Math.tan(fov / 2);
  return { yaw: 0, pitch: 90 * D, dist: fpx / k, fov, lookH: 0, yOff: 0, near: 40, far: 9000 };
};

describe('camera math', () => {
  it('straight down at yaw 0 is the 2D camera: scale k about the view centre', () => {
    const W = 1000, H = 600, k = 1.5, tx = 5000, ty = 4000;
    const b = makeBasis(topDown(k, H), tx, ty, W, H);
    const out = [0, 0, 0];
    for (const [x, y] of [[5000, 4000], [5100, 3900], [4800, 4200]] as const) {
      project(b, x, 0, y, out);
      expect(out[0]).toBeCloseTo(W / 2 + k * (x - tx), 6);
      expect(out[1]).toBeCloseTo(H / 2 + k * (y - ty), 6);
    }
  });

  it('groundRay inverts project on the ground plane', () => {
    const p: CamParams = { yaw: 37 * D, pitch: 28 * D, dist: 1600, fov: 55 * D, lookH: 120, yOff: 0.12, near: 40, far: 9000 };
    const b = makeBasis(p, 7000, 6000, 1280, 720);
    const out = [0, 0, 0];
    project(b, 7300, 0, 5800, out);
    const g = groundRay(b, out[0]!, out[1]!);
    expect(g).not.toBeNull();
    expect(g!.x).toBeCloseTo(7300, 3);
    expect(g!.y).toBeCloseTo(5800, 3);
  });

  it('groundRay is null above the horizon', () => {
    const b = makeBasis({ yaw: 0, pitch: 5 * D, dist: 1600, fov: 55 * D, lookH: 120, yOff: 0, near: 40, far: 9000 }, 0, 0, 1280, 720);
    expect(groundRay(b, 640, 0)).toBeNull();
  });

  it('groundFootprint contains the camera ground point and stays within maxDist of it', () => {
    const b = makeBasis({ yaw: 0, pitch: 20 * D, dist: 1600, fov: 55 * D, lookH: 120, yOff: 0.12, near: 40, far: 9000 }, 7000, 6000, 1280, 720);
    const f = groundFootprint(b, 1280, 720, 3000);
    expect(f.x0).toBeLessThanOrEqual(b.C[0]);
    expect(f.x1).toBeGreaterThanOrEqual(b.C[0]);
    expect(f.y0).toBeGreaterThanOrEqual(b.C[2] - 3000 - 1e-6);
    expect(f.x1 - f.x0).toBeLessThanOrEqual(6000 + 1e-6);
  });
});
