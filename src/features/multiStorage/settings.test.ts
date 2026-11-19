import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
    set: (key: string, value: unknown) => { store.set(key, value); },
    remove: (key: string) => { store.delete(key); },
  },
}));

const {
  MULTI_STORAGE_ENABLED_KEY, MULTI_STORAGE_LAYOUT_KEY, MULTI_STORAGE_PICK_KEY, clearSavedLayout, getSavedLayout,
  getStoragePick, isMultiStorageEnabled, saveLayoutCells, setMultiStorageEnabled, setStoragePick,
} = await import('./settings');
const { QPM_STORAGE_KEYS } = await import('../../utils/storageKeys');

describe('multi-storage settings', () => {
  beforeEach(() => { store.clear(); });

  it('registers every key it writes', () => {
    for (const key of [MULTI_STORAGE_ENABLED_KEY, MULTI_STORAGE_PICK_KEY, MULTI_STORAGE_LAYOUT_KEY]) {
      expect(QPM_STORAGE_KEYS).toContain(key);
    }
  });

  it('is enabled until switched off', () => {
    expect(isMultiStorageEnabled()).toBe(true);
    setMultiStorageEnabled(false);
    expect(isMultiStorageEnabled()).toBe(false);
    setMultiStorageEnabled(true);
    expect(isMultiStorageEnabled()).toBe(true);
  });

  it('keeps a pick, and treats empty or corrupt picks as all storages', () => {
    expect(getStoragePick()).toBeNull();
    setStoragePick(['SeedSilo', 'PetHutch', 'SeedSilo']);
    expect(getStoragePick()).toEqual(['SeedSilo', 'PetHutch']);
    setStoragePick([]);
    expect(store.has(MULTI_STORAGE_PICK_KEY)).toBe(false);
    setStoragePick(['PetHutch']);
    setStoragePick(null);
    expect(getStoragePick()).toBeNull();
    store.set(MULTI_STORAGE_PICK_KEY, [1, null, '']);
    expect(getStoragePick()).toBeNull();
    store.set(MULTI_STORAGE_PICK_KEY, 'PetHutch');
    expect(getStoragePick()).toBeNull();
  });

  it('merges saved cells per storage and drops unusable entries', () => {
    saveLayoutCells({ PetHutch: { x: 0, y: 0, w: 0.5, h: 1, z: 0 } });
    saveLayoutCells({ SeedSilo: { x: 0.5, y: 0, w: 0.5, h: 1 }, DecorShed: { x: 0, y: 0, w: 0, h: 1 } });
    expect(getSavedLayout()).toEqual({ PetHutch: { x: 0, y: 0, w: 0.5, h: 1, z: 0 }, SeedSilo: { x: 0.5, y: 0, w: 0.5, h: 1 } });
    store.set(MULTI_STORAGE_LAYOUT_KEY, { PetHutch: { x: 'a' }, SeedSilo: null, DecorShed: { x: 0.1, y: 0.2, w: 0.3, h: 0.4, z: 'top' } });
    expect(getSavedLayout()).toEqual({ DecorShed: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } });
    store.set(MULTI_STORAGE_LAYOUT_KEY, 'nope');
    expect(getSavedLayout()).toEqual({});
  });

  it('clears the saved layout', () => {
    saveLayoutCells({ PetHutch: { x: 0, y: 0, w: 0.5, h: 1 } });
    clearSavedLayout();
    expect(store.has(MULTI_STORAGE_LAYOUT_KEY)).toBe(false);
    expect(getSavedLayout()).toEqual({});
  });
});
