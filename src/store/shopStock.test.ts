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

const SERVER_AHEAD_MS = 400;
let clockAvailable = false;
vi.mock('./serverClock', () => ({
  getServerNowMs: () => (clockAvailable ? Date.now() + SERVER_AHEAD_MS : null),
}));

const {
  startShopStockStore,
  stopShopStockStore,
  getShopStockState,
  getShopStockItemByKey,
  getPurchaseBucket,
  onShopStock,
  onShopStockItemChange,
} = await import('./shopStock');

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
  clockAvailable = false;
  vi.useRealTimers();
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

describe('shop stock item index', () => {
  it('serves the new cycle to onShopStock listeners at a restock, then fires per-key listeners', async () => {
    atomValues.set('shops', { egg: { inventory: INVENTORY, restockId: 'egg:1', startedAtMs: 1000 } });
    atomValues.set('myData', { shopPurchases: { egg: EGG_BUCKET } });
    await startShopStockStore();
    expect(getShopStockItemByKey('egg:commonegg')?.purchased).toBe(3);

    const order: string[] = [];
    const seenInListener: Array<number | undefined> = [];
    const offState = onShopStock(() => {
      order.push('state');
      seenInListener.push(getShopStockItemByKey('egg:commonegg')?.purchased);
    }, false);
    const offItem = onShopStockItemChange('egg:commonegg', (item) => { order.push(`item:${item?.purchased}`); });

    push('shops', { egg: { inventory: INVENTORY, restockId: 'egg:2', startedAtMs: 2000 } });
    expect(seenInListener).toEqual([0]);
    expect(order).toEqual(['state', 'item:0']);
    offState();
    offItem();
  });
});

describe('shop deadline gate', () => {
  const DEADLINE = 1794116700000;
  const NEXT_DEADLINE = DEADLINE + 300_000;
  const eggShop = (restockId: string, deadlineMs: number) => ({
    egg: { inventory: INVENTORY, restockId, startedAtMs: deadlineMs - 300_000, deadlineMs },
  });

  async function startAtServerTime(serverNowMs: number): Promise<void> {
    vi.useFakeTimers({ now: serverNowMs - SERVER_AHEAD_MS });
    clockAvailable = true;
    atomValues.set('shops', eggShop('egg:1', DEADLINE));
    atomValues.set('myData', { shopPurchases: { egg: { restockId: 'egg:1', startedAtMs: DEADLINE - 300_000, purchases: {} } } });
    await startShopStockStore();
  }

  it('drops the shop at its deadline with one rebuild, then restores it at the roll', async () => {
    await startAtServerTime(DEADLINE - 100);
    expect(eggIds()).toEqual(['CommonEgg']);
    expect(vi.getTimerCount()).toBe(1);

    let notifies = 0;
    const itemEvents: Array<string | null> = [];
    const offState = onShopStock(() => { notifies += 1; }, false);
    const offItem = onShopStockItemChange('egg:commonegg', (item) => { itemEvents.push(item?.id ?? null); });

    vi.advanceTimersByTime(149);
    expect(eggIds()).toEqual(['CommonEgg']);
    vi.advanceTimersByTime(1);
    expect(eggIds()).toEqual([]);
    expect(notifies).toBe(1);
    expect(itemEvents).toEqual([null]);
    expect(getShopStockState().categories.eggs?.nextRestockAt).toBe(DEADLINE);
    expect(vi.getTimerCount()).toBe(0);

    push('myData', { shopPurchases: { egg: { restockId: 'egg:1', startedAtMs: DEADLINE - 300_000, purchases: {} } } });
    expect(notifies).toBe(1);
    expect(itemEvents).toEqual([null]);

    push('shops', eggShop('egg:2', NEXT_DEADLINE));
    expect(eggIds()).toEqual(['CommonEgg']);
    expect(notifies).toBe(2);
    expect(itemEvents).toEqual([null, 'CommonEgg']);
    expect(vi.getTimerCount()).toBe(1);
    offState();
    offItem();
  });

  it('keeps one timer across rebuilds and none after stop', async () => {
    await startAtServerTime(DEADLINE - 10_000);
    push('shops', eggShop('egg:1', DEADLINE));
    push('myUserSlot', { customRestockInventories: null });
    expect(vi.getTimerCount()).toBe(1);
    stopShopStockStore();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('arms nothing without a future deadline and stays ungated without a clock', async () => {
    await startAtServerTime(DEADLINE + 50);
    expect(eggIds()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    clockAvailable = false;
    push('shops', eggShop('egg:1', DEADLINE));
    expect(eggIds()).toEqual(['CommonEgg']);
  });

  it('exposes the raw purchase bucket per category', async () => {
    await startAtServerTime(DEADLINE - 100);
    push('myData', { shopPurchases: { egg: { restockId: 'egg:1', startedAtMs: 1, purchases: { CommonEgg: 1 } } } });
    expect(getPurchaseBucket('eggs')?.restockId).toBe('egg:1');
    expect(getPurchaseBucket('seeds')).toBeNull();
  });
});
