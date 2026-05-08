// src/ui/shopRestockAlerts/purchaseActions.ts
// WS purchase workflow, inventory cap logic, auto-store, and coins confirm modal.

import { log } from '../../utils/logger';
import { formatCoins } from '../../utils/formatters';
import { getItemIdVariants } from '../../utils/restockDataService';
import { isRoomSocketOpen, sendRoomAction, type WebSocketSendResult } from '../../websocket/api';
import { getShopStockState } from '../../store/shopStock';
import {
  BUY_SEND_DELAY_MS,
  BUY_ACTION_THROTTLE_MS,
  COINS_CONFIRM_MODAL_ID,
  TOOL_STACK_LIMIT,
  TOOL_LIMITED_IDS,
  SEED_SILO_WS_STORAGE_ID,
  DECOR_SHED_WS_STORAGE_ID,
  type RestockShopType,
  type AlertModel,
  type ActiveAlert,
  type BuyAllResult,
  type OwnershipBaseline,
  type PendingOwnershipConfirmation,
} from './types';
import {
  alertState,
  pendingOwnershipConfirmations,
} from './alertState';
import {
  sleep,
  hasOwnershipSource,
  waitForOwnershipBaselines,
  captureOwnershipBaseline,
  clearPendingOwnershipConfirmation,
  failPendingConfirmation,
  schedulePendingStaleNotice,
  scheduleMaxConfirmationTimeout,
  processPendingOwnershipConfirmations,
  debugLog,
  debugLogError,
  toCanonicalKey,
} from './ownershipTracker';
import { setAlertBusy, setAlertPendingConfirmation } from './alertDom';
import { processShopStock } from './stockProcessor';

// ---------------------------------------------------------------------------
// Tool inventory cap helpers
// ---------------------------------------------------------------------------

export function normalizeToolId(value: string): string {
  const compact = value.trim().replace(/\s+/g, '').toLowerCase();
  if (compact.endsWith('s') && compact.length > 1) return compact.slice(0, -1);
  return compact;
}

export function getToolInventoryLimitFromKey(key: string): number | null {
  if (!key.startsWith('tool:')) return null;
  const rawToolId = key.slice('tool:'.length);
  const normalized = normalizeToolId(rawToolId);
  return TOOL_LIMITED_IDS.has(normalized) ? TOOL_STACK_LIMIT : null;
}

export function getOwnedToolCount(itemId: string, canonicalKey: string): number {
  let owned = alertState.inventoryKeyCounts.get(canonicalKey) ?? 0;
  for (const variant of getItemIdVariants('tool', itemId)) {
    const variantKey = toCanonicalKey('tool', variant);
    owned = Math.max(owned, alertState.inventoryKeyCounts.get(variantKey) ?? 0);
  }
  return owned;
}

export function hasReachedToolInventoryCap(
  key: string,
  itemId: string,
): { reached: boolean; limit: number | null; owned: number } {
  const limit = getToolInventoryLimitFromKey(key);
  const owned = getOwnedToolCount(itemId, key);
  if (limit == null) return { reached: false, limit: null, owned };
  return { reached: owned >= limit, limit, owned };
}

export function applyInventoryCapToQuantity(
  shopType: RestockShopType,
  itemId: string,
  canonicalKey: string,
  requested: number,
): number {
  if (shopType !== 'tool') return requested;
  const limit = getToolInventoryLimitFromKey(canonicalKey);
  if (limit == null) return requested;
  const owned = getOwnedToolCount(itemId, canonicalKey);
  const remainingCapacity = Math.max(0, limit - owned);
  return Math.max(0, Math.min(requested, remainingCapacity));
}

export function shouldLockDismissForPurchaseCompletion(key: string): boolean {
  return getToolInventoryLimitFromKey(key) == null;
}

// ---------------------------------------------------------------------------
// WS send helpers
// ---------------------------------------------------------------------------

type PurchaseSendFailureReason = WebSocketSendResult['reason'] | 'socket_not_open';

/**
 * Map shop type → V16 ItemType string for the standard 4 shops.
 * Dawn shop can carry multiple item types, so it uses itemTypeHint.
 */
const SHOP_TO_ITEM_TYPE: Record<string, string> = {
  seed: 'Seed',
  egg:  'Egg',
  tool: 'Tool',
  decor: 'Decor',
};

/**
 * Build the V16 ShopItemTarget discriminated union for a given shop + item ID.
 * For Dawn shop, itemTypeHint disambiguates (defaults to 'Seed' if unknown).
 */
function buildShopItemTarget(
  shopType: RestockShopType,
  itemId: string,
  itemTypeHint?: string,
): { itemType: string } & Record<string, unknown> {
  const itemType = itemTypeHint ?? SHOP_TO_ITEM_TYPE[shopType] ?? 'Seed';
  switch (itemType) {
    case 'Seed':  return { itemType: 'Seed',  species: itemId };
    case 'Egg':   return { itemType: 'Egg',   eggId: itemId };
    case 'Tool':  return { itemType: 'Tool',  toolId: itemId };
    case 'Decor': return { itemType: 'Decor', decorId: itemId };
    default:      return { itemType: 'Seed',  species: itemId };
  }
}

export function sendPurchase(shopType: RestockShopType, itemId: string, itemTypeHint?: string): WebSocketSendResult {
  const item = buildShopItemTarget(shopType, itemId, itemTypeHint);
  return sendRoomAction('PurchaseShopItem', { shop: shopType, item } as unknown as Record<string, unknown>, { throttleMs: BUY_ACTION_THROTTLE_MS });
}

export function explainSendFailure(reason: PurchaseSendFailureReason | null): string {
  switch (reason) {
    case 'socket_not_open': return 'Room socket not open yet';
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
// Auto-store
// ---------------------------------------------------------------------------

export function resolveAutoStoreTarget(
  shopType: RestockShopType,
  key: string,
): { storageId: string; label: string } | null {
  if (shopType === 'seed') {
    const existingCount = alertState.seedSiloKeyCounts.get(key) ?? 0;
    if (existingCount <= 0) {
      debugLog('Auto-store target skipped for seed', { key, hasSeedSiloBaseline: alertState.hasSeedSiloBaseline, existingSeedCountInSilo: existingCount });
      return null;
    }
    debugLog('Auto-store target resolved', { key, shopType, storageId: SEED_SILO_WS_STORAGE_ID, label: 'Seed Silo', existingSeedCountInSilo: existingCount });
    return { storageId: SEED_SILO_WS_STORAGE_ID, label: 'Seed Silo' };
  }
  if (shopType === 'decor') {
    const existingCount = alertState.decorShedKeyCounts.get(key) ?? 0;
    if (existingCount <= 0) {
      debugLog('Auto-store target skipped for decor', { key, hasDecorShedBaseline: alertState.hasDecorShedBaseline, existingDecorCountInShed: existingCount });
      return null;
    }
    debugLog('Auto-store target resolved', { key, shopType, storageId: DECOR_SHED_WS_STORAGE_ID, label: 'Decor Shed', existingDecorCountInShed: existingCount });
    return { storageId: DECOR_SHED_WS_STORAGE_ID, label: 'Decor Shed' };
  }
  debugLog('Auto-store target not applicable for shop type', { key, shopType });
  return null;
}

export function pickAutoStoreStackForKey(
  key: string,
  baseline: OwnershipBaseline,
): { itemId: string; quantity: number; gained: number } | null {
  const current = alertState.inventoryKeyItemQuantities.get(key);
  if (!current || current.size === 0) return null;

  let best: { itemId: string; quantity: number; gained: number } | null = null;
  for (const [itemId, currentQty] of current.entries()) {
    const baselineQty = baseline.inventoryKeyItemQuantities.get(itemId) ?? 0;
    const gained = Math.max(0, currentQty - baselineQty);
    const candidate = { itemId, quantity: currentQty, gained };
    if (!best) { best = candidate; continue; }
    if (candidate.gained > best.gained) { best = candidate; continue; }
    if (candidate.gained === best.gained && candidate.quantity > best.quantity) best = candidate;
  }
  return best;
}

export function maybeAutoStoreConfirmedDelta(
  pending: PendingOwnershipConfirmation,
  confirmed: number,
): void {
  if (pending.autoStoreInFlight) {
    debugLog('Auto-store skipped (already in flight)', { key: pending.key, confirmed });
    return;
  }
  if (!pending.autoStoreStorageId) {
    debugLog('Auto-store skipped (no target storage)', { key: pending.key, confirmed, shopType: pending.shopType });
    return;
  }
  if (confirmed < pending.expectedIncrease) {
    debugLog('Auto-store deferred until full confirmation', { key: pending.key, confirmed, expectedIncrease: pending.expectedIncrease });
    return;
  }
  if (pending.autoStoreFinalMoveRequested) return;

  const targetStack = pickAutoStoreStackForKey(pending.key, pending.baseline);
  if (!targetStack) {
    debugLog('Auto-store skipped (no inventory stack found for key)', { key: pending.key, confirmed, expectedIncrease: pending.expectedIncrease });
    return;
  }

  debugLog('Auto-store attempting single full-stack move', {
    key: pending.key,
    confirmed,
    expectedIncrease: pending.expectedIncrease,
    storageId: pending.autoStoreStorageId,
    storageLabel: pending.autoStoreLabel,
    itemId: targetStack.itemId,
    currentStackQuantity: targetStack.quantity,
    gainedInStack: targetStack.gained,
  });

  pending.autoStoreInFlight = true;
  pending.autoStoreFinalMoveRequested = true;
  try {
    const moved = sendItemToStorage(targetStack.itemId, pending.autoStoreStorageId, null);
    pending.storedInTargetStorage = moved;
    debugLog('Auto-store single move result', { key: pending.key, itemId: targetStack.itemId, moved, storageId: pending.autoStoreStorageId });
  } finally {
    pending.autoStoreInFlight = false;
    debugLog('Auto-store final pass finished', { key: pending.key, confirmed, autoStoreFinalMoveRequested: pending.autoStoreFinalMoveRequested, storedInTargetStorage: pending.storedInTargetStorage });
  }
}

// ---------------------------------------------------------------------------
// Coins confirm modal
// ---------------------------------------------------------------------------

interface CoinsConfirmResult {
  confirmed: boolean;
  affordableQty: number;
}

function showCoinsConfirmModal(
  label: string,
  priceCoins: number,
  requestedQty: number,
  balance: number,
): Promise<CoinsConfirmResult> {
  return new Promise((resolve) => {
    const existing = document.getElementById(COINS_CONFIRM_MODAL_ID);
    if (existing) existing.remove();

    const affordableQty  = Math.min(requestedQty, Math.floor(balance / priceCoins));
    const totalCost      = priceCoins * requestedQty;
    const affordableCost = priceCoins * affordableQty;
    const balanceAfter   = balance - affordableCost;

    const overlay = document.createElement('div');
    overlay.id = COINS_CONFIRM_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.62);';

    const card = document.createElement('div');
    card.style.cssText = 'min-width:280px;max-width:400px;background:#0f1318;color:#ffffff;border:1px solid rgba(143,130,255,0.4);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.45);padding:18px 20px;display:grid;gap:14px;';

    const title = document.createElement('div');
    title.textContent = 'Insufficient Balance';
    title.style.cssText = 'font-size:17px;font-weight:800;';

    const desc = document.createElement('div');
    desc.textContent = `You can't afford all ${requestedQty}× ${label}.`;
    desc.style.cssText = 'font-size:13px;opacity:0.85;';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;gap:7px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;font-size:13px;';

    const makeRow = (rowLabel: string, rowValue: string, highlight?: string): HTMLElement => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
      const lbl = document.createElement('span');
      lbl.textContent = rowLabel;
      lbl.style.cssText = 'opacity:0.7;';
      const val = document.createElement('span');
      val.textContent = rowValue;
      val.style.cssText = `font-weight:700;${highlight ? `color:${highlight};` : ''}`;
      row.append(lbl, val);
      return row;
    };

    grid.append(
      makeRow('Your balance',   `${formatCoins(balance)} coins`),
      makeRow('Cost for all',   `${formatCoins(totalCost)} coins`, '#fca5a5'),
      makeRow('Affordable',     `${affordableQty} of ${requestedQty}`, '#86efac'),
      makeRow('Purchase cost',  `${formatCoins(affordableCost)} coins`),
      makeRow('Balance after',  `${formatCoins(balanceAfter)} coins`, '#8f82ff'),
    );

    const note = document.createElement('div');
    note.style.cssText = 'font-size:12px;opacity:0.65;';
    note.textContent = affordableQty <= 0
      ? 'You cannot afford any of these items.'
      : `Buy ${affordableQty} item${affordableQty !== 1 ? 's' : ''} instead?`;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.22);background:transparent;color:#ffffff;cursor:pointer;';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.disabled = affordableQty <= 0;
    confirmBtn.textContent = affordableQty > 0 ? `Buy ${affordableQty}` : 'Cannot afford';
    confirmBtn.style.cssText = `padding:8px 14px;border-radius:10px;border:1px solid rgba(143,130,255,0.7);background:#1a2040;color:#ffffff;cursor:pointer;font-weight:700;${affordableQty <= 0 ? 'opacity:0.45;cursor:default;' : ''}`;

    let settled = false;
    const close = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      try { overlay.remove(); } catch { /* ignore */ }
      document.removeEventListener('keydown', onKeyDown, true);
      resolve({ confirmed: accepted, affordableQty });
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(false);
    };

    cancelBtn.addEventListener('click', () => close(false));
    if (affordableQty > 0) confirmBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(false); });

    actions.append(cancelBtn, confirmBtn);
    card.append(title, desc, grid, note, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown, true);
    if (affordableQty > 0) confirmBtn.focus();
    else cancelBtn.focus();
  });
}

// ---------------------------------------------------------------------------
// Buy-all workflow
// ---------------------------------------------------------------------------

async function buyAllForAlert(model: AlertModel, quantity: number): Promise<BuyAllResult> {
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
    baselineInventoryStacks: ownershipBaseline.inventoryKeyItemQuantities.size,
    roomSocketOpen: isRoomSocketOpen(),
  });

  let sent = 0;
  let firstFailureReason: PurchaseSendFailureReason | null = null;
  for (let i = 0; i < requested; i++) {
    if (!isRoomSocketOpen()) {
      firstFailureReason = 'socket_not_open';
      debugLog('Buy-all send loop halted: room socket not open', { key: model.key, requested, sent, index: i });
      break;
    }
    const result = sendPurchase(model.shopType, model.itemId, model.itemType);
    if (!result.ok) {
      firstFailureReason = result.reason ?? null;
      debugLog('Buy-all send failed', { key: model.key, requested, sent, index: i, reason: firstFailureReason });
      break;
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
  };
  debugLog('Buy-all send loop completed', { key: model.key, requested, sent, confirmationAvailable: response.confirmationAvailable });
  return response;
}

export async function handleBuyAll(active: ActiveAlert): Promise<void> {
  const buyModel: AlertModel = { ...active.model };
  let requested = Math.max(1, Math.floor(buyModel.quantity));
  debugLog('Buy button clicked', {
    key: buyModel.key,
    label: buyModel.label,
    requestedFromAlert: requested,
    priceCoins: buyModel.priceCoins,
    hasCoinsBaseline: alertState.hasCoinsBaseline,
    currentCoinsCount: alertState.currentCoinsCount,
    roomSocketOpen: isRoomSocketOpen(),
  });

  setAlertBusy(active, true);
  active.statusEl.style.color = 'rgba(200,192,255,0.72)';
  active.statusEl.textContent = 'Buying...';

  try {
    const cappedRequested = applyInventoryCapToQuantity(buyModel.shopType, buyModel.itemId, buyModel.key, requested);
    if (cappedRequested <= 0) {
      debugLog('Buy-all skipped because inventory cap is already reached', {
        key: buyModel.key,
        label: buyModel.label,
        requested,
        cappedRequested,
        owned: getOwnedToolCount(buyModel.itemId, buyModel.key),
        limit: getToolInventoryLimitFromKey(buyModel.key),
      });
      setAlertPendingConfirmation(active, false);
      active.statusEl.style.color = '#fde68a';
      active.statusEl.textContent = 'Inventory full (99/99)';
      setAlertBusy(active, false);
      processShopStock(getShopStockState());
      return;
    }
    if (cappedRequested < requested) {
      debugLog('Buy-all quantity clamped by inventory cap', {
        key: buyModel.key,
        label: buyModel.label,
        requested,
        cappedRequested,
        owned: getOwnedToolCount(buyModel.itemId, buyModel.key),
        limit: getToolInventoryLimitFromKey(buyModel.key),
      });
      requested = cappedRequested;
      active.statusEl.style.color = '#fde68a';
      active.statusEl.textContent = `Buying ${requested} (inventory cap)`;
    }

    if (alertState.hasCoinsBaseline && buyModel.priceCoins != null && buyModel.priceCoins > 0) {
      const totalCost = buyModel.priceCoins * requested;
      if (totalCost > alertState.currentCoinsCount) {
        const modalResult = await showCoinsConfirmModal(buyModel.label, buyModel.priceCoins, requested, alertState.currentCoinsCount);
        if (!modalResult.confirmed) {
          debugLog('Buy-all canceled in insufficient balance modal', { key: buyModel.key, requested, affordableQty: modalResult.affordableQty });
          active.statusEl.style.color = 'rgba(200,192,255,0.72)';
          active.statusEl.textContent = 'Ready to buy';
          setAlertBusy(active, false);
          return;
        }
        requested = modalResult.affordableQty;
        debugLog('Buy-all adjusted from insufficient balance modal', { key: buyModel.key, adjustedRequested: requested });
        if (requested <= 0) {
          active.statusEl.style.color = '#fca5a5';
          active.statusEl.textContent = 'Cannot afford any items';
          setAlertBusy(active, false);
          return;
        }
      }
    }

    const socketGenBefore = alertState.socketCloseGeneration;
    const result = await buyAllForAlert(buyModel, requested);
    if (result.error || result.sent <= 0) {
      debugLog('Buy-all request failed', { key: buyModel.key, requested, sent: result.sent, error: result.error });
      active.statusEl.style.color = '#fca5a5';
      active.statusEl.textContent = result.error ?? 'Purchase failed';
      setAlertBusy(active, false);
      return;
    }

    if (!result.confirmationAvailable || !result.baseline) {
      debugLog('Buy-all sent but confirmation source unavailable', { key: buyModel.key, requested, sent: result.sent, confirmationAvailable: result.confirmationAvailable });
      setAlertPendingConfirmation(active, false);
      active.statusEl.style.color = '#fca5a5';
      active.statusEl.textContent = `Sent ${result.sent} \u2014 no confirmation source`;
      setAlertBusy(active, false);
      return;
    }

    const autoStoreTarget = resolveAutoStoreTarget(buyModel.shopType, buyModel.key);
    const pending: PendingOwnershipConfirmation = {
      key: active.model.key,
      shopType: buyModel.shopType,
      itemId: buyModel.itemId,
      stockCycleId: buyModel.stockCycleId,
      expectedIncrease: result.sent,
      sent: result.sent,
      baseline: result.baseline,
      confirmed: 0,
      staleNoticeTimerId: null,
      staleNoticeShown: false,
      maxTimeoutTimerId: null,
      autoStoreInFlight: false,
      autoStoreFinalMoveRequested: false,
      autoStoreStorageId: autoStoreTarget?.storageId ?? null,
      autoStoreLabel: autoStoreTarget?.label ?? null,
      storedInTargetStorage: false,
    };
    debugLog('Pending ownership confirmation created', {
      key: pending.key,
      requested,
      sent: pending.sent,
      expectedIncrease: pending.expectedIncrease,
      autoStoreStorageId: pending.autoStoreStorageId,
      autoStoreLabel: pending.autoStoreLabel,
      stockCycleId: pending.stockCycleId,
    });
    clearPendingOwnershipConfirmation(active.model.key);
    pendingOwnershipConfirmations.set(active.model.key, pending);
    setAlertPendingConfirmation(active, true);
    active.statusEl.style.color = '#fde68a';
    active.statusEl.textContent = `Sent ${result.sent} \u2014 confirming\u2026`;
    setAlertBusy(active, false);
    schedulePendingStaleNotice(active.model.key);
    scheduleMaxConfirmationTimeout(active.model.key);

    // If the socket closed or was replaced during the async buy flow, the
    // close-event handler may have fired before the pending was created and
    // therefore had nothing to fail.  Detect this via the generation counter.
    if (alertState.socketCloseGeneration !== socketGenBefore) {
      debugLog('Socket lost during buy flow — failing pending', {
        key: active.model.key,
        genBefore: socketGenBefore,
        genNow: alertState.socketCloseGeneration,
      });
      failPendingConfirmation(active.model.key, 'Connection lost during purchase \u2014 retry');
      return;
    }

    processPendingOwnershipConfirmations();
  } catch (error) {
    log('[ShopRestockAlerts] Buy-all failed', error);
    debugLogError('Buy-all threw exception', error, { key: buyModel.key, requested });
    setAlertPendingConfirmation(active, false);
    active.statusEl.style.color = '#fca5a5';
    active.statusEl.textContent = 'Purchase failed';
    setAlertBusy(active, false);
  }
}
