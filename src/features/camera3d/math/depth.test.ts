import { describe, expect, it } from 'vitest';
import { AREA_MARK_Z, BUILDING_DECAL_Z, GROUND_DECOR_Z, MARKER_Z, SCRIM_Z, depthKey, quantizeYaw, sortYOf, stickyQuantize, tiebreakOf } from './depth';

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

  it('stickyQuantize holds the key until the value moves a full step', () => {
    expect(stickyQuantize(undefined, 100)).toBe(96);
    expect(stickyQuantize(96, 120)).toBe(96);
    expect(stickyQuantize(96, 128)).toBe(128);
  });
});
