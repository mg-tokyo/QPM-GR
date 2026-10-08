import { describe, expect, it } from 'vitest';
import { makeBasis, project, type CamParams } from '../math/camera';
import { STRIP_VERTS, WALL_COLS, WALL_ROWS, projectStrip, stripCanWait, stripIndices, stripNeedsPerspective, stripUvs, wallQuadWorld, type WallLine } from './wallGeom';

const D = Math.PI / 180;
const W = 1280, H = 656, NEAR = 40;
const cam = (p: Partial<CamParams>, tx = 5000, ty = 5000) =>
  makeBasis({ yaw: 0, pitch: 30 * D, dist: 1500, fov: 50 * D, lookH: 120, yOff: 0, near: NEAR, far: 31000, ...p }, tx, ty, W, H);

describe('wall strip topology', () => {
  it('is a (cols + 1) × (rows + 1) grid: texture top-left at the wall top over A, bottom-right at the ground over B', () => {
    expect(STRIP_VERTS).toBe((WALL_COLS + 1) * (WALL_ROWS + 1));
    const uv = stripUvs();
    expect(uv.length).toBe(STRIP_VERTS * 2);
    expect([uv[0], uv[1]]).toEqual([0, 0]);
    expect([uv[2 * WALL_COLS], uv[2 * WALL_COLS + 1]]).toEqual([1, 0]);
    expect([uv[uv.length - 2], uv[uv.length - 1]]).toEqual([1, 1]);
    const idx = stripIndices();
    expect(idx.length).toBe(WALL_COLS * WALL_ROWS * 6);
    // Two triangles per cell, each spanning one column and one row.
    for (let t = 0; t < idx.length; t += 3) {
      const cols = [idx[t]!, idx[t + 1]!, idx[t + 2]!].map((v) => v % (WALL_COLS + 1));
      const rows = [idx[t]!, idx[t + 1]!, idx[t + 2]!].map((v) => Math.floor(v / (WALL_COLS + 1)));
      expect(Math.max(...cols) - Math.min(...cols)).toBe(1);
      expect(Math.max(...rows) - Math.min(...rows)).toBe(1);
    }
  });

  it('the perspective quad has the same corners in world space: A top, B top, B ground, A ground', () => {
    const w: WallLine = { ax: 100, az: 200, bx: 356, bz: 200, h: 150 };
    expect([...wallQuadWorld(w)]).toEqual([100, 150, 200, 356, 150, 200, 356, 0, 200, 100, 0, 200]);
  });
});

describe('projectStrip', () => {
  const w: WallLine = { ax: 4872, az: 4600, bx: 5128, bz: 4600, h: 150 };

  it('puts every vertex exactly where the camera projects its wall point, and reports only real changes', () => {
    const b = cam({});
    const pos = new Float32Array(STRIP_VERTS * 2), depth = new Float32Array(STRIP_VERTS), o = [0, 0, 0];
    expect(projectStrip(b, w, pos, depth)).toBe(true);
    for (let j = 0; j <= WALL_ROWS; j++) {
      for (let i = 0; i <= WALL_COLS; i++) {
        const v = i + j * (WALL_COLS + 1), f = i / WALL_COLS;
        project(b, w.ax + (w.bx - w.ax) * f, w.h * (1 - j / WALL_ROWS), w.az + (w.bz - w.az) * f, o);
        expect(pos[2 * v]).toBeCloseTo(o[0]!, 2);
        expect(pos[2 * v + 1]).toBeCloseTo(o[1]!, 2);
        expect(depth[v]).toBeCloseTo(o[2]!, 2);
      }
    }
    expect(projectStrip(b, w, pos, depth)).toBe(false);
    expect(projectStrip(cam({ yaw: 1 * D }), w, pos, depth)).toBe(true);
  });
});

describe('stripNeedsPerspective (A V4)', () => {
  const strip = (b: ReturnType<typeof cam>, w: WallLine) => {
    const pos = new Float32Array(STRIP_VERTS * 2), depth = new Float32Array(STRIP_VERTS);
    projectStrip(b, w, pos, depth);
    return { pos, depth };
  };

  it('keeps a wall facing the lens on the strip: no depth change across it, no texture error', () => {
    const { pos, depth } = strip(cam({ pitch: 0, lookH: 75 }), { ax: 4872, az: 4000, bx: 5128, bz: 4000, h: 150 });
    expect(stripNeedsPerspective(false, pos, depth, NEAR)).toBe(false);
  });

  it('moves a receding wall next to the lens to the perspective mesh, and keeps a far one on the strip', () => {
    // First person facing east along a north-south wall line half a tile to the right.
    const fp = cam({ yaw: 90 * D, pitch: 10 * D, dist: 1, lookH: 170 }, 5000, 5000);
    const near = strip(fp, { ax: 5100, az: 5128, bx: 5356, bz: 5128, h: 150 });
    expect(stripNeedsPerspective(false, near.pos, near.depth, NEAR)).toBe(true);
    const far = strip(fp, { ax: 9000, az: 5128, bx: 9256, bz: 5128, h: 150 });
    expect(stripNeedsPerspective(false, far.pos, far.depth, NEAR)).toBe(false);
  });

  it('always takes the perspective mesh within a few near planes of the lens (a strip vertex would project through infinity)', () => {
    const fp = cam({ yaw: 90 * D, pitch: 10 * D, dist: 1, lookH: 170 }, 5000, 5000);
    const touching = strip(fp, { ax: 5040, az: 4900, bx: 5040, bz: 5156, h: 150 });
    expect(Math.min(...touching.depth)).toBeLessThan(3 * NEAR);
    expect(stripNeedsPerspective(false, touching.pos, touching.depth, NEAR)).toBe(true);
  });

  it('has hysteresis: a wall between the two thresholds keeps its current path', () => {
    const fp = cam({ yaw: 90 * D, pitch: 10 * D, dist: 1, lookH: 170 }, 5000, 5000);
    // Walk a receding wall away from the lens until the strip is accepted again, then check one step nearer.
    let x = 5100, last = true;
    for (; x < 12000; x += 16) {
      const s = strip(fp, { ax: x, az: 5128, bx: x + 256, bz: 5128, h: 150 });
      last = stripNeedsPerspective(true, s.pos, s.depth, NEAR);
      if (!last) break;
    }
    expect(last).toBe(false);
    const between = strip(fp, { ax: x - 16, az: 5128, bx: x + 240, bz: 5128, h: 150 });
    expect(stripNeedsPerspective(true, between.pos, between.depth, NEAR)).toBe(true);
    expect(stripNeedsPerspective(false, between.pos, between.depth, NEAR)).toBe(false);
  });

  it('lets a switch wait while only a little texture error asks for it, never with a vertex near the lens', () => {
    const fp = cam({ yaw: 90 * D, pitch: 10 * D, dist: 1, lookH: 170 }, 5000, 5000);
    const at = (x: number) => strip(fp, { ax: x, az: 5128, bx: x + 256, bz: 5128, h: 150 });
    // Bring a receding wall in from afar until the strip first asks for the quad.
    let x = 12000;
    while (x > 5100 && !stripNeedsPerspective(false, at(x).pos, at(x).depth, NEAR)) x -= 8;
    const first = at(x);
    expect(stripNeedsPerspective(false, first.pos, first.depth, NEAR)).toBe(true);
    expect(stripCanWait(first.pos, first.depth, NEAR)).toBe(true);
    // Nearer, the error outgrows the wait while every vertex is still well past the near planes.
    while (x > 5100 && stripCanWait(at(x).pos, at(x).depth, NEAR)) x -= 8;
    expect(Math.min(...at(x).depth)).toBeGreaterThan(3 * NEAR);
    const touching = strip(fp, { ax: 5040, az: 4900, bx: 5040, bz: 5156, h: 150 });
    expect(stripCanWait(touching.pos, touching.depth, NEAR)).toBe(false);
  });
});
