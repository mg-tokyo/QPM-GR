import { afterEach, describe, expect, it, vi } from 'vitest';

const atomValues = new Map<string, unknown>();
const atomCallbacks = new Map<string, (value: unknown) => void>();

vi.mock('../core/atomRegistry', () => ({
  readAtomValue: vi.fn(async (key: string) => atomValues.get(key) ?? null),
  readAtomValueSync: vi.fn((key: string) => atomValues.get(key) ?? null),
  subscribeAtomValue: vi.fn(async (key: string, cb: (value: unknown) => void) => {
    atomCallbacks.set(key, cb);
    return () => { atomCallbacks.delete(key); };
  }),
}));

vi.mock('../core/jotaiBridge', () => ({ getCachedStore: vi.fn(() => null) }));

vi.mock('./_storeDiagnostics', () => ({
  createStoreDiagnostics: () => ({ register: vi.fn(), publishOk: vi.fn(), warn: vi.fn() }),
}));

vi.mock('./shopRegistry', () => ({
  getKnownShopIds: () => ['seeds', 'eggs', 'tools', 'decor'],
  getWeatherGatedShopIds: () => [],
  isStandardShop: () => true,
  onShopDiscovered: () => () => {},
}));

vi.mock('../catalogs/gameCatalogs', () => ({
  getPlantSpecies: () => null,
  getEggType: () => null,
  getItem: () => null,
  getDecor: () => null,
}));

vi.mock('../utils/restock/dataService', () => ({
  canonicalItemId: (_shopType: string, itemId: string) => itemId,
}));

const { startShopStockStore, stopShopStockStore, getShopStockState } = await import('./shopStock');

const INVENTORY = [{ itemType: 'Egg', eggId: 'CommonEgg', initialStock: 3 }];
const EGG_BUCKET = { restockId: 'egg:1', startedAtMs: 1000, purchases: { CommonEgg: 3 } };

function push(key: string, value: unknown): void {
  atomValues.set(key, value);
  atomCallbacks.get(key)?.(value);
}

function eggIds(): string[] {
  return getShopStockState().categories.eggs?.items.map((item) => item.id) ?? [];
}

function commonEgg() {
  return getShopStockState().categories.eggs?.items.find((item) => item.id === 'CommonEgg');
}

afterEach(() => {
  stopShopStockStore();
  atomValues.clear();
  atomCallbacks.clear();
});

describe('shop stock category memo', () => {
  it('(7) rebuilds when the inventory is identical but the restockId is new', async () => {
    atomValues.set('shops', { egg: { inventory: INVENTORY, restockId: 'egg:1', startedAtMs: 1000 } });
    atomValues.set('myData', { shopPurchases: { egg: EGG_BUCKET } });
    await startShopStockStore();
    expect(commonEgg()?.remaining).toBe(0);

    push('shops', { egg: { inventory: INVENTORY.map((entry) => ({ ...entry })), restockId: 'egg:2', startedAtMs: 2000 } });
    expect(commonEgg()?.purchased).toBe(0);
    expect(commonEgg()?.remaining).toBe(3);
  });

  it('rebuilds when only myData.customRestocks changes', async () => {
    const custom = { restockId: 'egg:custom:5000', startedAtMs: 5000, inventory: [{ itemType: 'Egg', eggId: 'RareEgg', initialStock: 1 }] };
    atomValues.set('shops', { egg: { inventory: INVENTORY, restockId: 'egg:1', startedAtMs: 1000 } });
    atomValues.set('myData', { shopPurchases: { egg: EGG_BUCKET }, customRestocks: { egg: null } });
    await startShopStockStore();
    push('myUserSlot', { customRestockInventories: { egg: custom } });
    expect(eggIds()).toEqual(['CommonEgg']);

    push('myData', { shopPurchases: { egg: EGG_BUCKET }, customRestocks: { egg: { purchasedAt: 5000 } } });
    expect(eggIds()).toEqual(['RareEgg']);
  });
});
