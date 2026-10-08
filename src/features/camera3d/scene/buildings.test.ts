import { describe, expect, it } from 'vitest';
import { FakeNode, FakePoint } from '../__test__/fakeNode';
import type { FrameCtx } from '../frame/frame';
import type { Caps } from '../types';
import { createBuildingPlacer, createClipper, isWalkIn, standLine } from './buildings';
import type { PlaceFn } from './entities';

const D = Math.PI / 180;

class FakeRect { constructor(public x = 0, public y = 0, public width = 0, public height = 0) {} }
interface TexOpts { source: unknown; frame: FakeRect; orig?: FakeRect; trim?: FakeRect; dynamic?: boolean; rotate?: number }
class FakeTex {
  frame: FakeRect; orig: FakeRect; trim: FakeRect | null; source: unknown; dynamic: boolean; rotate: number;
  updates = 0; destroyed = false;
  constructor(o: TexOpts) {
    this.frame = new FakeRect(o.frame.x, o.frame.y, o.frame.width, o.frame.height);
    this.orig = o.orig ?? this.frame; this.trim = o.trim ?? null; this.source = o.source; this.dynamic = !!o.dynamic; this.rotate = o.rotate ?? 0;
  }
  update(): void { this.updates++; }
  destroy(): void { this.destroyed = true; }
}
const caps = { classes: { Texture: FakeTex, Rectangle: FakeRect } } as unknown as Caps;
const gameTex = (w: number, h: number, extra: Partial<TexOpts> = {}): FakeTex => new FakeTex({ source: {}, frame: new FakeRect(10, 20, w, h), ...extra });
const texOf = (n: FakeNode): unknown => n.texture;

// 100 art rows at scale 2, anchored at the bottom: the art spans 2D y 800–1000.
function piece(tex: FakeTex): FakeNode {
  const n = new FakeNode(500, 1000, 2);
  n.anchor = new FakePoint(0.5, 1);
  n.texture = tex as unknown as FakeNode['texture'];
  return n;
}

// Live 2026-10-03 (build 1381): 101 map columns; the seed shop collides on row 31, the gazebo footprint nowhere.
const map = (tiles: Array<[number, number]>) => ({ cols: 101, rows: 60, collisionTiles: new Set(tiles.map(([c, r]) => r * 101 + c)) });

describe('isWalkIn', () => {
  it('is true for the gazebo: no collision between its sort line and its art bottom', () => {
    expect(isWalkIn(map([[41, 31]]), 12481.6, 13366.2, 7662.94, 7850.9)).toBe(true);
  });
  it('is false for a shop that collides between its sort line and its art bottom', () => {
    expect(isWalkIn(map([[40, 31], [41, 31], [42, 31]]), 10239.7, 11007.7, 8051.39, 8480.4)).toBe(false);
  });
  it('ignores collision north of the sort line', () => {
    expect(isWalkIn(map([[50, 28]]), 12481.6, 13366.2, 7662.94, 7850.9)).toBe(true);
  });
});

describe('createClipper', () => {
  it('hides the rows below the ground line and keeps the scale and orig', () => {
    const g = gameTex(40, 100), n = piece(g), clip = createClipper(caps);
    clip.clip(n.node, 900);
    const own = texOf(n) as FakeTex;
    expect(own).not.toBe(g);
    expect(own.frame).toEqual(new FakeRect(10, 20, 40, 50));
    expect(own.trim).toEqual(new FakeRect(0, 0, 40, 50));
    expect(own.orig).toBe(g.orig);
    expect(own.dynamic).toBe(true);
    expect([n.scale.x, n.scale.y]).toEqual([2, 2]);
  });

  it('moves the clip row on the same texture, then hands the game texture back at the art bottom', () => {
    const g = gameTex(40, 100), n = piece(g), clip = createClipper(caps);
    clip.clip(n.node, 900);
    const own = texOf(n) as FakeTex;
    clip.clip(n.node, 950);
    expect(texOf(n)).toBe(own);
    expect(own.frame.height).toBe(75);
    expect(own.trim?.height).toBe(75);
    expect(own.updates).toBe(1);
    clip.clip(n.node, 1000);
    expect(texOf(n)).toBe(g);
  });

  it('clips inside an existing trim', () => {
    const g = gameTex(40, 90, { orig: new FakeRect(0, 0, 50, 100), trim: new FakeRect(5, 4, 40, 90) }), n = piece(g), clip = createClipper(caps);
    clip.clip(n.node, 900);
    const own = texOf(n) as FakeTex;
    expect(own.trim).toEqual(new FakeRect(5, 4, 40, 46));
    expect(own.frame.height).toBe(46);
  });

  it('leaves rotated frames alone and reports them as not sinkable', () => {
    const g = gameTex(40, 100, { rotate: 8 }), n = piece(g), clip = createClipper(caps);
    expect(clip.clip(n.node, 900)).toBe(false);
    expect(texOf(n)).toBe(g);
  });

  it('reports sinkable when clipped or when nothing needs clipping', () => {
    const n = piece(gameTex(40, 100)), clip = createClipper(caps);
    expect(clip.clip(n.node, 900)).toBe(true);
    expect(clip.clip(n.node, 1000)).toBe(true);
  });

  it('adopts a texture the game set while clipped; drop hands the game texture back', () => {
    const g = gameTex(40, 100), n = piece(g), clip = createClipper(caps);
    clip.clip(n.node, 900);
    const first = texOf(n) as FakeTex;
    const g2 = gameTex(40, 100);
    n.texture = g2 as unknown as FakeNode['texture'];
    clip.clip(n.node, 900);
    expect(first.destroyed).toBe(true);
    const second = texOf(n) as FakeTex;
    expect(second).not.toBe(g2);
    clip.drop();
    expect(texOf(n)).toBe(g2);
    expect(second.destroyed).toBe(true);
  });

  it('drop keeps a texture the game set after the last clip (A V9)', () => {
    const g = gameTex(40, 100), n = piece(g), clip = createClipper(caps);
    clip.clip(n.node, 900);
    const own = texOf(n) as FakeTex;
    const newer = gameTex(40, 100);
    n.texture = newer as unknown as FakeNode['texture'];
    clip.drop();
    expect(texOf(n)).toBe(newer);
    expect(own.destroyed).toBe(true);
  });
});

describe('createBuildingPlacer: a building card covering the avatar (A V5, seed shop at yaw 90)', () => {
  // The shop: art x 10239.7–11007.7, sort line 8051.39; the avatar on its mat at (10624, 8320), drawn at screen (50, 50).
  const SORT_Z = 80513905;
  function scene(camX: number, camY: number, shopKey: number, avatarKey: number) {
    const piece = new FakeNode(10239.7, 8480.39).withTexture(768, 858, 1);
    piece.anchor = new FakePoint(0, 1);
    const shop = new FakeNode(0, 0, 1, [piece]);
    // Its roof, attached by a fractional zIndex: drawn at screen x 0–154, y −196…−76 (above the card).
    const roofPiece = new FakeNode(10239.7, 7353).withTexture(768, 600, 1);
    roofPiece.anchor = new FakePoint(0, 1);
    const roof = new FakeNode(0, 0, 1, [roofPiece]);
    const puts = new Map<unknown, number>();
    const ov = {
      gameValue: (_k: string, n: unknown) => (n === shop ? SORT_Z : n === roof ? SORT_Z + 0.5 : 0),
      put: (k: string, n: unknown, v: number) => { if (k === 'zIndex') puts.set(n, v); },
      drop: () => undefined, raw: () => true,
    };
    const ctx = {
      ov, exactKeys: false, params: { pitch: 30 * D }, basis: { C: [camX, 900, camY] }, drawn: { push: () => undefined },
      avatarKey, avatarUpper: { x: 50, y: 50 }, avatarGround: { x: 10624, y: 8320 },
      caps: { systems: { map: map([[40, 31], [41, 31], [42, 31]]) } },
    } as unknown as FrameCtx;
    // The stub stands the card on screen around the avatar's upper body, at the key the caller gives.
    const place: PlaceFn = (_c, n, _o, lp) => {
      n.position.set(0, 150); // the card spans screen x 0–154, y −22–150
      n.scale.set(0.2, 0.2);
      ov.put('zIndex', n, shopKey);
      lp.key = shopKey; lp.fx = 10623.7; lp.fy2d = 8480.39; lp.sx = 76.8; lp.sy = 150; lp.mm = 0.2;
      return shopKey;
    };
    return { shop, piece, roof, puts, ctx, place };
  }

  it('draws the shop under the avatar while its wall is not between the avatar and the camera', () => {
    // Yaw 90: the camera west of the mat, the card centre 0.3 px nearer than the avatar.
    const s = scene(9424, 8320, -106237000, -106239999.8);
    createBuildingPlacer(null).place(s.ctx, [s.shop.node], s.place);
    expect(s.puts.get(s.shop)).toBeLessThan(-106239999.8);
    expect(s.puts.get(s.piece)).toBeLessThan(-106239999.8);
  });
  it('keeps the shop over the avatar once its wall stands between them (yaw 180)', () => {
    const s = scene(10624, 7120, -80513905, -83199999.8);
    createBuildingPlacer(null).place(s.ctx, [s.shop.node], s.place);
    expect(s.puts.get(s.shop)).toBe(-80513905);
  });
  it('raises the shop over the avatar when its wall is between them but its centre key says otherwise', () => {
    const s = scene(10624, 7120, -90000000, -83199999.8);
    createBuildingPlacer(null).place(s.ctx, [s.shop.node], s.place);
    expect(s.puts.get(s.shop)).toBeGreaterThan(-83199999.8);
  });
  it('raises it over the whole depth step, so a mount or pet beside the hidden avatar stays under it too', () => {
    const s = scene(10624, 7120, -90000000, -83199999.8);
    createBuildingPlacer(null).place(s.ctx, [s.shop.node], s.place);
    // Same 32 px step, pet layer 7 (tiltedTiebreak 0.7…0.8).
    expect(s.puts.get(s.shop)).toBeGreaterThan(-83200000 + 0.8);
  });
  it('a roof covering the avatar counts as the building covering it, and moves with its base', () => {
    const s = scene(10624, 7120, -90000000, -83199999.8);
    const ctx = { ...s.ctx, avatarUpper: { x: 50, y: -100 } } as FrameCtx;
    createBuildingPlacer(null).place(ctx, [s.roof.node, s.shop.node], s.place);
    expect(s.puts.get(s.shop)).toBeGreaterThan(-83199999.8);
    expect(s.puts.get(s.roof)).toBeGreaterThan(s.puts.get(s.shop)!);
  });
  it('leaves the game order alone straight down (s = 0)', () => {
    const s = scene(9424, 8320, -106237000, -106239999.8);
    createBuildingPlacer(null).place({ ...s.ctx, exactKeys: true } as FrameCtx, [s.shop.node], s.place);
    expect(s.puts.get(s.shop)).toBe(-106237000);
  });
  it('leaves a card that does not cover the avatar alone', () => {
    const s = scene(9424, 8320, -106237000, -106239999.8);
    createBuildingPlacer(null).place({ ...s.ctx, avatarUpper: { x: 5000, y: 50 } } as FrameCtx, [s.shop.node], s.place);
    expect(s.puts.get(s.shop)).toBe(-106237000);
  });
});

describe('standLine (blend)', () => {
  it('is the foot straight down, so s = 0 matches 2D', () => {
    expect(standLine(8480, 8051.39, 90 * D)).toBeCloseTo(8480, 6);
  });
  it('is the sort line at or below 60° pitch', () => {
    expect(standLine(8480, 8051.39, 60 * D)).toBeCloseTo(8051.39, 6);
    expect(standLine(8480, 8051.39, 24 * D)).toBeCloseTo(8051.39, 6);
  });
  it('blends between 60° and 90°', () => {
    const y = standLine(8480, 8051.39, 75 * D);
    expect(y).toBeGreaterThan(8051.39);
    expect(y).toBeLessThan(8480);
  });
  it('keeps the foot when the sort line is not behind it', () => {
    expect(standLine(7842, 7900, 30 * D)).toBe(7842);
  });
});
