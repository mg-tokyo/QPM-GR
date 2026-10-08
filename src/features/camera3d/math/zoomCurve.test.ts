import { describe, expect, it } from 'vitest';
import { makeBasis, project } from './camera';
import {
  CURVE_KEYS, FIRST_PERSON, NEAR_PLANE, S_LAST_THIRD, curveAt, distForScale, farPlaneFor, lookScale, pchipSlopes, pitchRange, tiltOf, viewForS, wrapDeg,
  type CurveKey,
} from './zoomCurve';

// The live movement map (1419: 101 × 60 tiles).
const FAR = farPlaneFor(101, 60);

describe('farPlaneFor (A V8: derived from the movement map)', () => {
  it('clears the map diagonal with slack, as the old fixed 31,000 did for 101 × 60', () => {
    expect(FAR).toBeGreaterThan(Math.hypot(101, 60) * 256);
    expect(Math.abs(FAR - 31000)).toBeLessThan(256);
    expect(farPlaneFor(202, 120)).toBeGreaterThan(2 * Math.hypot(101, 60) * 256);
  });

  it('every view carries the far plane it was given', () => {
    const i = { W: 1280, H: 720, k: 1.5, viewCentre: { x: 0, y: 0 }, ground: { x: 0, y: 0 }, userYawDeg: 0, userPitchDeg: 0, fovDeg: 70, far: 12345 };
    for (const s of [0, 0.3, 0.95, 1]) expect(viewForS({ ...i, s }).params.far).toBe(12345);
  });
});

describe('wrapDeg', () => {
  it('wraps into [-180, 180)', () => {
    expect([wrapDeg(0), wrapDeg(190), wrapDeg(-190), wrapDeg(540), wrapDeg(180), wrapDeg(-180)]).toEqual([0, -170, 170, -180, -180, -180]);
  });
});

type Channel = (k: CurveKey) => number;
// literal-list-justified: the CurveKey channels under test, not game data
const CHANNELS: ReadonlyArray<[string, Channel]> = [
  ['pitch', (k) => k.pitch], ['fov', (k) => k.fov], ['lnM', (k) => Math.log(k.m)], ['lookH', (k) => k.lookH],
  ['yOff', (k) => k.yOff], ['follow', (k) => k.follow], ['orbit', (k) => k.orbit],
];

describe('zoom curve', () => {
  it('s = 0 is the first key exactly and s >= 1 is first person', () => {
    expect(curveAt(0)).toMatchObject({ pitch: 90, fov: 20, m: 1, lookH: 0, yOff: 0, follow: 0, orbit: 0 });
    expect(curveAt(1)).toBeNull();
  });

  it('pitch never increases along s', () => {
    let last = Infinity;
    for (let s = 0; s < 1; s += 0.001) {
      const k = curveAt(s)!;
      expect(k.pitch).toBeLessThanOrEqual(last + 1e-9);
      last = k.pitch;
    }
  });

  it('hits every key at its own s, for every channel', () => {
    for (const key of CURVE_KEYS) {
      const k = curveAt(key.s)!;
      for (const [, f] of CHANNELS) expect(f(k)).toBeCloseTo(f(key), 9);
    }
  });

  it('first derivative is continuous at every key (A S5)', () => {
    const eps = 1e-6;
    for (const key of CURVE_KEYS.slice(1, -1)) {
      for (const [name, f] of CHANNELS) {
        const l = (f(curveAt(key.s)!) - f(curveAt(key.s - eps)!)) / eps;
        const r = (f(curveAt(key.s + eps)!) - f(curveAt(key.s)!)) / eps;
        expect({ name, s: key.s, jump: Math.abs(l - r) < 0.05 + 1e-3 * Math.abs(l) }).toEqual({ name, s: key.s, jump: true });
      }
    }
  });

  it('never overshoots its keys: pitch ≤ 90, follow and orbit within [0, 1], each segment within its end values', () => {
    for (let i = 0; i + 1 < CURVE_KEYS.length; i++) {
      const a = CURVE_KEYS[i]!, b = CURVE_KEYS[i + 1]!;
      for (let s = a.s; s <= b.s; s += (b.s - a.s) / 50) {
        const k = curveAt(s)!;
        for (const [, f] of CHANNELS) {
          expect(f(k)).toBeGreaterThanOrEqual(Math.min(f(a), f(b)) - 1e-9);
          expect(f(k)).toBeLessThanOrEqual(Math.max(f(a), f(b)) + 1e-9);
        }
      }
    }
  });

  it('pchipSlopes is zero at a local extremum and keeps the sign of the data', () => {
    const m = pchipSlopes([0, 1, 2, 3], [0, 1, 0, 2]);
    expect(m[1]).toBe(0);
    expect(m[2]).toBe(0);
    expect(m[0]).toBeGreaterThan(0);
    expect(m[3]).toBeGreaterThan(0);
  });

  it('fills a caller-owned key without allocating a new one', () => {
    const out: CurveKey = { ...CURVE_KEYS[0]! };
    expect(curveAt(0.4, out)).toBe(out);
    expect(out.s).toBe(0.4);
    expect(curveAt(1, out)).toBeNull();
  });

  it('distForScale gives fpx/k straight down with no look height', () => {
    expect(distForScale(1000, 2, 1, 0, Math.PI / 2)).toBeCloseTo(500, 9);
  });

  it('viewForS(0) reproduces the 2D view (scale k about the view centre), with no yaw even if the user turned', () => {
    const W = 1280, H = 720, k = 1.5, vc = { x: 6000, y: 5000 };
    for (const userYawDeg of [120, -120, 250]) {
      const v = viewForS({ s: 0, W, H, k, viewCentre: vc, ground: { x: 6100, y: 5100 }, userYawDeg, userPitchDeg: -20, fovDeg: 70, far: FAR });
      expect(v.params.yaw).toBe(0);
      expect(v.params.pitch).toBe(Math.PI / 2);
      expect(v.target).toEqual(vc);
      const b = makeBasis(v.params, v.target.x, v.target.y, W, H);
      const out = [0, 0, 0];
      project(b, 6200, 0, 4900, out);
      expect(out[0]).toBeCloseTo(W / 2 + k * 200, 4);
      expect(out[1]).toBeCloseTo(H / 2 - k * 100, 4);
    }
  });

  it('third-person yaw is the user yaw scaled by orbit, then wrapped (no ±180 jump below orbit 1, A T7)', () => {
    const base = { W: 1280, H: 720, k: 1.5, viewCentre: { x: 0, y: 0 }, ground: { x: 0, y: 0 }, userPitchDeg: 0, fovDeg: 70, far: FAR };
    const s = 0.12;
    const orbit = curveAt(s)!.orbit;
    const a = viewForS({ ...base, s, userYawDeg: 179 }).params.yaw * 180 / Math.PI;
    const b = viewForS({ ...base, s, userYawDeg: 181 }).params.yaw * 180 / Math.PI;
    expect(b - a).toBeCloseTo(2 * orbit, 6);
    const full = viewForS({ ...base, s: 0.5, userYawDeg: 190 }).params.yaw * 180 / Math.PI;
    expect(full).toBeCloseTo(-170, 6);
  });

  it('first person hides the avatar, follows the ground point and clamps pitch to the spec range', () => {
    const v = viewForS({ s: 1, W: 1280, H: 720, k: 1.5, viewCentre: { x: 0, y: 0 }, ground: { x: 10, y: 20 }, userYawDeg: 90, userPitchDeg: 200, fovDeg: 70, far: FAR });
    expect(v.hideSelf).toBe(true);
    expect([v.selfAlpha, v.hand]).toEqual([0, 1]);
    expect(v.target).toEqual({ x: 10, y: 20 });
    expect(v.params.pitch).toBeCloseTo(80 * Math.PI / 180, 9);
  });

  it('the camera rises with the avatar height (bench, saddle) as far as it follows the avatar; s = 0 is untouched', () => {
    const base = { W: 1280, H: 720, k: 1.5, viewCentre: { x: 6000, y: 5000 }, ground: { x: 6100, y: 5100 }, userYawDeg: 30, userPitchDeg: 0, fovDeg: 70, far: FAR };
    for (const s of [0, 0.05, 0.3, 0.6, 0.95, 1]) {
      const flat = viewForS({ ...base, s }), up = viewForS({ ...base, s, groundH: 46.08 });
      const follow = s >= 1 || s > S_LAST_THIRD ? 1 : curveAt(s)!.follow;
      expect(up.params.lookH - flat.params.lookH).toBeCloseTo(46.08 * follow, 9);
      expect(up.params.dist).toBe(flat.params.dist);
      expect(up.target).toEqual(flat.target);
    }
    expect(viewForS({ ...base, s: 0, groundH: 300 })).toEqual(viewForS({ ...base, s: 0 }));
  });
});

// Every band property holds at both ends of the FOV slider too (P8).
describe.each([50, 70, 100])('first-person push-in band at %i° (A T4, S6; P2 a)', (fovDeg) => {
  const D = 180 / Math.PI;
  const base = { W: 1280, H: 656, k: 1.5, viewCentre: { x: 6000, y: 6000 }, ground: { x: 6000, y: 6200 }, userYawDeg: 30, fovDeg, far: FAR };
  const at = (s: number, userPitchDeg = 0, H = 656) => viewForS({ ...base, H, s, userPitchDeg });
  type P = keyof ReturnType<typeof at>['params'];
  // literal-list-justified: the camera parameters under test, not game data
  const PARAMS: readonly P[] = ['pitch', 'fov', 'dist', 'lookH', 'yOff', 'near', 'yaw'];
  const camPos = (s: number, up = 0) => { const v = at(s, up); return makeBasis(v.params, v.target.x, v.target.y, base.W, 656).C; };

  it('meets the third-person curve at 0.92 and the eye at 1, for any look pitch and window height', () => {
    for (const up of [-60, -10, 0, 25, 70]) {
      for (const H of [303, 656, 1080]) {
        const tp = at(S_LAST_THIRD, up, H), lo = at(S_LAST_THIRD + 1e-9, up, H), hi = at(1 - 1e-9, up, H), fp = at(1, up, H);
        for (const p of PARAMS) {
          expect(Math.abs(lo.params[p] - tp.params[p])).toBeLessThan(1e-5 * Math.max(1, Math.abs(tp.params[p])));
          expect(Math.abs(hi.params[p] - fp.params[p])).toBeLessThan(1e-5 * Math.max(1, Math.abs(fp.params[p])));
        }
        expect(lo.selfAlpha).toBeCloseTo(1, 9);
        expect(lo.hand).toBe(0);
        expect(hi.selfAlpha).toBe(0);
        expect(hi.hand).toBeCloseTo(1, 6);
      }
    }
  });

  it('leaves the curve with its own rates: pitch, fov, eye height and distance are C1 at 0.92', () => {
    const eps = 1e-5, s = S_LAST_THIRD;
    for (const p of ['pitch', 'fov', 'lookH', 'dist'] as const) {
      const l = (at(s).params[p] - at(s - eps).params[p]) / eps;
      const r = (at(s + eps).params[p] - at(s).params[p]) / eps;
      expect({ p, ok: Math.abs(l - r) <= 0.02 * Math.max(1, Math.abs(l)) }).toEqual({ p, ok: true });
    }
  });

  it('the camera moves steadily forward through the head: no per-step jump in position, pitch or fov', () => {
    const n = 400;
    let maxStep = 0, maxPitch = 0, maxFov = 0;
    for (let i = 0; i < n; i++) {
      const s0 = S_LAST_THIRD - 0.02 + (0.1 * i) / n, s1 = S_LAST_THIRD - 0.02 + (0.1 * (i + 1)) / n;
      const a = camPos(s0), b = camPos(s1);
      maxStep = Math.max(maxStep, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      maxPitch = Math.max(maxPitch, Math.abs(at(s1).params.pitch - at(s0).params.pitch) * D);
      maxFov = Math.max(maxFov, Math.abs(at(s1).params.fov - at(s0).params.fov) * D);
    }
    // 400 steps over the band and a bit: the whole move is ~100 px, ~10° pitch and 6° fov.
    expect(maxStep).toBeLessThan(1);
    expect(maxPitch).toBeLessThan(0.12);
    expect(maxFov).toBeLessThan(0.06);
  });

  it('pitch, distance and the lens fraction are monotone across the band', () => {
    let lastPitch = Infinity, lastDist = Infinity, lastAlpha = 2, lastHand = -1;
    for (let s = S_LAST_THIRD; s <= 1; s += 0.0005) {
      const v = at(s);
      expect(v.params.pitch).toBeLessThanOrEqual(lastPitch + 1e-12);
      expect(v.params.dist).toBeLessThanOrEqual(lastDist + 1e-9);
      expect(v.selfAlpha).toBeLessThanOrEqual(lastAlpha + 1e-12);
      expect(v.hand).toBeGreaterThanOrEqual(lastHand - 1e-12);
      lastPitch = v.params.pitch; lastDist = v.params.dist; lastAlpha = v.selfAlpha; lastHand = v.hand;
    }
  });

  it('the body is gone before the held item rises, and the item lowers before the body returns', () => {
    for (const H of [303, 656, 1080]) {
      for (let s = S_LAST_THIRD; s < 1; s += 0.0005) {
        const v = at(s, 0, H);
        if (v.hand > 0) expect(v.selfAlpha).toBe(0);
        expect(v.hideSelf).toBe(v.hand > 0);
      }
    }
  });

  it('the body is faded out before the near plane would clip it, even in a 303 px Discord panel', () => {
    for (const H of [303, 656, 1080]) {
      for (let s = S_LAST_THIRD; s < 1; s += 0.0005) {
        const v = at(s, 0, H);
        const b = makeBasis(v.params, v.target.x, v.target.y, base.W, H);
        const out = [0, 0, 0];
        project(b, base.ground.x, 0, base.ground.y, out);
        if (out[2]! < v.params.near * 1.1) expect(v.selfAlpha).toBe(0);
      }
    }
  });
});

describe('pitch range (P5 a)', () => {
  it('pitchRange is the visible range on both sides and blends continuously in the band', () => {
    const r = { base: 0, lo: 0, hi: 0, orbit: 0 };
    const k: CurveKey = { ...CURVE_KEYS[0]! };
    expect(pitchRange(S_LAST_THIRD, r, k)).toMatchObject({ base: 12, lo: 2, hi: 90, orbit: 1 });
    expect(pitchRange(1, r, k)).toMatchObject({ base: 2, lo: -60, hi: 80, orbit: 1 });
    let last = { ...pitchRange(S_LAST_THIRD, r, k) };
    for (let s = S_LAST_THIRD; s <= 1; s += 0.0005) {
      const c = pitchRange(s, r, k);
      expect(Math.abs(c.base - last.base) + Math.abs(c.lo - last.lo) + Math.abs(c.hi - last.hi)).toBeLessThan(1);
      last = { ...c };
    }
  });
});

describe('field of view setting (P8)', () => {
  const D = 180 / Math.PI;
  const FOVS = [50, 60, 70, 85, 100];
  const base = { W: 1280, k: 1.5, viewCentre: { x: 6000, y: 6000 }, ground: { x: 6000, y: 6200 }, userYawDeg: 30, userPitchDeg: 0, far: FAR };
  const at = (s: number, fovDeg: number, H = 656) => viewForS({ ...base, H, s, fovDeg });
  const feetDepth = (s: number, fovDeg: number, H: number): { cz: number; fpx: number; near: number } => {
    const v = at(s, fovDeg, H);
    const b = makeBasis(v.params, v.target.x, v.target.y, base.W, H);
    const out = [0, 0, 0];
    project(b, base.ground.x, 0, base.ground.y, out);
    return { cz: out[2]!, fpx: b.fpx, near: v.params.near };
  };

  it('s = 0 is identical at every FOV, so the 2D handoff never moves', () => {
    const ref = at(0, 70);
    for (const f of FOVS) expect(at(0, f)).toEqual(ref);
  });

  it('the default is today\'s view: unshifted keys, first person at 70°, near planes 40 and 20', () => {
    for (const key of CURVE_KEYS) {
      const v = at(key.s, FIRST_PERSON.fov);
      expect(v.params.fov * D).toBeCloseTo(key.fov, 9);
      expect(v.params.near).toBe(NEAR_PLANE);
    }
    expect(at(1, FIRST_PERSON.fov).params.fov * D).toBeCloseTo(70, 9);
    expect(at(1, FIRST_PERSON.fov).params.near).toBe(FIRST_PERSON.near);
  });

  it('first person uses the setting; third person shifts by (fov − 70)·orbit', () => {
    for (const f of FOVS) {
      expect(at(1, f).params.fov * D).toBeCloseTo(f, 9);
      for (const s of [0.03, 0.09, 0.14, 0.3, 0.6, S_LAST_THIRD]) {
        const k = curveAt(s)!;
        expect(at(s, f).params.fov * D).toBeCloseTo(k.fov + (f - 70) * k.orbit, 9);
      }
    }
  });

  it('your avatar keeps its on-screen size at every FOV (a dolly zoom): the feet stay at scale k·m', () => {
    for (const s of [0.18, 0.4, 0.6, S_LAST_THIRD]) {
      const m = curveAt(s)!.m;
      for (const f of FOVS) {
        const { cz, fpx } = feetDepth(s, f, 656);
        expect(fpx / cz).toBeCloseTo(base.k * m, 6);
      }
    }
  });

  it('the near plane keeps its on-screen meaning: feet depth over near is the same at every FOV, in any window', () => {
    for (const H of [303, 656, 1080]) {
      for (const s of [0.09, 0.18, 0.6, S_LAST_THIRD]) {
        const ref = feetDepth(s, 70, H);
        for (const f of FOVS) {
          const d = feetDepth(s, f, H);
          expect(d.cz / d.near).toBeCloseTo(ref.cz / ref.near, 6);
        }
      }
    }
  });

  it('look speed follows the lens: a drag moves the picture as far on screen at any FOV, and 70 is unchanged', () => {
    const k: CurveKey = { ...CURVE_KEYS[0]! };
    for (const f of FOVS) {
      for (const s of [0.05, 0.12, 0.18, 0.5, S_LAST_THIRD, 0.95, 0.99, 1]) {
        const want = Math.tan(at(s, f).params.fov / 2) / Math.tan(at(s, 70).params.fov / 2);
        expect(lookScale(s, f, k)).toBeCloseTo(want, 9);
      }
    }
    for (const s of [0.05, 0.5, 0.95, 1]) expect(lookScale(s, 70, k)).toBe(1);
  });

  it('the rendered FOV is continuous along s at both ends of the slider (no jump entering first person)', () => {
    for (const f of [50, 100]) {
      let last = at(0, f).params.fov;
      for (let s = 0.001; s <= 1; s += 0.001) {
        const now = at(Math.min(1, s), f).params.fov;
        expect(Math.abs(now - last) * D).toBeLessThan(0.5);
        last = now;
      }
      expect(Math.abs(at(1, f).params.fov - last) * D).toBeLessThan(0.5);
    }
  });
});

describe('tilt: how far the view has left the 2D match, by s alone (polish Task 11, A V2)', () => {
  const base = { W: 1280, H: 656, k: 1.5, viewCentre: { x: 6000, y: 6000 }, ground: { x: 6000, y: 6200 }, userYawDeg: 30, fovDeg: 70, far: FAR };
  const at = (s: number, userPitchDeg = 0) => viewForS({ ...base, s, userPitchDeg });

  it('tiltOf ramps from 0 at the curve\'s 80° to 1 at its 60°', () => {
    expect(tiltOf(90)).toBe(0);
    expect(tiltOf(80)).toBe(0);
    expect(tiltOf(70)).toBeCloseTo(0.5, 9);
    expect(tiltOf(60)).toBe(1);
    expect(tiltOf(2)).toBe(1);
  });

  it('is exactly 0 at s = 0 whatever the look offset, and follows the curve pitch on the way in', () => {
    for (const up of [-80, 0, 80]) expect(at(0, up).tilt).toBe(0);
    for (const s of [0.01, 0.03, 0.05, 0.08, 0.12]) expect(at(s).tilt).toBeCloseTo(tiltOf(curveAt(s)!.pitch), 12);
    let last = 0;
    for (let s = 0; s <= 1; s += 0.001) { const t = at(Math.min(1, s)).tilt; expect(t).toBeGreaterThanOrEqual(last - 1e-12); last = t; }
  });

  it('free-look never brings it back: third person looking straight down and first person looking down stay fully tilted', () => {
    const tpDown = at(0.6, 90);
    expect(tpDown.params.pitch).toBeCloseTo(Math.PI / 2, 9);
    expect(tpDown.tilt).toBe(1);
    const fpDown = at(1, 90);
    expect(fpDown.params.pitch).toBeCloseTo(80 * Math.PI / 180, 9);
    expect(fpDown.tilt).toBe(1);
    expect(at(0.96, 90).tilt).toBe(1);
  });
});
