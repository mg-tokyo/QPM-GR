import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CycleFingerprint,
  OwnershipBaseline,
  PendingOwnershipConfirmation,
  PendingPresenter,
} from './types';
import type { ShopStockItem } from '../../../store/shopStock';

let pendingOwnershipConfirmations: Map<string, PendingOwnershipConfirmation>;
let activeAlerts: Map<string, unknown>;
let dismissedInStockKeys: Set<string>;
let ownershipListeners: Set<() => void>;
let debugLastStockStateByKey: Map<string, string>;
let alertPurchaseWatchers: Map<string, unknown>;
let alertStateObj: Record<string, unknown>;

let mockShopStockByKey: Map<string, ShopStockItem>;
let shopStockChangeCallbacks: Map<string, Array<(item: ShopStockItem | null) => void>>;
let mockShouldLockDismiss: (key: string) => boolean;
let mockHasReachedCap: () => { reached: boolean; owned: number; limit: number };
let mockAutoStoreCalls: Array<{ key: string; confirmed: number }>;
let mockMarkDismissedCycle: (key: string, cycleId: string | null) => void;
let mockRemoveAlert: (key: string) => void;

vi.mock('./alertState', () => ({
  get activeAlerts() { return activeAlerts; },
  get pendingOwnershipConfirmations() { return pendingOwnershipConfirmations; },
  get dismissedInStockKeys() { return dismissedInStockKeys; },
  get ownershipListeners() { return ownershipListeners; },
  get debugLastStockStateByKey() { return debugLastStockStateByKey; },
  get alertPurchaseWatchers() { return alertPurchaseWatchers; },
  get alertState() { return alertStateObj; },
  alertSpriteUrlCache: new Map(),
  fallbackCycleByKey: new Map(),
  lastSeenStockQtyByKey: new Map(),
  dismissedCyclesByKey: new Map(),
  isAlertDebug: () => false,
  setAlertDebug: () => { /* no-op */ },
}));

vi.mock('./alertDom', () => ({
  updateAlertQuantity: vi.fn(),
  removeAlert: (key: string) => mockRemoveAlert(key),
}));

vi.mock('./purchaseActions', () => ({
  hasReachedToolInventoryCap: () => mockHasReachedCap(),
  shouldLockDismissForPurchaseCompletion: (key: string) => mockShouldLockDismiss(key),
  maybeAutoStoreConfirmedDelta: async (p: PendingOwnershipConfirmation, confirmed: number) => {
    mockAutoStoreCalls.push({ key: p.key, confirmed });
  },
}));

vi.mock('./stockProcessor', () => ({
  processShopStock: vi.fn(),
  markDismissedCycle: (key: string, cycleId: string | null) => mockMarkDismissedCycle(key, cycleId),
}));

vi.mock('../../../store/shopStock', () => ({
  getShopStockState: () => ({ updatedAt: 0, categories: {} }),
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

vi.mock('./_diagnostics', () => ({
  warnFeature: () => { /* no-op */ },
}));

vi.mock('../../../types/shops', () => ({
  isWeatherShopType: (id: string) => !['seed', 'egg', 'tool', 'decor'].includes(id),
}));

vi.mock('./ownershipCounts', () => ({
  toLowerTrimmed: (v: string) => v.toLowerCase().trim(),
  toTrimmedString: (v: unknown) => (typeof v === 'string' ? v.trim() : ''),
  toNonNegativeInteger: (v: unknown) => (typeof v === 'number' ? Math.max(0, Math.floor(v)) : null),
  firstString: (values: unknown[]) => {
    for (const v of values) if (typeof v === 'string' && v.length > 0) return v;
    return null;
  },
  addCount: (m: Map<string, number>, k: string, v: number) => { m.set(k, (m.get(k) ?? 0) + v); },
  normalizeShopType: (v: string) => v,
  toCanonicalKey: (kind: string, id: string) => `${kind}:${id}`,
  getInventoryItemKey: (v: string) => v,
  buildInventoryKeyCounts: () => new Map<string, number>(),
  buildInventoryKeyItemQuantities: () => new Map<string, Map<string, number>>(),
  buildSeedSiloKeyCounts:  () => new Map<string, number>(),
  buildDecorShedKeyCounts: () => new Map<string, number>(),
  buildToolShackKeyCounts: () => new Map<string, number>(),
}));

async function loadModule(): Promise<typeof import('./ownershipTracker')> {
  return await import('./ownershipTracker');
}

function fireCallback(key: string, item: ShopStockItem | null): void {
  const arr = shopStockChangeCallbacks.get(key) ?? [];
  for (const cb of arr.slice()) cb(item);
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

function makePresenter(): PendingPresenter & {
  showStaleNoticeCalls: number[];
  showProgressCalls: Array<{ confirmed: number; sent: number }>;
  showCompletionCalls: number;
  showFailureCalls: string[];
} {
  const p = {
    showStaleNoticeCalls: [] as number[],
    showProgressCalls: [] as Array<{ confirmed: number; sent: number }>,
    showCompletionCalls: 0,
    showFailureCalls: [] as string[],
    showStaleNotice(sent: number) { p.showStaleNoticeCalls.push(sent); },
    showProgress(confirmed: number, sent: number) { p.showProgressCalls.push({ confirmed, sent }); },
    showCompletion() { p.showCompletionCalls += 1; },
    showFailure(reason: string) { p.showFailureCalls.push(reason); },
  };
  return p;
}

function makeBaseline(): OwnershipBaseline {
  return {
    count: 0,
    includeInventory: true,
    includeSeedSilo: true,
    includeDecorShed: true,
    includeToolShack: true,
    inventoryKeyItemQuantities: new Map(),
  };
}

function makePending(key: string, presenter: PendingPresenter | null, overrides: Partial<PendingOwnershipConfirmation> = {}): PendingOwnershipConfirmation {
  return {
    key,
    shopType: 'seed',
    itemId: 'CarrotSeed',
    stockCycleId: 'cycle-1',
    expectedIncrease: 1,
    sent: 1,
    baseline: makeBaseline(),
    confirmed: 0,
    staleNoticeTimerId: null,
    staleNoticeShown: false,
    maxTimeoutTimerId: null,
    autoStoreInFlight: false,
    autoStoreFinalMoveRequested: false,
    autoStoreStorageId: null,
    autoStoreLabel: null,
    storedInTargetStorage: false,
    shopPurchasesBaseline: null,
    shopPurchasesArmed: false,
    cycleArmFp: null,
    cleanups: [],
    presenter,
    settle: null,
    ...overrides,
  };
}

beforeEach(() => {
  pendingOwnershipConfirmations = new Map();
  activeAlerts = new Map();
  dismissedInStockKeys = new Set();
  ownershipListeners = new Set();
  debugLastStockStateByKey = new Map();
  alertPurchaseWatchers = new Map();
  alertStateObj = {
    inventoryKeyCounts:         new Map<string, number>(),
    seedSiloKeyCounts:          new Map<string, number>(),
    decorShedKeyCounts:         new Map<string, number>(),
    toolShackKeyCounts:         new Map<string, number>(),
    toolInventoryKeyCounts:     new Map<string, number>(),
    inventoryKeyItemQuantities: new Map<string, Map<string, number>>(),
    hasInventoryBaseline:  true,
    hasSeedSiloBaseline:   true,
    hasDecorShedBaseline:  true,
    hasToolShackBaseline:  true,
    hasToolInventoryBaseline: true,
    started: false,
  };
  mockShopStockByKey = new Map();
  shopStockChangeCallbacks = new Map();
  mockShouldLockDismiss = () => false;
  mockHasReachedCap = () => ({ reached: false, owned: 0, limit: 0 });
  mockAutoStoreCalls = [];
  mockMarkDismissedCycle = () => { /* no-op */ };
  mockRemoveAlert = () => { /* no-op */ };
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('armReactiveConfirmation — late-arm (T4)', () => {
  it('leaves shopPurchasesArmed=false when the item bucket is empty at arm time', async () => {
    const mod = await loadModule();
    const pending = makePending('seed:CarrotSeed', null);
    pendingOwnershipConfirmations.set(pending.key, pending);

    mod.armReactiveConfirmation(pending);

    expect(pending.shopPurchasesArmed).toBe(false);
    expect(pending.shopPurchasesBaseline).toBeNull();
    expect(pending.cycleArmFp).toBeNull();
  });

  it('late-arms baseline on the first non-null item tick without counting it as a delta', async () => {
    const mod = await loadModule();
    const presenter = makePresenter();
    const pending = makePending('seed:CarrotSeed', presenter);
    pendingOwnershipConfirmations.set(pending.key, pending);

    mod.armReactiveConfirmation(pending);
    fireCallback('seed:CarrotSeed', makeItem({ purchased: 7 }));

    expect(pending.shopPurchasesArmed).toBe(true);
    expect(pending.shopPurchasesBaseline).toBe(7);
    expect(pending.cycleArmFp).not.toBeNull();
    expect(presenter.showCompletionCalls).toBe(0);
    expect(pendingOwnershipConfirmations.has(pending.key)).toBe(true);
  });

  it('settles from the late-armed baseline on the next tick where purchased grows enough', async () => {
    const mod = await loadModule();
    const presenter = makePresenter();
    const pending = makePending('seed:CarrotSeed', presenter, { expectedIncrease: 1 });
    pendingOwnershipConfirmations.set(pending.key, pending);

    mod.armReactiveConfirmation(pending);
    fireCallback('seed:CarrotSeed', makeItem({ purchased: 3 }));
    expect(pending.shopPurchasesArmed).toBe(true);
    expect(presenter.showCompletionCalls).toBe(0);

    fireCallback('seed:CarrotSeed', makeItem({ purchased: 4 }));
    expect(presenter.showCompletionCalls).toBe(1);
    expect(pending.confirmed).toBe(1);
    expect(pendingOwnershipConfirmations.has(pending.key)).toBe(false);
    expect(mockAutoStoreCalls).toEqual([{ key: 'seed:CarrotSeed', confirmed: 1 }]);
  });

  it('arm-at-buy-time still works: item present at arm, delta on next tick completes without a late-arm branch', async () => {
    const mod = await loadModule();
    const presenter = makePresenter();
    const pending = makePending('seed:CarrotSeed', presenter, { expectedIncrease: 2 });
    pendingOwnershipConfirmations.set(pending.key, pending);
    mockShopStockByKey.set('seed:CarrotSeed', makeItem({ purchased: 10 }));

    mod.armReactiveConfirmation(pending);
    expect(pending.shopPurchasesArmed).toBe(true);
    expect(pending.shopPurchasesBaseline).toBe(10);

    fireCallback('seed:CarrotSeed', makeItem({ purchased: 12 }));
    expect(presenter.showCompletionCalls).toBe(1);
    expect(pending.confirmed).toBe(2);
    expect(pendingOwnershipConfirmations.has(pending.key)).toBe(false);
  });

  it('cycleArmFp is captured at late-arm time so a subsequent cycle roll fails the pending', async () => {
    const mod = await loadModule();
    const markedDismissed: Array<[string, string | null]> = [];
    const removedKeys: string[] = [];
    mockMarkDismissedCycle = (key, cycleId) => { markedDismissed.push([key, cycleId]); };
    mockRemoveAlert = (key) => { removedKeys.push(key); };

    const presenter = makePresenter();
    const pending = makePending('seed:CarrotSeed', presenter, { stockCycleId: 'cycle-A' });
    pendingOwnershipConfirmations.set(pending.key, pending);

    mod.armReactiveConfirmation(pending);
    fireCallback('seed:CarrotSeed', makeItem({ purchased: 0, initialStock: 5, canSpawn: true }));
    expect(pending.shopPurchasesArmed).toBe(true);
    const armFp = pending.cycleArmFp as CycleFingerprint;
    expect(armFp.initialStock).toBe(5);
    expect(armFp.canSpawn).toBe(true);

    fireCallback('seed:CarrotSeed', makeItem({ purchased: 0, initialStock: 8, canSpawn: true }));
    expect(pendingOwnershipConfirmations.has(pending.key)).toBe(false);
    expect(dismissedInStockKeys.has(pending.key)).toBe(true);
    expect(markedDismissed).toEqual([['seed:CarrotSeed', 'cycle-A']]);
    expect(removedKeys).toEqual(['seed:CarrotSeed']);
  });
});
