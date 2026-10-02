import { describe, expect, it, vi } from 'vitest';

const STANDARD = new Set(['seeds', 'eggs', 'tools', 'decor']);

vi.mock('./shopRegistry', () => ({
  getKnownShopIds: () => ['seeds', 'eggs', 'tools', 'decor', 'dawn'],
  isStandardShop: (id: string) => STANDARD.has(id),
}));

const { buildCategoryState, extractMyDataShopPurchases } = await import('./shopStockParsers');
const { extractMyDataCustomRestocks } = await import('./shopPurchaseCycle');

// Shapes copied from a live game 1361 state tree (2026-10-02).
const EGG_SHOP = {
  inventory: [{ itemType: 'Egg', eggId: 'CommonEgg', initialStock: 3 }],
  secondsUntilRestock: 116,
  restockId: 'egg:1989892',
  startedAtMs: 1790902800000,
};

function myDataWithEggPurchases(bucket: Record<string, unknown>): unknown {
  return { shopPurchases: { egg: bucket, seed: null } };
}

function commonEgg(myData: unknown, shop: Record<string, unknown> = EGG_SHOP) {
  const purchases = extractMyDataShopPurchases(myData);
  const state = buildCategoryState('eggs', shop, purchases, null, null);
  return state.items.find((item) => item.id === 'CommonEgg');
}

describe('shop purchases are scoped to the stock cycle', () => {
  it('keeps restockId and startedAtMs on the normalized bucket', () => {
    const purchases = extractMyDataShopPurchases(myDataWithEggPurchases({
      restockId: 'egg:1989883', startedAtMs: 1790894700000, purchases: { CommonEgg: 3 },
    }));
    expect(purchases?.egg).toEqual({ restockId: 'egg:1989883', startedAtMs: 1790894700000, purchases: { CommonEgg: 3 } });
  });

  it('subtracts purchases made in the current cycle', () => {
    const item = commonEgg(myDataWithEggPurchases({
      restockId: 'egg:1989892', startedAtMs: 1790902800000, purchases: { CommonEgg: 2 },
    }));
    expect(item?.purchased).toBe(2);
    expect(item?.remaining).toBe(1);
    expect(item?.isAvailable).toBe(true);
  });

  it('(3) ignores purchases from an older cycle (fresh restock is fully available)', () => {
    const item = commonEgg(myDataWithEggPurchases({
      restockId: 'egg:1989883', startedAtMs: 1790894700000, purchases: { CommonEgg: 3 },
    }));
    expect(item?.purchased).toBe(0);
    expect(item?.remaining).toBe(3);
    expect(item?.isAvailable).toBe(true);
  });

  it('(4) shows the item sold out when the bucket is newer than the shop snapshot', () => {
    const item = commonEgg(myDataWithEggPurchases({
      restockId: 'egg:1989893', startedAtMs: 1790903100000, purchases: { CommonEgg: 1 },
    }));
    expect(item?.purchased).toBe(3);
    expect(item?.remaining).toBe(0);
    expect(item?.isAvailable).toBe(false);
  });

  it('(5) a null restockId means no stock; timers still come from the snapshot', () => {
    const state = buildCategoryState('eggs', { ...EGG_SHOP, restockId: null }, null, null, null);
    expect(state.items).toEqual([]);
    expect(state.secondsUntilRestock).toBe(116);
  });

  it('falls back to counting purchases when the shop snapshot has no restockId', () => {
    const { restockId: _restockId, startedAtMs: _startedAtMs, ...legacyShop } = EGG_SHOP;
    const item = commonEgg(myDataWithEggPurchases({ purchases: { CommonEgg: 1 } }), legacyShop);
    expect(item?.purchased).toBe(1);
    expect(item?.remaining).toBe(2);
  });
});

describe('custom restocks mirror the game', () => {
  const T = 1790903000000;
  const GLOBAL_SEED = {
    inventory: [{ itemType: 'Seed', species: 'Carrot', initialStock: 5 }],
    secondsUntilRestock: 200,
    restockId: 'seed:5969118',
    startedAtMs: 1790902800000,
  };
  const CUSTOM_SEED = {
    restockId: `seed:custom:${T}`,
    startedAtMs: T,
    inventory: [{ itemType: 'Seed', species: 'Sunflower', initialStock: 3 }],
  };

  function seedState(myData: Record<string, unknown>, customInventory: Record<string, unknown> | null = CUSTOM_SEED) {
    const restock = extractMyDataCustomRestocks(myData)?.seed ?? null;
    return buildCategoryState('seeds', GLOBAL_SEED, extractMyDataShopPurchases(myData), customInventory, restock);
  }

  function myData(seedBucket: Record<string, unknown> | null, purchasedAt: number | null = T): Record<string, unknown> {
    return {
      shopPurchases: { seed: seedBucket, egg: { restockId: 'egg:1', startedAtMs: 1, purchases: {} } },
      customRestocks: { seed: purchasedAt == null ? null : { purchasedAt }, egg: null, tool: null, decor: null },
    };
  }

  it('(1) sells from the custom inventory while its id matches the live customRestocks entry', () => {
    const state = seedState(myData(null));
    expect(state.items.map((item) => item.id)).toEqual(['Sunflower']);
    expect(state.items[0]?.remaining).toBe(3);
    expect(state.secondsUntilRestock).toBe(200);
  });

  it('ignores a custom inventory when customRestocks has no live entry', () => {
    const state = seedState(myData(null, null));
    expect(state.items.map((item) => item.id)).toEqual(['Carrot']);
  });

  it('(2) counts a bucket stamped with the custom restock id', () => {
    const item = seedState(myData({ restockId: `seed:custom:${T}`, startedAtMs: T, purchases: { Sunflower: 1 } })).items[0];
    expect(item?.purchased).toBe(1);
    expect(item?.remaining).toBe(2);
  });

  it('(3) a bucket from the older global cycle counts 0 against the custom restock', () => {
    const item = seedState(myData({ restockId: 'seed:5969118', startedAtMs: 1790902800000, purchases: { Sunflower: 2 } })).items[0];
    expect(item?.purchased).toBe(0);
    expect(item?.remaining).toBe(3);
  });

  it('(6) no stock when the custom inventory id does not match purchasedAt', () => {
    expect(seedState(myData(null), { ...CUSTOM_SEED, restockId: `seed:custom:${T - 1}` }).items).toEqual([]);
    expect(seedState(myData(null), null).items).toEqual([]);
  });

  it('reads the pre-v1361 `.items` field when `.inventory` is absent', () => {
    const { inventory, ...rest } = CUSTOM_SEED;
    const state = seedState(myData(null), { ...rest, items: inventory });
    expect(state.items.map((item) => item.id)).toEqual(['Sunflower']);
  });
});
