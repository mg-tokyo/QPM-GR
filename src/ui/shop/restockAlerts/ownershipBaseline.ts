import { isWeatherShopType } from '../../../types/shops';
import { warnFeature } from './_diagnostics';
import {
  OWNERSHIP_BASELINE_WAIT_MS,
  type RestockShopType,
  type OwnershipBaseline,
} from './types';
import {
  alertState,
  ownershipListeners,
  debugLastStockStateByKey,
  isAlertDebug,
} from './alertState';

// ---------------------------------------------------------------------------
// Debug helpers
// ---------------------------------------------------------------------------

export function debugLog(message: string, details?: Record<string, unknown>): void {
  if (!isAlertDebug()) return;
  const prefix = '[QPM][ShopRestockAlerts][Debug]';
  if (details) { console.log(`${prefix} ${message}`, details); return; }
  console.log(`${prefix} ${message}`);
}

export function debugLogError(message: string, error: unknown, details?: Record<string, unknown>): void {
  if (!isAlertDebug()) return;
  const prefix = '[QPM][ShopRestockAlerts][Debug]';
  if (details) { console.error(`${prefix} ${message}`, { ...details, error }); return; }
  console.error(`${prefix} ${message}`, error);
}

export function debugLogStockStateIfChanged(key: string, snapshot: Record<string, unknown>): void {
  if (!isAlertDebug()) return;
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

export function currentCountSources(): OwnershipCountSources {
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
