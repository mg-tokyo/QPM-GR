// Inventory snapshot handling, ownership state machine, and confirmation tracking.

import type { InventoryData } from '../../../store/inventory';
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
export {
  debugLog,
  debugLogError,
  debugLogStockStateIfChanged,
  sleep,
  asNonNegativeQuantity,
  onOwnershipChange,
  notifyOwnershipChange,
  waitForOwnershipMatch,
  resolveOwnershipKey,
  combinedOwnedCount,
  hasOwnershipSource,
  waitForOwnershipBaselines,
  captureOwnershipBaseline,
  readOwnershipDelta,
  type OwnershipCountSources,
} from './ownershipBaseline';
export { armReactiveConfirmation } from './pendingSignals';
export {
  failPendingAndDismissForCycle,
  finishDeferredCompletion,
  clearPendingOwnershipConfirmation,
  schedulePendingStaleNotice,
  failPendingConfirmation,
  scheduleMaxConfirmationTimeout,
  failAllPendingConfirmations,
  processPendingOwnershipConfirmations,
} from './pendingLifecycle';
import { alertState, activeAlerts, pendingOwnershipConfirmations } from './alertState';
import {
  debugLog,
  notifyOwnershipChange,
  combinedOwnedCount,
  currentCountSources,
  type OwnershipCountSources,
} from './ownershipBaseline';
import { processPendingOwnershipConfirmations } from './pendingLifecycle';

// Forward imports (circular — safe in esbuild IIFE)
import { processShopStock } from './stockProcessor';
import { getShopStockState } from '../../../store/shopStock';

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
