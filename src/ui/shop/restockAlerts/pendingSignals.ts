import { pendingOwnershipConfirmations } from './alertState';
import type { PendingOwnershipConfirmation, CycleFingerprint, PurchaseCommandAwait } from './types';
import { debugLog } from './ownershipBaseline';
import {
  failPendingAndDismissForCycle,
  failPendingConfirmation,
  completePending,
  processPendingOwnershipConfirmations,
} from './pendingLifecycle';
import { describePurchaseRefusal, mergeRefusals, type PurchaseRefusal } from './purchaseRefusal';

// Forward imports (circular — safe in esbuild IIFE)
import { maybeAutoStoreConfirmedDelta } from './autoStore';
import { getShopStockItemByKey, onShopStockItemChange, type ShopStockItem } from '../../../store/shopStock';

// ---------------------------------------------------------------------------
// Reactive signal helpers (Signal A: shopPurchases delta / Signal B: cycle
// rollover / Signal C: envelope reject). Signal D (inventory delta) stays in
// processPendingOwnershipConfirmations (pendingLifecycle.ts).
// ---------------------------------------------------------------------------

function fingerprintCycle(item: ShopStockItem | null): CycleFingerprint | null {
  if (!item) return null;
  return {
    nextRestockAt: null,
    initialStock: item.initialStock,
    canSpawn: item.canSpawn,
  };
}

function cycleRolled(prev: CycleFingerprint | null, next: CycleFingerprint | null): boolean {
  if (!prev) return false;
  if (!next) return true;
  if (prev.initialStock !== next.initialStock) return true;
  if (prev.canSpawn !== next.canSpawn) return true;
  return false;
}

/**
 * Sets up the pending's reactive signals. Idempotent: existing subs are
 * torn down first. Must be called AFTER the pending is placed in
 * pendingOwnershipConfirmations. Envelope reject (Signal C) is optional and
 * absent under legacy transport.
 */
export function armReactiveConfirmation(
  pending: PendingOwnershipConfirmation,
  options: { rejectionAwaits?: PurchaseCommandAwait[] } = {},
): void {
  for (const teardown of pending.cleanups) {
    try { teardown(); } catch { /* ignore */ }
  }
  pending.cleanups.length = 0;

  const item0 = getShopStockItemByKey(pending.key);
  pending.shopPurchasesBaseline = item0 ? item0.purchased : null;
  pending.shopPurchasesArmed    = item0 != null;
  pending.cycleArmFp            = fingerprintCycle(item0);

  const key = pending.key;
  const cycleUnsub = onShopStockItemChange(key, (item) => {
    const latest = pendingOwnershipConfirmations.get(key);
    if (!latest) return;
    // Late-arm: when the shop bucket was empty at buy time (weather event
    // between pushes, myData rebinding mid-flight), baseline the FIRST tick
    // where the item exists and don't count it as a delta.
    if (item && !latest.shopPurchasesArmed) {
      latest.shopPurchasesBaseline = item.purchased;
      latest.shopPurchasesArmed = true;
      latest.cycleArmFp = fingerprintCycle(item);
      debugLog('Pending late-armed on first item appearance', { key, purchasedAtBaseline: item.purchased });
      return;
    }
    if (completeIfShopPurchasesReached(latest, item)) return;
    const nextFp = fingerprintCycle(item);
    if (cycleRolled(latest.cycleArmFp, nextFp)) {
      debugLog('Pending failed: shop cycle rolled', { key, armFp: latest.cycleArmFp, nextFp });
      failPendingAndDismissForCycle(key, 'Cycle rolled before confirmation — retry', 'cycleRolled');
    }
  });
  pending.cleanups.push(cycleUnsub);

  // Signal C: a refused command (sold out, not enough coins) never executed, so
  // all of its units leave the expected growth. Units from other commands that
  // did land still complete — and auto-store — normally.
  let refusal: PurchaseRefusal | null = null;
  for (const { units, awaitResult } of options.rejectionAwaits ?? []) {
    awaitResult().then((r) => {
      if (r.ok || r.resentAsLegacy || r.code === 'handler_error') return;
      if (pendingOwnershipConfirmations.get(key) !== pending) return;
      pending.expectedIncrease = Math.max(0, pending.expectedIncrease - units);
      refusal = mergeRefusals(refusal, describePurchaseRefusal(r.code));
      debugLog('Pending send refused by server', { key, code: r.code, retryable: refusal.retryable, expectedIncrease: pending.expectedIncrease, confirmed: pending.confirmed });
      if (pending.expectedIncrease === 0) {
        if (refusal.retryable) failPendingConfirmation(key, refusal.message, 'rejected');
        else failPendingAndDismissForCycle(key, refusal.message, 'rejected', { showReason: true });
      } else if (pending.confirmed >= pending.expectedIncrease) {
        void maybeAutoStoreConfirmedDelta(pending, pending.confirmed);
        completePending(pending, '');
      } else if (!completeIfShopPurchasesReached(pending, getShopStockItemByKey(key))) {
        processPendingOwnershipConfirmations();
      }
    }).catch(() => { /* timeout = unknown outcome; other signals decide */ });
  }
}

/** Signal A: the server's purchase counter has grown by the expected amount. */
function completeIfShopPurchasesReached(pending: PendingOwnershipConfirmation, item: ShopStockItem | null): boolean {
  if (!item || pending.shopPurchasesBaseline == null) return false;
  const delta = Math.max(0, item.purchased - pending.shopPurchasesBaseline);
  if (delta < pending.expectedIncrease) return false;
  completeFromShopPurchases(pending, delta);
  return true;
}

function completeFromShopPurchases(pending: PendingOwnershipConfirmation, delta: number): void {
  const confirmed = Math.min(pending.expectedIncrease, delta);
  if (confirmed <= pending.confirmed) return;
  pending.confirmed = confirmed;
  void maybeAutoStoreConfirmedDelta(pending, confirmed);
  if (pending.confirmed < pending.expectedIncrease) {
    pending.presenter?.showProgress(confirmed, pending.sent);
    return;
  }
  debugLog('Pending completed via shopPurchases delta', { key: pending.key, confirmed: pending.confirmed, baseline: pending.shopPurchasesBaseline });
  completePending(pending, '');
}
