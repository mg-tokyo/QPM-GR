import { describe, expect, it } from 'vitest';
import { FakeNode, FakePoint } from '../__test__/fakeNode';
import type { Caps } from '../types';
import { createClipper, isWalkIn, standLine } from './buildings';

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
