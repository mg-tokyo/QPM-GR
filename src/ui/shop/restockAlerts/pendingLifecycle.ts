import { warnFeature } from './_diagnostics';
import {
  OWNERSHIP_STALE_NOTICE_MS,
  OWNERSHIP_MAX_CONFIRMATION_MS,
  type PendingOwnershipConfirmation,
  type PurchaseOutcome,
} from './types';
import { activeAlerts, dismissedInStockKeys, pendingOwnershipConfirmations } from './alertState';
import { debugLog, readOwnershipDelta } from './ownershipBaseline';

// Forward imports (circular — safe in esbuild IIFE)
import { removeAlert } from './alertDom';
import { hasReachedToolInventoryCap, shouldLockDismissForPurchaseCompletion } from './purchaseActions';
import { maybeAutoStoreConfirmedDelta } from './autoStore';
import { markDismissedCycle } from './stockProcessor';

// ---------------------------------------------------------------------------
// Pending ownership confirmation lifecycle
// ---------------------------------------------------------------------------

/**
 * Fail the pending AND dismiss the alert for its stock cycle. Used when a
 * reactive signal concludes this cycle's stock is unattainable — envelope
 * reject (Signal C) or cycle rollover (Signal B) — so the alert clears
 * instead of flashing red and reverting to "Ready to buy". `showReason` keeps
 * an open card up with the reason first (PD3 refusals).
 */
export function failPendingAndDismissForCycle(
  key: string,
  reason: string,
  status: 'rejected' | 'cycleRolled',
  options: { showReason?: boolean } = {},
): void {
  const pending = pendingOwnershipConfirmations.get(key);
  if (!pending) return;
  const cycleId = pending.stockCycleId;
  const presenter = pending.presenter;
  const outcome: PurchaseOutcome = {
    sent: pending.sent,
    confirmed: pending.confirmed,
    storedIn: pending.storedInTargetStorage ? pending.autoStoreStorageId : null,
    error: reason,
    timedOut: false,
    status,
  };
  // Disarm before clearing: clearPendingOwnershipConfirmation now settles any
  // still-armed pending itself, and this outcome is the more specific one.
  const settle = pending.settle;
  pending.settle = null;
  debugLog('Fail-and-dismiss pending for cycle', {
    key, reason, cycleId, sent: pending.sent, confirmed: pending.confirmed,
    headless: pending.presenter === null,
  });
  clearPendingOwnershipConfirmation(key);
  settle?.(outcome);
  if (options.showReason && presenter?.showRefusal(reason, cycleId)) return;
  dismissedInStockKeys.add(key);
  markDismissedCycle(key, cycleId);
  removeAlert(key);
}

/** Settle a fully confirmed pending. Held back while its auto-store move awaits the server's verdict. */
export function completePending(pending: PendingOwnershipConfirmation, completionSuffix: string): void {
  if (pending.autoStoreInFlight) {
    pending.deferredCompletionSuffix = completionSuffix;
    // The purchase itself is confirmed; only the storage move is outstanding.
    if (pending.maxTimeoutTimerId != null) window.clearTimeout(pending.maxTimeoutTimerId);
    pending.maxTimeoutTimerId = null;
    debugLog('Completion deferred until auto-store verdict', { key: pending.key, storageId: pending.autoStoreStorageId });
    return;
  }
  pending.deferredCompletionSuffix = null;
  const storeNote = !pending.storedInTargetStorage && pending.autoStoreSkipReason ? pending.autoStoreSkipReason : null;
  const storedNote = pending.storedInTargetStorage && pending.autoStoreLabel
    ? ` + moved to ${pending.autoStoreLabel}`
    : (storeNote ? ` (kept in inventory: ${storeNote})` : '');
  const lockDismissForCycle = shouldLockDismissForPurchaseCompletion(pending.key);
  debugLog('Ownership confirmation completed; scheduling alert removal', {
    key: pending.key,
    confirmed: pending.confirmed,
    expectedIncrease: pending.expectedIncrease,
    storedInTargetStorage: pending.storedInTargetStorage,
    autoStoreLabel: pending.autoStoreLabel,
    storeNote,
    stockCycleId: pending.stockCycleId,
    lockDismissForCycle,
    completionSuffix,
    headless: pending.presenter === null,
  });
  pending.presenter?.showCompletion({
    confirmed: pending.confirmed,
    storedNote,
    completionSuffix,
    lockDismissForCycle,
    stockCycleId: pending.stockCycleId,
  });
  const outcome: PurchaseOutcome = {
    sent: pending.sent,
    confirmed: pending.confirmed,
    storedIn: pending.storedInTargetStorage ? pending.autoStoreStorageId : null,
    ...(storeNote ? { storeNote } : {}),
    error: null,
    timedOut: false,
    status: 'confirmed',
  };
  const settle = pending.settle;
  pending.settle = null;
  settle?.(outcome);
  clearPendingOwnershipConfirmation(pending.key);
}

/** Auto-store verdict arrived: finish a completion that was held back for it, if this pending is still live. */
export function finishDeferredCompletion(pending: PendingOwnershipConfirmation): void {
  if (pending.deferredCompletionSuffix == null) return;
  if (pendingOwnershipConfirmations.get(pending.key) !== pending) return;
  completePending(pending, pending.deferredCompletionSuffix);
}

export function clearPendingOwnershipConfirmation(key: string): void {
  const pending = pendingOwnershipConfirmations.get(key);
  if (!pending) return;
  debugLog('Clearing pending ownership confirmation', {
    key,
    sent: pending.sent,
    confirmed: pending.confirmed,
    expectedIncrease: pending.expectedIncrease,
    autoStoreFinalMoveRequested: pending.autoStoreFinalMoveRequested,
    storedInTargetStorage: pending.storedInTargetStorage,
  });
  if (pending.staleNoticeTimerId != null) window.clearTimeout(pending.staleNoticeTimerId);
  if (pending.maxTimeoutTimerId != null) window.clearTimeout(pending.maxTimeoutTimerId);
  for (const teardown of pending.cleanups) {
    try { teardown(); } catch (error) { warnFeature('QPM-FEATURE-004', { what: 'pending:cleanup', key }, error); }
  }
  pending.cleanups.length = 0;
  pendingOwnershipConfirmations.delete(key);
  // A headless caller (purchaseAndConfirm) is awaiting this pending's settle, so
  // every clear must resolve it (feature stop/restart clears all pendings) or the
  // caller's in-flight flag sticks. Sites with a more specific outcome null out
  // `settle` before calling here, so this never double-settles.
  const orphaned = pending.settle;
  if (orphaned) {
    pending.settle = null;
    orphaned({
      sent: pending.sent,
      confirmed: pending.confirmed,
      storedIn: pending.storedInTargetStorage ? pending.autoStoreStorageId : null,
      error: 'purchase cleared',
      timedOut: false,
      status: 'cleared',
    });
  }
}

export function schedulePendingStaleNotice(key: string): void {
  const pending = pendingOwnershipConfirmations.get(key);
  if (!pending) return;
  if (pending.staleNoticeTimerId != null) window.clearTimeout(pending.staleNoticeTimerId);
  pending.staleNoticeTimerId = window.setTimeout(() => {
    const latest = pendingOwnershipConfirmations.get(key);
    if (!latest) return;
    latest.staleNoticeTimerId = null;
    if (latest.confirmed > 0) return;
    latest.staleNoticeShown = true;
    latest.presenter?.showStaleNotice(latest.sent);
    debugLog('Pending confirmation reached stale notice window', {
      key,
      sent: latest.sent,
      confirmed: latest.confirmed,
      expectedIncrease: latest.expectedIncrease,
      baselineCount: latest.baseline.count,
      currentDelta: readOwnershipDelta(key, latest.baseline),
      headless: latest.presenter === null,
    });
  }, OWNERSHIP_STALE_NOTICE_MS);
}

export function failPendingConfirmation(key: string, reason: string, status: 'timedOut' | 'connectionLost' | 'rejected'): void {
  const pending = pendingOwnershipConfirmations.get(key);
  if (!pending) return;
  debugLog('Failing pending confirmation', { key, reason, sent: pending.sent, confirmed: pending.confirmed, headless: pending.presenter === null });
  const outcome: PurchaseOutcome = {
    sent: pending.sent,
    confirmed: pending.confirmed,
    storedIn: pending.storedInTargetStorage ? pending.autoStoreStorageId : null,
    error: reason,
    timedOut: reason.startsWith('Purchase timed out'),
    status,
  };
  const presenter = pending.presenter;
  const settle = pending.settle;
  pending.settle = null;
  clearPendingOwnershipConfirmation(key);
  settle?.(outcome);
  presenter?.showFailure(reason);
}

export function scheduleMaxConfirmationTimeout(key: string): void {
  const pending = pendingOwnershipConfirmations.get(key);
  if (!pending) return;
  if (pending.maxTimeoutTimerId != null) window.clearTimeout(pending.maxTimeoutTimerId);
  pending.maxTimeoutTimerId = window.setTimeout(() => {
    const latest = pendingOwnershipConfirmations.get(key);
    if (!latest) return;
    latest.maxTimeoutTimerId = null;
    failPendingConfirmation(key, `Purchase timed out (${latest.confirmed}/${latest.sent} confirmed)`, 'timedOut');
  }, OWNERSHIP_MAX_CONFIRMATION_MS);
}

export function failAllPendingConfirmations(reason: string, status: 'connectionLost'): void {
  if (pendingOwnershipConfirmations.size === 0) return;
  for (const key of Array.from(pendingOwnershipConfirmations.keys())) {
    failPendingConfirmation(key, reason, status);
  }
}

export function processPendingOwnershipConfirmations(): void {
  if (pendingOwnershipConfirmations.size === 0) return;

  for (const [key, pending] of Array.from(pendingOwnershipConfirmations.entries())) {
    if (pending.presenter !== null && !activeAlerts.has(key)) {
      debugLog('Clearing pending confirmation because alert no longer exists', {
        key,
        expectedIncrease: pending.expectedIncrease,
        confirmed: pending.confirmed,
      });
      clearPendingOwnershipConfirmation(key);
      continue;
    }

    const confirmed = Math.min(
      pending.expectedIncrease,
      readOwnershipDelta(key, pending.baseline),
    );
    const capState = hasReachedToolInventoryCap(pending.key, pending.itemId);
    const completedByToolCap = capState.reached;

    if (confirmed <= pending.confirmed && !completedByToolCap) continue;

    if (confirmed > pending.confirmed) {
      debugLog('Ownership confirmation progressed', {
        key,
        expectedIncrease: pending.expectedIncrease,
        previousConfirmed: pending.confirmed,
        nextConfirmed: confirmed,
        sent: pending.sent,
        baselineCount: pending.baseline.count,
        currentDelta: readOwnershipDelta(key, pending.baseline),
      });
      pending.confirmed = confirmed;
      void maybeAutoStoreConfirmedDelta(pending, confirmed);
    }

    const completed = pending.confirmed >= pending.expectedIncrease || completedByToolCap;
    if (completed) {
      completePending(pending, completedByToolCap ? ` (inventory full ${capState.owned}/${capState.limit})` : '');
      continue;
    }

    pending.presenter?.showProgress(confirmed, pending.sent);
    schedulePendingStaleNotice(key);
  }
}
