// Wire-facing purchase helpers for the restock-alert flow: PurchaseShopItem and
// PutItemInStorage senders plus the batched buy, split out so headless callers can
// drive a purchase without pulling in the alert-card handler.

import {
  BUY_ACTION_THROTTLE_MS,
  type AlertModel,
  type BuyAllResult,
  type PendingOwnershipConfirmation,
  type PurchaseCommandAwait,
  type PurchaseOutcome,
  type RestockShopType,
} from './types';
import {
  isRoomSessionReady,
  isRoomSocketOpen,
  sendRoomAction,
  type WebSocketSendResult,
} from '../../../websocket/api';
import type { PurchaseShopItemPayload } from '../../../websocket/validation';
import { isGameStateReady, readSync } from '../../../core/gameState';
import { getShopStockItemByKey } from '../../../store/shopStock';
import { getItemCatalogPricing } from '../../../catalogs/shopEligibility';
import { t } from '../../../i18n';
import {
  armReactiveConfirmation,
  captureOwnershipBaseline,
  debugLog,
  hasOwnershipSource,
  processPendingOwnershipConfirmations,
  scheduleMaxConfirmationTimeout,
  waitForOwnershipBaselines,
} from './ownershipTracker';
import { pendingOwnershipConfirmations } from './alertState';
import { applyInventoryCapToQuantity } from './purchaseActions';
import { resolveAutoStoreTarget } from './autoStore';
import { describeConfirmationSourceGaps } from './sourceGaps';
import { resolveShopViewMode } from './shopViewMode';
import { affordableUnits, clampPurchaseQuantity, type PurchaseLimit, type PurchaseLimits } from './purchaseQuantity';

// ---------------------------------------------------------------------------
// WS send helpers
// ---------------------------------------------------------------------------

type PurchaseSendFailureReason = WebSocketSendResult['reason'] | 'server_rejected';

/** Standard shops carry one item type; weather shops mix types, so they rely on the hints from the shop entry. */
const SHOP_TO_ITEM_TYPE: Record<string, string> = {
  seed: 'Seed',
  egg:  'Egg',
  tool: 'Tool',
  decor: 'Decor',
};

/** `idField` (from the shop entry) makes the payload shape follow the game for item types QPM has never seen. */
function buildShopItemTarget(
  shopType: RestockShopType,
  itemId: string,
  itemTypeHint?: string,
  idField?: string,
): { itemType: string } & Record<string, unknown> {
  const itemType = itemTypeHint ?? SHOP_TO_ITEM_TYPE[shopType] ?? 'Seed';
  if (idField) return { itemType, [idField]: itemId };
  switch (itemType) {
    case 'Seed':  return { itemType: 'Seed',  species: itemId };
    case 'Egg':   return { itemType: 'Egg',   eggId: itemId };
    case 'Tool':  return { itemType: 'Tool',  toolId: itemId };
    case 'Decor': return { itemType: 'Decor', decorId: itemId };
    default:      return { itemType: 'Seed',  species: itemId };
  }
}

export function buildPurchasePayload(
  shopType: RestockShopType,
  itemId: string,
  quantity: number,
  itemTypeHint?: string,
  idField?: string,
): PurchaseShopItemPayload {
  return {
    shop: shopType,
    viewMode: resolveShopViewMode(shopType),
    item: buildShopItemTarget(shopType, itemId, itemTypeHint, idField),
    ...(quantity === 1 ? {} : { quantity }),
  };
}

export function sendPurchase(shopType: RestockShopType, itemId: string, itemTypeHint?: string, idField?: string, quantity = 1): WebSocketSendResult {
  const payload = buildPurchasePayload(shopType, itemId, quantity, itemTypeHint, idField);
  return sendRoomAction('PurchaseShopItem', payload as unknown as Record<string, unknown>, { throttleMs: BUY_ACTION_THROTTLE_MS });
}

/** Replaces the wire call inside sendPurchaseBatch; must forward `quantity`. Return sync or async; either is awaited. */
export type PurchaseSender = (
  shopType: RestockShopType,
  itemId: string,
  itemTypeHint: string | undefined,
  idField: string | undefined,
  quantity: number,
) => WebSocketSendResult | Promise<WebSocketSendResult>;

export interface PurchaseBatchOptions {
  send?: PurchaseSender;
}

export function explainSendFailure(reason: PurchaseSendFailureReason | null): string {
  switch (reason) {
    case 'server_rejected': return 'Shop rejected the purchase (sold out or not enough coins)';
    case 'no_connection':   return 'No room connection';
    case 'session_not_ready': return 'Room connection not ready yet (waiting for the server\'s Welcome)';
    case 'invalid_payload': return 'Invalid purchase payload';
    case 'throttled':       return 'Purchase request throttled';
    case 'send_failed':     return 'Failed to send purchase';
    default:                return 'Purchase request failed';
  }
}

function explainPurchaseLimit(limit: PurchaseLimit | null): string {
  switch (limit) {
    case 'stock':   return t('feature.restockAlert.soldOut');
    case 'balance': return t('feature.restockAlert.notEnoughBalance');
    case 'stack':   return t('feature.restockAlert.maxStack');
    default:        return explainSendFailure(null);
  }
}

function readBalance(dustPriced: boolean): number | null {
  if (!isGameStateReady()) return null;
  return dustPriced ? readSync('magicDustBalance') : readSync('coinsBalance');
}

/**
 * Game: price is `dustPrice ?? coinPrice` and the balance is the matching currency.
 * Standard-shop stock entries carry no price (v1361), so the blueprint supplies it.
 */
function resolvePurchaseLimits(model: AlertModel, requested: number): PurchaseLimits {
  const stock = getShopStockItemByKey(model.key);
  const catalog = getItemCatalogPricing(model.itemId);
  const dustPrice = stock?.priceMagicDust ?? catalog?.dustPrice ?? null;
  const unitPrice = dustPrice ?? stock?.priceCoins ?? catalog?.coinPrice ?? model.priceCoins;
  return {
    remainingStock: stock?.remaining ?? null,
    affordable: affordableUnits(readBalance(dustPrice != null), unitPrice),
    stackRoom: applyInventoryCapToQuantity(model.shopType, model.itemId, model.key, requested, model.itemType),
  };
}

/** `ok` only means the move left the socket; the server's verdict comes via `awaitResult`. */
export function sendItemToStorage(itemId: string, storageId: string, quantity: number | null): WebSocketSendResult {
  const payload: Record<string, unknown> = { itemId, storageId };
  if (quantity != null && quantity > 0) payload.quantity = quantity;
  return sendRoomAction('PutItemInStorage', payload, { throttleMs: BUY_ACTION_THROTTLE_MS });
}

// ---------------------------------------------------------------------------
// Buy-all workflow
// ---------------------------------------------------------------------------

/** One `PurchaseShopItem` carrying `quantity`, like the game's Buy All; `sent` counts units. */
export async function sendPurchaseBatch(model: AlertModel, quantity: number, opts?: PurchaseBatchOptions): Promise<BuyAllResult> {
  const requested = Math.max(1, Math.floor(quantity));
  await waitForOwnershipBaselines(model.shopType);
  const ownershipBaseline = captureOwnershipBaseline(model.key, model.shopType);
  const limits = resolvePurchaseLimits(model, requested);
  const { quantity: units, limitedBy } = clampPurchaseQuantity(requested, limits);
  const confirmationAvailable = hasOwnershipSource(ownershipBaseline);
  debugLog('Buy-all starting', {
    key: model.key,
    label: model.label,
    requested,
    units,
    limitedBy,
    ...limits,
    shopType: model.shopType,
    itemId: model.itemId,
    stockCycleId: model.stockCycleId,
    baselineCount: ownershipBaseline.count,
    includeInventory: ownershipBaseline.includeInventory,
    includeSeedSilo: ownershipBaseline.includeSeedSilo,
    includeDecorShed: ownershipBaseline.includeDecorShed,
    includeToolShack: ownershipBaseline.includeToolShack,
    baselineInventoryStacks: ownershipBaseline.inventoryKeyItemQuantities.size,
    roomSocketOpen: isRoomSocketOpen(),
    roomSessionReady: isRoomSessionReady(),
  });

  const fail = (error: string, detail: Record<string, unknown>): BuyAllResult => {
    debugLog('Buy-all failed before the purchase was sent', { key: model.key, requested, units, ...detail });
    return { sent: 0, baseline: null, confirmationAvailable, error, hasEnvelope: false };
  };
  if (units <= 0) return fail(explainPurchaseLimit(limitedBy), { limitedBy });
  if (!isRoomSessionReady()) {
    const reason: PurchaseSendFailureReason = isRoomSocketOpen() ? 'session_not_ready' : 'no_connection';
    return fail(explainSendFailure(reason), { reason });
  }

  const sender: PurchaseSender = opts?.send ?? sendPurchase;
  const result = await sender(model.shopType, model.itemId, model.itemType, model.idField, units);
  if (!result.ok) return fail(explainSendFailure(result.reason ?? null), { reason: result.reason ?? null });

  const awaitResults: PurchaseCommandAwait[] = result.awaitResult ? [{ units, awaitResult: result.awaitResult }] : [];
  const response: BuyAllResult = {
    sent: units,
    baseline: ownershipBaseline,
    confirmationAvailable,
    error: null,
    hasEnvelope: awaitResults.length > 0,
    ...(awaitResults.length > 0 ? { awaitResults } : {}),
  };
  debugLog('Buy-all sent', { key: model.key, requested, units, confirmationAvailable, envelopeReply: awaitResults.length > 0 });
  return response;
}

// ---------------------------------------------------------------------------
// Headless purchase entry point
// ---------------------------------------------------------------------------

export interface PurchaseRequest {
  shopType: RestockShopType;
  itemId: string;
  itemType?: string;
  idField?: string;
  /** Canonical ownership key (`toCanonicalKey(shopType, itemId)`). */
  key: string;
  label: string;
  quantity: number;
  stockCycleId: string | null;
  /** Move the received stack into the matching storage after confirmation. Requires an existing stack in that storage. */
  autoStore: boolean;
  send?: PurchaseSender;
}

/**
 * Send one `PurchaseShopItem` for up to N units, then resolve when ownership growth matches the units sent,
 * a failure is reported, or `OWNERSHIP_MAX_CONFIRMATION_MS` elapses. Refuses when
 * an alert-card purchase for the same key is already pending.
 */
export async function purchaseAndConfirm(req: PurchaseRequest): Promise<PurchaseOutcome> {
  if (pendingOwnershipConfirmations.has(req.key)) {
    return { sent: 0, confirmed: 0, storedIn: null, error: 'purchase already pending', timedOut: false };
  }

  const requested = applyInventoryCapToQuantity(req.shopType, req.itemId, req.key, Math.max(1, Math.floor(req.quantity)), req.itemType);
  if (requested <= 0) {
    return { sent: 0, confirmed: 0, storedIn: null, error: 'inventory cap reached', timedOut: false };
  }

  const model: AlertModel = {
    key: req.key,
    shopType: req.shopType,
    itemId: req.itemId,
    stockCycleId: req.stockCycleId,
    label: req.label,
    quantity: requested,
    priceCoins: null,
    ...(req.itemType !== undefined ? { itemType: req.itemType } : {}),
    ...(req.idField !== undefined ? { idField: req.idField } : {}),
  };
  const batchOpts: PurchaseBatchOptions = req.send !== undefined ? { send: req.send } : {};
  const result = await sendPurchaseBatch(model, requested, batchOpts);
  if (result.error || result.sent <= 0) {
    return { sent: result.sent, confirmed: 0, storedIn: null, error: result.error ?? 'purchase failed', timedOut: false };
  }
  if (!result.confirmationAvailable || !result.baseline) {
    const gapText = result.baseline
      ? describeConfirmationSourceGaps(result.baseline, result.hasEnvelope ?? false)
      : '';
    return { sent: result.sent, confirmed: 0, storedIn: null, error: `no confirmation source${gapText}`, timedOut: false };
  }

  const autoStoreTarget = req.autoStore ? resolveAutoStoreTarget(req.shopType, req.key) : null;

  return new Promise<PurchaseOutcome>((resolve) => {
    const pending: PendingOwnershipConfirmation = {
      key: req.key,
      shopType: req.shopType,
      itemId: req.itemId,
      stockCycleId: req.stockCycleId,
      expectedIncrease: result.sent,
      sent: result.sent,
      baseline: result.baseline!,
      confirmed: 0,
      staleNoticeTimerId: null,
      staleNoticeShown: false,
      maxTimeoutTimerId: null,
      autoStoreInFlight: false,
      autoStoreFinalMoveRequested: false,
      autoStoreStorageId: autoStoreTarget?.storageId ?? null,
      autoStoreLabel: autoStoreTarget?.label ?? null,
      storedInTargetStorage: false,
      shopPurchasesBaseline: null,
      shopPurchasesArmed: false,
      cycleArmFp: null,
      cleanups: [],
      presenter: null,
      settle: resolve,
    };
    pendingOwnershipConfirmations.set(req.key, pending);
    armReactiveConfirmation(pending, result.awaitResults ? { rejectionAwaits: result.awaitResults } : {});
    scheduleMaxConfirmationTimeout(req.key);
    processPendingOwnershipConfirmations();
  });
}
