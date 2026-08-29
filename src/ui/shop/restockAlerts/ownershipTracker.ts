// Inventory snapshot handling, ownership state machine, and confirmation tracking.

import { isWeatherShopType } from '../../../types/shops';
import { warnFeature } from './_diagnostics';
import type { InventoryData } from '../../../store/inventory';
import {
  ALERT_DEBUG_ENABLED,
  ALERT_SUCCESS_HIDE_MS,
  OWNERSHIP_BASELINE_WAIT_MS,
  OWNERSHIP_STALE_NOTICE_MS,
  OWNERSHIP_MAX_CONFIRMATION_MS,
  type RestockShopType,
  type OwnershipBaseline,
  type PendingOwnershipConfirmation,
} from './types';
import {
  toNonNegativeInteger,
  firstString,
  addCount,
  toCanonicalKey,
  buildInventoryKeyCounts,
  buildInventoryKeyItemQuantities,
  buildSeedSiloKeyCounts,
  buildDecorShedKeyCounts,
  buildToolShackKeyCounts,
} from './ownershipCounts';

export {
  toLowerTrimmed,
  toTrimmedString,
  toNonNegativeInteger,
  firstString,
  addCount,
  normalizeShopType,
  toCanonicalKey,
  getInventoryItemKey,
  buildInventoryKeyCounts,
  buildInventoryKeyItemQuantities,
  buildSeedSiloKeyCounts,
  buildDecorShedKeyCounts,
  buildToolShackKeyCounts,
} from './ownershipCounts';
import {
  alertState,
  activeAlerts,
  ownershipListeners,
  pendingOwnershipConfirmations,
  debugLastStockStateByKey,
  dismissedInStockKeys,
} from './alertState';

// Forward imports (circular — safe in esbuild IIFE)
import { removeAlert, setAlertPendingConfirmation, updateAlertQuantity } from './alertDom';
import { hasReachedToolInventoryCap, shouldLockDismissForPurchaseCompletion, maybeAutoStoreConfirmedDelta } from './purchaseActions';
import { markDismissedCycle, clearDismissedCycle, processShopStock } from './stockProcessor';
import { getShopStockState } from '../../../store/shopStock';

// ---------------------------------------------------------------------------
// Debug helpers
// ---------------------------------------------------------------------------

export function debugLog(message: string, details?: Record<string, unknown>): void {
  if (!ALERT_DEBUG_ENABLED) return;
  const prefix = '[QPM][ShopRestockAlerts][Debug]';
  if (details) { console.log(`${prefix} ${message}`, details); return; }
  console.log(`${prefix} ${message}`);
}

export function debugLogError(message: string, error: unknown, details?: Record<string, unknown>): void {
  if (!ALERT_DEBUG_ENABLED) return;
  const prefix = '[QPM][ShopRestockAlerts][Debug]';
  if (details) { console.error(`${prefix} ${message}`, { ...details, error }); return; }
  console.error(`${prefix} ${message}`, error);
}

export function debugLogStockStateIfChanged(key: string, snapshot: Record<string, unknown>): void {
  if (!ALERT_DEBUG_ENABLED) return;
  const nextSignature = JSON.stringify(snapshot);
  const prevSignature = debugLastStockStateByKey.get(key);
  if (prevSignature === nextSignature) return;
  debugLastStockStateByKey.set(key, nextSignature);
  debugLog('Stock state changed', { key, ...snapshot });
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

export function asNonNegativeQuantity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function cloneItemQuantities(source: Map<string, number> | undefined): Map<string, number> {
  if (!source) return new Map<string, number>();
  return new Map<string, number>(source.entries());
}

// ---------------------------------------------------------------------------
// Ownership pub/sub
// ---------------------------------------------------------------------------

export function onOwnershipChange(listener: () => void): () => void {
  ownershipListeners.add(listener);
  return () => { ownershipListeners.delete(listener); };
}

export function notifyOwnershipChange(): void {
  for (const listener of Array.from(ownershipListeners)) {
    try { listener(); } catch (error) { warnFeature('QPM-FEATURE-004', { what: 'listener:ownership' }, error); }
  }
}

export function waitForOwnershipMatch(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  if (predicate()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = 0;
    const unsubscribe = onOwnershipChange(() => {
      if (settled) return;
      if (!predicate()) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve(true);
    });
    timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(false);
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// Ownership counting and baseline
// ---------------------------------------------------------------------------

/** Weather-shop keys (`dawn:x`) own nothing directly — map to whichever item-type key (`seed:x`, `crystal:x`, …) the player holds. */
export function resolveOwnershipKey(key: string): string {
  const sep = key.indexOf(':');
  if (sep <= 0 || !isWeatherShopType(key.slice(0, sep))) return key;
  const suffix = key.slice(sep);
  for (const source of [alertState.inventoryKeyCounts, alertState.seedSiloKeyCounts, alertState.decorShedKeyCounts, alertState.toolShackKeyCounts]) {
    for (const candidate of source.keys()) {
      if (candidate !== key && candidate.endsWith(suffix)) return candidate;
    }
  }
  return key;
}

export interface OwnershipCountSources {
  inventory: Map<string, number>;
  seedSilo: Map<string, number>;
  decorShed: Map<string, number>;
  toolShack: Map<string, number>;
}

function currentCountSources(): OwnershipCountSources {
  return {
    inventory: alertState.inventoryKeyCounts,
    seedSilo:  alertState.seedSiloKeyCounts,
    decorShed: alertState.decorShedKeyCounts,
    toolShack: alertState.toolShackKeyCounts,
  };
}

export function combinedOwnedCount(key: string, sources: OwnershipCountSources): number {
  const resolvedKey = resolveOwnershipKey(key);
  const inventoryQty = sources.inventory.get(resolvedKey) ?? 0;
  if (resolvedKey.startsWith('seed:'))  return inventoryQty + (sources.seedSilo.get(resolvedKey) ?? 0);
  if (resolvedKey.startsWith('decor:')) return inventoryQty + (sources.decorShed.get(resolvedKey) ?? 0);
  if (resolvedKey.startsWith('tool:'))  return inventoryQty + (sources.toolShack.get(resolvedKey) ?? 0);
  return inventoryQty;
}

function readOwnedCountFromBaseline(key: string, baseline: OwnershipBaseline): number {
  const resolvedKey = resolveOwnershipKey(key);
  let total = 0;
  if (baseline.includeInventory) total += alertState.inventoryKeyCounts.get(resolvedKey) ?? 0;
  if (baseline.includeSeedSilo)  total += alertState.seedSiloKeyCounts.get(resolvedKey) ?? 0;
  if (baseline.includeDecorShed) total += alertState.decorShedKeyCounts.get(resolvedKey) ?? 0;
  if (baseline.includeToolShack) total += alertState.toolShackKeyCounts.get(resolvedKey) ?? 0;
  return total;
}

export function hasOwnershipSource(baseline: OwnershipBaseline): boolean {
  return baseline.includeInventory || baseline.includeSeedSilo || baseline.includeDecorShed || baseline.includeToolShack;
}

export async function waitForOwnershipBaselines(shopType: RestockShopType): Promise<void> {
  const isWeatherShop         = isWeatherShopType(shopType);
  const requiresSeedSilo      = shopType === 'seed' || isWeatherShop;
  const requiresDecorShed     = shopType === 'decor' || isWeatherShop;
  const requiresToolShack     = shopType === 'tool' || isWeatherShop;
  const requiresToolInventory = shopType === 'tool' || isWeatherShop;
  const ready = (): boolean =>
    alertState.hasInventoryBaseline &&
    (!requiresSeedSilo      || alertState.hasSeedSiloBaseline) &&
    (!requiresDecorShed     || alertState.hasDecorShedBaseline) &&
    (!requiresToolShack     || alertState.hasToolShackBaseline) &&
    (!requiresToolInventory || alertState.hasToolInventoryBaseline);
  if (ready()) return;
  await waitForOwnershipMatch(ready, OWNERSHIP_BASELINE_WAIT_MS);
}

export function captureOwnershipBaseline(key: string, shopType: RestockShopType): OwnershipBaseline {
  const isWeatherShop     = isWeatherShopType(shopType);
  const includeInventory  = alertState.hasInventoryBaseline;
  const includeSeedSilo   = (shopType === 'seed'  || isWeatherShop) && alertState.hasSeedSiloBaseline;
  const includeDecorShed  = (shopType === 'decor' || isWeatherShop) && alertState.hasDecorShedBaseline;
  const includeToolShack  = (shopType === 'tool'  || isWeatherShop) && alertState.hasToolShackBaseline;
  const baseline: OwnershipBaseline = {
    count: 0,
    includeInventory,
    includeSeedSilo,
    includeDecorShed,
    includeToolShack,
    // Inventory stacks are keyed by item type (`tool:x`), never by weather shop (`amber:x`).
    inventoryKeyItemQuantities: cloneItemQuantities(alertState.inventoryKeyItemQuantities.get(resolveOwnershipKey(key))),
  };
  return { ...baseline, count: readOwnedCountFromBaseline(key, baseline) };
}

export function readOwnershipDelta(key: string, baseline: OwnershipBaseline): number {
  const current = readOwnedCountFromBaseline(key, baseline);
  return Math.max(0, current - baseline.count);
}

// ---------------------------------------------------------------------------
// Pending ownership confirmation lifecycle
// ---------------------------------------------------------------------------

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
  pendingOwnershipConfirmations.delete(key);
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
    const active = activeAlerts.get(key);
    if (!active || active.busy || !active.pendingConfirmation) return;
    active.statusEl.style.color = '#fde68a';
    active.statusEl.textContent = `Sent ${latest.sent} \u2014 confirming (slow)\u2026`;
    debugLog('Pending confirmation reached stale notice window', {
      key,
      sent: latest.sent,
      confirmed: latest.confirmed,
      expectedIncrease: latest.expectedIncrease,
      baselineCount: latest.baseline.count,
      currentDelta: readOwnershipDelta(key, latest.baseline),
    });
  }, OWNERSHIP_STALE_NOTICE_MS);
}

export function failPendingConfirmation(key: string, reason: string): void {
  const pending = pendingOwnershipConfirmations.get(key);
  if (!pending) return;
  debugLog('Failing pending confirmation', { key, reason, sent: pending.sent, confirmed: pending.confirmed });
  clearPendingOwnershipConfirmation(key);
  const active = activeAlerts.get(key);
  if (!active) return;
  setAlertPendingConfirmation(active, false);
  active.statusEl.style.color = '#fca5a5';
  active.statusEl.textContent = reason;
  window.setTimeout(() => {
    const current = activeAlerts.get(key);
    if (!current) return;
    if (current.busy || current.pendingConfirmation) return;
    current.statusEl.style.color = 'rgba(200,192,255,0.72)';
    current.statusEl.textContent = 'Ready to buy';
  }, 4_000);
}

export function scheduleMaxConfirmationTimeout(key: string): void {
  const pending = pendingOwnershipConfirmations.get(key);
  if (!pending) return;
  if (pending.maxTimeoutTimerId != null) window.clearTimeout(pending.maxTimeoutTimerId);
  pending.maxTimeoutTimerId = window.setTimeout(() => {
    const latest = pendingOwnershipConfirmations.get(key);
    if (!latest) return;
    latest.maxTimeoutTimerId = null;
    failPendingConfirmation(key, `Purchase timed out (${latest.confirmed}/${latest.sent} confirmed)`);
  }, OWNERSHIP_MAX_CONFIRMATION_MS);
}

export function failAllPendingConfirmations(reason: string): void {
  if (pendingOwnershipConfirmations.size === 0) return;
  for (const key of Array.from(pendingOwnershipConfirmations.keys())) {
    failPendingConfirmation(key, reason);
  }
}

export function processPendingOwnershipConfirmations(): void {
  if (pendingOwnershipConfirmations.size === 0) return;

  for (const [key, pending] of Array.from(pendingOwnershipConfirmations.entries())) {
    const active = activeAlerts.get(key);
    if (!active) {
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
      const storedNote = pending.storedInTargetStorage && pending.autoStoreLabel
        ? ` + moved to ${pending.autoStoreLabel}`
        : '';
      active.statusEl.style.color = '#86efac';
      const completionSuffix = completedByToolCap
        ? ` (inventory full ${capState.owned}/${capState.limit})`
        : '';
      active.statusEl.textContent = `Purchased ${pending.confirmed}${storedNote}${completionSuffix}`;
      setAlertPendingConfirmation(active, false);
      clearPendingOwnershipConfirmation(key);
      if (shouldLockDismissForPurchaseCompletion(key)) {
        dismissedInStockKeys.add(key);
        markDismissedCycle(key, pending.stockCycleId);
      } else {
        dismissedInStockKeys.delete(key);
        clearDismissedCycle(key);
      }
      debugLog('Ownership confirmation completed; scheduling alert removal', {
        key,
        confirmed: pending.confirmed,
        expectedIncrease: pending.expectedIncrease,
        storedInTargetStorage: pending.storedInTargetStorage,
        autoStoreLabel: pending.autoStoreLabel,
        stockCycleId: pending.stockCycleId,
        lockDismissForCycle: shouldLockDismissForPurchaseCompletion(key),
        completedByToolCap,
        capOwned: capState.owned,
        capLimit: capState.limit,
      });
      window.setTimeout(() => { removeAlert(key); }, ALERT_SUCCESS_HIDE_MS);
      continue;
    }

    active.statusEl.style.color = '#fde68a';
    active.statusEl.textContent = `Purchased ${confirmed}/${pending.sent} confirmed`;
    schedulePendingStaleNotice(key);
  }
}

export function applyOwnershipDelta(prevSources: OwnershipCountSources, nextSources: OwnershipCountSources): void {
  if (activeAlerts.size === 0) return;
  for (const key of Array.from(activeAlerts.keys())) {
    const previous = combinedOwnedCount(key, prevSources);
    const next     = combinedOwnedCount(key, nextSources);
    if (next <= previous) continue;
    const active = activeAlerts.get(key);
    const hasPending = pendingOwnershipConfirmations.has(key);
    if (active && (active.busy || active.pendingConfirmation || hasPending)) {
      debugLog('Ownership increase detected during in-flight purchase; keeping alert state intact', {
        key,
        previousOwned: previous,
        nextOwned: next,
        increase: next - previous,
        busy: active.busy,
        pendingConfirmation: active.pendingConfirmation,
        hasPending,
      });
      continue;
    }
    debugLog('Ownership increase detected while alert idle; waiting for stock snapshot update', {
      key,
      previousOwned: previous,
      nextOwned: next,
      increase: next - previous,
    });
  }
}

// ---------------------------------------------------------------------------
// Atom snapshot handlers
// ---------------------------------------------------------------------------

function mergeToolCountsInto(counts: Map<string, number>): void {
  // Tool items are in a separate atom (myToolInventoryAtom) — merge them in
  // so all cap-check and ownership-delta logic can read from one place.
  // Use Math.max to avoid regressing a correct general-inventory count with
  // stale tool-atom data during the race window between snapshot handlers.
  for (const [key, qty] of alertState.toolInventoryKeyCounts.entries()) {
    const existing = counts.get(key) ?? 0;
    counts.set(key, Math.max(existing, qty));
  }
}

export function handleInventorySnapshot(data: InventoryData): void {
  const nextCounts        = buildInventoryKeyCounts(data);
  mergeToolCountsInto(nextCounts);
  const nextItemQuantities = buildInventoryKeyItemQuantities(data);
  debugLog('Inventory snapshot received', {
    itemRows: Array.isArray(data.items) ? data.items.length : 0,
    keyCount: nextCounts.size,
    pendingConfirmations: pendingOwnershipConfirmations.size,
  });
  if (!alertState.hasInventoryBaseline) {
    alertState.inventoryKeyCounts         = nextCounts;
    alertState.inventoryKeyItemQuantities = nextItemQuantities;
    alertState.hasInventoryBaseline       = true;
    debugLog('Inventory baseline initialized', { keyCount: alertState.inventoryKeyCounts.size });
    notifyOwnershipChange();
    processPendingOwnershipConfirmations();
    processShopStock(getShopStockState());
    return;
  }
  const prevCounts = alertState.inventoryKeyCounts;
  alertState.inventoryKeyCounts         = nextCounts;
  alertState.inventoryKeyItemQuantities = nextItemQuantities;
  applyOwnershipDelta({ ...currentCountSources(), inventory: prevCounts }, currentCountSources());
  notifyOwnershipChange();
  processPendingOwnershipConfirmations();
  processShopStock(getShopStockState());
}

export function handleToolInventorySnapshot(rawValue: unknown): void {
  const next = new Map<string, number>();
  if (Array.isArray(rawValue)) {
    for (const item of rawValue) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;
      const toolId = firstString([raw.toolId, raw.id, raw.name]);
      if (!toolId) continue;
      const quantity = toNonNegativeInteger(raw.quantity) ?? 1;
      addCount(next, toCanonicalKey('tool', toolId), Math.max(1, quantity));
    }
  }
  alertState.toolInventoryKeyCounts = next;

  // Rebuild inventoryKeyCounts with updated tool counts — strip old tool: entries
  // then add new ones so the rest of the ownership system sees correct totals.
  const merged = new Map<string, number>(alertState.inventoryKeyCounts.entries());
  for (const key of Array.from(merged.keys())) {
    if (key.startsWith('tool:')) merged.delete(key);
  }
  mergeToolCountsInto(merged);

  const prevCounts = alertState.inventoryKeyCounts;
  alertState.inventoryKeyCounts = merged;

  if (!alertState.hasToolInventoryBaseline) {
    alertState.hasToolInventoryBaseline = true;
    debugLog('Tool inventory baseline initialized', { keyCount: next.size });
    notifyOwnershipChange();
    processPendingOwnershipConfirmations();
    processShopStock(getShopStockState());
    return;
  }
  applyOwnershipDelta({ ...currentCountSources(), inventory: prevCounts }, currentCountSources());
  notifyOwnershipChange();
  processPendingOwnershipConfirmations();
  processShopStock(getShopStockState());
}

export function handleMyDataSnapshot(value: unknown): void {
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    const coins = raw.coinsCount;
    if (typeof coins === 'number' && Number.isFinite(coins)) {
      alertState.currentCoinsCount = Math.max(0, Math.floor(coins));
      alertState.hasCoinsBaseline  = true;
      debugLog('Coin baseline updated', { coins: alertState.currentCoinsCount });
    }
  }

  const nextSeedCounts  = buildSeedSiloKeyCounts(value);
  const nextDecorCounts = buildDecorShedKeyCounts(value);
  const nextShackCounts = buildToolShackKeyCounts(value);
  debugLog('myData storage snapshot received', {
    seedSiloKeyCount:  nextSeedCounts.size,
    decorShedKeyCount: nextDecorCounts.size,
    toolShackKeyCount: nextShackCounts.size,
    pendingConfirmations: pendingOwnershipConfirmations.size,
  });
  const hadStorageBaseline = alertState.hasSeedSiloBaseline || alertState.hasDecorShedBaseline || alertState.hasToolShackBaseline;
  const prevSources = currentCountSources();

  alertState.seedSiloKeyCounts  = nextSeedCounts;
  alertState.decorShedKeyCounts = nextDecorCounts;
  alertState.toolShackKeyCounts = nextShackCounts;
  alertState.hasSeedSiloBaseline  = true;
  alertState.hasDecorShedBaseline = true;
  alertState.hasToolShackBaseline = true;

  if (!hadStorageBaseline) {
    debugLog('Storage baselines initialized', {
      seedSiloKeyCount:  alertState.seedSiloKeyCounts.size,
      decorShedKeyCount: alertState.decorShedKeyCounts.size,
      toolShackKeyCount: alertState.toolShackKeyCounts.size,
    });
    notifyOwnershipChange();
    processPendingOwnershipConfirmations();
    processShopStock(getShopStockState());
    return;
  }

  applyOwnershipDelta(prevSources, currentCountSources());
  notifyOwnershipChange();
  processPendingOwnershipConfirmations();
  processShopStock(getShopStockState());
}

