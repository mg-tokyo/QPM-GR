import { describe, expect, it, vi } from 'vitest';
import { TILE } from '../constants';
import type { FrameCtx } from '../frame/frame';
import type { Caps, UniformGroupLike } from '../types';
import { createFloor, type Floor } from './floor';

// The tilemap dance and the GPU programs are not under test here.
vi.mock('./tileArt', () => ({ setTilemapShown: () => undefined }));
vi.mock('./shaders', () => ({ GROUND_FS: '', GROUND_VS: '', compileNow: () => undefined }));

interface FakeTex { px: number; destroyed: boolean; source: { style: object; updateMipmaps: () => void }; destroy: () => void }

function fakeCaps() {
  const made: FakeTex[] = [];
  const tex = (px: number): FakeTex => {
    const t: FakeTex = { px, destroyed: false, source: { style: {}, updateMipmaps: () => undefined }, destroy: () => { t.destroyed = true; } };
    made.push(t);
    return t;
  };
  class UniformGroup {
    uniforms: Record<string, unknown>;
    constructor(u: Record<string, { value: unknown }>) { this.uniforms = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.value])); }
    update(): void { /* fake */ }
  }
  const shaders: Shader[] = [];
  class Shader {
    resources: Record<string, unknown>;
    constructor(o: { resources: Record<string, unknown> }) { this.resources = o.resources; shaders.push(this); }
    destroy(): void { /* fake */ }
  }
  class Mesh { visible = true; label = ''; texture: unknown; constructor(o: { texture: unknown }) { this.texture = o.texture; } destroy(): void { /* fake */ } }
  class Container { children: unknown[] = []; addChild(c: unknown): void { this.children.push(c); } destroy(): void { /* fake */ } }
  class Sprite { visible = true; x = 0; y = 0; width = 0; height = 0; }
  class Rectangle { constructor(public x: number, public y: number, public width: number, public height: number) {} }
  const renderer = {
    gl: null,
    generateTexture: (o: { frame: Rectangle; resolution: number }) => tex(Math.round(o.frame.width * o.resolution)),
    render: () => undefined,
  };
  const caps = {
    scene: { ground: { addChild: () => undefined, removeChild: () => undefined }, tilemap: {}, tileData: { pointsBuf: new Float32Array(14) }, renderer },
    // literal-list-justified: test fake of the PIXI class table (same shape as the tagged table in capabilities.ts)
    classes: {
      Geometry: class { destroy(): void { /* fake */ } }, UniformGroup, Shader, GlProgram: class {}, Mesh, Container, Sprite, Matrix: class {}, Rectangle,
      Texture: { WHITE: { source: { style: {} } } },
    },
    systems: { map: { cols: 101, rows: 60 } },
  } as unknown as Caps;
  return { caps, made, shaders };
}

const CAM: UniformGroupLike = { uniforms: {}, update: () => undefined };
const ov = { raw: () => true };
const at = (tx: number, ty: number): FrameCtx => ({ target: { x: tx * TILE, y: ty * TILE }, ov } as unknown as FrameCtx);
// Near: 13 tiles at res 1; far: 55 tiles at res 0.25 (floor.ts R, lvl()).
const HIGH = { near: 13 * TILE, far: Math.round(55 * TILE * 0.25) };
const LOW = { near: HIGH.near / 2, far: HIGH.far / 2 };
const bakes = (f: Floor): { nearBakes: number; farBakes: number; mapBakes: number } =>
  f.stats!() as unknown as { nearBakes: number; farBakes: number; mapBakes: number };

describe('floor.setGround (perf Task 9, S §4.2)', () => {
  it('Low on a live floor: the next frame rebakes each level once, whole, at half size, and frees the old bakes', () => {
    const { caps, made } = fakeCaps();
    const floor = createFloor(caps, CAM);
    floor.pre!(at(30, 20));
    const high = bakes(floor);
    const [nearHi, farHi] = [made.find((t) => t.px === HIGH.near)!, made.find((t) => t.px === HIGH.far)!];
    expect(nearHi && farHi).toBeTruthy();
    expect(floor.memoryMB()).toBeCloseTo(127.3, 0);

    floor.setGround('low');
    floor.pre!(at(30, 20));
    const low = bakes(floor);
    expect(low.nearBakes - high.nearBakes).toBe(1);
    expect(low.farBakes - high.farBakes).toBe(1);
    expect(low.mapBakes).toBe(high.mapBakes);
    expect(nearHi.destroyed && farHi.destroyed).toBe(true);
    expect(made.filter((t) => !t.destroyed).map((t) => t.px).sort((a, b) => a - b)).toEqual([1616, LOW.near, LOW.far]);
    expect(floor.memoryMB()).toBeCloseTo(37.8, 0);

    floor.pre!(at(30, 20));
    expect(bakes(floor).nearBakes).toBe(low.nearBakes);
  });

  it('the ground samples the new bakes on that frame (no black floor), and High puts today\'s sizes back', () => {
    const { caps, made, shaders } = fakeCaps();
    const floor = createFloor(caps, CAM);
    floor.pre!(at(30, 20));
    floor.setGround('low');
    floor.pre!(at(30, 20));
    const ground = shaders[0]!.resources;
    const live = (px: number): FakeTex | undefined => made.find((t) => !t.destroyed && t.px === px);
    expect(ground.uNearTexture).toBe(live(LOW.near)?.source);
    expect(ground.uFarTexture).toBe(live(LOW.far)?.source);
    floor.setGround('high');
    floor.pre!(at(30, 20));
    expect(ground.uNearTexture).toBe(live(HIGH.near)?.source);
    expect(ground.uFarTexture).toBe(live(HIGH.far)?.source);
    expect(floor.memoryMB()).toBeCloseTo(127.3, 0);
  });

  it('a change made in 2D while the bakes are held: the prewarm rebakes at the new size and the first 3D frame bakes nothing more', () => {
    vi.useFakeTimers();
    try {
      const { caps, made } = fakeCaps();
      const floor = createFloor(caps, CAM);
      const t = at(30, 20);
      floor.pre!(t);
      floor.drop!();
      floor.setGround('low');
      while (floor.warm!(t.ov, t.target)) { /* one bake per 2D frame */ }
      const warmed = bakes(floor);
      expect(made.filter((x) => !x.destroyed).map((x) => x.px).sort((a, b) => a - b)).toEqual([1616, LOW.near, LOW.far]);
      floor.pre!(t);
      expect(bakes(floor)).toEqual(warmed);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the same value does nothing; set before any bake, the first bakes are at that size', () => {
    const { caps, made } = fakeCaps();
    const floor = createFloor(caps, CAM);
    floor.setGround('high');
    floor.setGround('low');
    floor.pre!(at(30, 20));
    const first = bakes(floor);
    expect(made.filter((t) => !t.destroyed).map((t) => t.px).sort((a, b) => a - b)).toEqual([1616, LOW.near, LOW.far]);
    floor.setGround('low');
    floor.pre!(at(30, 20));
    const again = bakes(floor);
    expect([again.nearBakes, again.farBakes]).toEqual([first.nearBakes, first.farBakes]);
  });
});
