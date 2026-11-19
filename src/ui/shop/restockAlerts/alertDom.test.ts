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

let mockRarityById: Map<string, string>;

vi.mock('../../../catalogs/shopEligibility', () => ({
  getItemCatalogSpriteKey: () => null,
  getItemCatalogRarity: (id: string) => mockRarityById.get(id) ?? null,
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

let cardSizes = new Map<string, number>();
vi.mock('../../../features/alertHub/settings', () => ({
  getRowCardSize: (id: string) => cardSizes.get(id) ?? 1,
  clampCardSize: (v: number) => Math.min(1.3, Math.max(0.7, Math.round(v * 10) / 10)),
  getAlertRowSettings: (_id: string, soundId: string) => ({ enabled: false, soundId }),
  writeRowCardSize: (id: string, v: number) => { cardSizes.set(id, v); return v; },
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
    autoStoreInFlight: false, autoStoreAwaitingStack: false, autoStoreFinalMoveRequested: false,
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
  mockRarityById = new Map();
  cardSizes = new Map();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
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

describe('removeAlert — pending purchases', () => {
  const presenter = { showStaleNotice: vi.fn(), showProgress: vi.fn(), showCompletion: vi.fn(), showFailure: vi.fn(), showRefusal: vi.fn(() => true) };

  it("clears the card's own pending that is still awaiting purchase confirmation", async () => {
    const { removeAlert } = await loadAlertDom();
    const { pendingOwnershipConfirmations } = await loadAlertState();
    pendingOwnershipConfirmations.set('seed:CarrotSeed', { ...makePending('seed:CarrotSeed'), presenter });

    removeAlert('seed:CarrotSeed');
    expect(mockClearPendingCalls).toEqual(['seed:CarrotSeed']);
  });

  it('leaves a headless purchaseAndConfirm pending to its own signals', async () => {
    const { removeAlert } = await loadAlertDom();
    const { pendingOwnershipConfirmations } = await loadAlertState();
    pendingOwnershipConfirmations.set('seed:CarrotSeed', makePending('seed:CarrotSeed'));

    removeAlert('seed:CarrotSeed');
    expect(mockClearPendingCalls).toEqual([]);
  });

  it('leaves a confirmed pending that only awaits its auto-store verdict', async () => {
    const { removeAlert } = await loadAlertDom();
    const { pendingOwnershipConfirmations } = await loadAlertState();
    pendingOwnershipConfirmations.set('seed:CarrotSeed', {
      ...makePending('seed:CarrotSeed'),
      presenter,
      confirmed: 1,
      autoStoreInFlight: true,
      deferredCompletionSuffix: '',
    });

    removeAlert('seed:CarrotSeed');
    expect(mockClearPendingCalls).toEqual([]);
  });
});

describe('createAlert — card shell look (ALR-17.3)', () => {
  it('draws on the shell with the catalog rarity token as the card colour', async () => {
    mockRarityById.set('CarrotSeed', 'Legendary');
    const { createAlert } = await loadAlertDom();
    const active = createAlert(makeModel());

    expect(active.root.classList.contains('qpm-alert-card')).toBe(true);
    expect(active.root.classList.contains('qpm-alert-card--accent')).toBe(true);
    expect(active.root.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-rarity-legendary)');
    expect(active.root.dataset.qpmRarity).toBe('Legendary');
    expect(document.getElementById('qpm-alert-card-style')).not.toBeNull();
    expect(active.root.querySelector('.qpm-alert-card__caption')?.textContent).toBe('feature.restockAlert.pinnedRestocked');
    expect(active.itemEl.textContent).toBe('Carrot Seed');
    expect(active.qtyEl.textContent).toBe('qty:3');
  });

  it("maps the game's 'Mythical' to the mythic token", async () => {
    mockRarityById.set('CarrotSeed', 'Mythical');
    const { createAlert } = await loadAlertDom();
    const active = createAlert(makeModel());
    expect(active.root.style.getPropertyValue('--qpm-alert-color')).toBe('var(--qpm-rarity-mythic)');
  });

  it('keeps the plain border for a weather alert and an unknown rarity', async () => {
    mockRarityById.set('Rain', 'Rare');
    const { createAlert } = await loadAlertDom();
    const weather = createAlert(makeModel({ key: 'weather:Rain', itemId: 'Rain', label: 'Rain', isWeatherAlert: true, weatherDurationMs: 300_000 }));
    const unknown = createAlert(makeModel({ key: 'seed:Mystery', itemId: 'Mystery', label: 'Mystery' }));

    for (const active of [weather, unknown]) {
      expect(active.root.classList.contains('qpm-alert-card--accent')).toBe(false);
      expect(active.root.style.getPropertyValue('--qpm-alert-color')).toBe('');
    }
    expect(weather.buyBtn.style.display).toBe('none');
  });

  it('shows the letter fallback when no sprite resolves', async () => {
    const { createAlert } = await loadAlertDom();
    const active = createAlert(makeModel());
    expect(active.iconImg.style.display).toBe('none');
    expect(active.iconFallbackEl.textContent).toBe('C');
    expect(active.iconFallbackEl.style.display).toBe('');
  });

  it('exits with the shell exit class', async () => {
    const { createAlert, removeAlert } = await loadAlertDom();
    const active = createAlert(makeModel());
    removeAlert('seed:CarrotSeed');
    expect(active.root.classList.contains('qpm-alert-card--exit')).toBe(true);
  });
});

describe('restock + weather card size, one for all (ALR-17.11b)', () => {
  const scaleOf = (el: HTMLElement): string => el.style.getPropertyValue('--qpm-alert-scale');
  const weatherModel = (): AlertModel => makeModel({ key: 'weather:Rain', itemId: 'Rain', label: 'Rain', isWeatherAlert: true, weatherDurationMs: 300_000 });

  it('opens at the default size with no scale set', async () => {
    const { createAlert } = await loadAlertDom();
    expect(scaleOf(createAlert(makeModel()).root)).toBe('');
  });

  it('opens restock and weather cards at the stored size', async () => {
    cardSizes.set('linked.restock', 1.2);
    const { createAlert } = await loadAlertDom();
    expect(scaleOf(createAlert(makeModel()).root)).toBe('1.2');
    expect(scaleOf(createAlert(weatherModel()).root)).toBe('1.2');
  });

  it('preview resizes every open card without storing; set stores and resizes', async () => {
    const { createAlert } = await loadAlertDom();
    const { previewRestockCardSize, setRestockCardSize, getRestockCardSize } = await import('./cardSize');
    const a = createAlert(makeModel());
    const b = createAlert(weatherModel());

    previewRestockCardSize(0.8);
    expect([scaleOf(a.root), scaleOf(b.root)]).toEqual(['0.8', '0.8']);
    expect(cardSizes.has('linked.restock')).toBe(false);

    expect(setRestockCardSize(1.3)).toBe(1.3);
    expect(getRestockCardSize()).toBe(1.3);
    expect([scaleOf(a.root), scaleOf(b.root)]).toEqual(['1.3', '1.3']);

    setRestockCardSize(1);
    expect(scaleOf(a.root)).toBe('');
  });
});
