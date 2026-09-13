// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertModel, PendingOwnershipConfirmation } from './types';
import type { ShopStockItem } from '../../../store/shopStock';

let mockShopStockByKey: Map<string, ShopStockItem>;
let shopStockChangeCallbacks: Map<string, Array<(item: ShopStockItem | null) => void>>;
let mockMarkDismissedCycle: (key: string, cycleId: string | null) => void;
let mockClearPendingCalls: string[];

vi.mock('../../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (params && typeof params.qty === 'number') return `qty:${params.qty}`;
    return key;
  },
}));

vi.mock('../../../utils/restock/dataService', () => ({
  getItemIdVariants: () => [] as string[],
  canonicalItemId: (_shopType: string, id: string) => id,
}));

vi.mock('../../../sprite-v2/compat', () => ({
  getAnySpriteDataUrl: () => null,
  getCropSpriteCanvas: () => null,
  getPetSpriteCanvas:  () => null,
}));

vi.mock('../../../utils/dom/canvasHelpers', () => ({
  canvasToDataUrl: () => null,
}));

vi.mock('../../../catalogs/shopEligibility', () => ({
  getItemCatalogSpriteKey: () => null,
}));

vi.mock('./ownershipTracker', () => ({
  debugLog: () => { /* silenced */ },
  toCanonicalKey: (kind: string, id: string) => `${kind}:${id}`,
  clearPendingOwnershipConfirmation: (key: string) => { mockClearPendingCalls.push(key); },
}));

vi.mock('./purchaseActions', () => ({
  handleBuyAll: vi.fn(async () => { /* no-op */ }),
}));

vi.mock('./stockProcessor', () => ({
  markDismissedCycle: (key: string, cycleId: string | null) => mockMarkDismissedCycle(key, cycleId),
}));

vi.mock('../../../store/shopStock', () => ({
  getShopStockItemByKey: (key: string) => mockShopStockByKey.get(key) ?? null,
  onShopStockItemChange: (key: string, cb: (item: ShopStockItem | null) => void) => {
    const list = shopStockChangeCallbacks.get(key) ?? [];
    list.push(cb);
    shopStockChangeCallbacks.set(key, list);
    return () => {
      const arr = shopStockChangeCallbacks.get(key);
      if (!arr) return;
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    };
  },
}));

vi.mock('./soundConfig', () => ({
  getSoundConfig: () => null,
  getCustomSounds: () => ({}),
  DEFAULT_LOOP_INTERVAL_MS: 5_000,
}));

vi.mock('./soundEngine', () => ({
  playSound: vi.fn(async () => { /* no-op */ }),
  playCustomSound: vi.fn(async () => { /* no-op */ }),
  startLoop: vi.fn(),
  stopLoop: vi.fn(),
  isLooping: () => false,
  isBuiltinSound: () => true,
}));

async function loadAlertDom(): Promise<typeof import('./alertDom')> {
  return await import('./alertDom');
}

async function loadAlertState(): Promise<typeof import('./alertState')> {
  return await import('./alertState');
}

function makeModel(overrides: Partial<AlertModel> = {}): AlertModel {
  return {
    key: 'seed:CarrotSeed',
    shopType: 'seed',
    itemId: 'CarrotSeed',
    stockCycleId: 'cycle-1',
    label: 'Carrot Seed',
    quantity: 3,
    priceCoins: 100,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ShopStockItem> = {}): ShopStockItem {
  return {
    category: 'seed',
    id: 'CarrotSeed',
    label: 'Carrot Seed',
    orderIndex: 0,
    initialStock: 5,
    currentStock: 5,
    remaining: 5,
    purchased: 0,
    canSpawn: true,
    isAvailable: true,
    priceCoins: 100,
    priceCredits: null,
    priceMagicDust: null,
    quantityPerPurchase: 1,
    raw: {} as ShopStockItem['raw'],
    ...overrides,
  };
}

function fireCallback(key: string, item: ShopStockItem | null): void {
  const arr = shopStockChangeCallbacks.get(key) ?? [];
  for (const cb of arr.slice()) cb(item);
}

function makePending(key: string): PendingOwnershipConfirmation {
  return {
    key, shopType: 'seed', itemId: 'CarrotSeed', stockCycleId: 'cycle-1',
    expectedIncrease: 1, sent: 1,
    baseline: {
      count: 0, includeInventory: true, includeSeedSilo: true,
      includeDecorShed: true, includeToolShack: true,
      inventoryKeyItemQuantities: new Map(),
    },
    confirmed: 0,
    staleNoticeTimerId: null, staleNoticeShown: false, maxTimeoutTimerId: null,
    autoStoreInFlight: false, autoStoreFinalMoveRequested: false,
    autoStoreStorageId: null, autoStoreLabel: null, storedInTargetStorage: false,
    shopPurchasesBaseline: null, shopPurchasesArmed: false, cycleArmFp: null,
    cleanups: [], presenter: null, settle: null,
  };
}

beforeEach(() => {
  mockShopStockByKey = new Map();
  shopStockChangeCallbacks = new Map();
  mockMarkDismissedCycle = () => { /* no-op */ };
  mockClearPendingCalls = [];
  document.body.innerHTML = '';
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('armAlertPurchaseWatcher — cooperates with pending (T5)', () => {
  it('runs the growth-path even when a pending exists for the same key (short-circuit removed)', async () => {
    const alertDom = await loadAlertDom();
    const alertState = await loadAlertState();

    alertState.pendingOwnershipConfirmations.set('seed:CarrotSeed', makePending('seed:CarrotSeed'));
    mockShopStockByKey.set('seed:CarrotSeed', makeItem({ purchased: 10 }));

    alertDom.createAlert(makeModel({ quantity: 3 }));
    expect(alertState.alertPurchaseWatchers.has('seed:CarrotSeed')).toBe(true);

    fireCallback('seed:CarrotSeed', makeItem({ purchased: 10 }));
    let active = alertState.activeAlerts.get('seed:CarrotSeed');
    expect(active?.model.quantity).toBe(3);

    fireCallback('seed:CarrotSeed', makeItem({ purchased: 11 }));
    active = alertState.activeAlerts.get('seed:CarrotSeed');
    expect(active?.model.quantity).toBe(2);
  });

  it('without a pending, still dismisses when derived-remaining hits zero', async () => {
    const alertDom = await loadAlertDom();
    const alertState = await loadAlertState();
    const dismissedCycles: Array<[string, string | null]> = [];
    mockMarkDismissedCycle = (key, cycleId) => { dismissedCycles.push([key, cycleId]); };

    mockShopStockByKey.set('seed:CarrotSeed', makeItem({ purchased: 0 }));

    alertDom.createAlert(makeModel({ quantity: 2, stockCycleId: 'cycle-Z' }));

    fireCallback('seed:CarrotSeed', makeItem({ purchased: 0 }));
    fireCallback('seed:CarrotSeed', makeItem({ purchased: 2 }));

    expect(alertState.activeAlerts.has('seed:CarrotSeed')).toBe(false);
    expect(alertState.dismissedInStockKeys.has('seed:CarrotSeed')).toBe(true);
    expect(dismissedCycles).toEqual([['seed:CarrotSeed', 'cycle-Z']]);
    expect(mockClearPendingCalls).toContain('seed:CarrotSeed');
  });

  it('with a pending, derived-zero writes the decrement but leaves dismissal to the pending', async () => {
    const alertDom = await loadAlertDom();
    const alertState = await loadAlertState();

    alertState.pendingOwnershipConfirmations.set('seed:CarrotSeed', makePending('seed:CarrotSeed'));
    mockShopStockByKey.set('seed:CarrotSeed', makeItem({ purchased: 0 }));

    alertDom.createAlert(makeModel({ quantity: 1 }));

    fireCallback('seed:CarrotSeed', makeItem({ purchased: 0 }));
    fireCallback('seed:CarrotSeed', makeItem({ purchased: 1 }));

    // The pending's own listener (registered after this watcher) must still
    // find its entry to run completeFromShopPurchases + auto-store.
    expect(alertState.activeAlerts.has('seed:CarrotSeed')).toBe(true);
    expect(alertState.activeAlerts.get('seed:CarrotSeed')?.model.quantity).toBe(0);
    expect(mockClearPendingCalls).not.toContain('seed:CarrotSeed');
  });

  it('once the pending is gone, a later derived-zero tick dismisses as usual', async () => {
    const alertDom = await loadAlertDom();
    const alertState = await loadAlertState();

    alertState.pendingOwnershipConfirmations.set('seed:CarrotSeed', makePending('seed:CarrotSeed'));
    mockShopStockByKey.set('seed:CarrotSeed', makeItem({ purchased: 0 }));

    alertDom.createAlert(makeModel({ quantity: 2 }));
    fireCallback('seed:CarrotSeed', makeItem({ purchased: 0 }));
    fireCallback('seed:CarrotSeed', makeItem({ purchased: 1 }));
    expect(alertState.activeAlerts.get('seed:CarrotSeed')?.model.quantity).toBe(1);

    alertState.pendingOwnershipConfirmations.delete('seed:CarrotSeed');
    fireCallback('seed:CarrotSeed', makeItem({ purchased: 2 }));

    expect(alertState.activeAlerts.has('seed:CarrotSeed')).toBe(false);
  });
});
