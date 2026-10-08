import { describe, expect, it } from 'vitest';
import {
  AREA_MARK_Z, BASE_LAYER, BUILDING_DECAL_Z, FOREMOST_Z, GROUND_DECOR_Z, MARKER_Z, SCRIM_Z, bandOf, depthKey, depthKeyAlong, layerOf, quantizeAlong,
  buildingShift, checkDepthKeys, quantizeYaw, sortYOf, tiebreakOf, tiltedTiebreak, wallBetween,
} from './depth';

describe('checkDepthKeys (A V8: the zIndex encoding drift alarm)', () => {
  // Live 1419 shape: tiles and pets sort at their own y (layer digit 1/3), avatars 192 px below, buildings at the origin.
  const live = (n: number, scale = 1e4): Array<{ x: number; y: number; zIndex: number }> => {
    const out: Array<{ x: number; y: number; zIndex: number }> = [];
    for (let i = 0; i < n; i++) { const y = 2560 + 256 * i; out.push({ x: 128, y, zIndex: y * scale + (i % 2 ? 1 : 3) + 0.25 }); }
    out.push({ x: 640, y: 3000, zIndex: (3000 + 192) * scale + 6 });
    out.push({ x: 0, y: 0, zIndex: 7800 * scale });
    return out;
  };

  it('the live encoding passes; buildings at the origin and the world overlay are not samples', () => {
    expect(checkDepthKeys([...live(40), { x: 5, y: 9, zIndex: 1e12 }])).toEqual({ samples: 41, ok: 41, verdict: 'ok' });
  });

  it('the airborne foremost band is read past its 9e11 offset', () => {
    expect(checkDepthKeys([...live(30), { x: 1, y: 4000, zIndex: FOREMOST_Z + 4000e4 + 6 }]).ok).toBe(32);
  });

  it('a changed scale or a plain y zIndex is drift', () => {
    expect(checkDepthKeys(live(40, 1e3)).verdict).toBe('drift');
    expect(checkDepthKeys(live(40, 1e5)).verdict).toBe('drift');
    expect(checkDepthKeys(live(40).map((n) => ({ ...n, zIndex: n.y }))).verdict).toBe('drift');
  });

  it('a nearly empty World proves nothing', () => {
    expect(checkDepthKeys(live(5, 1e3)).verdict).toBe('unknown');
  });
});

// Live samples 2026-10-02 (build 1370): [game zIndex, node y].
const SAMPLES: Array<[number, number]> = [
  [83200002, 8088],              // AvatarContainer: ground 232 px below its origin
  [90880001.13586937, 9088],     // Tile (44, 35)
  [90880001.18132815, 9088],     // Tile (42, 35)
  [40704007, 4070],              // Pet
  [80513905, 8480],              // Building (23: seedShop) sort line
];

describe('depth', () => {
  it('sortYOf decodes the game sort y and keeps small literal zIndex nodes on their own y', () => {
    expect(sortYOf(83200002, 8088)).toBeCloseTo(8320.0002, 6);
    expect(sortYOf(90880001.13586937, 9088)).toBeCloseTo(9088.0001, 6);
    expect(sortYOf(10, 6272)).toBe(6272);
  });

  it('at yaw 0 the depth key equals the game zIndex, so the s = 0 order is the 2D order', () => {
    for (const [gz, y] of SAMPLES) {
      expect(depthKey(123, sortYOf(gz, y), Math.sin(0), -Math.cos(0), tiebreakOf(gz))).toBeCloseTo(gz, 3);
    }
    const byGame = [...SAMPLES].sort((a, b) => a[0] - b[0]).map((s) => s[0]);
    const byKey = [...SAMPLES].sort((a, b) => depthKey(0, sortYOf(a[0], a[1]), 0, -1, tiebreakOf(a[0])) - depthKey(0, sortYOf(b[0], b[1]), 0, -1, tiebreakOf(b[0]))).map((s) => s[0]);
    expect(byKey).toEqual(byGame);
  });

  it('an airborne rider and its mount (foremost band) decode to their ground row; the band alone keeps the 2D order', () => {
    // Live 2026-10-04, mounted Phoenix: [zIndex, y] of the AvatarContainer and the Pet.
    const rider: [number, number] = [900062720006, 5863.4];
    const mount: [number, number] = [900062720007, 6372.6];
    expect(sortYOf(...rider)).toBeCloseTo(6272.0006, 4);
    expect(sortYOf(...mount)).toBeCloseTo(6272.0007, 4);
    expect(bandOf(rider[0])).toBe(FOREMOST_Z);
    expect(bandOf(83200002)).toBe(0);
    for (const [gz, y] of [rider, mount]) {
      expect(depthKey(0, sortYOf(gz, y), 0, -1, tiebreakOf(gz) + bandOf(gz))).toBeCloseTo(gz, 3);
    }
    const southmost = Math.max(...SAMPLES.map(([gz, y]) => depthKey(0, sortYOf(gz, y), 0, -1, tiebreakOf(gz))));
    expect(depthKey(0, sortYOf(...rider), 0, -1, bandOf(rider[0]))).toBeGreaterThan(southmost);
  });

  it('flat bands keep the 2D order: ground decor < layer markers < area marks < weather scrim < building decals < every entity', () => {
    const maxY = 60 * 256 + 2000;
    expect(GROUND_DECOR_Z + maxY).toBeLessThan(MARKER_Z);
    expect(MARKER_Z + maxY).toBeLessThan(AREA_MARK_Z);
    expect(AREA_MARK_Z).toBeLessThan(SCRIM_Z);
    expect(SCRIM_Z).toBeLessThan(BUILDING_DECAL_Z);
    expect(BUILDING_DECAL_Z + maxY).toBeLessThan(depthKey(25856, 15360, 0, 1, 0));
  });

  it('quantizeYaw snaps to the step and passes through with step 0', () => {
    const D = Math.PI / 180;
    expect(quantizeYaw(22 * D, 15 * D)).toBeCloseTo(15 * D, 9);
    expect(quantizeYaw(23 * D, 15 * D)).toBeCloseTo(30 * D, 9);
    expect(quantizeYaw(23 * D, 0)).toBe(23 * D);
  });

  it('depthKeyAlong is depthKey on the projected scalar gx·dx + gy·dz', () => {
    const [dx, dz] = [Math.sin(0.7), -Math.cos(0.7)];
    expect(depthKeyAlong(5000 * dx + 4000 * dz, 0.25)).toBeCloseTo(depthKey(5000, 4000, dx, dz, 0.25), 6);
  });

  it('quantizeAlong is stateless: the same scalar always lands in the same 32 px step, whichever way it came', () => {
    expect(quantizeAlong(100)).toBe(96);
    expect(quantizeAlong(111.9)).toBe(96);
    expect(quantizeAlong(112)).toBe(128);
    expect(quantizeAlong(-100)).toBe(-96);
  });

  // Live 2026-10-05 (v1419): a StoneBench tile (Base decor, body-bottom .1715) and the avatar standing on it.
  it('tilted ties keep the game layer: avatar over ground decor, an occluding object over the avatar, all under 1', () => {
    const bench = 34560001.1715229, avatar = 34560002, plant = 34560003.12628176, pet = 34560007;
    const tb = (gz: number): number => tiltedTiebreak(gz, sortYOf(gz, 0));
    expect(tb(avatar)).toBeGreaterThan(tb(bench));
    expect(tb(plant)).toBeGreaterThan(tb(avatar));
    expect(tb(pet)).toBeGreaterThan(tb(plant));
    for (const gz of [bench, avatar, plant, pet]) expect(tb(gz)).toBeLessThan(1);
    expect(layerOf(sortYOf(bench, 0))).toBe(BASE_LAYER);
  });

  // Live 2026-10-05: NpcVisitSummons (a world-overlay node, small literal zIndex) re-keyed every frame as its y animated.
  it('a node without a sort key gets no layer tiebreak, so its key does not follow its own y', () => {
    for (const y of [5120.31, 5121.77, 5123.04]) expect(tiltedTiebreak(10, sortYOf(10, y))).toBe(0);
  });
});

// Live 2026-10-05 (v1419): avatar on the seed-shop mat (41,32), the shop's art x-range on its sort line.
describe('wallBetween', () => {
  const P = { x: 10624, y: 8320 };
  const wall = [10239.7, 11007.7, 8051.39] as const;
  const camAt = (yawDeg: number, d = 1200) => ({ x: P.x - d * Math.sin(yawDeg * Math.PI / 180), y: P.y + d * Math.cos(yawDeg * Math.PI / 180) });
  const between = (yawDeg: number) => { const c = camAt(yawDeg); return wallBetween(P.x, P.y, c.x, c.y, ...wall); };

  it('is false while the camera is on the mat side of the wall (yaw 0 to 90)', () => {
    expect(between(0)).toBe(false);
    expect(between(90)).toBe(false);
  });
  it('is false while the line to the camera passes beside the wall (yaw 120, 240)', () => {
    expect(between(120)).toBe(false);
    expect(between(240)).toBe(false);
  });
  it('is true once the wall stands between the feet and the camera (yaw 150, 180)', () => {
    expect(between(150)).toBe(true);
    expect(between(180)).toBe(true);
  });
  it('matches the 2D sort rule straight from the south: behind the sort line within the width', () => {
    expect(wallBetween(10624, 7808, 10624, 9008, ...wall)).toBe(true);
    expect(wallBetween(11200, 7808, 11200, 9008, ...wall)).toBe(false);
  });
  it('a point on the wall line is not behind it', () => {
    expect(wallBetween(10624, 8051.39, 10624, 7000, ...wall)).toBe(false);
  });
});

// Keys on one 32 px depth step share the integer part; the fraction is the layer tiebreak (avatar .2, mount .6, pet .7).
describe('buildingShift', () => {
  it('moves a covering building that is not between avatar and camera under the avatar\'s whole step', () => {
    const s = buildingShift(-106237000, -106237000, -106239999.8, false);
    expect(-106237000 + s).toBeLessThan(-106240000);
    expect(-106237000 + s).toBeGreaterThan(-106240001);
  });
  it('moves a building that stands between them over the avatar\'s whole step, keeping its pieces in order', () => {
    const s = buildingShift(-12000, -11000, -9000.7, true);
    expect(-12000 + s).toBe(-9000);
    expect(-11000 + s).toBeGreaterThan(-12000 + s);
  });
  it('a building already on the avatar\'s step moves off it', () => {
    expect(-9000.9 + buildingShift(-9000.9, -9000.9, -9000.7, true)).toBe(-9000);
    expect(-9000.9 + buildingShift(-9000.9, -9000.9, -9000.7, false)).toBeLessThan(-9001);
  });
  it('leaves an order that already agrees', () => {
    expect(buildingShift(-5000, -5000, -9000.7, true)).toBe(0);
    expect(buildingShift(-12000, -12000, -9000.7, false)).toBe(0);
  });
});
