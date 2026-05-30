// src/ui/shopRestockAlerts/ownershipTracker.ts
// Inventory snapshot handling, ownership state machine, and confirmation tracking.

import { log } from '../../../utils/logger';
import { canonicalItemId } from '../../../utils/restockDataService';
import type { InventoryData, InventoryItem } from '../../../store/inventory';
import {
  ALERT_DEBUG_ENABLED,
  ALERT_SUCCESS_HIDE_MS,
  OWNERSHIP_BASELINE_WAIT_MS,
  OWNERSHIP_STALE_NOTICE_MS,
  OWNERSHIP_MAX_CONFIRMATION_MS,
  SEED_SILO_STORAGE_ID,
  DECOR_SHED_STORAGE_ID,
  type RestockShopType,
  type OwnershipBaseline,
  type PendingOwnershipConfirmation,
} from './types';
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

export function toLowerTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const next = value.trim().toLowerCase();
  return next.length > 0 ? next : null;
}

export function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  return next.length > 0 ? next : null;
}

export function toNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

export function asNonNegativeQuantity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

export function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function addCount(map: Map<string, number>, key: string, amount: number): void {
  if (amount <= 0 || !Number.isFinite(amount)) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

export function normalizeShopType(rawType: unknown): RestockShopType | null {
  const type = toLowerTrimmed(rawType);
  if (!type) return null;
  if (type === 'seed' || type === 'seeds') return 'seed';
  if (type === 'egg' || type === 'eggs') return 'egg';
  if (type === 'decor' || type === 'decoration' || type === 'decorations') return 'decor';
  if (type === 'tool' || type === 'tools') return 'tool';
  if (type === 'dawn') return 'dawn';
  return null;
}

export function toCanonicalKey(shopType: RestockShopType, itemId: string): string {
  const canonicalId = canonicalItemId(shopType, itemId).trim().toLowerCase();
  return `${shopType}:${canonicalId}`;
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
    try { listener(); } catch (error) { log('[ShopRestockAlerts] Ownership listener failed', error); }
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
// Inventory key derivation
// ---------------------------------------------------------------------------

export function getInventoryItemKey(item: InventoryItem): string | null {
  const raw = item.raw && typeof item.raw === 'object' ? item.raw as Record<string, unknown> : null;
  const inferredType =
    normalizeShopType(item.itemType) ??
    normalizeShopType(raw?.itemType) ??
    normalizeShopType(raw?.type);

  const explicitByType = (): string | null => {
    if (inferredType === 'egg') {
      const id = firstString([raw?.eggId, item.itemId, raw?.id]);
      return id ? toCanonicalKey('egg', id) : null;
    }
    if (inferredType === 'tool') {
      // Prefer dedicated type field, then species/name — avoid UUIDs (itemId/raw.id)
      // since the game stores tool identity in species/name, not itemId.
      const id = firstString([raw?.toolId, raw?.species, item.species, raw?.name, item.name]);
      return id ? toCanonicalKey('tool', id) : null;
    }
    if (inferredType === 'decor') {
      const id = firstString([raw?.decorId, item.itemId, raw?.id]);
      return id ? toCanonicalKey('decor', id) : null;
    }
    if (inferredType === 'seed') {
      const id = firstString([item.species, raw?.species, raw?.seedName, item.itemId, raw?.id]);
      return id ? toCanonicalKey('seed', id) : null;
    }
    return null;
  };

  const explicit = explicitByType();
  if (explicit) return explicit;

  const eggId = firstString([raw?.eggId]);
  if (eggId) return toCanonicalKey('egg', eggId);
  const toolId = firstString([raw?.toolId]);
  if (toolId) return toCanonicalKey('tool', toolId);
  const decorId = firstString([raw?.decorId]);
  if (decorId) return toCanonicalKey('decor', decorId);

  const seedId = firstString([item.species, raw?.species, raw?.seedName]);
  if (seedId) return toCanonicalKey('seed', seedId);
  return null;
}

export function buildInventoryKeyCounts(data: InventoryData): Map<string, number> {
  const next = new Map<string, number>();
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    const key = getInventoryItemKey(item);
    if (!key) continue;
    const quantity = toNonNegativeInteger(item.quantity) ?? 1;
    addCount(next, key, Math.max(1, quantity));
  }
  return next;
}

export function buildInventoryKeyItemQuantities(data: InventoryData): Map<string, Map<string, number>> {
  const next = new Map<string, Map<string, number>>();
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    const key = getInventoryItemKey(item);
    if (!key) continue;
    const itemId = toTrimmedString(item.id);
    if (!itemId) continue;
    const quantity = toNonNegativeInteger(item.quantity) ?? 1;
    const bucket = next.get(key) ?? new Map<string, number>();
    bucket.set(itemId, Math.max(1, quantity));
    next.set(key, bucket);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Storage (Seed Silo / Decor Shed) counting
// ---------------------------------------------------------------------------

function isStorageByToken(entry: unknown, storageToken: string): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const row = entry as Record<string, unknown>;
  const fields = [row.storageId, row.decorId, row.id, row.type, row.name];
  const token = storageToken.trim().toLowerCase();
  return fields.some((value) => {
    const normalized = toLowerTrimmed(value);
    if (!normalized) return false;
    const compact = normalized.replace(/\s+/g, '');
    return normalized === token || compact === token || compact.includes(token);
  });
}

function isSeedSiloStorage(entry: unknown): boolean {
  return isStorageByToken(entry, SEED_SILO_STORAGE_ID);
}

function isDecorShedStorage(entry: unknown): boolean {
  return isStorageByToken(entry, DECOR_SHED_STORAGE_ID);
}

function getMyDataStorages(myDataValue: unknown): unknown[] {
  if (!myDataValue || typeof myDataValue !== 'object') return [];
  const inventory = (myDataValue as Record<string, unknown>).inventory;
  if (!inventory || typeof inventory !== 'object') return [];
  const rawStorages = (inventory as Record<string, unknown>).storages;
  return Array.isArray(rawStorages)
    ? rawStorages
    : rawStorages && typeof rawStorages === 'object'
      ? Object.values(rawStorages)
      : [];
}

function buildStorageKeyCounts(myDataValue: unknown, shopType: RestockShopType, predicate: (entry: unknown) => boolean): Map<string, number> {
  const next = new Map<string, number>();
  const store = getMyDataStorages(myDataValue).find((entry) => predicate(entry));
  if (!store || typeof store !== 'object') return next;

  const items = Array.isArray((store as Record<string, unknown>).items)
    ? ((store as Record<string, unknown>).items as unknown[])
    : [];
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const row = rawItem as Record<string, unknown>;
    const itemId =
      shopType === 'seed'
        ? firstString([row.species, row.seedName, row.itemId, row.id])
        : firstString([row.decorId, row.itemId, row.id]);
    if (!itemId) continue;
    const quantity = toNonNegativeInteger(row.quantity ?? row.qty ?? row.count ?? row.amount ?? row.stackSize) ?? 1;
    addCount(next, toCanonicalKey(shopType, itemId), Math.max(1, quantity));
  }
  return next;
}

export function buildSeedSiloKeyCounts(myDataValue: unknown): Map<string, number> {
  return buildStorageKeyCounts(myDataValue, 'seed', isSeedSiloStorage);
}

export function buildDecorShedKeyCounts(myDataValue: unknown): Map<string, number> {
  return buildStorageKeyCounts(myDataValue, 'decor', isDecorShedStorage);
}

// ---------------------------------------------------------------------------
// Ownership counting and baseline
// ---------------------------------------------------------------------------

export function resolveDawnOwnershipKey(dawnKey: string): string {
  if (!dawnKey.startsWith('dawn:')) return dawnKey;
  const suffix = dawnKey.slice('dawn:'.length);
  for (const prefix of ['seed', 'tool', 'egg', 'decor'] as const) {
    const candidate = `${prefix}:${suffix}`;
    if (alertState.inventoryKeyCounts.has(candidate)) return candidate;
  }
  for (const prefix of ['seed', 'tool', 'egg', 'decor'] as const) {
    const candidate = `${prefix}:${suffix}`;
    if (alertState.seedSiloKeyCounts.has(candidate) || alertState.decorShedKeyCounts.has(candidate)) return candidate;
  }
  return dawnKey;
}

export function combinedOwnedCount(
  key: string,
  inventoryCounts: Map<string, number>,
  seedSiloCounts: Map<string, number>,
  decorShedCounts: Map<string, number>,
): number {
  const resolvedKey = resolveDawnOwnershipKey(key);
  const inventoryQty = inventoryCounts.get(resolvedKey) ?? 0;
  if (resolvedKey.startsWith('seed:')) return inventoryQty + (seedSiloCounts.get(resolvedKey) ?? 0);
  if (resolvedKey.startsWith('decor:')) return inventoryQty + (decorShedCounts.get(resolvedKey) ?? 0);
  return inventoryQty;
}

function readOwnedCountFromBaseline(key: string, baseline: OwnershipBaseline): number {
  const resolvedKey = resolveDawnOwnershipKey(key);
  let total = 0;
  if (baseline.includeInventory) total += alertState.inventoryKeyCounts.get(resolvedKey) ?? 0;
  if (baseline.includeSeedSilo)  total += alertState.seedSiloKeyCounts.get(resolvedKey) ?? 0;
  if (baseline.includeDecorShed) total += alertState.decorShedKeyCounts.get(resolvedKey) ?? 0;
  return total;
}

export function hasOwnershipSource(baseline: OwnershipBaseline): boolean {
  return baseline.includeInventory || baseline.includeSeedSilo || baseline.includeDecorShed;
}

export async function waitForOwnershipBaselines(shopType: RestockShopType): Promise<void> {
  const requiresSeedSilo      = shopType === 'seed' || shopType === 'dawn';
  const requiresDecorShed     = shopType === 'decor' || shopType === 'dawn';
  const requiresToolInventory = shopType === 'tool' || shopType === 'dawn';
  const ready = (): boolean =>
    alertState.hasInventoryBaseline &&
    (!requiresSeedSilo      || alertState.hasSeedSiloBaseline) &&
    (!requiresDecorShed     || alertState.hasDecorShedBaseline) &&
    (!requiresToolInventory || alertState.hasToolInventoryBaseline);
  if (ready()) return;
  await waitForOwnershipMatch(ready, OWNERSHIP_BASELINE_WAIT_MS);
}

export function captureOwnershipBaseline(key: string, shopType: RestockShopType): OwnershipBaseline {
  const includeInventory  = alertState.hasInventoryBaseline;
  const includeSeedSilo   = (shopType === 'seed'  || shopType === 'dawn') && alertState.hasSeedSiloBaseline;
  const includeDecorShed  = (shopType === 'decor' || shopType === 'dawn') && alertState.hasDecorShedBaseline;
  const baseline: OwnershipBaseline = {
    count: 0,
    includeInventory,
    includeSeedSilo,
    includeDecorShed,
    inventoryKeyItemQuantities: cloneItemQuantities(alertState.inventoryKeyItemQuantities.get(key)),
  };
  return {
    count: readOwnedCountFromBaseline(key, baseline),
    includeInventory,
    includeSeedSilo,
    includeDecorShed,
    inventoryKeyItemQuantities: baseline.inventoryKeyItemQuantities,
  };
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

export function applyOwnershipDelta(
  prevInventoryCounts: Map<string, number>,
  prevSeedSiloCounts: Map<string, number>,
  prevDecorShedCounts: Map<string, number>,
  nextInventoryCounts: Map<string, number>,
  nextSeedSiloCounts: Map<string, number>,
  nextDecorShedCounts: Map<string, number>,
): void {
  if (activeAlerts.size === 0) return;
  for (const key of Array.from(activeAlerts.keys())) {
    const previous = combinedOwnedCount(key, prevInventoryCounts, prevSeedSiloCounts, prevDecorShedCounts);
    const next     = combinedOwnedCount(key, nextInventoryCounts, nextSeedSiloCounts, nextDecorShedCounts);
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
  applyOwnershipDelta(
    prevCounts,
    alertState.seedSiloKeyCounts,
    alertState.decorShedKeyCounts,
    alertState.inventoryKeyCounts,
    alertState.seedSiloKeyCounts,
    alertState.decorShedKeyCounts,
  );
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
  applyOwnershipDelta(
    prevCounts,
    alertState.seedSiloKeyCounts,
    alertState.decorShedKeyCounts,
    alertState.inventoryKeyCounts,
    alertState.seedSiloKeyCounts,
    alertState.decorShedKeyCounts,
  );
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
  debugLog('myData storage snapshot received', {
    seedSiloKeyCount:  nextSeedCounts.size,
    decorShedKeyCount: nextDecorCounts.size,
    pendingConfirmations: pendingOwnershipConfirmations.size,
  });
  const hadSeedBaseline  = alertState.hasSeedSiloBaseline;
  const hadDecorBaseline = alertState.hasDecorShedBaseline;
  const prevSeedCounts   = alertState.seedSiloKeyCounts;
  const prevDecorCounts  = alertState.decorShedKeyCounts;

  alertState.seedSiloKeyCounts  = nextSeedCounts;
  alertState.decorShedKeyCounts = nextDecorCounts;
  alertState.hasSeedSiloBaseline  = true;
  alertState.hasDecorShedBaseline = true;

  if (!hadSeedBaseline && !hadDecorBaseline) {
    debugLog('Storage baselines initialized', {
      seedSiloKeyCount:  alertState.seedSiloKeyCounts.size,
      decorShedKeyCount: alertState.decorShedKeyCounts.size,
    });
    notifyOwnershipChange();
    processPendingOwnershipConfirmations();
    processShopStock(getShopStockState());
    return;
  }

  applyOwnershipDelta(
    alertState.inventoryKeyCounts,
    prevSeedCounts,
    prevDecorCounts,
    alertState.inventoryKeyCounts,
    alertState.seedSiloKeyCounts,
    alertState.decorShedKeyCounts,
  );
  notifyOwnershipChange();
  processPendingOwnershipConfirmations();
  processShopStock(getShopStockState());
}

