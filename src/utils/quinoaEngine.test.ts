import { describe, expect, it } from 'vitest';
import { getEngineSystem, isQuinoaEngine } from './quinoaEngine';

const legacyEngine = { getSystem: (name: string) => (name === 'inventory' ? { modalView: {} } : undefined) };
const scopedEngine = {
  boot: {
    seatScope: { getSystem: (name: string) => (name === 'inventory' ? { modalView: { inventoryCardView: { open() {} } } } : undefined) },
    worldScope: { getSystem: (name: string) => (name === 'map' ? { tiles: 83 } : undefined) },
  },
};

describe('isQuinoaEngine', () => {
  it('accepts the pre-1152 getSystem shape and the 1152 boot/scope shape', () => {
    expect(isQuinoaEngine(legacyEngine)).toBe(true);
    expect(isQuinoaEngine(scopedEngine)).toBe(true);
    expect(isQuinoaEngine({ boot: { seatScope: null } })).toBe(true);
  });
  it('rejects non-engines', () => {
    expect(isQuinoaEngine(null)).toBe(false);
    expect(isQuinoaEngine({})).toBe(false);
    expect(isQuinoaEngine({ boot: {} })).toBe(false);
  });
});

describe('getEngineSystem', () => {
  it('uses engine.getSystem when present', () => { expect(getEngineSystem(legacyEngine, 'inventory')).toEqual({ modalView: {} }); });
  it('walks seat scope then world scope', () => {
    expect(getEngineSystem(scopedEngine, 'inventory')).toBeTruthy();
    expect(getEngineSystem(scopedEngine, 'map')).toEqual({ tiles: 83 });
  });
  it('returns null when the seat is absent or the system is unknown', () => {
    expect(getEngineSystem({ boot: { seatScope: null, worldScope: null } }, 'inventory')).toBeNull();
    expect(getEngineSystem(scopedEngine, 'nope')).toBeNull();
    expect(getEngineSystem(undefined, 'inventory')).toBeNull();
  });
});
