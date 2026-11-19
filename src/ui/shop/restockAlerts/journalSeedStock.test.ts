import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopStockCategoryState, ShopStockState } from '../../../store/shopStock';
import type { JournalCardInfo } from './types';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  pinned: new Set<string>(),
  journal: new Map<string, JournalCardInfo>(),
}));

vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (key: string, fallback: unknown = null) => (h.store.has(key) ? JSON.parse(JSON.stringify(h.store.get(key))) : fallback),
    set: (key: string, value: unknown) => { h.store.set(key, JSON.parse(JSON.stringify(value))); },
    remove: (key: string) => { h.store.delete(key); },
  },
}));
vi.mock('./alertDom', () => ({ upsertAlert: vi.fn(), removeAlert: vi.fn(), updateAlertQuantity: vi.fn() }));
vi.mock('./journalSeedCard', () => ({
  isSeedEntry: (shopType: string, itemType: string | undefined) => shopType === 'seed' || itemType === 'Seed',
  resolveJournalCard: (species: string, pinned: boolean) => {
    const info = h.journal.get(species);
    return info ? { ...info, pinned } : null;
  },
}));
vi.mock('./purchaseActions', () => ({
  applyInventoryCapToQuantity: (_s: string, _i: string, _k: string, qty: number) => qty,
  getToolInventoryLimitForAlert: () => null,
  getOwnedToolCount: () => 0,
}));
vi.mock('./ownershipTracker', () => ({
  asNonNegativeQuantity: (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null),
  toCanonicalKey: (shopType: string, itemId: string) => `${shopType}:${itemId.toLowerCase()}`,
  firstString: (values: unknown[]) => values.find((v): v is string => typeof v === 'string' && v.length > 0) ?? null,
  debugLog: vi.fn(),
  debugLogStockStateIfChanged: vi.fn(),
}));
vi.mock('../../../store/restockTracked', () => ({
  loadTrackedSet: () => new Set(),
  isTrackedItem: (_set: unknown, _shopType: string, id: string) => h.pinned.has(id),
}));
vi.mock('../../../store/shopRegistry', () => ({ isWeatherGatedShop: () => false }));
vi.mock('../../../catalogs/shopEligibility', () => ({ getItemCatalogName: () => null }));
vi.mock('../../../utils/restock/dataService', () => ({ canonicalItemId: (_s: string, id: string) => id }));
vi.mock('../../../store/shopStockParsers', () => ({ getShopEntryIdentity: () => null }));
vi.mock('../../../types/shops', () => ({ isWeatherShopType: () => false }));
vi.mock('./oneTimeOwnership', () => ({ readOwnershipData: () => ({}), isOwnedOneTimeItem: () => false }));

const info = (rowId = 'shops.journalSeed'): JournalCardInfo => ({ rowId, pinned: false, line: 'Journal: 4 variants missing', weatherLine: null, chips: [] });

function category(name: string, restockId: string | null, itemIds: string[], stock = 5): ShopStockCategoryState {
  return {
    category: name, secondsUntilRestock: null, nextRestockAt: 1_000, restockIntervalMs: null,
    items: itemIds.map((id, index) => ({
      category: name, id, label: id, orderIndex: index, initialStock: stock, currentStock: stock, remaining: stock,
      purchased: 0, canSpawn: true, isAvailable: true, priceCoins: 10, priceCredits: null, priceMagicDust: null,
      quantityPerPurchase: 1, raw: { species: id },
    })),
    availableCount: itemIds.length, signature: '', updatedAt: 0, raw: null, restockId,
  };
}

const state = (...cats: ShopStockCategoryState[]): ShopStockState => ({ updatedAt: 0, categories: Object.fromEntries(cats.map((c) => [c.category, c])) });

async function boot() {
  vi.resetModules();
  const sp = await import('./stockProcessor');
  const dom = await import('./alertDom');
  const st = await import('./alertState');
  sp.loadDismissedCycles();
  const upsert = vi.mocked(dom.upsertAlert);
  upsert.mockClear();
  return { sp, st, upsert, shown: () => upsert.mock.calls.map(([m]) => m.key) };
}

describe('journal seeds in the stock loop (ALR-16.4)', () => {
  beforeEach(() => {
    h.store.clear();
    h.pinned.clear();
    h.journal.clear();
  });

  it('a watched, unpinned seed in stock gets a card carrying the journal part', async () => {
    h.journal.set('Pumpkin', info());
    const run = await boot();
    run.sp.processShopStock(state(category('seeds', 'seed:1', ['Pumpkin', 'Carrot'])));
    expect(run.shown()).toEqual(['seed:pumpkin']);
    expect(run.upsert.mock.calls[0]?.[0].journal).toMatchObject({ rowId: 'shops.journalSeed', pinned: false });
  });

  it('not watched (owned, complete, or rows off) and not pinned → no card', async () => {
    const run = await boot();
    run.sp.processShopStock(state(category('seeds', 'seed:1', ['Pumpkin'])));
    expect(run.shown()).toEqual([]);
  });

  it('pinned and watched → one card, marked pinned; pinned only → no journal part', async () => {
    h.pinned.add('Pumpkin');
    h.pinned.add('Carrot');
    h.journal.set('Pumpkin', info());
    const run = await boot();
    run.sp.processShopStock(state(category('seeds', 'seed:1', ['Pumpkin', 'Carrot'])));
    expect(run.shown()).toEqual(['seed:pumpkin', 'seed:carrot']);
    expect(run.upsert.mock.calls[0]?.[0].journal?.pinned).toBe(true);
    expect(run.upsert.mock.calls[1]?.[0].journal).toBeUndefined();
  });

  it('out of stock → no card', async () => {
    h.journal.set('Pumpkin', info());
    const run = await boot();
    run.sp.processShopStock(state(category('seeds', 'seed:1', ['Pumpkin'], 0)));
    expect(run.shown()).toEqual([]);
  });

  it('only seed entries are matched: an egg with the same id is not a journal card', async () => {
    h.journal.set('Pumpkin', info());
    const run = await boot();
    run.sp.processShopStock(state(category('eggs', 'egg:1', ['Pumpkin'])));
    expect(run.shown()).toEqual([]);
  });

  it('dismissed stays quiet for that restock and returns with the next one (PD2)', async () => {
    h.journal.set('Pumpkin', info());
    const run = await boot();
    run.sp.processShopStock(state(category('seeds', 'seed:1', ['Pumpkin'])));
    run.st.dismissedInStockKeys.add('seed:pumpkin');
    run.sp.markDismissedCycle('seed:pumpkin', run.upsert.mock.calls[0]?.[0].stockCycleId ?? null);
    run.upsert.mockClear();
    run.sp.processShopStock(state(category('seeds', 'seed:1', ['Pumpkin'])));
    expect(run.shown()).toEqual([]);
    run.sp.processShopStock(state(category('seeds', 'seed:2', ['Pumpkin'])));
    expect(run.shown()).toEqual(['seed:pumpkin']);
  });

  it('a card mid-purchase keeps its journal part after the bought seed leaves the watched list', async () => {
    h.journal.set('Pumpkin', info());
    const run = await boot();
    run.sp.processShopStock(state(category('seeds', 'seed:1', ['Pumpkin'])));
    const model = run.upsert.mock.calls[0]?.[0];
    if (!model) throw new Error('no card');
    run.st.activeAlerts.set('seed:pumpkin', { model, busy: true } as never);
    h.journal.clear();
    run.upsert.mockClear();
    run.sp.processShopStock(state(category('seeds', 'seed:1', ['Pumpkin'])));
    expect(run.shown()).toEqual(['seed:pumpkin']);
    run.st.activeAlerts.delete('seed:pumpkin');
  });
});
