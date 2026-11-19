import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('../../utils/storage', () => ({
  storage: {
    get: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
    set: (key: string, value: unknown) => { store.set(key, value); },
    remove: (key: string) => { store.delete(key); },
  },
}));
let shopIds: string[] | null = null;
vi.mock('../../catalogs/logic/gamePanelsCatalog', () => ({ getShopPanelIds: () => shopIds }));
vi.mock('../../core/gameState', () => ({ readSync: () => null, subscribe: () => () => {} }));

const {
  MULTI_SHOP_ENABLED_KEY, MULTI_SHOP_LAYOUT_KEY, MULTI_SHOP_PICK_KEY, clearSavedShopLayout, getSavedShopLayout, getShopPick,
  isMultiShopEnabled, onMultiShopSettingsChange, saveShopLayoutCells, setMultiShopEnabled, setShopPick,
} = await import('./settings');
const { getStoragePick, onMultiStorageSettingsChange } = await import('../multiStorage/settings');
const { chooseShopNames, chosenShopNames } = await import('./shops');
const { QPM_STORAGE_KEYS } = await import('../../utils/storageKeys');

describe('multi-shop settings', () => {
  beforeEach(() => { store.clear(); });

  it('registers every key it writes, under qpm.multiShop', () => {
    for (const key of [MULTI_SHOP_ENABLED_KEY, MULTI_SHOP_PICK_KEY, MULTI_SHOP_LAYOUT_KEY]) {
      expect(QPM_STORAGE_KEYS).toContain(key);
      expect(key.startsWith('qpm.multiShop.')).toBe(true);
    }
  });

  it('is enabled until switched off', () => {
    expect(isMultiShopEnabled()).toBe(true);
    setMultiShopEnabled(false);
    expect(isMultiShopEnabled()).toBe(false);
  });

  it('keeps its pick and layout apart from multi-storage, and tells only its own listeners', () => {
    const shop = vi.fn();
    const storage = vi.fn();
    const offs = [onMultiShopSettingsChange(shop), onMultiStorageSettingsChange(storage)];
    setShopPick(['eggShop', 'seedShop', 'eggShop']);
    saveShopLayoutCells({ seedShop: { x: 0, y: 0, w: 0.5, h: 1, z: 1 }, eggShop: { x: 0, y: 0, w: 0, h: 1 } });
    expect(getShopPick()).toEqual(['eggShop', 'seedShop']);
    expect(getStoragePick()).toBeNull();
    expect(getSavedShopLayout()).toEqual({ seedShop: { x: 0, y: 0, w: 0.5, h: 1, z: 1 } });
    expect(shop).toHaveBeenCalledTimes(2);
    expect(storage).not.toHaveBeenCalled();
    clearSavedShopLayout();
    expect(store.has(MULTI_SHOP_LAYOUT_KEY)).toBe(false);
    for (const off of offs) off();
  });
});

describe('multi-shop pick', () => {
  const shops = ['seedShop', 'eggShop', 'toolShop', 'rainShop'];

  beforeEach(() => { store.clear(); shopIds = null; });

  it('limits the pick to the game list, in pick order', () => {
    expect(chooseShopNames(shops, null)).toEqual(shops);
    expect(chooseShopNames(shops, ['rainShop', 'gone', 'seedShop'])).toEqual(['rainShop', 'seedShop']);
    expect(chooseShopNames(shops, ['gone'])).toEqual(shops);
  });

  it('opens nothing while the shop list is unread, then the saved pick', () => {
    setShopPick(['toolShop']);
    expect(chosenShopNames()).toEqual([]);
    shopIds = shops;
    expect(chosenShopNames()).toEqual(['toolShop']);
    setShopPick(null);
    expect(chosenShopNames()).toEqual(shops);
  });
});
