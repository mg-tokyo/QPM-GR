import { describe, expect, it } from 'vitest';
import { makeBasis, project, type CamParams } from '../math/camera';
import type { DrawnSideWall } from '../scene/sideDecor';
import type { Node3 } from '../types';
import type { Texel } from './alphaProbe';
import { WALL_PICK_TILT, panelTexel, sideWallHits, wallHitAt } from './wallPick';

const D = Math.PI / 180;
const W = 1280, H = 656;
const params = (yaw: number): CamParams => ({ yaw, pitch: 24 * D, dist: 800, fov: 55 * D, lookH: 120, yOff: 0.12, near: 40, far: 31000 });
// The live test pose: yaw 90 looks east at the arch on tile (39, 39) (centre 10112, 10112), its wall on the N-S line.
const cam = makeBasis(params(90 * D), 10112, 10240, W, H);
const tex = { uvs: { x0: 0, y0: 0, x1: 1, y1: 0, x2: 1, y2: 1, x3: 0, y3: 1 }, source: { width: 296, height: 307, style: {} } };
const wall = (over: Partial<DrawnSideWall> = {}): DrawnSideWall =>
  ({ node: {} as Node3, mesh: {} as Node3, ax: 10112, az: 9964, bx: 10112, bz: 10260, h: 307, tex, ...over }) as DrawnSideWall;
const screenOf = (x: number, y: number, z: number): [number, number] => { const o = [0, 0, 0]; project(cam, x, y, z, o); return [o[0]!, o[1]!]; };
const foot = { x: 10112, y: 10112 };

describe('wallHitAt', () => {
  it('finds where the cursor meets the wall: u along A→B, v from its top, and the matching point on the 2D card', () => {
    const [sx, sy] = screenOf(10112, 0.6 * 307, 9964 + 0.25 * 296);
    const hit = wallHitAt(cam, sx, sy, wall(), foot)!;
    expect(hit.u).toBeCloseTo(0.25, 4);
    expect(hit.v).toBeCloseTo(0.4, 4);
    // The same height above the ground on the card standing at its tile: the 2D sprite point a card hit would give.
    expect(hit.sprite.x).toBe(10112);
    expect(hit.sprite.y).toBeCloseTo(10112 - 0.6 * 307, 3);
    expect(hit.depth).toBeGreaterThan(0);
  });

  it('misses past either end, above the top and below the ground', () => {
    expect(wallHitAt(cam, ...screenOf(10112, 100, 9964 - 20), wall(), foot)).toBeNull();
    expect(wallHitAt(cam, ...screenOf(10112, 100, 10260 + 20), wall(), foot)).toBeNull();
    expect(wallHitAt(cam, ...screenOf(10112, 330, 10100), wall(), foot)).toBeNull();
    expect(wallHitAt(cam, ...screenOf(10112, 0, 10100).map((v, i) => (i ? v + 30 : v)) as [number, number], wall(), foot)).toBeNull();
  });

  it('misses a wall behind the camera and one seen exactly end-on', () => {
    // The camera stands at x ≈ 9381: this wall is behind it, tall and wide enough that the backward ray would cross it.
    const behind = wall({ ax: 9000, bx: 9000, az: 9000, bz: 11500, h: 5000 });
    expect(wallHitAt(cam, W / 2, H / 2, behind, foot)).toBeNull();
    // Yaw 0 looks north along the N-S line: the ray never crosses the wall's plane.
    const endOn = makeBasis(params(0), 10112, 10600, W, H);
    expect(wallHitAt(endOn, W / 2, H / 2, wall(), foot)).toBeNull();
  });
});

describe('panelTexel', () => {
  it('maps (u, v) through the panel texture uvs to an atlas pixel, as a card leaf texel is read', () => {
    const t = { uvs: { x0: 0.25, y0: 0.5, x1: 0.75, y1: 0.5, x2: 0.75, y2: 1, x3: 0.25, y3: 1 }, source: { width: 400, height: 200, style: {} } };
    const out: Texel = { source: { style: null }, x: -1, y: -1 };
    expect(panelTexel(t, 0.5, 0.5, out)).toBe(true);
    expect(out).toEqual({ source: t.source, x: 200, y: 150 });
    panelTexel(t, 0.9999, 0.9999, out);
    expect([out.x, out.y]).toEqual([299, 199]);
  });

  it('a panel without uvs or a sized source has nothing to sample', () => {
    const out: Texel = { source: { style: null }, x: 0, y: 0 };
    expect(panelTexel({ source: { style: {} } }, 0.5, 0.5, out)).toBe(false);
  });
});

describe('sideWallHits', () => {
  const a = wall({ node: { label: 'Tile (39, 39)' } as Node3 });
  const b = wall({ node: { label: 'Tile (39, 42)' } as Node3, az: 10732, bz: 11028 });
  const posOf = (n: Node3): { x: number; y: number } => (n === a.node ? foot : { x: 10112, y: 10880 });
  const [sx, sy] = screenOf(10112, 200, 10000);

  it('below WALL_PICK_TILT the cards take taps (the more visible half of the crossfade): no wall, no card skipped', () => {
    const r = sideWallHits(cam, WALL_PICK_TILT - 0.01, sx, sy, [a, b], posOf);
    expect(r.hits).toEqual([]);
    expect(r.cards.size).toBe(0);
  });

  it('from WALL_PICK_TILT up: the wall under the cursor hits at its own tile view, and every drawn wall\'s card is skipped', () => {
    const r = sideWallHits(cam, WALL_PICK_TILT, sx, sy, [a, b], posOf);
    expect(r.hits.map((h) => h.wall)).toEqual([a]);
    expect(r.hits[0]!.sprite).toEqual({ x: 10112, y: expect.closeTo(10112 - 200, 3) as unknown as number });
    expect([...r.cards]).toEqual([a.node, b.node]);
  });
});
