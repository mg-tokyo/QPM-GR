// src/ui/shopRestockAlerts/purchaseActions.ts
// Inventory cap logic, coins confirm modal, and the alert-card Buy handler.

import { formatCoins } from '../../../utils/formatters';
import { warnFeature } from './_diagnostics';
import { getItemIdVariants } from '../../../utils/restock/dataService';
import { isRoomSessionReady, isRoomSocketOpen } from '../../../websocket/api';
import { getShopStockState } from '../../../store/shopStock';
import { isWeatherShopType } from '../../../types/shops';
import { findCatalogIdCaseInsensitive, getToolMaxInventoryQuantity, isItemCatalogLoaded } from '../../../catalogs/shopEligibility';
import {
  ALERT_SUCCESS_HIDE_MS,
  COINS_CONFIRM_MODAL_ID,
  TOOL_STACK_LIMIT,
  TOOL_LIMITED_IDS,
  type RestockShopType,
  type AlertModel,
  type ActiveAlert,
  type PendingCompletionInfo,
  type PendingOwnershipConfirmation,
  type PendingPresenter,
} from './types';
import {
  activeAlerts,
  alertState,
  dismissedInStockKeys,
  pendingOwnershipConfirmations,
} from './alertState';
import {
  clearPendingOwnershipConfirmation,
  failPendingConfirmation,
  schedulePendingStaleNotice,
  scheduleMaxConfirmationTimeout,
  processPendingOwnershipConfirmations,
  armReactiveConfirmation,
  debugLog,
  debugLogError,
  toCanonicalKey,
  resolveOwnershipKey,
} from './ownershipTracker';
import { removeAlert, setAlertBusy, setAlertPendingConfirmation } from './alertDom';
import { clearDismissedCycle, markDismissedCycle, processShopStock } from './stockProcessor';
import { sendPurchaseBatch } from './purchasePipeline';
import { resolveAutoStoreTarget } from './autoStore';
import { describeConfirmationSourceGaps } from './sourceGaps';
export { sendPurchase, explainSendFailure, sendItemToStorage } from './purchasePipeline';

// ---------------------------------------------------------------------------
// Tool inventory cap helpers
// ---------------------------------------------------------------------------

export function normalizeToolId(value: string): string {
  const compact = value.trim().replace(/\s+/g, '').toLowerCase();
  if (compact.endsWith('s') && compact.length > 1) return compact.slice(0, -1);
  return compact;
}

/** Cap comes from the tool blueprint's `maxInventoryQuantity`; the literal set is only a catalog-unavailable fallback. */
export function getToolInventoryLimitFromKey(key: string): number | null {
  if (!key.startsWith('tool:')) return null;
  const rawToolId = key.slice('tool:'.length);
  const normalized = normalizeToolId(rawToolId);
  const catalogId = findCatalogIdCaseInsensitive('item', rawToolId) ?? findCatalogIdCaseInsensitive('item', normalized);
  if (catalogId) return getToolMaxInventoryQuantity(catalogId);
  if (isItemCatalogLoaded()) return null;
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

/**
 * Resolve an alert key to the `tool:` key its stack cap is stored under, or
 * null when the item has no tool stack cap. Weather shops (`snow:ChilledPotion`)
 * sell tools under their own prefix, and `getToolInventoryLimitFromKey` only
 * understands `tool:` — without this the weather branch below is dead.
 * The key's own prefix IS the shop type (`toCanonicalKey` builds `type:id`).
 */
function toToolCapKey(key: string, itemType?: string): string | null {
  if (key.startsWith('tool:')) return key;
  const sep = key.indexOf(':');
  if (sep <= 0 || !isWeatherShopType(key.slice(0, sep))) return null;
  // Owned case: the ownership tracker already maps `snow:X` → `tool:X`.
  const resolved = resolveOwnershipKey(key);
  if (resolved.startsWith('tool:')) return resolved;
  // Zero-owned case: nothing to resolve against, so trust the shop entry's type.
  return itemType === 'Tool' ? toCanonicalKey('tool', key.slice(sep + 1)) : null;
}

/** Stack cap that applies to an alert key (weather keys included), or null when uncapped. */
export function getToolInventoryLimitForAlert(key: string, itemType?: string): number | null {
  const capKey = toToolCapKey(key, itemType);
  return capKey == null ? null : getToolInventoryLimitFromKey(capKey);
}

export function hasReachedToolInventoryCap(
  key: string,
  itemId: string,
  itemType?: string,
): { reached: boolean; limit: number | null; owned: number } {
  const capKey = toToolCapKey(key, itemType);
  if (capKey == null) return { reached: false, limit: null, owned: getOwnedToolCount(itemId, key) };
  const limit = getToolInventoryLimitFromKey(capKey);
  const owned = getOwnedToolCount(itemId, capKey);
  if (limit == null) return { reached: false, limit: null, owned };
  return { reached: owned >= limit, limit, owned };
}

export function applyInventoryCapToQuantity(
  shopType: RestockShopType,
  itemId: string,
  canonicalKey: string,
  requested: number,
  itemType?: string,
): number {
  if (shopType !== 'tool' && !isWeatherShopType(shopType)) return requested;
  const capKey = toToolCapKey(canonicalKey, itemType);
  if (capKey == null) return requested;
  const limit = getToolInventoryLimitFromKey(capKey);
  if (limit == null) return requested;
  const owned = getOwnedToolCount(itemId, capKey);
  const remainingCapacity = Math.max(0, limit - owned);
  return Math.max(0, Math.min(requested, remainingCapacity));
}

export function shouldLockDismissForPurchaseCompletion(key: string): boolean {
  return getToolInventoryLimitFromKey(key) == null;
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
      try { overlay.remove(); } catch { /* teardown — modal may already be detached */ }
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
// Alert-card presenter — status text, pending flag, dismiss-cycle, removal.
// Bound to the alert's key at creation so calls are safe after the card is gone.
// ---------------------------------------------------------------------------

function createAlertPresenter(key: string): PendingPresenter {
  return {
    showStaleNotice(sent: number): void {
      const current = activeAlerts.get(key);
      if (!current || current.busy || !current.pendingConfirmation) return;
      current.statusEl.style.color = '#fde68a';
      current.statusEl.textContent = `Sent ${sent} — confirming (slow)…`;
    },
    showProgress(confirmed: number, sent: number): void {
      const current = activeAlerts.get(key);
      if (!current) return;
      current.statusEl.style.color = '#fde68a';
      current.statusEl.textContent = `Purchased ${confirmed}/${sent} confirmed`;
    },
    showCompletion(info: PendingCompletionInfo): void {
      const current = activeAlerts.get(key);
      if (current) {
        current.statusEl.style.color = '#86efac';
        current.statusEl.textContent = `Purchased ${info.confirmed}${info.storedNote}${info.completionSuffix}`;
        setAlertPendingConfirmation(current, false);
      }
      if (info.lockDismissForCycle) {
        dismissedInStockKeys.add(key);
        markDismissedCycle(key, info.stockCycleId);
      } else {
        dismissedInStockKeys.delete(key);
        clearDismissedCycle(key);
      }
      window.setTimeout(() => { removeAlert(key); }, ALERT_SUCCESS_HIDE_MS);
    },
    showFailure(reason: string): void {
      const current = activeAlerts.get(key);
      if (!current) return;
      setAlertPendingConfirmation(current, false);
      current.statusEl.style.color = '#fca5a5';
      current.statusEl.textContent = reason;
      window.setTimeout(() => {
        const later = activeAlerts.get(key);
        if (!later) return;
        if (later.busy || later.pendingConfirmation) return;
        later.statusEl.style.color = 'rgba(200,192,255,0.72)';
        later.statusEl.textContent = 'Ready to buy';
      }, 4_000);
    },
  };
}

// ---------------------------------------------------------------------------
// Buy-all workflow
// ---------------------------------------------------------------------------

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
    roomSessionReady: isRoomSessionReady(),
  });

  setAlertBusy(active, true);
  active.statusEl.style.color = 'rgba(200,192,255,0.72)';
  active.statusEl.textContent = 'Buying...';

  try {
    const cappedRequested = applyInventoryCapToQuantity(buyModel.shopType, buyModel.itemId, buyModel.key, requested, buyModel.itemType);
    if (cappedRequested <= 0) {
      const capState = hasReachedToolInventoryCap(buyModel.key, buyModel.itemId, buyModel.itemType);
      const owned = capState.owned;
      const limit = capState.limit;
      debugLog('Buy-all skipped because inventory cap is already reached', {
        key: buyModel.key,
        label: buyModel.label,
        requested,
        cappedRequested,
        owned,
        limit,
      });
      setAlertPendingConfirmation(active, false);
      active.statusEl.style.color = '#fde68a';
      active.statusEl.textContent = `Inventory full (${owned}/${limit ?? owned})`;
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
        ...hasReachedToolInventoryCap(buyModel.key, buyModel.itemId, buyModel.itemType),
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
    const result = await sendPurchaseBatch(buyModel, requested);
    if (result.error || result.sent <= 0) {
      debugLog('Buy-all request failed', { key: buyModel.key, requested, sent: result.sent, error: result.error });
      active.statusEl.style.color = '#fca5a5';
      active.statusEl.textContent = result.error ?? 'Purchase failed';
      setAlertBusy(active, false);
      return;
    }

    if (!result.confirmationAvailable || !result.baseline) {
      const gapText = result.baseline
        ? describeConfirmationSourceGaps(result.baseline, result.hasEnvelope ?? false)
        : '';
      debugLog('Buy-all sent but confirmation source unavailable', { key: buyModel.key, requested, sent: result.sent, confirmationAvailable: result.confirmationAvailable, hasEnvelope: result.hasEnvelope ?? false });
      setAlertPendingConfirmation(active, false);
      active.statusEl.style.color = '#fca5a5';
      active.statusEl.textContent = `Sent ${result.sent} \u2014 no confirmation source${gapText}`;
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
      shopPurchasesBaseline: null,
      shopPurchasesArmed: false,
      cycleArmFp: null,
      cleanups: [],
      presenter: createAlertPresenter(active.model.key),
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
    armReactiveConfirmation(pending, result.awaitResults ? { rejectionAwaits: result.awaitResults } : {});
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
    warnFeature('QPM-FEATURE-004', { what: 'buyAll', key: buyModel.key, requested }, error);
    debugLogError('Buy-all threw exception', error, { key: buyModel.key, requested });
    setAlertPendingConfirmation(active, false);
    active.statusEl.style.color = '#fca5a5';
    active.statusEl.textContent = 'Purchase failed';
    setAlertBusy(active, false);
  }
}
