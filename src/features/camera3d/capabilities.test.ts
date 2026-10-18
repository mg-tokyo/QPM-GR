import { describe, expect, it } from 'vitest';
import { ownerOf, resolveMeshGeometry, resolveScene, resolveSystems, sceneNotBuilt, seatMissing, systemsReplaced } from './capabilities';

class Mat { a = 1; b = 0; c = 0; d = 1; tx = 0; ty = 0; }
class Container {
  label: string | null = null; x = 0; y = 0; zIndex = 0; children: Container[] = []; localTransform = new Mat();
  constructor(label: string | null = null, kids: Container[] = []) { this.label = label; this.children = kids; }
}
/** One live-shaped tilemap rect (live 1419): u, v, x, y, w, h, rotate, animX, animY, texIdx, animCount 1024 ×2, divisor, alpha. */
const RECT = [0, 0, 0, 0, 256, 256, 0, 0, 0, 0, 1024, 1024, 1, 1];
/** A scene that resolves, with this tilemap buffer and these World children. */
function scene(pointsBuf: number[], worldKids: Container[] = []) {
  const tiles = new Container('t');
  (tiles as unknown as { pointsBuf: number[]; rects_count: number }).pointsBuf = pointsBuf;
  const camera = new Container('Camera', [new Container('Ground', [new Container(null, [tiles])]), new Container('World', worldKids), new Container('Weather')]);
  const stage = new Container(null, [new Container('GameContent', [camera])]);
  const events = { mapPositionToPoint: () => undefined, rootBoundary: { hitTest: () => null } };
  return { stage, renderer: { screen: { width: 1, height: 1 }, gl: { texStorage2D: () => undefined }, render: () => undefined, events } };
}
const tile = (y: number, z: number): Container => { const c = new Container('Tile'); c.x = 128; c.y = y; c.zIndex = z; return c; };
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
    (tiles as unknown as { pointsBuf: number[]; rects_count: number }).pointsBuf = [...RECT];
    const ground = new Container('Ground', [new Container('TravelForest'), new Container(null, [tiles])]);
    const camera = new Container('Camera', [ground, new Container('World'), new Container('Weather')]);
    const stage = new Container(null, [new Container('GameContent', [camera])]);
    const events = { mapPositionToPoint: () => undefined, rootBoundary: { hitTest: () => null } };
    const renderer = { screen: { width: 1, height: 1 }, gl: { texStorage2D: () => undefined }, render: () => undefined, events };
    const ok = resolveScene(stage, renderer, {});
    expect(Array.isArray(ok)).toBe(false);
    const bad = resolveScene(new Container(null, [new Container('GameContent', [])]), renderer, {});
    expect(bad).toEqual(['camera']);
  });

  it('resolveScene reports the renderer hooks the input remap and render hook wrap (A R1)', () => {
    const tiles = new Container('t');
    (tiles as unknown as { pointsBuf: number[] }).pointsBuf = [];
    const camera = new Container('Camera', [new Container('Ground', [new Container(null, [tiles])]), new Container('World'), new Container('Weather')]);
    const stage = new Container(null, [new Container('GameContent', [camera])]);
    const gl = { texStorage2D: () => undefined };
    expect(resolveScene(stage, { gl }, {})).toEqual(['render', 'events']);
    expect(resolveScene(stage, { gl, render: () => undefined, events: { mapPositionToPoint: () => undefined, rootBoundary: {} } }, {})).toEqual(['events']);
  });

  it('resolveScene turns a drifted tile buffer or depth-key encoding into a missing entry (A V8)', () => {
    const live = Array.from({ length: 30 }, (_, i) => tile(2560 + 256 * i, (2560 + 256 * i) * 1e4 + 1));
    const ok = scene(RECT.concat(RECT), live);
    expect(Array.isArray(resolveScene(ok.stage, ok.renderer, {}))).toBe(false);
    const wide = scene([...RECT, 0, ...RECT, 0], live);
    expect(resolveScene(wide.stage, wide.renderer, {})).toEqual(['tilemap-layout']);
    const rescaled = scene(RECT, live.map((c) => tile(c.y, c.y * 1e3)));
    expect(resolveScene(rescaled.stage, rescaled.renderer, {})).toEqual(['depth-keys']);
    // An empty tilemap or World proves nothing either way.
    const empty = scene([], []);
    expect(Array.isArray(resolveScene(empty.stage, empty.renderer, {}))).toBe(false);
  });

  it('sceneNotBuilt: only scene layers missing means the game is still building its scene (re-probe); anything else does not', () => {
    expect(sceneNotBuilt(['camera'])).toBe(true);
    expect(sceneNotBuilt(['world', 'weather', 'tilemap'])).toBe(true);
    expect(sceneNotBuilt(['world', 'depth-keys'])).toBe(false);
    expect(sceneNotBuilt(['render', 'events'])).toBe(false);
    expect(sceneNotBuilt([])).toBe(false);
  });

  /** The missing list ([] when everything resolved). */
  const systems = (zoom: Record<string, unknown>, di: Record<string, unknown> | null = null): string[] => {
    const sys: Record<string, unknown> = { zoom: { zoom, shouldBlockZoom: () => false }, directionalInput: di };
    const scope = { systemRegistry: { getSystem: (n: string) => sys[n] ?? null } };
    const r = resolveSystems({ page: { rendererScope: scope, playerViews: scope } });
    return Array.isArray(r) ? r : [];
  };
  const zoomOk = { applyInputZoom() { return null; }, effective: 64, intentTileSize: 64, overrideTileSize: null };

  it('resolveSystems lists every missing engine system', () => {
    expect(resolveSystems(null)).toEqual(['engine']);
    expect(systems(zoomOk)).toEqual(['worldTapRouter', 'map', 'pet']);
  });

  it('resolveSystems needs both movement map dimensions (the far plane and the cull box are derived from them)', () => {
    const resolve = (map: Record<string, unknown>) => {
      const sys: Record<string, unknown> = {
        zoom: { zoom: zoomOk, shouldBlockZoom: () => false }, directionalInput: { updateDirectionState() { /* noop */ }, keysPressed: [] },
        worldTapRouter: { movementFallback: { isTapInBounds: () => true } }, movement: { map }, pet: { preDraw() { /* noop */ } },
      };
      const registry = { getSystem: (n: string) => sys[n] ?? null };
      const r = resolveSystems({ page: { rendererScope: { systemRegistry: registry }, playerViews: { systemRegistry: registry } } });
      return Array.isArray(r) ? r : [];
    };
    expect(resolve({ cols: 101, rows: 60, collisionTiles: new Set() })).toEqual([]);
    expect(resolve({ cols: 101, collisionTiles: new Set() })).toEqual(['map']);
    // Walk-in buildings read the collision tiles (buildings.ts isWalkIn): a map without them is no map.
    expect(resolve({ cols: 101, rows: 60 })).toEqual(['map']);
  });

  it('resolveSystems checks the zoom fields and the key stack the bridge and movement read', () => {
    expect(systems({ applyInputZoom() { return null; }, effective: 64, intentTileSize: 64 })[0]).toBe('zoom');
    expect(systems({ ...zoomOk, effective: undefined })[0]).toBe('zoom');
    // A drifted key stack is a seat system the game doesn't give: optional, not missing (spectator Task 12).
    expect(systems(zoomOk, { updateDirectionState() { /* noop */ } })[0]).toBe('worldTapRouter');
    expect(systems(zoomOk, { updateDirectionState() { /* noop */ }, keysPressed: [] })[0]).toBe('worldTapRouter');
  });

  // Live 2026-10-14 (1497): movement and directionalInput are page.playerViews systems; zoom, worldTapRouter, pet, avatar
  // and map are rendererScope ones, and the world map key is movement.map itself.
  describe('seat systems are optional (spectator Task 12, S §5.1)', () => {
    const worldMap = { cols: 101, rows: 60, collisionTiles: new Set<number>() };
    // One set of world systems: only the seat varies between calls.
    const shared = { zoom: { zoom: zoomOk, shouldBlockZoom: () => false }, worldTapRouter: { movementFallback: { isTapInBounds: () => true } }, pet: { preDraw() { /* noop */ } } };
    const world = (seat: Record<string, unknown>, map: unknown = worldMap) => {
      const sys: Record<string, unknown> = { ...shared, ...seat };
      const registry = { getSystem: (n: string) => sys[n] ?? null };
      return resolveSystems({ page: { rendererScope: { systemRegistry: registry }, playerViews: { systemRegistry: registry } } }, map);
    };

    it('without a seat: resolves, the map from the world map, no key stack and no step', () => {
      const r = world({});
      expect(Array.isArray(r)).toBe(false);
      if (Array.isArray(r)) return;
      expect(r.map).toBe(worldMap);
      expect(r.directionalInput).toBeNull();
      expect(r.mover).toBeNull();
      expect(seatMissing(r)).toEqual(['directionalInput']);
    });

    it('the world map comes first; the movement map stands in without it; neither is missing map', () => {
      const mvMap = { cols: 50, rows: 40, collisionTiles: new Set<number>() };
      const di = { updateDirectionState() { /* noop */ }, keysPressed: [] };
      const both = world({ directionalInput: di, movement: { map: mvMap, movePlayer: () => true } });
      expect(Array.isArray(both) ? both : both.map).toBe(worldMap);
      const mvOnly = world({ movement: { map: mvMap } }, null);
      expect(Array.isArray(mvOnly) ? mvOnly : mvOnly.map).toBe(mvMap);
      expect(world({}, null)).toEqual(['map']);
      expect(world({}, { cols: 101 })).toEqual(['map']);
      if (!Array.isArray(both)) expect(seatMissing(both)).toEqual([]);
    });

    it('systemsReplaced: a seat system gone for now is not a replacement; a new or different one is', () => {
      const di = { updateDirectionState() { /* noop */ }, keysPressed: [] };
      const mover = { map: worldMap, movePlayer: () => true };
      const seated = world({ directionalInput: di, movement: mover });
      const seatless = world({});
      const other = world({ directionalInput: { ...di }, movement: mover });
      if (Array.isArray(seated) || Array.isArray(seatless) || Array.isArray(other)) throw new Error('unresolved');
      expect(systemsReplaced(seated, seated)).toBe(false);
      expect(systemsReplaced(seatless, seated)).toBe(false);
      expect(systemsReplaced(seated, seatless)).toBe(true);
      expect(systemsReplaced(other, seated)).toBe(true);
      expect(systemsReplaced({ ...seated, petSystem: { preDraw() { /* noop */ } } }, seated)).toBe(true);
      expect(systemsReplaced({ ...seated, map: { ...worldMap } }, seated)).toBe(true);
    });
  });

  it('the FPS policy is optional: resolved from the renderer scope when present, null otherwise (A S4)', () => {
    const policy = { notifyActivity() { /* noop */ } };
    const all = (rendererScopeExtra: Record<string, unknown>) => {
      const sys: Record<string, unknown> = {
        zoom: { zoom: zoomOk, shouldBlockZoom: () => false }, directionalInput: { updateDirectionState() { /* noop */ }, keysPressed: [] },
        worldTapRouter: { movementFallback: { isTapInBounds: () => true } }, movement: { map: { cols: 1, rows: 1, collisionTiles: new Set() } }, pet: { preDraw() { /* noop */ } },
      };
      const registry = { getSystem: (n: string) => sys[n] ?? null };
      return resolveSystems({ page: { rendererScope: { systemRegistry: registry, ...rendererScopeExtra }, playerViews: { systemRegistry: registry } } });
    };
    const withPolicy = all({ performancePolicy: policy });
    const without = all({});
    const broken = all({ performancePolicy: { notifyActivity: 1 } });
    expect(Array.isArray(withPolicy) ? null : withPolicy.activity).toBe(policy);
    expect(Array.isArray(without) ? 'missing' : without.activity).toBeNull();
    expect(Array.isArray(broken) ? 'missing' : broken.activity).toBeNull();
  });

  it('the tap claim resolver is optional: the router itself when it has resolveClaimAt, null otherwise (A I5)', () => {
    const resolve = (router: Record<string, unknown>) => {
      const sys: Record<string, unknown> = {
        zoom: { zoom: zoomOk, shouldBlockZoom: () => false }, directionalInput: { updateDirectionState() { /* noop */ }, keysPressed: [] },
        worldTapRouter: router, movement: { map: { cols: 1, rows: 1, collisionTiles: new Set() } }, pet: { preDraw() { /* noop */ } },
      };
      const registry = { getSystem: (n: string) => sys[n] ?? null };
      const r = resolveSystems({ page: { rendererScope: { systemRegistry: registry }, playerViews: { systemRegistry: registry } } });
      return Array.isArray(r) ? 'missing' : r.tapRouter;
    };
    const mf = { isTapInBounds: () => true };
    const router = { movementFallback: mf, resolveClaimAt: () => null };
    expect(resolve(router)).toBe(router);
    expect(resolve({ movementFallback: mf })).toBeNull();
  });

  it('the avatar system is optional: resolved when it holds a views map, null otherwise (avatar heights)', () => {
    const resolve = (avatar: unknown) => {
      const sys: Record<string, unknown> = {
        zoom: { zoom: zoomOk, shouldBlockZoom: () => false }, directionalInput: { updateDirectionState() { /* noop */ }, keysPressed: [] },
        worldTapRouter: { movementFallback: { isTapInBounds: () => true } }, movement: { map: { cols: 1, rows: 1, collisionTiles: new Set() } }, pet: { preDraw() { /* noop */ } }, avatar,
      };
      const registry = { getSystem: (n: string) => sys[n] ?? null };
      const r = resolveSystems({ page: { rendererScope: { systemRegistry: registry }, playerViews: { systemRegistry: registry } } });
      return Array.isArray(r) ? 'missing' : r.avatar;
    };
    const avatar = { views: new Map() };
    expect(resolve(avatar)).toBe(avatar);
    expect(resolve({ views: {} })).toBeNull();
    expect(resolve(null)).toBeNull();
  });
});

describe('resolveMeshGeometry (polish Task 11: batched fence strips)', () => {
  class Geometry { addAttribute(): void { /* fake */ } }
  class MeshGeometry extends Geometry { get positions(): Float32Array { return new Float32Array(0); } }
  class NineSliceGeometry extends MeshGeometry {}
  const tree = (n: Record<string, unknown>) => ({ children: [{ children: [], ...n }] });

  it('finds the class through a mesh geometry or the GPU data of a nine-slice sprite (live 1411), else null', () => {
    expect(resolveMeshGeometry(tree({ geometry: new MeshGeometry() }))).toBe(MeshGeometry);
    expect(resolveMeshGeometry(tree({ _gpuData: { 1: { batchableMesh: { geometry: new NineSliceGeometry() } } } }))).toBe(MeshGeometry);
    expect(resolveMeshGeometry(tree({ _gpuData: { 1: { geometry: new NineSliceGeometry() } } }))).toBe(MeshGeometry);
    expect(resolveMeshGeometry(tree({ geometry: new Geometry() }))).toBeNull();
    expect(resolveMeshGeometry(null)).toBeNull();
  });
});
