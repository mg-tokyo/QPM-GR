// Tracks the set of shop ids the game state exposes. Persists discovered
// ids so consumers don't need to re-discover on every page load.

import { getAtomByLabel, getCachedStore } from '../core/jotaiBridge';
import { subscribeAtomValue } from '../core/atomRegistry';
import {
  STANDARD_SHOP_IDS,
  STANDARD_RESTOCK_SHOP_TYPES,
  INITIALLY_KNOWN_WEATHER_GATED_SHOP_IDS,
  type StandardShopId,
} from '../types/shops';
import type { ShopInventoryEntry } from '../types/gameAtoms';
import { storage } from '../utils/storage';
import { DETAILED_WEATHER_KINDS, type DetailedWeather } from '../utils/game/weatherDetection';
import { getWeatherSnapshot } from './weatherHub';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeShopRegistry', 'shopRegistry');

const STORAGE_KEY = 'qpm.shopRegistry.discovered.v1';
const WEATHER_STORAGE_KEY = 'qpm.shopRegistry.weather.v1';
const QUINOA_DATA_ATOM_LABEL = 'quinoaDataAtom';

const STANDARD_SET: ReadonlySet<string> = new Set(STANDARD_SHOP_IDS);
const INITIAL_WEATHER_GATED_SET: ReadonlySet<string> = new Set(INITIALLY_KNOWN_WEATHER_GATED_SHOP_IDS);

let discoveredIds: Set<string> = new Set();
let observedWeatherByShop: Record<string, DetailedWeather> = {};
/** Shops seen with live stock during sunny weather are not weather-gated (e.g. apology) — never map them. */
const openDuringSunny = new Set<string>();
let quinoaDataUnsubscribe: (() => void) | null = null;
let startPromise: Promise<void> | null = null;

const discoveryListeners = new Set<(id: string) => void>();

/** The game keys `shops` by singular id (`seed`, `tool`, …); those are the standard shops, not discoveries. */
function isStandardShopAlias(id: string): boolean {
  return STANDARD_SET.has(id) || STANDARD_RESTOCK_SHOP_TYPES.has(id);
}

function loadPersistedDiscovered(): Set<string> {
  const raw = storage.get<unknown>(STORAGE_KEY, null);
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((v): v is string => typeof v === 'string' && !isStandardShopAlias(v)));
}

function loadPersistedWeather(): Record<string, DetailedWeather> {
  const raw = storage.get<unknown>(WEATHER_STORAGE_KEY, null);
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, DetailedWeather> = {};
  for (const [id, kind] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof kind === 'string' && (DETAILED_WEATHER_KINDS as readonly string[]).includes(kind)) out[id] = kind as DetailedWeather;
  }
  return out;
}

function persistWeather(): void {
  try {
    storage.set(WEATHER_STORAGE_KEY, observedWeatherByShop);
  } catch (err) {
    diag.warn('QPM-STORE-004', { what: 'weather', key: WEATHER_STORAGE_KEY }, err);
  }
}

function hasLiveStock(bucket: unknown): boolean {
  const inventory = bucket && typeof bucket === 'object' ? (bucket as Record<string, unknown>).inventory : null;
  if (!Array.isArray(inventory)) return false;
  return inventory.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const row = entry as Record<string, unknown>;
    const stock = typeof row.initialStock === 'number' ? row.initialStock : typeof row.stock === 'number' ? row.stock : 0;
    return stock > 0;
  });
}

/** Weather shops are emptied between events, so live stock ⇒ the current weather is the shop's gate. */
function observeShopWeather(shops: Record<string, unknown>): void {
  const kind = getWeatherSnapshot().kind;
  if (kind === 'unknown') return;
  let changed = false;
  for (const [id, bucket] of Object.entries(shops)) {
    if (isStandardShopAlias(id) || !hasLiveStock(bucket)) continue;
    if (kind === 'sunny') {
      openDuringSunny.add(id);
      if (observedWeatherByShop[id]) { delete observedWeatherByShop[id]; changed = true; }
      continue;
    }
    if (openDuringSunny.has(id) || observedWeatherByShop[id] === kind) continue;
    observedWeatherByShop[id] = kind;
    changed = true;
  }
  if (changed) persistWeather();
}

function persistDiscovered(): void {
  try {
    storage.set(STORAGE_KEY, [...discoveredIds]);
  } catch (err) {
    diag.warn('QPM-STORE-004', { what: 'discovered', key: STORAGE_KEY }, err);
  }
}

function notifyDiscovered(id: string): void {
  for (const cb of discoveryListeners) {
    try { cb(id); } catch (err) { diag.warn('QPM-STORE-003', { phase: 'notifyDiscovered', id }, err); }
  }
}

function ingestShopsSnapshot(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const shops = (value as Record<string, unknown>).shops;
  if (!shops || typeof shops !== 'object') return;
  let added = false;
  for (const id of Object.keys(shops)) {
    if (isStandardShopAlias(id)) continue;
    if (INITIAL_WEATHER_GATED_SET.has(id)) continue;
    if (discoveredIds.has(id)) continue;
    discoveredIds.add(id);
    added = true;
    notifyDiscovered(id);
  }
  if (added) persistDiscovered();
  observeShopWeather(shops as Record<string, unknown>);
}

export async function startShopRegistry(): Promise<void> {
  if (startPromise) return startPromise;
  diag.register('Loading persisted shop registry');
  discoveredIds = loadPersistedDiscovered();
  persistDiscovered();
  observedWeatherByShop = loadPersistedWeather();
  exposeDebugNamespace();
  startPromise = (async () => {
    try {
      const unsub = await subscribeAtomValue('quinoaData', (value) => {
        ingestShopsSnapshot(value);
      });
      if (unsub) quinoaDataUnsubscribe = unsub;
      diag.publishOk('Shop registry subscribed', { discovered: discoveredIds.size });
    } catch (err) {
      diag.warn('QPM-STORE-002', { atom: 'quinoaData', phase: 'subscribe' }, err);
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

/** Static classification — true for any non-standard shop id (plural or the game's singular alias). NOT a runtime check on current weather. */
export function isWeatherGatedShop(id: string): boolean {
  return !isStandardShopAlias(id);
}

/**
 * Weather that opens `shopId`: name heuristic against QPM's weather kinds first
 * (`thunder` → `thunderstorm`), then the observed mapping. Null for non-weather shops.
 */
export function getShopWeatherKind(shopId: string): DetailedWeather | null {
  if (!isWeatherGatedShop(shopId)) return null;
  const id = shopId.toLowerCase();
  const heuristic = DETAILED_WEATHER_KINDS.find(
    (kind) => kind !== 'sunny' && kind !== 'unknown' && (kind.startsWith(id) || id.startsWith(kind)),
  );
  return heuristic ?? observedWeatherByShop[shopId] ?? null;
}

/** Weather-gated shop ids that resolve to a weather kind — the set restock UIs treat as "weather shops". */
export function getWeatherShopIds(): readonly string[] {
  return getWeatherGatedShopIds().filter((id) => getShopWeatherKind(id) !== null);
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

/** Inject a synthetic shop bucket into `quinoaData.shops` for testing; patches the atom and registers the id. */
export function injectShopInventory(
  shopId: string,
  inventory: ShopInventoryEntry[],
  secondsUntilRestock = 600,
): void {
  const store = getCachedStore();
  if (!store || store.__polyfill) {
    diag.log.debug('injectShopInventory needs a writable jotai store', { shopId });
    return;
  }
  const quinoaDataAtom = getAtomByLabel(QUINOA_DATA_ATOM_LABEL);
  if (!quinoaDataAtom) return;
  let current: Record<string, unknown> | null;
  try {
    current = store.get(quinoaDataAtom) as Record<string, unknown> | null;
  } catch (err) {
    diag.warn('QPM-STORE-002', { atom: QUINOA_DATA_ATOM_LABEL, phase: 'inject:read' }, err);
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
    diag.warn('QPM-STORE-002', { atom: QUINOA_DATA_ATOM_LABEL, phase: 'inject:write' }, err);
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
      getShopWeatherKind,
      getWeatherShopIds,
      getObservedShopWeather: () => ({ ...observedWeatherByShop }),
      registerDiscovered,
      clearDiscovered,
      injectShopInventory,
    };
    w.__QPM_DEBUG = existing;
  } catch {}
}
