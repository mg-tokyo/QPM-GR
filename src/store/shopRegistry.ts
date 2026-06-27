// src/store/shopRegistry.ts
// Tracks the set of shop ids the game state exposes. Persists discovered
// ids so consumers don't need to re-discover on every page load.

import { getAtomByLabel, getCachedStore, subscribeAtom } from '../core/jotaiBridge';
import { log } from '../utils/logger';
import {
  STANDARD_SHOP_IDS,
  INITIALLY_KNOWN_WEATHER_GATED_SHOP_IDS,
  type StandardShopId,
} from '../types/shops';
import type { ShopInventoryEntry } from '../types/gameAtoms';
import { storage } from '../utils/storage';

const STORAGE_KEY = 'qpm.shopRegistry.discovered.v1';
const QUINOA_DATA_ATOM_LABEL = 'quinoaDataAtom';

const STANDARD_SET: ReadonlySet<string> = new Set(STANDARD_SHOP_IDS);
const INITIAL_WEATHER_GATED_SET: ReadonlySet<string> = new Set(INITIALLY_KNOWN_WEATHER_GATED_SHOP_IDS);

let discoveredIds: Set<string> = new Set();
let quinoaDataUnsubscribe: (() => void) | null = null;
let startPromise: Promise<void> | null = null;

const discoveryListeners = new Set<(id: string) => void>();

function loadPersistedDiscovered(): Set<string> {
  const raw = storage.get<unknown>(STORAGE_KEY, null);
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((v): v is string => typeof v === 'string'));
}

function persistDiscovered(): void {
  try {
    storage.set(STORAGE_KEY, [...discoveredIds]);
  } catch (err) {
    log('⚠️ shopRegistry: failed to persist discovered ids', err);
  }
}

function notifyDiscovered(id: string): void {
  for (const cb of discoveryListeners) {
    try { cb(id); } catch (err) { log('⚠️ shopRegistry listener error', err); }
  }
}

function ingestShopsSnapshot(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const shops = (value as Record<string, unknown>).shops;
  if (!shops || typeof shops !== 'object') return;
  let added = false;
  for (const id of Object.keys(shops)) {
    if (STANDARD_SET.has(id)) continue;
    if (INITIAL_WEATHER_GATED_SET.has(id)) continue;
    if (discoveredIds.has(id)) continue;
    discoveredIds.add(id);
    added = true;
    notifyDiscovered(id);
  }
  if (added) persistDiscovered();
}

export async function startShopRegistry(): Promise<void> {
  if (startPromise) return startPromise;
  discoveredIds = loadPersistedDiscovered();
  exposeDebugNamespace();
  startPromise = (async () => {
    const quinoaDataAtomRef = getAtomByLabel(QUINOA_DATA_ATOM_LABEL);
    if (!quinoaDataAtomRef) return;
    try {
      quinoaDataUnsubscribe = await subscribeAtom<unknown>(quinoaDataAtomRef, (value) => {
        ingestShopsSnapshot(value);
      });
    } catch (err) {
      log('⚠️ shopRegistry: failed to subscribe to quinoaDataAtom', err);
    }
  })();
  return startPromise;
}

export function stopShopRegistry(): void {
  try { quinoaDataUnsubscribe?.(); } catch {}
  quinoaDataUnsubscribe = null;
  startPromise = null;
  // discoveredIds is NOT cleared — restart resumes from persisted state.
}

export function getKnownShopIds(): readonly string[] {
  return [...STANDARD_SHOP_IDS, ...INITIALLY_KNOWN_WEATHER_GATED_SHOP_IDS, ...discoveredIds];
}

export function getStandardShopIds(): readonly StandardShopId[] {
  return STANDARD_SHOP_IDS;
}

export function getWeatherGatedShopIds(): readonly string[] {
  return [...INITIALLY_KNOWN_WEATHER_GATED_SHOP_IDS, ...discoveredIds];
}

export function isStandardShop(id: string): boolean {
  return STANDARD_SET.has(id);
}

/** Static classification — true for any non-standard shop id. NOT a runtime check on current weather. */
export function isWeatherGatedShop(id: string): boolean {
  return !STANDARD_SET.has(id);
}

export function onShopDiscovered(cb: (id: string) => void): () => void {
  discoveryListeners.add(cb);
  return () => { discoveryListeners.delete(cb); };
}

export function registerDiscovered(id: string): void {
  if (STANDARD_SET.has(id) || INITIAL_WEATHER_GATED_SET.has(id)) return;
  if (discoveredIds.has(id)) return;
  discoveredIds.add(id);
  persistDiscovered();
  notifyDiscovered(id);
}

export function clearDiscovered(id: string): void {
  if (!discoveredIds.delete(id)) return;
  persistDiscovered();
}

/**
 * Inject a synthetic shop bucket into `quinoaData.shops` for testing.
 * Patches the quinoaDataAtom value, then registers the id so consumers
 * pick the new bucket up via their normal subscription paths.
 */
export function injectShopInventory(
  shopId: string,
  inventory: ShopInventoryEntry[],
  secondsUntilRestock = 600,
): void {
  const store = getCachedStore();
  if (!store || store.__polyfill) {
    log('⚠️ shopRegistry: injectShopInventory needs a writable jotai store');
    return;
  }
  const quinoaDataAtom = getAtomByLabel(QUINOA_DATA_ATOM_LABEL);
  if (!quinoaDataAtom) return;
  let current: Record<string, unknown> | null;
  try {
    current = store.get(quinoaDataAtom) as Record<string, unknown> | null;
  } catch (err) {
    log('⚠️ shopRegistry: injectShopInventory failed to read quinoaDataAtom', err);
    return;
  }
  if (!current || typeof current !== 'object') return;
  const existingShops = (current.shops as Record<string, unknown> | undefined) ?? {};
  const nextShops = {
    ...existingShops,
    [shopId]: { inventory, secondsUntilRestock },
  };
  try {
    store.set(quinoaDataAtom, { ...current, shops: nextShops });
  } catch (err) {
    log('⚠️ shopRegistry: injectShopInventory write failed (atom may be read-only)', err);
    return;
  }
  registerDiscovered(shopId);
}

function exposeDebugNamespace(): void {
  try {
    const w = globalThis as Record<string, unknown>;
    const existing = (w.__QPM_DEBUG as Record<string, unknown> | undefined) ?? {};
    existing.shopRegistry = {
      getKnownShopIds,
      getStandardShopIds,
      getWeatherGatedShopIds,
      isStandardShop,
      isWeatherGatedShop,
      registerDiscovered,
      clearDiscovered,
      injectShopInventory,
    };
    w.__QPM_DEBUG = existing;
  } catch {}
}
