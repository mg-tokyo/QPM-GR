import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertModel, OwnershipBaseline } from './types';
import type { ShopStockItem } from '../../../store/shopStock';
import type { WebSocketSendResult } from '../../../websocket/api';
import type { QuinoaCommandResultMessage } from '../../../websocket/envelope';
import { isValidPurchaseShopItem, type PurchaseShopItemPayload } from '../../../websocket/validation';

let sentPayloads: Array<Record<string, unknown>>;
let sendResult: WebSocketSendResult;
let stockByKey: Map<string, Partial<ShopStockItem>>;
let balances: { coinsBalance: number | null; magicDustBalance: number | null };
let stackCap: number | null;
let catalogPricing: { coinPrice: number | null; dustPrice: number | null; rarity: string | null } | null;

vi.mock('../../../catalogs/shopEligibility', () => ({ getItemCatalogPricing: () => catalogPricing }));
vi.mock('../../../websocket/api', () => ({
  isRoomSessionReady: () => true,
  isRoomSocketOpen: () => true,
  sendRoomAction: (_type: string, payload: Record<string, unknown>) => { sentPayloads.push(payload); return sendResult; },
}));
vi.mock('../../../core/gameState', () => ({
  isGameStateReady: () => true,
  readSync: (key: 'coinsBalance' | 'magicDustBalance') => balances[key],
}));
vi.mock('../../../store/shopStock', () => ({
  getShopStockItemByKey: (key: string) => stockByKey.get(key) ?? null,
}));
vi.mock('../../../i18n', () => ({ t: (key: string) => key }));
vi.mock('./ownershipTracker', () => ({
  armReactiveConfirmation: vi.fn(),
  captureOwnershipBaseline: (): OwnershipBaseline => ({
    count: 0, includeInventory: true, includeSeedSilo: true, includeDecorShed: true, includeToolShack: true,
    inventoryKeyItemQuantities: new Map(),
  }),
  debugLog: vi.fn(),
  hasOwnershipSource: () => true,
  processPendingOwnershipConfirmations: vi.fn(),
  scheduleMaxConfirmationTimeout: vi.fn(),
  waitForOwnershipBaselines: async () => { /* baselines ready */ },
}));
vi.mock('./alertState', () => ({ pendingOwnershipConfirmations: new Map() }));
vi.mock('./purchaseActions', () => ({
  applyInventoryCapToQuantity: (_s: string, _i: string, _k: string, requested: number) =>
    (stackCap == null ? requested : Math.min(requested, stackCap)),
}));
vi.mock('./autoStore', () => ({ resolveAutoStoreTarget: () => null }));
vi.mock('./shopViewMode', () => ({ resolveShopViewMode: () => 'grid' }));

const { buildPurchasePayload, sendPurchaseBatch } = await import('./purchasePipeline');

const KEY = 'seed:Carrot';
const model: AlertModel = { key: KEY, shopType: 'seed', itemId: 'Carrot', stockCycleId: null, label: 'Carrot', quantity: 5, priceCoins: 10 };
const okReply = { type: 'QuinoaCommandResult', requestId: 'r', ok: true } as QuinoaCommandResultMessage;

beforeEach(() => {
  sentPayloads = [];
  sendResult = { ok: true, transport: 'envelope', awaitResult: async () => okReply };
  stockByKey = new Map([[KEY, { remaining: 20, priceCoins: 10, priceMagicDust: null }]]);
  balances = { coinsBalance: 1_000_000, magicDustBalance: 0 };
  stackCap = null;
  catalogPricing = null;
});

describe('buildPurchasePayload', () => {
  it('omits quantity for a single unit, like the game', () => {
    const p = buildPurchasePayload('seed', 'Carrot', 1);
    expect(p).toEqual({ shop: 'seed', viewMode: 'grid', item: { itemType: 'Seed', species: 'Carrot' } });
    expect(isValidPurchaseShopItem(p)).toBe(true);
  });

  it('carries quantity for a batch', () => {
    const p = buildPurchasePayload('egg', 'CommonEgg', 4);
    expect(p).toEqual({ shop: 'egg', viewMode: 'grid', item: { itemType: 'Egg', eggId: 'CommonEgg' }, quantity: 4 });
    expect(isValidPurchaseShopItem(p)).toBe(true);
  });

  it('validation rejects a non-integer or zero quantity and a missing viewMode', () => {
    const base = buildPurchasePayload('seed', 'Carrot', 1);
    expect(isValidPurchaseShopItem({ ...base, quantity: 0 })).toBe(false);
    expect(isValidPurchaseShopItem({ ...base, quantity: 1.5 })).toBe(false);
    const { viewMode: _drop, ...noViewMode } = base;
    expect(isValidPurchaseShopItem(noViewMode as PurchaseShopItemPayload)).toBe(false);
  });
});

describe('sendPurchaseBatch', () => {
  it('sends ONE command whose quantity is the request when nothing limits it', async () => {
    const r = await sendPurchaseBatch(model, 5);
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({ shop: 'seed', quantity: 5 });
    expect(r.sent).toBe(5);
    expect(r.error).toBeNull();
    expect(r.awaitResults?.map((a) => a.units)).toEqual([5]);
  });

  it('clamps to remaining stock', async () => {
    stockByKey.set(KEY, { remaining: 3, priceCoins: 10, priceMagicDust: null });
    expect((await sendPurchaseBatch(model, 5)).sent).toBe(3);
    expect(sentPayloads[0]).toMatchObject({ quantity: 3 });
  });

  it('clamps to the coin balance', async () => {
    balances.coinsBalance = 25;
    expect((await sendPurchaseBatch(model, 5)).sent).toBe(2);
  });

  it('dust-priced items use the dust balance and price', async () => {
    stockByKey.set(KEY, { remaining: 20, priceCoins: 10, priceMagicDust: 50 });
    balances.magicDustBalance = 120;
    expect((await sendPurchaseBatch(model, 5)).sent).toBe(2);
  });

  // Live v1361 standard-shop entries are `{itemType, species, initialStock}`: no price fields.
  it('a coin price missing from the stock entry comes from the catalog', async () => {
    stockByKey.set(KEY, { remaining: 20, priceCoins: null, priceMagicDust: null });
    catalogPricing = { coinPrice: 10, dustPrice: null, rarity: null };
    balances.coinsBalance = 25;
    expect((await sendPurchaseBatch({ ...model, priceCoins: null }, 5)).sent).toBe(2);
  });

  it('a dust price missing from the stock entry comes from the catalog and uses the dust balance', async () => {
    stockByKey.set(KEY, { remaining: 20, priceCoins: null, priceMagicDust: null });
    catalogPricing = { coinPrice: null, dustPrice: 250, rarity: null };
    balances.magicDustBalance = 600;
    expect((await sendPurchaseBatch({ ...model, priceCoins: null }, 5)).sent).toBe(2);
  });

  it('clamps to stack room and omits quantity at one unit', async () => {
    stackCap = 1;
    const r = await sendPurchaseBatch(model, 5);
    expect(r.sent).toBe(1);
    expect(sentPayloads[0]).not.toHaveProperty('quantity');
  });

  it('sends nothing and names the limit when it is zero', async () => {
    stockByKey.set(KEY, { remaining: 0, priceCoins: 10, priceMagicDust: null });
    const r = await sendPurchaseBatch(model, 5);
    expect(sentPayloads).toHaveLength(0);
    expect(r).toMatchObject({ sent: 0, baseline: null, error: 'feature.restockAlert.soldOut' });
  });

  it('a failed send reports zero units sent', async () => {
    sendResult = { ok: false, reason: 'throttled' };
    const r = await sendPurchaseBatch(model, 5);
    expect(r).toMatchObject({ sent: 0, error: 'Purchase request throttled' });
  });

  it('a custom sender receives the clamped quantity', async () => {
    stockByKey.set(KEY, { remaining: 4, priceCoins: 10, priceMagicDust: null });
    const calls: number[] = [];
    await sendPurchaseBatch(model, 9, { send: (_s, _i, _h, _f, quantity) => { calls.push(quantity); return { ok: true }; } });
    expect(calls).toEqual([4]);
  });
});
