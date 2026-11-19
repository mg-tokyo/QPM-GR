import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopStockCategoryState, ShopStockState } from '../../../store/shopStock';

const store = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (key: string, fallback: unknown = null) => (store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : fallback),
    set: (key: string, value: unknown) => { store.set(key, JSON.parse(JSON.stringify(value))); },
    remove: (key: string) => { store.delete(key); },
  },
}));
vi.mock('./alertDom', () => ({ upsertAlert: vi.fn(), removeAlert: vi.fn(), updateAlertQuantity: vi.fn() }));
vi.mock('./journalSeedCard', () => ({ isSeedEntry: () => false, resolveJournalCard: () => null }));
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
vi.mock('../../../store/restockTracked', () => ({ loadTrackedSet: () => new Set(), isTrackedItem: () => true }));
vi.mock('../../../store/shopRegistry', () => ({ isWeatherGatedShop: () => false }));
vi.mock('../../../catalogs/shopEligibility', () => ({ getItemCatalogName: () => null }));
vi.mock('../../../utils/restock/dataService', () => ({ canonicalItemId: (_s: string, id: string) => id }));
vi.mock('../../../store/shopStockParsers', () => ({ getShopEntryIdentity: () => null }));
vi.mock('../../../types/shops', () => ({ isWeatherShopType: () => false }));
const ownedOneTime = vi.hoisted(() => new Set<string>());
vi.mock('./oneTimeOwnership', () => ({
  readOwnershipData: () => ({}),
  isOwnedOneTimeItem: (id: string) => ownedOneTime.has(id),
}));

const KEY = 'qpm.restock.dismissedRestocks.v2';

function category(name: string, restockId: string | null, itemIds: string[]): ShopStockCategoryState {
  return {
    category: name,
    secondsUntilRestock: null,
    nextRestockAt: 1_000,
    restockIntervalMs: null,
    items: itemIds.map((id, index) => ({
      category: name, id, label: id, orderIndex: index, initialStock: 5, currentStock: 5, remaining: 5,
      purchased: 0, canSpawn: true, isAvailable: true, priceCoins: 10, priceCredits: null, priceMagicDust: null,
      quantityPerPurchase: 1, raw: { species: id },
    })),
    availableCount: itemIds.length,
    signature: '',
    updatedAt: 0,
    raw: null,
    restockId,
  };
}

function state(...cats: ShopStockCategoryState[]): ShopStockState {
  return { updatedAt: 0, categories: Object.fromEntries(cats.map((c) => [c.category, c])) };
}

async function boot() {
  vi.resetModules();
  const sp = await import('./stockProcessor');
  const dom = await import('./alertDom');
  const st = await import('./alertState');
  sp.loadDismissedCycles();
  const upsert = vi.mocked(dom.upsertAlert);
  upsert.mockClear();
  const shown = (): string[] => upsert.mock.calls.map(([model]) => model.key);
  const dismiss = (key: string): void => {
    const cycleId = upsert.mock.calls.filter(([model]) => model.key === key).at(-1)?.[0].stockCycleId ?? null;
    st.dismissedInStockKeys.add(key);
    sp.markDismissedCycle(key, cycleId);
  };
  return { sp, shown, dismiss, upsert };
}

describe('restock dismissals keyed by restockId (ALR-7.2)', () => {
  beforeEach(() => { store.clear(); });

  it('a dismissal survives a reload while the shop sells the same restock', async () => {
    const first = await boot();
    first.sp.processShopStock(state(category('seeds', 'seed:1', ['Carrot'])));
    expect(first.upsert.mock.calls[0]?.[0].stockCycleId).toBe('rid:seed:1');
    first.dismiss('seed:carrot');
    expect(store.get(KEY)).toEqual({ 'seed:carrot': { restockId: 'seed:1', shop: 'seeds' } });

    const reloaded = await boot();
    reloaded.sp.processShopStock(state(category('seeds', 'seed:1', ['Carrot'])));
    expect(reloaded.shown()).toEqual([]);
  });

  it('a new restockId brings the card back and drops the stored dismissal', async () => {
    const first = await boot();
    first.sp.processShopStock(state(category('seeds', 'seed:1', ['Carrot'])));
    first.dismiss('seed:carrot');

    const reloaded = await boot();
    reloaded.sp.processShopStock(state(category('seeds', 'seed:2', ['Carrot'])));
    expect(reloaded.shown()).toEqual(['seed:carrot']);
    expect(store.has(KEY)).toBe(false);
  });

  it('prunes a dismissal for an item missing from its shop once the shop moves on', async () => {
    const first = await boot();
    first.sp.processShopStock(state(category('seeds', 'seed:1', ['Carrot', 'Tulip'])));
    first.dismiss('seed:carrot');
    first.dismiss('seed:tulip');

    const reloaded = await boot();
    reloaded.sp.processShopStock(state(category('seeds', 'seed:1', ['Tulip'])));
    expect(store.get(KEY)).toEqual({
      'seed:carrot': { restockId: 'seed:1', shop: 'seeds' },
      'seed:tulip': { restockId: 'seed:1', shop: 'seeds' },
    });
    reloaded.sp.processShopStock(state(category('seeds', 'seed:2', ['Tulip'])));
    expect(store.has(KEY)).toBe(false);
  });

  it('keeps a dismissal while its shop has no current restockId, and leaves other shops alone', async () => {
    const first = await boot();
    first.sp.processShopStock(state(category('seeds', 'seed:1', ['Carrot'])));
    first.dismiss('seed:carrot');

    const reloaded = await boot();
    reloaded.sp.processShopStock(state(category('seeds', null, []), category('eggs', 'egg:9', [])));
    expect(store.get(KEY)).toEqual({ 'seed:carrot': { restockId: 'seed:1', shop: 'seeds' } });
  });

  it('without a restockId the old in-memory behaviour holds: nothing stored, the card returns after a reload', async () => {
    const first = await boot();
    first.sp.processShopStock(state(category('seeds', null, ['Carrot'])));
    expect(first.upsert.mock.calls[0]?.[0].stockCycleId).toBe('next:1000:cycle:1');
    first.dismiss('seed:carrot');
    first.sp.processShopStock(state(category('seeds', null, ['Carrot'])));
    expect(first.shown()).toEqual(['seed:carrot']);
    expect(store.has(KEY)).toBe(false);

    const reloaded = await boot();
    reloaded.sp.processShopStock(state(category('seeds', null, ['Carrot'])));
    expect(reloaded.shown()).toEqual(['seed:carrot']);
  });
});

describe('owned one-time items raise no card (ALR-7.1)', () => {
  beforeEach(() => { store.clear(); ownedOneTime.clear(); });

  it('a pinned owned one-time item shows no card; an unowned one still does', async () => {
    ownedOneTime.add('SeedSilo');
    const run = await boot();
    run.sp.processShopStock(state(category('decor', 'decor:1', ['SeedSilo', 'PetHutch'])));
    expect(run.shown()).toEqual(['decor:pethutch']);
  });

  it('a card mid-purchase is left to finish its own display', async () => {
    const run = await boot();
    const st = await import('./alertState');
    st.pendingOwnershipConfirmations.set('decor:seedsilo', {} as never);
    ownedOneTime.add('SeedSilo');
    run.sp.processShopStock(state(category('decor', 'decor:1', ['SeedSilo'])));
    expect(run.shown()).toEqual(['decor:seedsilo']);
    st.pendingOwnershipConfirmations.clear();
  });
});
