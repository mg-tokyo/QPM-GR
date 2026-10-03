import { describe, expect, it } from 'vitest';
import { ownerOf, resolveScene, resolveSystems } from './capabilities';

class Mat { a = 1; b = 0; c = 0; d = 1; tx = 0; ty = 0; }
class Container {
  label: string | null = null; x = 0; y = 0; children: Container[] = []; localTransform = new Mat();
  constructor(label: string | null = null, kids: Container[] = []) { this.label = label; this.children = kids; }
}
class Base { get geometry(): number { return 1; } }
class Mid extends Base {}
class Leaf extends Mid {}

describe('capabilities', () => {
  it('ownerOf finds the class that owns an accessor', () => {
    expect(ownerOf(Leaf, 'geometry')).toBe(Base);
    expect(ownerOf(Leaf, 'nope')).toBeNull();
  });

  it('resolveScene finds Camera under GameContent, the tilemap by its points buffer, and reports what is missing', () => {
    const tiles = new Container('t');
    (tiles as unknown as { pointsBuf: Float32Array; rects_count: number; tileset: { arr: unknown[] } }).pointsBuf = new Float32Array(14);
    (tiles as unknown as { tileset: { arr: unknown[] } }).tileset = { arr: [{}] };
    const ground = new Container('Ground', [new Container('TravelForest'), new Container(null, [tiles])]);
    const camera = new Container('Camera', [ground, new Container('World'), new Container('Weather')]);
    const stage = new Container(null, [new Container('GameContent', [camera])]);
    const renderer = { screen: { width: 1, height: 1 }, gl: { texStorage2D: () => undefined } };
    const ok = resolveScene(stage, renderer, {});
    expect(Array.isArray(ok)).toBe(false);
    const bad = resolveScene(new Container(null, [new Container('GameContent', [])]), renderer, {});
    expect(bad).toEqual(['camera']);
  });

  it('resolveSystems lists every missing engine system', () => {
    expect(resolveSystems(null)).toEqual(['engine']);
    const scope = { systemRegistry: { getSystem: (n: string) => (n === 'zoom' ? { zoom: { applyInputZoom() { return null; } }, shouldBlockZoom: () => false } : null) } };
    const r = resolveSystems({ page: { rendererScope: scope, playerViews: scope } });
    expect(r).toEqual(['directionalInput', 'worldTapRouter', 'movement', 'pet']);
  });
});
