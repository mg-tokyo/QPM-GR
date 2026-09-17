import { describe, expect, it } from 'vitest';
import { getEngineSystem, isQuinoaEngine } from './quinoaEngine';

const legacyEngine = { getSystem: (name: string) => (name === 'inventory' ? { modalView: {} } : undefined) };
const scopedEngine = {
  boot: {
    seatScope: { getSystem: (name: string) => (name === 'inventory' ? { modalView: { inventoryCardView: { open() {} } } } : undefined) },
    worldScope: { getSystem: (name: string) => (name === 'map' ? { tiles: 83 } : undefined) },
  },
};
const pageEngine = {
  page: {
    playerViews: {
      systemRegistry: {
        getSystem: (name: string) => (name === 'inventory' ? { modalView: { inventoryCardView: { open() {} } } } : undefined),
      },
    },
    rendererScope: {
      systemRegistry: {
        getSystem: (name: string) => (name === 'map' ? { tiles: 91 } : undefined),
      },
    },
  },
};

describe('isQuinoaEngine', () => {
  it('accepts pre-1152 getSystem, 1152 boot/scope, and 1202 page-registry shapes', () => {
    expect(isQuinoaEngine(legacyEngine)).toBe(true);
    expect(isQuinoaEngine(scopedEngine)).toBe(true);
    expect(isQuinoaEngine({ boot: { seatScope: null } })).toBe(true);
    expect(isQuinoaEngine(pageEngine)).toBe(true);
    expect(isQuinoaEngine({ page: { rendererScope: {} } })).toBe(true);
  });
  it('rejects non-engines', () => {
    expect(isQuinoaEngine(null)).toBe(false);
    expect(isQuinoaEngine({})).toBe(false);
    expect(isQuinoaEngine({ boot: {} })).toBe(false);
    expect(isQuinoaEngine({ page: {} })).toBe(false);
  });
});

describe('getEngineSystem', () => {
  it('uses engine.getSystem when present', () => { expect(getEngineSystem(legacyEngine, 'inventory')).toEqual({ modalView: {} }); });
  it('walks seat scope then world scope (1152 boot)', () => {
    expect(getEngineSystem(scopedEngine, 'inventory')).toBeTruthy();
    expect(getEngineSystem(scopedEngine, 'map')).toEqual({ tiles: 83 });
  });
  it('walks playerViews then rendererScope registries (1202 page)', () => {
    expect(getEngineSystem(pageEngine, 'inventory')).toBeTruthy();
    expect(getEngineSystem(pageEngine, 'map')).toEqual({ tiles: 91 });
  });
  it('returns null when the seat is absent or the system is unknown', () => {
    expect(getEngineSystem({ boot: { seatScope: null, worldScope: null } }, 'inventory')).toBeNull();
    expect(getEngineSystem({ page: { playerViews: null, rendererScope: null } }, 'inventory')).toBeNull();
    expect(getEngineSystem(scopedEngine, 'nope')).toBeNull();
    expect(getEngineSystem(pageEngine, 'nope')).toBeNull();
    expect(getEngineSystem(undefined, 'inventory')).toBeNull();
  });
});
