import { describe, expect, it } from 'vitest';
import { makeBasis, project, type CamParams } from '../math/camera';
import { BAND_DECAY, TurnBand, hullMayShow, legacyShow, legacyWallShow, mayShow, newCull, updateCull } from './cull';

const D2R = Math.PI / 180;
const LV = { capPx: 768, legacy: 0.75, ring: 3584, ahead: 0, aheadMax: 30 * D2R };

// Deterministic pseudo-random numbers (mulberry32): the coverage runs are the same every time.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cam = (o: Partial<CamParams>): CamParams => ({ yaw: 0.4, pitch: 12 * D2R, dist: 400, fov: 64 * D2R, lookH: 150, yOff: 0.06, near: 40, far: 31000, ...o });

/** A billboard's art rect (foot gx, gz; reach in world px at its depth) overlaps the screen of camera (p, tx, ty). */
function artOnScreen(p: CamParams, tx: number, ty: number, W: number, H: number, gx: number, gz: number, side: number, up: number, down: number): boolean {
  const b = makeBasis(p, tx, ty, W, H), o = [0, 0, 0];
  project(b, gx, 0, gz, o);
  const cz = o[2]!;
  if (cz < p.near || cz > p.far) return false;
  const mm = b.fpx / cz;
  return o[0]! + side * mm >= 0 && o[0]! - side * mm <= W && o[1]! + down * mm >= 0 && o[1]! - up * mm <= H;
}

describe('cull: the screen as it is (perf Task 5: the near ring and flat art)', () => {
  it('is exactly the art rect overlapping the screen', () => {
    const r = rng(7);
    const W = 1280, H = 632;
    for (const p of [cam({}), cam({ pitch: 2 * D2R, dist: 1, fov: 70 * D2R, yOff: 0 }), cam({ pitch: 33 * D2R, dist: 1325, fov: 50 * D2R, yOff: 0.12 })]) {
      const b = makeBasis(p, 6000, 6000, W, H), c = updateCull(newCull(), b, p, W, H, LV, null), o = [0, 0, 0];
      let mismatches = 0, inside = 0;
      for (let i = 0; i < 4000; i++) {
        const gx = 6000 + (r() - 0.5) * 16000, gz = 6000 + (r() - 0.5) * 16000;
        project(b, gx, 0, gz, o);
        const side = 300 * r(), up = 1200 * r(), down = 300 * r();
        const want = artOnScreen(p, 6000, 6000, W, H, gx, gz, side, up, down);
        if (want) inside++;
        if (o[2]! >= p.near && mayShow(c, o[0]!, o[1]!, o[2]!, side, up, down) !== want) mismatches++;
      }
      expect(mismatches).toBe(0);
      expect(inside).toBeGreaterThan(100);
    }
  });
});

describe('cull: walls (world-fixed quads)', () => {
  const p = cam({ pitch: 12 * D2R, dist: 400, fov: 64 * D2R }), W = 1280, H = 632;
  const b = makeBasis(p, 6000, 6000, W, H);
  const c = updateCull(newCull(), b, p, W, H, LV, null);
  const corners = (pts: Array<[number, number, number]>): Float64Array => {
    const out = new Float64Array(pts.length * 3), o = [0, 0, 0];
    pts.forEach(([x, y, z], i) => { project(b, x, y, z, o); out[3 * i] = o[0]!; out[3 * i + 1] = o[1]!; out[3 * i + 2] = o[2]!; });
    return out;
  };
  const along = (d: number, s: number): [number, number] => [b.C[0] + b.F[0] * d + b.R[0] * s, b.C[2] + b.F[2] * d + b.R[2] * s];

  it('is ruled out only when every corner is past the same face', () => {
    const [ax, az] = along(2000, 30000), [bx, bz] = along(2600, 30000);
    expect(hullMayShow(c, corners([[ax, 0, az], [bx, 0, bz], [ax, 200, az], [bx, 200, bz]]), 4)).toBe(false);
    const [cx, cz] = along(2600, 0);
    expect(hullMayShow(c, corners([[ax, 0, az], [cx, 0, cz], [ax, 200, az], [cx, 200, cz]]), 4)).toBe(true);
  });

  it('a wall from behind the lens to in front of it is kept', () => {
    const [ax, az] = along(-3000, 200), [bx, bz] = along(3000, 200);
    expect(hullMayShow(c, corners([[ax, 0, az], [bx, 0, bz], [ax, 200, az], [bx, 200, bz]]), 4)).toBe(true);
  });

  it('past the ring: its two ground ends against the fixed margins (sides × W, the caller\'s bands, the depth range)', () => {
    const at = (x0: number, y0: number, x1: number, y1: number, z = 500): Float64Array => new Float64Array([x0, y0, z, x1, y1, z]);
    expect([legacyWallShow(c, at(-2000, 300, -960, 300), 200, 1600), legacyWallShow(c, at(-2000, 300, -961, 300), 200, 1600)]).toEqual([true, false]);
    expect([legacyWallShow(c, at(W + 960, 300, W + 3000, 300), 200, 1600), legacyWallShow(c, at(W + 961, 300, W + 3000, 300), 200, 1600)]).toEqual([true, false]);
    expect([legacyWallShow(c, at(600, -200, 700, -900), 200, 1600), legacyWallShow(c, at(600, -201, 700, -900), 200, 1600)]).toEqual([true, false]);
    expect(legacyWallShow(c, at(600, 300, 700, 300, 39), 200, 1600)).toBe(false);
  });
});

describe('cull: the show-ahead band (perf Task 7, PC12)', () => {
  const W = 1280, H = 632;
  const ON = { ...LV, ahead: 8 };

  it('band 0 or the lever off: the ahead box is the screen as it is', () => {
    const p = cam({}), b = makeBasis(p, 6000, 6000, W, H);
    expect(updateCull(newCull(), b, p, W, H, ON, { yaw: 0, pitch: 0 }).ahead).toEqual(updateCull(newCull(), b, p, W, H, LV, null).now);
    const off = updateCull(newCull(), b, p, W, H, LV, { yaw: 0.2, pitch: 0.1 });
    expect([off.ahead, off.aheadFrames]).toEqual([off.now, 0]);
  });

  it('widens the side faces by the yaw band and the top and bottom by the pitch band', () => {
    const p = cam({}), b = makeBasis(p, 6000, 6000, W, H);
    const c = updateCull(newCull(), b, p, W, H, ON, { yaw: 5 * D2R, pitch: 2 * D2R });
    expect(Math.atan(c.ahead.r) - Math.atan(c.now.r)).toBeCloseTo(5 * D2R, 9);
    expect(Math.atan(c.ahead.l) - Math.atan(c.now.l)).toBeCloseTo(5 * D2R, 9);
    expect(Math.atan(c.ahead.t) - Math.atan(c.now.t)).toBeCloseTo(2 * D2R, 9);
    expect(Math.atan(c.ahead.b) - Math.atan(c.now.b)).toBeCloseTo(2 * D2R, 9);
    expect(c.ahead.nr).toBeCloseTo(Math.hypot(1, c.ahead.r), 12);
    expect(c.aheadFrames).toBe(8);
    // A face never reaches 90°.
    const wide = updateCull(newCull(), b, p, W, H, ON, { yaw: Math.PI, pitch: 0 });
    expect(Number.isFinite(wide.ahead.r) && wide.ahead.r > 0).toBe(true);
  });

  it('art the camera turns on screen within the band is in view now (yaw about world up; level and pitched cameras)', () => {
    const r = rng(11);
    for (const [pitch, frac] of [[0, 1], [12 * D2R, 0.9]] as const) {
      const band = 6 * D2R, p0 = cam({ pitch, yaw: 0.4 });
      const b0 = makeBasis(p0, 6000, 6000, W, H), c = updateCull(newCull(), b0, p0, W, H, ON, { yaw: band, pitch: 0 }), o = [0, 0, 0];
      let missed = 0, turnedOn = 0, inBand = 0;
      for (let i = 0; i < 6000; i++) {
        const gx = 6000 + (r() - 0.5) * 12000, gz = 6000 + (r() - 0.5) * 12000;
        const side = 300 * r(), up = 1200 * r(), down = 300 * r();
        project(b0, gx, 0, gz, o);
        if (o[2]! < p0.near) continue;
        const now = mayShow(c, o[0]!, o[1]!, o[2]!, side, up, down);
        const ahead = mayShow(c, o[0]!, o[1]!, o[2]!, side, up, down, 0, c.ahead);
        if (now && !ahead) missed++;
        if (ahead && !now) inBand++;
        const turned = [-1, -0.5, 0.5, 1].some((k) => artOnScreen({ ...p0, yaw: p0.yaw + k * frac * band }, 6000, 6000, W, H, gx, gz, side, up, down));
        if (turned && !now) { turnedOn++; if (!ahead) missed++; }
      }
      expect(missed).toBe(0);
      expect(turnedOn).toBeGreaterThan(50);
      expect(inBand).toBeGreaterThan(turnedOn - 1);
    }
  });

  it('a wall just past the right face is kept by the ahead box and culled by the screen', () => {
    const p = cam({ pitch: 12 * D2R, dist: 400, fov: 64 * D2R }), b = makeBasis(p, 6000, 6000, W, H);
    const c = updateCull(newCull(), b, p, W, H, ON, { yaw: 8 * D2R, pitch: 0 });
    // Corners 3° and 4° past the right face (camera space), 2000 px deep, at the centre row and 40 px above it.
    const o = [0, 0, 0], pts = new Float64Array(12), ang = Math.atan(c.now.r), Z = 2000;
    [3, 4].forEach((deg, i) => {
      const X = Z * Math.tan(ang + deg * D2R);
      for (const [k, Y] of [[i, 0], [i + 2, 40]] as const) {
        const w = [0, 1, 2].map((j) => b.C[j]! + b.F[j]! * Z + b.R[j]! * X + b.U[j]! * Y);
        project(b, w[0]!, w[1]!, w[2]!, o); pts.set(o, 3 * k);
      }
    });
    expect([hullMayShow(c, pts, 4), hullMayShow(c, pts, 4, c.ahead)]).toEqual([false, true]);
  });
});

describe('TurnBand (perf Task 7, PC12)', () => {
  const MAX = 30 * D2R;

  it('is 0 on the first frame and frames × the turn while the camera keeps turning', () => {
    const t = new TurnBand();
    expect([t.step(1, 0.2, 8, MAX), t.yaw, t.pitch]).toEqual([false, 0, 0]);
    expect(t.step(1 + D2R, 0.2, 8, MAX)).toBe(true);
    expect(t.yaw).toBeCloseTo(8 * D2R, 12);
    t.step(1 + 2 * D2R, 0.2 + 0.5 * D2R, 8, MAX);
    expect([t.yaw, t.pitch].map((v) => +(v / D2R).toFixed(9))).toEqual([8, 4]);
  });

  it('holds its peak and decays once the turn stops, then snaps to 0 and stops changing', () => {
    const t = new TurnBand();
    t.step(0, 0, 8, MAX); t.step(2 * D2R, 0, 8, MAX);
    t.step(2 * D2R, 0, 8, MAX);
    expect(t.yaw).toBeCloseTo(16 * D2R * BAND_DECAY, 12);
    t.step(2 * D2R + 0.1 * D2R, 0, 8, MAX);
    expect(t.yaw).toBeCloseTo(16 * D2R * BAND_DECAY * BAND_DECAY, 12);
    let f = 0;
    while (t.step(2.1 * D2R, 0, 8, MAX) && f < 500) f++;
    expect([t.yaw, f < 500]).toEqual([0, true]);
    expect(t.step(2.1 * D2R, 0, 8, MAX)).toBe(false);
  });

  it('clamps at the maximum, wraps the yaw across ±π, and is 0 with the lever off', () => {
    const t = new TurnBand();
    t.step(0, 0, 8, MAX); t.step(20 * D2R, 0, 8, MAX);
    expect(t.yaw).toBe(MAX);
    const w = new TurnBand();
    w.step(Math.PI - 0.5 * D2R, 0, 8, MAX); w.step(-Math.PI + 0.5 * D2R, 0, 8, MAX);
    expect(w.yaw).toBeCloseTo(8 * D2R, 9);
    const off = new TurnBand();
    off.step(0, 0, 0, MAX); off.step(5 * D2R, 0, 0, MAX);
    expect(off.yaw).toBe(0);
  });

  it('reset() forgets the last camera and the band', () => {
    const t = new TurnBand();
    t.step(0, 0, 8, MAX); t.step(D2R, 0, 8, MAX);
    t.reset();
    expect([t.yaw, t.step(1, 0, 8, MAX), t.yaw]).toEqual([0, false, 0]);
  });
});

describe('cull: the fixed margins (items past the ring, and the cullTune lever)', () => {
  it('sides at margin × W, the caller\'s top and bottom bands, the depth range', () => {
    const p = cam({}), W = 1000, H = 600;
    const c = updateCull(newCull(), makeBasis(p, 0, 0, W, H), p, W, H, LV, null);
    expect([legacyShow(c, -750, 0, 100, 450, 1200), legacyShow(c, -751, 0, 100, 450, 1200)]).toEqual([true, false]);
    expect([legacyShow(c, 1750, 0, 100, 450, 1200), legacyShow(c, 1751, 0, 100, 450, 1200)]).toEqual([true, false]);
    expect([legacyShow(c, 0, -450, 100, 450, 1200), legacyShow(c, 0, -451, 100, 450, 1200)]).toEqual([true, false]);
    expect([legacyShow(c, 0, 1800, 100, 450, 1200), legacyShow(c, 0, 1801, 100, 450, 1200)]).toEqual([true, false]);
    expect(legacyShow(c, 0, 0, 39, 450, 1200)).toBe(false);
  });
});
