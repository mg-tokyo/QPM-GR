// Auto-store after a confirmed purchase: move the bought stack into the storage
// that already holds that item. Mirrors the game's own storage rule (reducer
// `ld` / room check `vo`) so a move the server would refuse is never sent, and
// reports stored only once the server (or the storage count) confirms it.

import { isWeatherShopType } from '../../../types/shops';
import type { QuinoaCommandResultMessage } from '../../../websocket/envelope';
import type { WebSocketSendResult } from '../../../websocket/api';
import {
  SEED_SILO_WS_STORAGE_ID,
  DECOR_SHED_WS_STORAGE_ID,
  TOOL_SHACK_WS_STORAGE_ID,
  type RestockShopType,
  type OwnershipBaseline,
  type PendingOwnershipConfirmation,
} from './types';
import { alertState } from './alertState';
import {
  debugLog,
  finishDeferredCompletion,
  resolveOwnershipKey,
  waitForOwnershipMatch,
} from './ownershipTracker';
import { getToolInventoryLimitFromKey } from './purchaseActions';
import { sendItemToStorage } from './purchasePipeline';

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
  if (shopType === 'tool') {
    const existingCount = alertState.toolShackKeyCounts.get(key) ?? 0;
    if (existingCount <= 0) {
      debugLog('Auto-store target skipped for tool', { key, hasToolShackBaseline: alertState.hasToolShackBaseline, existingToolCountInShack: existingCount });
      return null;
    }
    debugLog('Auto-store target resolved', { key, shopType, storageId: TOOL_SHACK_WS_STORAGE_ID, label: 'Tool Shack', existingToolCountInShack: existingCount });
    return { storageId: TOOL_SHACK_WS_STORAGE_ID, label: 'Tool Shack' };
  }
  if (isWeatherShopType(shopType)) {
    const resolvedKey = resolveOwnershipKey(key);
    if (resolvedKey.startsWith('seed:')) {
      const existingCount = alertState.seedSiloKeyCounts.get(resolvedKey) ?? 0;
      if (existingCount <= 0) {
        debugLog('Auto-store target skipped for weather-shop seed', { key, resolvedKey, existingSeedCountInSilo: existingCount });
        return null;
      }
      debugLog('Auto-store target resolved', { key, resolvedKey, shopType, storageId: SEED_SILO_WS_STORAGE_ID, label: 'Seed Silo', existingSeedCountInSilo: existingCount });
      return { storageId: SEED_SILO_WS_STORAGE_ID, label: 'Seed Silo' };
    }
    if (resolvedKey.startsWith('decor:')) {
      const existingCount = alertState.decorShedKeyCounts.get(resolvedKey) ?? 0;
      if (existingCount <= 0) {
        debugLog('Auto-store target skipped for weather-shop decor', { key, resolvedKey, existingDecorCountInShed: existingCount });
        return null;
      }
      debugLog('Auto-store target resolved', { key, resolvedKey, shopType, storageId: DECOR_SHED_WS_STORAGE_ID, label: 'Decor Shed', existingDecorCountInShed: existingCount });
      return { storageId: DECOR_SHED_WS_STORAGE_ID, label: 'Decor Shed' };
    }
    if (resolvedKey.startsWith('tool:')) {
      const existingCount = alertState.toolShackKeyCounts.get(resolvedKey) ?? 0;
      if (existingCount <= 0) {
        debugLog('Auto-store target skipped for weather-shop tool', { key, resolvedKey, existingToolCountInShack: existingCount });
        return null;
      }
      debugLog('Auto-store target resolved', { key, resolvedKey, shopType, storageId: TOOL_SHACK_WS_STORAGE_ID, label: 'Tool Shack', existingToolCountInShack: existingCount });
      return { storageId: TOOL_SHACK_WS_STORAGE_ID, label: 'Tool Shack' };
    }
    debugLog('Auto-store target not applicable for weather-shop item type', { key, resolvedKey });
    return null;
  }
  debugLog('Auto-store target not applicable for shop type', { key, shopType });
  return null;
}

export function pickAutoStoreStackForKey(
  key: string,
  baseline: OwnershipBaseline,
): { itemId: string; quantity: number; gained: number } | null {
  // Stacks are keyed by item type (`tool:x`); weather-shop alert keys (`amber:x`) must resolve first.
  const current = alertState.inventoryKeyItemQuantities.get(resolveOwnershipKey(key));
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

/** Storage fallback wait when the server's answer is unknown (timeout, legacy transport). */
const AUTO_STORE_OBSERVE_MS = 3_000;

function storageKeyCounts(storageId: string): Map<string, number> | null {
  if (storageId === SEED_SILO_WS_STORAGE_ID) return alertState.seedSiloKeyCounts;
  if (storageId === DECOR_SHED_WS_STORAGE_ID) return alertState.decorShedKeyCounts;
  if (storageId === TOOL_SHACK_WS_STORAGE_ID) return alertState.toolShackKeyCounts;
  return null;
}

/**
 * Room left in the storage's stack for this item — the game's `vo`: only tools
 * carry a per-stack cap (`maxInventoryQuantity`), seeds and decor are unlimited.
 */
export function getStorageRoomForKey(
  storageId: string,
  key: string,
): { held: number; limit: number | null; room: number } {
  const resolvedKey = resolveOwnershipKey(key);
  const held = storageKeyCounts(storageId)?.get(resolvedKey) ?? 0;
  const limit = getToolInventoryLimitFromKey(resolvedKey);
  return { held, limit, room: limit == null ? Infinity : Math.max(0, limit - held) };
}

/** `stored: null` = the server's answer is unknown; the storage count decides. */
type StoreVerdict = { stored: boolean | null; reason?: string };

function classifyStoreResult(result: QuinoaCommandResultMessage): StoreVerdict {
  if (result.ok) return { stored: true };
  // Flat re-send or a mid-handler throw: the move may or may not have applied.
  if (result.resentAsLegacy || result.code === 'handler_error') return { stored: null };
  return { stored: false, reason: `server refused (${typeof result.code === 'string' ? result.code : 'rejected'})` };
}

async function resolveStoreVerdict(send: WebSocketSendResult, observeStorageGrowth: () => Promise<boolean>): Promise<StoreVerdict> {
  let verdict: StoreVerdict = { stored: null };
  if (send.awaitResult) {
    try { verdict = classifyStoreResult(await send.awaitResult()); } catch { /* result timeout — unknown */ }
  }
  if (verdict.stored !== null) return verdict;
  return (await observeStorageGrowth()) ? { stored: true } : { stored: false, reason: 'no storage change observed' };
}

function settleAutoStore(pending: PendingOwnershipConfirmation, stored: boolean, reason: string | null): void {
  pending.storedInTargetStorage = stored;
  pending.autoStoreSkipReason = stored ? null : reason;
  pending.autoStoreInFlight = false;
  debugLog('Auto-store result', { key: pending.key, storageId: pending.autoStoreStorageId, stored, reason });
  finishDeferredCompletion(pending);
}

export function maybeAutoStoreConfirmedDelta(
  pending: PendingOwnershipConfirmation,
  confirmed: number,
): void {
  if (pending.autoStoreInFlight) {
    debugLog('Auto-store skipped (already in flight)', { key: pending.key, confirmed });
    return;
  }
  const storageId = pending.autoStoreStorageId;
  if (!storageId) {
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

  pending.autoStoreFinalMoveRequested = true;
  const label = pending.autoStoreLabel ?? storageId;
  const { held, limit, room } = getStorageRoomForKey(storageId, pending.key);
  if (room <= 0) {
    // The server refuses a move into a stack already at its cap.
    pending.autoStoreSkipReason = `${label} already holds ${held}/${limit}`;
    debugLog('Auto-store skipped (storage stack at cap)', { key: pending.key, storageId, held, limit });
    return;
  }

  debugLog('Auto-store attempting single full-stack move', {
    key: pending.key,
    confirmed,
    expectedIncrease: pending.expectedIncrease,
    storageId,
    storageLabel: pending.autoStoreLabel,
    itemId: targetStack.itemId,
    currentStackQuantity: targetStack.quantity,
    gainedInStack: targetStack.gained,
    storageHeld: held,
    storageRoom: room,
  });

  const resolvedKey = resolveOwnershipKey(pending.key);
  const observeStorageGrowth = (): Promise<boolean> => waitForOwnershipMatch(
    () => (storageKeyCounts(storageId)?.get(resolvedKey) ?? 0) > held,
    AUTO_STORE_OBSERVE_MS,
  );

  pending.autoStoreInFlight = true;
  const send = sendItemToStorage(targetStack.itemId, storageId, null);
  if (!send.ok) {
    settleAutoStore(pending, false, `send failed (${send.reason ?? 'unknown'})`);
    return;
  }
  void resolveStoreVerdict(send, observeStorageGrowth)
    .then((v) => settleAutoStore(pending, v.stored === true, v.reason ?? null));
}
