// Wire-facing purchase helpers for the restock-alert flow: PurchaseShopItem and
// PutItemInStorage senders plus the batch loop, split out so headless callers can
// drive a purchase without pulling in the alert-card handler.

import {
  BUY_ACTION_THROTTLE_MS,
  BUY_SEND_DELAY_MS,
  type AlertModel,
  type BuyAllResult,
  type PendingOwnershipConfirmation,
  type PurchaseOutcome,
  type RestockShopType,
} from './types';
import {
  isRoomSocketOpen,
  sendRoomAction,
  type WebSocketSendResult,
} from '../../../websocket/api';
import {
  armReactiveConfirmation,
  captureOwnershipBaseline,
  debugLog,
  hasOwnershipSource,
  processPendingOwnershipConfirmations,
  scheduleMaxConfirmationTimeout,
  sleep,
  waitForOwnershipBaselines,
} from './ownershipTracker';
import { pendingOwnershipConfirmations } from './alertState';
import { applyInventoryCapToQuantity, resolveAutoStoreTarget } from './purchaseActions';

// ---------------------------------------------------------------------------
// WS send helpers
// ---------------------------------------------------------------------------

type PurchaseSendFailureReason = WebSocketSendResult['reason'] | 'socket_not_open' | 'server_rejected';

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

export function sendPurchase(shopType: RestockShopType, itemId: string, itemTypeHint?: string, idField?: string): WebSocketSendResult {
  const item = buildShopItemTarget(shopType, itemId, itemTypeHint, idField);
  return sendRoomAction('PurchaseShopItem', { shop: shopType, item } as unknown as Record<string, unknown>, { throttleMs: BUY_ACTION_THROTTLE_MS });
}

/** Replaces the wire call inside sendPurchaseBatch. Return sync or async; either is awaited. */
export type PurchaseSender = (
  shopType: RestockShopType,
  itemId: string,
  itemTypeHint?: string,
  idField?: string,
) => WebSocketSendResult | Promise<WebSocketSendResult>;

export interface PurchaseBatchOptions {
  send?: PurchaseSender;
}

export function explainSendFailure(reason: PurchaseSendFailureReason | null): string {
  switch (reason) {
    case 'socket_not_open': return 'Room socket not open yet';
    case 'server_rejected': return 'Shop rejected the purchase (sold out or not enough coins)';
    case 'no_connection':   return 'No room connection';
    case 'invalid_payload': return 'Invalid purchase payload';
    case 'throttled':       return 'Purchase request throttled';
    case 'send_failed':     return 'Failed to send purchase';
    default:                return 'Purchase request failed';
  }
}

export function sendItemToStorage(itemId: string, storageId: string, quantity: number | null): boolean {
  const payload: Record<string, unknown> = { itemId, storageId };
  if (quantity != null && quantity > 0) payload.quantity = quantity;
  return sendRoomAction('PutItemInStorage', payload, { throttleMs: BUY_ACTION_THROTTLE_MS }).ok;
}

// ---------------------------------------------------------------------------
// Buy-all workflow
// ---------------------------------------------------------------------------

export async function sendPurchaseBatch(model: AlertModel, quantity: number, opts?: PurchaseBatchOptions): Promise<BuyAllResult> {
  const requested = Math.max(1, Math.floor(quantity));
  await waitForOwnershipBaselines(model.shopType);
  const ownershipBaseline = captureOwnershipBaseline(model.key, model.shopType);
  debugLog('Buy-all starting', {
    key: model.key,
    label: model.label,
    requested,
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
  });

  const sender: PurchaseSender = opts?.send ?? sendPurchase;
  let sent = 0;
  let firstFailureReason: PurchaseSendFailureReason | null = null;
  // Halts *future* iterations only; caller uses awaitResults for per-send
  // rejection surface (see armReactiveConfirmation, Signal C).
  let serverRejectionCode: string | null = null;
  const awaitResults: Array<() => Promise<import('../../../websocket/envelope').QuinoaCommandResultMessage>> = [];
  for (let i = 0; i < requested; i++) {
    if (!isRoomSocketOpen()) {
      firstFailureReason = 'socket_not_open';
      debugLog('Buy-all send loop halted: room socket not open', { key: model.key, requested, sent, index: i });
      break;
    }
    if (serverRejectionCode !== null) {
      firstFailureReason = 'server_rejected';
      debugLog('Buy-all send loop halted: server rejected an earlier purchase', { key: model.key, requested, sent, index: i, code: serverRejectionCode });
      break;
    }
    const result = await sender(model.shopType, model.itemId, model.itemType, model.idField);
    if (!result.ok) {
      firstFailureReason = result.reason ?? null;
      debugLog('Buy-all send failed', { key: model.key, requested, sent, index: i, reason: firstFailureReason });
      break;
    }
    if (result.awaitResult) {
      const awaitFn = result.awaitResult;
      awaitResults.push(awaitFn);
      awaitFn().then((r) => {
        if (!r.ok && !r.resentAsLegacy && r.code !== 'handler_error') {
          serverRejectionCode = typeof r.code === 'string' ? r.code : 'rejected';
        }
      }).catch(() => { /* timeout — outcome unknown; ownership confirmation decides */ });
    }
    sent += 1;
    if (i === 0 || i === requested - 1 || i % 5 === 0) {
      debugLog('Buy-all send succeeded', { key: model.key, index: i, sent, requested });
    }
    if (i < requested - 1) await sleep(BUY_SEND_DELAY_MS);
  }

  if (sent <= 0) {
    debugLog('Buy-all failed before any sends completed', { key: model.key, requested, sent, failureReason: firstFailureReason, confirmationAvailable: hasOwnershipSource(ownershipBaseline) });
    return { sent: 0, baseline: null, confirmationAvailable: hasOwnershipSource(ownershipBaseline), error: explainSendFailure(firstFailureReason) };
  }

  const response: BuyAllResult = {
    sent,
    baseline: ownershipBaseline,
    confirmationAvailable: hasOwnershipSource(ownershipBaseline),
    error: null,
    ...(awaitResults.length > 0 ? { awaitResults } : {}),
  };
  debugLog('Buy-all send loop completed', { key: model.key, requested, sent, confirmationAvailable: response.confirmationAvailable, envelopeReplies: awaitResults.length });
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
 * Send N `PurchaseShopItem`s, then resolve when ownership growth matches sent count,
 * a failure is reported, or `OWNERSHIP_MAX_CONFIRMATION_MS` elapses. Refuses when
 * an alert-card purchase for the same key is already pending.
 */
export async function purchaseAndConfirm(req: PurchaseRequest): Promise<PurchaseOutcome> {
  if (pendingOwnershipConfirmations.has(req.key)) {
    return { sent: 0, confirmed: 0, storedIn: null, error: 'purchase already pending', timedOut: false };
  }

  const requested = applyInventoryCapToQuantity(req.shopType, req.itemId, req.key, Math.max(1, Math.floor(req.quantity)));
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
    return { sent: result.sent, confirmed: 0, storedIn: null, error: 'no confirmation source', timedOut: false };
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
