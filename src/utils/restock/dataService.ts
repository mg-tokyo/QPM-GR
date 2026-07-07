// Shared Supabase restock data fetcher + cache for shop window and dashboard.

import { storage } from '../storage';
import { log } from '../logger';
import { isDebugGlobalsEnabled } from '../debugGlobals';
import {
  errorRestockFetch,
  publishRestockOk,
  registerRestockBus,
  warnRestockConfig,
  warnRestockFetch,
  warnRestockParse,
} from './diagnostics';
import {
  canonicalItemId,
  getItemIdVariants,
  deduplicateItems,
  normalizeRestockItem,
  extractItemsArray,
  toFloat,
  toMs,
} from './parser';
import type {
  RestockItem,
  RestockPredictionAccuracyAggregate,
  RestockRefreshBudgetState,
  RestockDataUpdatedDetail,
  FetchStatus,
  CacheEntry,
  RefreshBudgetEntry,
  GmXhr,
  FetchTextResult,
  WeatherPrediction,
  WeatherPredictionCacheEntry,
} from './types';

// Re-export parser utilities and types so existing callers work unchanged.
export { canonicalItemId, getItemIdVariants } from './parser';
export type {
  RestockItem,
  RestockPredictionAccuracyAggregate,
  RestockRefreshBudgetState,
  RestockDataUpdatedDetail,
  FetchStatus,
  GmXhr,
  WeatherPrediction,
} from './types';

const RESTOCK_ENDPOINT = 'https://xjuvryjgrjchbhjixwzh.supabase.co/rest/v1/restock_predictions_mat';
const RESTOCK_ACCURACY_ENDPOINT = 'https://xjuvryjgrjchbhjixwzh.supabase.co/rest/v1/restock_prediction_accuracy_by_item';
export const RESTOCK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqdXZyeWpncmpjaGJoaml4d3poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMDYyODMsImV4cCI6MjA4NTY4MjI4M30.MqQCBG-UMR4HYJU44Tz2orHUj9gMgJTMJtxpb_MHeps';
// Base columns — known to exist in the live restock_predictions view.
const RESTOCK_COLUMNS = [
  'item_id',
  'shop_type',
  'current_probability',
  'base_rate',
  'estimated_next_timestamp',
  'median_interval_ms',
  'expected_interval_ms',
  'last_seen',
  'average_quantity',
  'total_quantity',
  'total_occurrences',
  'algorithm_version',
  'algorithm_updated_at_ms',
  'current_weather',
  'weather_baseline_ms',
  'weather_samples',
  'weather_used',
  'weather_rejected_reason',
] as const;
// Extended columns added by the 20260416000003 migration; requested as a secondary enrichment when supported.
const RESTOCK_EXTENDED_COLUMNS = [
  ...RESTOCK_COLUMNS,
  'recent_intervals_ms',
  'empirical_weight',
  'empirical_probability',
  'fallback_rate',
  'baseline_interval_ms',
  'ema_interval_ms',
  'weather_intervals',
  'is_dormant',
] as const;
const RESTOCK_QUERY = `select=${RESTOCK_COLUMNS.join(',')}`;
const RESTOCK_EXTENDED_QUERY = `select=${RESTOCK_EXTENDED_COLUMNS.join(',')}`;
const RESTOCK_URL = `${RESTOCK_ENDPOINT}?${RESTOCK_QUERY}`;
const RESTOCK_URL_EXTENDED = `${RESTOCK_ENDPOINT}?${RESTOCK_EXTENDED_QUERY}`;
const RESTOCK_ACCURACY_COLUMNS = [
  'shop_type',
  'item_id',
  'algorithm_version',
  'scored_predictions',
  'mae_min',
  'median_abs_error_min',
  'within_one_cycle_pct',
  'last_scored_at',
] as const;
// Track whether the server supports extended columns (auto-detected on first success).
let serverSupportsExtended: boolean | null = null;

// v6 key forces a fresh fetch after adding snow shop type.
const CACHE_KEY = 'qpm.restockCache.v6';
const REFRESH_BUDGET_KEY = 'qpm.restock.refreshBudget.v1';
const ALLOWED_SHOP_TYPES = new Set(['seed', 'egg', 'decor', 'tool', 'dawn', 'snow']);

const RESTOCK_REFRESH_WINDOW_MS_DEFAULT = 2 * 60 * 60 * 1000; // 2 hours
const RESTOCK_REFRESH_MAX_DEFAULT = 5;
const RESTOCK_REFRESH_WINDOW_MS_DEBUG = 1 * 60 * 60 * 1000; // 1 hour
const RESTOCK_REFRESH_MAX_DEBUG = 10;

export function getRestockRefreshLimits(): { windowMs: number; max: number } {
  const debug = isDebugGlobalsEnabled();
  return {
    windowMs: debug ? RESTOCK_REFRESH_WINDOW_MS_DEBUG : RESTOCK_REFRESH_WINDOW_MS_DEFAULT,
    max: debug ? RESTOCK_REFRESH_MAX_DEBUG : RESTOCK_REFRESH_MAX_DEFAULT,
  };
}

// Backward-compatible exports (static defaults for external consumers)
export const RESTOCK_REFRESH_WINDOW_MS = RESTOCK_REFRESH_WINDOW_MS_DEFAULT;
export const RESTOCK_REFRESH_MAX = RESTOCK_REFRESH_MAX_DEFAULT;
export const RESTOCK_DATA_UPDATED_EVENT = 'qpm:restock-data-updated';
export const RESTOCK_MODEL_ACCURACY_MIN_SCORED = 5;

// HTTP helpers

export function resolveGmXhr(): GmXhr | null {
  if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest as unknown as GmXhr;
  const gm = (globalThis as { GM?: { xmlHttpRequest?: GmXhr } }).GM;
  if (typeof gm?.xmlHttpRequest === 'function') return gm.xmlHttpRequest.bind(gm) as GmXhr;
  return null;
}

function toErrorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function bodySnippet(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function getRestockRequestConfig(): { url: string; key: string } | null {
  const url = (RESTOCK_URL || '').trim();
  const key = (RESTOCK_ANON_KEY || '').trim();
  const validUrl = /^https:\/\/[^ ]+$/i.test(url);
  if (!validUrl || key.length < 16) {
    if (!invalidConfigLogged) {
      warnRestockConfig({ url: validUrl ? '[ok]' : '[invalid]', keyLength: key.length });
      invalidConfigLogged = true;
    }
    return null;
  }
  return { url, key };
}

/** Promisified GM XHR GET with status/error details. */
export function gmGet(
  gm: GmXhr,
  url: string,
  apiKey: string,
  timeoutMs = 15_000,
  extraHeaders?: Record<string, string>,
): Promise<FetchTextResult> {
  return new Promise((resolve) => {
    gm({
      method: 'GET',
      url,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        apikey: apiKey,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, max-age=0',
        Pragma: 'no-cache',
        ...extraHeaders,
      },
      timeout: timeoutMs,
      onload: (res) => {
        if (res.status >= 200 && res.status < 300) {
          resolve({ ok: true, status: res.status, text: res.responseText, error: null });
          return;
        }
        const snippet = bodySnippet(res.responseText);
        resolve({
          ok: false,
          status: res.status,
          text: null,
          error: snippet ? `HTTP ${res.status}: ${snippet}` : `HTTP ${res.status}`,
        });
      },
      onerror: (err) =>
        resolve({
          ok: false,
          status: 0,
          text: null,
          error: `Network error: ${toErrorText(err)}`,
        }),
      ontimeout: () =>
        resolve({
          ok: false,
          status: 0,
          text: null,
          error: `Timeout after ${timeoutMs}ms`,
        }),
    });
  });
}

async function webGet(
  url: string,
  apiKey: string,
  timeoutMs = 15_000,
  extraHeaders?: Record<string, string>,
): Promise<FetchTextResult> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        apikey: apiKey,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, max-age=0',
        Pragma: 'no-cache',
        ...extraHeaders,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      const snippet = bodySnippet(text);
      return {
        ok: false,
        status: response.status,
        text: null,
        error: snippet ? `HTTP ${response.status}: ${snippet}` : `HTTP ${response.status}`,
      };
    }
    return { ok: true, status: response.status, text, error: null };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const message = toErrorText(err);
    if (name === 'AbortError') {
      return { ok: false, status: 0, text: null, error: `Timeout after ${timeoutMs}ms` };
    }
    return { ok: false, status: 0, text: null, error: `Fetch error: ${message}` };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

// Module state

let fetchingPromise: Promise<RestockItem[]> | null = null;
let fetchingIsForce = false;
let weatherDisabledLogged = false;
let invalidConfigLogged = false;
let predictionAccuracyFailureLogged = false;
const PREDICTION_ACCURACY_CACHE_TTL_MS = 10 * 60 * 1000;
const predictionAccuracyCache = new Map<string, {
  fetchedAt: number;
  value: RestockPredictionAccuracyAggregate | null;
}>();

// Event emission

function emitRestockDataUpdated(detail: RestockDataUpdatedDetail): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent<RestockDataUpdatedDetail>(RESTOCK_DATA_UPDATED_EVENT, { detail }));
}

// Cache management

function sanitizeItems(items: RestockItem[]): RestockItem[] {
  const filtered = items.filter((item) => !!item.item_id && ALLOWED_SHOP_TYPES.has(item.shop_type));
  return deduplicateItems(filtered);
}

function readCache(): CacheEntry | null {
  const cached = storage.get<CacheEntry | null>(CACHE_KEY, null);
  if (!cached || !Array.isArray(cached.data)) return null;
  return { ...cached, data: sanitizeItems(cached.data) };
}

function readRefreshBudgetRaw(): RefreshBudgetEntry | null {
  const saved = storage.get<RefreshBudgetEntry | null>(REFRESH_BUDGET_KEY, null);
  if (!saved || typeof saved !== 'object') return null;
  const used = Number(saved.used);
  const windowStartedAt = Number(saved.windowStartedAt);
  if (!Number.isFinite(used) || !Number.isFinite(windowStartedAt)) return null;
  return {
    used: Math.max(0, Math.floor(used)),
    windowStartedAt: Math.max(0, Math.floor(windowStartedAt)),
  };
}

function normalizeRefreshBudget(now: number): { entry: RefreshBudgetEntry; changed: boolean } {
  const { windowMs, max } = getRestockRefreshLimits();
  const raw = readRefreshBudgetRaw();
  if (!raw || raw.windowStartedAt <= 0 || now - raw.windowStartedAt >= windowMs) {
    return { entry: { used: 0, windowStartedAt: now }, changed: true };
  }
  const clampedUsed = Math.min(max, Math.max(0, raw.used));
  return {
    entry: { used: clampedUsed, windowStartedAt: raw.windowStartedAt },
    changed: clampedUsed !== raw.used,
  };
}

function writeRefreshBudget(entry: RefreshBudgetEntry): void {
  storage.set(REFRESH_BUDGET_KEY, entry);
}

function toRefreshBudgetState(entry: RefreshBudgetEntry): RestockRefreshBudgetState {
  const { windowMs, max } = getRestockRefreshLimits();
  const used = Math.min(max, Math.max(0, entry.used));
  const remaining = Math.max(0, max - used);
  const resetAt = entry.windowStartedAt + windowMs;
  return {
    max,
    used,
    remaining,
    windowStartedAt: entry.windowStartedAt,
    resetAt,
    blocked: remaining <= 0,
    windowMs,
  };
}

export function getRestockRefreshBudget(now = Date.now()): RestockRefreshBudgetState {
  const normalized = normalizeRefreshBudget(now);
  if (normalized.changed) {
    writeRefreshBudget(normalized.entry);
  }
  return toRefreshBudgetState(normalized.entry);
}

export function tryConsumeRestockRefresh(now = Date.now()): RestockRefreshBudgetState {
  const { max } = getRestockRefreshLimits();
  const normalized = normalizeRefreshBudget(now);
  const entry = normalized.entry;
  if (entry.used < max) {
    entry.used += 1;
  }
  writeRefreshBudget(entry);
  return toRefreshBudgetState(entry);
}

export function onRestockDataUpdated(listener: (detail: RestockDataUpdatedDetail) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};

  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<RestockDataUpdatedDetail>).detail;
    if (!detail || typeof detail.fetchedAt !== 'number' || typeof detail.count !== 'number') return;
    listener(detail);
  };

  window.addEventListener(RESTOCK_DATA_UPDATED_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(RESTOCK_DATA_UPDATED_EVENT, handler as EventListener);
  };
}

/** Return effective probability from either field. */
export function getItemProbability(item: RestockItem): number | null {
  return item.current_probability ?? item.appearance_rate ?? null;
}

function normalizeShopTypeForAggregate(shopType: string): string {
  const normalized = shopType.trim().toLowerCase();
  if (normalized === 'seeds') return 'seed';
  if (normalized === 'eggs') return 'egg';
  if (normalized === 'decors') return 'decor';
  if (normalized === 'tools') return 'tool';
  return normalized;
}

function normalizePredictionAccuracyAggregate(raw: Record<string, unknown>): RestockPredictionAccuracyAggregate | null {
  const shopType = typeof raw.shop_type === 'string' ? raw.shop_type : '';
  const itemId = typeof raw.item_id === 'string' ? raw.item_id : '';
  const scoredPredictions = toFloat(raw.scored_predictions);
  if (!shopType || !itemId || scoredPredictions == null || !Number.isFinite(scoredPredictions)) return null;

  return {
    shop_type: normalizeShopTypeForAggregate(shopType),
    item_id: itemId,
    algorithm_version: typeof raw.algorithm_version === 'string' ? raw.algorithm_version : null,
    scored_predictions: Math.max(0, Math.floor(scoredPredictions)),
    mae_min: toFloat(raw.mae_min),
    median_abs_error_min: toFloat(raw.median_abs_error_min),
    within_one_cycle_pct: toFloat(raw.within_one_cycle_pct),
    last_scored_at: toMs(raw.last_scored_at),
  };
}

function getPredictionAccuracyCacheKey(shopType: string, itemId: string): string {
  return `${shopType}:${canonicalItemId(shopType, itemId)}`;
}

export async function fetchRestockPredictionAccuracyAggregate(
  shopType: string,
  itemId: string,
): Promise<RestockPredictionAccuracyAggregate | null> {
  const canonical = canonicalItemId(shopType, itemId);
  const cacheKey = getPredictionAccuracyCacheKey(shopType, canonical);
  const cached = predictionAccuracyCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < PREDICTION_ACCURACY_CACHE_TTL_MS) {
    return cached.value;
  }

  const reqConfig = getRestockRequestConfig();
  if (!reqConfig) return null;

  const query = [
    `select=${RESTOCK_ACCURACY_COLUMNS.join(',')}`,
    `shop_type=eq.${encodeURIComponent(shopType)}`,
    `item_id=eq.${encodeURIComponent(canonical)}`,
    'order=scored_predictions.desc',
    'limit=1',
  ].join('&');
  const url = `${RESTOCK_ACCURACY_ENDPOINT}?${query}`;
  const gm = resolveGmXhr();

  let result: FetchTextResult | null = null;
  if (gm) {
    result = await gmGet(gm, url, reqConfig.key, 5_000, { Prefer: 'count=none' });
  }
  if (!result?.ok || result.text == null) {
    result = await webGet(url, reqConfig.key, 5_000, { Prefer: 'count=none' });
  }
  if (!result || !result.ok || result.text == null) {
    if (!predictionAccuracyFailureLogged) {
      const reason = result ? (result.error ?? `HTTP ${result.status}`) : 'no response';
      log(`[RestockData] Prediction accuracy fetch failed: ${reason}`);
      predictionAccuracyFailureLogged = true;
    }
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(result.text);
    const first = Array.isArray(parsed) ? parsed[0] : null;
    const value = first && typeof first === 'object'
      ? normalizePredictionAccuracyAggregate(first as Record<string, unknown>)
      : null;
    predictionAccuracyCache.set(cacheKey, { fetchedAt: now, value });
    return value;
  } catch (err) {
    if (!predictionAccuracyFailureLogged) {
      log('[RestockData] Prediction accuracy parse error', err);
      predictionAccuracyFailureLogged = true;
    }
    return null;
  }
}

/** Safe cache fallback — only returns the cached array, never a wrapped object. */
function safeCacheFallback(cache: CacheEntry | null): RestockItem[] {
  return Array.isArray(cache?.data) ? sanitizeItems(cache.data) : [];
}

function withCacheBust(url: string, _force: boolean): string {
  // PostgREST treats unknown query params as filters and returns HTTP 400.
  // Keep cache-busting header-only for force refresh.
  return url;
}

// Main fetch

/**
 * Fetch restock data from Supabase.
 * Non-force mode is cache-only once cache exists.
 * Force mode consumes refresh budget and fetches network when allowed.
 */
export async function fetchRestockData(force = false): Promise<RestockItem[]> {
  const cache = readCache();

  // Treat empty cache as a miss so clients can self-heal from older bad snapshots.
  if (!force && cache && Array.isArray(cache.data) && cache.data.length > 0) {
    return cache.data;
  }

  // Deduplicate concurrent fetches.
  if (fetchingPromise) {
    // If a force refresh is requested while a non-force fetch is in-flight,
    // wait for the first request and then continue with a true force fetch.
    if (force && !fetchingIsForce) {
      try {
        await fetchingPromise;
      } catch {
        // Ignore and continue to force fetch path.
      }
    } else {
      return fetchingPromise;
    }
  }

  if (force) {
    const budget = getRestockRefreshBudget();
    if (budget.blocked) {
      log('[RestockData] Refresh blocked by 2h quota.');
      return safeCacheFallback(cache);
    }
  }

  fetchingIsForce = force;
  fetchingPromise = (async (): Promise<RestockItem[]> => {
    const reqConfig = getRestockRequestConfig();
    if (!reqConfig) {
      return safeCacheFallback(cache);
    }

    const gm = resolveGmXhr();

    if (!weatherDisabledLogged) {
      log('[RestockData] Weather disabled until unified API is available.');
      weatherDisabledLogged = true;
    }

    // Weather is intentionally disabled for this interim mode.
    const forceMarker = force ? String(Date.now()) : '';
    const forceHeaders = force
      ? { 'X-QPM-Force-Refresh': forceMarker, Prefer: 'count=none' }
      : undefined;
    const requestText = async (
      url: string,
    ): Promise<{ text: string | null; errors: string[] }> => {
      const errors: string[] = [];
      if (gm) {
        const gmResult = await gmGet(gm, url, reqConfig.key, 15_000, forceHeaders);
        if (gmResult.ok && gmResult.text !== null) {
          return { text: gmResult.text, errors };
        }
        errors.push(`[gm] ${gmResult.error ?? `HTTP ${gmResult.status}`}`);
      }
      const webResult = await webGet(url, reqConfig.key, 15_000, forceHeaders);
      if (webResult.ok && webResult.text !== null) {
        return { text: webResult.text, errors };
      }
      errors.push(`[web] ${webResult.error ?? `HTTP ${webResult.status}`}`);
      return { text: null, errors };
    };

    // Try extended columns first if supported or unprobed; mark false on failure so we don't reprobe every request.
    let mainText: string | null = null;
    const fetchErrors: string[] = [];

    if (serverSupportsExtended !== false) {
      const extUrl = withCacheBust(RESTOCK_URL_EXTENDED, force);
      const ext = await requestText(extUrl);
      mainText = ext.text;
      if (!mainText) {
        // Server doesn't support extended columns — stop probing.
        serverSupportsExtended = false;
        fetchErrors.push(...ext.errors);
      }
    }

    if (!mainText) {
      const baseUrl = withCacheBust(reqConfig.url, force);
      const base = await requestText(baseUrl);
      mainText = base.text;
      fetchErrors.push(...base.errors);
    }

    if (!mainText) {
      const errors = fetchErrors.join(' | ');
      warnRestockFetch({ where: 'main', force, gm: gm ? 'yes' : 'no', errors });
      if (force) throw new Error(`[RestockData] Main fetch failed (force=true, gm=${gm ? 'yes' : 'no'}) :: ${errors}`);
      return safeCacheFallback(cache);
    }

    let normalized: RestockItem[] = [];
    try {
      const raw: unknown = JSON.parse(mainText);
      const items = extractItemsArray(raw);
      if (!items || items.length === 0) {
        const shape = raw && typeof raw === 'object' ? Object.keys(raw as object).slice(0, 8) : typeof raw;
        warnRestockParse({ what: 'shape', shape: Array.isArray(shape) ? shape.join(',') : String(shape) });
        if (force) throw new Error(`[RestockData] Unexpected response shape: ${JSON.stringify(shape)}`);
        return safeCacheFallback(cache);
      }
      normalized = items
        .map((item) => normalizeRestockItem(item as unknown as Record<string, unknown>));
    } catch (err) {
      if (force) throw err instanceof Error ? err : new Error(String(err));
      warnRestockParse({ what: 'parse' }, err);
      return safeCacheFallback(cache);
    }

    normalized = sanitizeItems(normalized);

    // Auto-detect extended column support from response data.
    if (serverSupportsExtended === null) {
      serverSupportsExtended = normalized.some(
        (item) => item.recent_intervals_ms != null || item.empirical_weight != null,
      );
    }

    if (force) {
      tryConsumeRestockRefresh();
    }

    const entry: CacheEntry = { data: normalized, fetchedAt: Date.now() };
    storage.set(CACHE_KEY, entry);
    publishRestockOk(normalized.length, entry.fetchedAt);
    emitRestockDataUpdated({
      fetchedAt: entry.fetchedAt,
      count: normalized.length,
      items: normalized,
    });
    log(`[RestockData] Fetched ${normalized.length} items`);
    return normalized;
  })();

  try {
    return await fetchingPromise;
  } catch (err) {
    errorRestockFetch({ where: 'outer', force }, err);
    throw err;
  } finally {
    fetchingPromise = null;
    fetchingIsForce = false;
  }
}

// Sync reads

/** Get stale-or-miss cached data synchronously (for dashboard use). */
export function getRestockDataSync(): RestockItem[] | null {
  const data = readCache()?.data;
  return Array.isArray(data) ? sanitizeItems(data) : null;
}

/** Get when data was last fetched (ms timestamp), or null. */
export function getRestockFetchedAt(): number | null {
  return readCache()?.fetchedAt ?? null;
}

/**
 * Bring the restockData bus entry online. Idempotent — call from main.ts after initDiagnostics().
 * Publishes 'ok' immediately if a usable cache exists; otherwise stays 'starting' until first fetch.
 */
export function startRestockDataDiagnostics(): void {
  registerRestockBus();
  const cached = readCache();
  if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
    publishRestockOk(cached.data.length, cached.fetchedAt);
  }
}

/** No-op symmetry with other diagnostics start/stop pairs. */
export function stopRestockDataDiagnostics(): void {
  // Bus teardown is handled by healthBus.teardown(); no module-local cleanup needed.
}

/** Clear the restock cache (forces a fresh fetch on next call). */
export function clearRestockCache(): void {
  storage.remove('qpm.restockCache.v2');
  storage.remove(CACHE_KEY);
}

/**
 * Patch last_seen for a cached item row (and aliases) when we observe fresher raw events.
 * Keeps QPM display in sync even if a stale row won deduplication previously.
 */
export function patchCachedItemLastSeen(shopType: string, itemId: string, lastSeenMs: number): boolean {
  if (!shopType || !itemId || !Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return false;
  const cached = readCache();
  if (!cached || !Array.isArray(cached.data) || cached.data.length === 0) return false;

  const canonical = canonicalItemId(shopType, itemId);
  let changed = false;
  const nextData = cached.data.map((row) => {
    if (row.shop_type !== shopType) return row;
    if (canonicalItemId(row.shop_type, row.item_id) !== canonical) return row;
    const prev = row.last_seen ?? 0;
    if (lastSeenMs <= prev) return row;
    changed = true;
    return { ...row, last_seen: lastSeenMs };
  });

  if (!changed) return false;
  const merged = sanitizeItems(nextData);
  const entry: CacheEntry = { data: merged, fetchedAt: cached.fetchedAt };
  storage.set(CACHE_KEY, entry);
  emitRestockDataUpdated({
    fetchedAt: entry.fetchedAt,
    count: merged.length,
    items: merged,
  });
  return true;
}

// Weather Predictions

const WEATHER_PREDICTIONS_ENDPOINT =
  'https://xjuvryjgrjchbhjixwzh.supabase.co/rest/v1/weather_predictions';
const WEATHER_PREDICTIONS_COLUMNS = [
  'weather_id',
  'total_occurrences',
  'last_seen',
  'average_interval_ms',
  'estimated_next_timestamp',
  'appearance_rate',
  'duration_ms',
] as const;
const WEATHER_PREDICTIONS_URL = `${WEATHER_PREDICTIONS_ENDPOINT}?select=${WEATHER_PREDICTIONS_COLUMNS.join(',')}`;
const WEATHER_CACHE_KEY = 'qpm.weatherPredictions.v1';
export const WEATHER_PREDICTIONS_UPDATED_EVENT = 'qpm:weather-predictions-updated';

let weatherFetchPromise: Promise<WeatherPrediction[]> | null = null;

function readWeatherCache(): WeatherPredictionCacheEntry | null {
  const cached = storage.get<WeatherPredictionCacheEntry | null>(WEATHER_CACHE_KEY, null);
  if (!cached || !Array.isArray(cached.data)) return null;
  return cached;
}

function emitWeatherPredictionsUpdated(data: WeatherPrediction[]): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(
    new CustomEvent(WEATHER_PREDICTIONS_UPDATED_EVENT, {
      detail: { data, fetchedAt: Date.now() },
    }),
  );
}

function normalizeWeatherPrediction(raw: Record<string, unknown>): WeatherPrediction | null {
  const weatherId = typeof raw.weather_id === 'string' ? raw.weather_id.trim() : '';
  if (!weatherId) return null;
  return {
    weather_id: weatherId,
    total_occurrences: toFloat(raw.total_occurrences) ?? 0,
    last_seen: toMs(raw.last_seen),
    average_interval_ms: toFloat(raw.average_interval_ms) ?? null,
    estimated_next_timestamp: toMs(raw.estimated_next_timestamp),
    appearance_rate: toFloat(raw.appearance_rate) ?? null,
    duration_ms: toFloat(raw.duration_ms) ?? 0,
  };
}

/**
 * Fetch weather predictions from Supabase. Returns cached data on non-force calls.
 */
const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchWeatherPredictions(force = false): Promise<WeatherPrediction[]> {
  const cache = readWeatherCache();
  const cacheAge = cache?.fetchedAt ? Date.now() - cache.fetchedAt : Infinity;
  if (!force && cache && cache.data.length > 0 && cacheAge < WEATHER_CACHE_TTL_MS) {
    return cache.data;
  }

  if (weatherFetchPromise) return weatherFetchPromise;

  weatherFetchPromise = (async (): Promise<WeatherPrediction[]> => {
    const key = (RESTOCK_ANON_KEY || '').trim();
    if (key.length < 16) return cache?.data ?? [];

    const gm = resolveGmXhr();
    let result: FetchTextResult | null = null;

    if (gm) {
      result = await gmGet(gm, WEATHER_PREDICTIONS_URL, key, 10_000);
    }
    if (!result?.ok || result.text == null) {
      result = await webGet(WEATHER_PREDICTIONS_URL, key, 10_000);
    }
    if (!result?.ok || result.text == null) {
      log('[RestockData] Weather predictions fetch failed', result?.error);
      return cache?.data ?? [];
    }

    try {
      const parsed: unknown = JSON.parse(result.text);
      if (!Array.isArray(parsed)) return cache?.data ?? [];
      const predictions = parsed
        .map((row) => normalizeWeatherPrediction(row as Record<string, unknown>))
        .filter((p): p is WeatherPrediction => p !== null);

      const entry: WeatherPredictionCacheEntry = { data: predictions, fetchedAt: Date.now() };
      storage.set(WEATHER_CACHE_KEY, entry);
      emitWeatherPredictionsUpdated(predictions);
      log(`[RestockData] Fetched ${predictions.length} weather predictions`);
      return predictions;
    } catch (err) {
      log('[RestockData] Weather predictions parse error', err);
      return cache?.data ?? [];
    }
  })();

  try {
    return await weatherFetchPromise;
  } finally {
    weatherFetchPromise = null;
  }
}

/** Synchronous cache read for weather predictions. */
export function getWeatherPredictionsSync(): WeatherPrediction[] | null {
  const data = readWeatherCache()?.data;
  return Array.isArray(data) && data.length > 0 ? data : null;
}

/** Convert weather predictions into RestockItem format for unified display. */
export function weatherPredictionsAsRestockItems(
  predictions?: WeatherPrediction[] | null,
): RestockItem[] {
  const data = predictions ?? getWeatherPredictionsSync();
  if (!data || data.length === 0) return [];

  const LUNAR_IDS = new Set(['Dawn', 'AmberMoon']);
  const SUNNY_ID = 'Sunny';
  const LUNAR_SLOTS_PER_DAY = 6; // every 4h UTC

  // Sum regular weather rates (excluding lunar + Sunny) for per-cycle probability.
  const regularTotalRate = data
    .filter((wp) => !LUNAR_IDS.has(wp.weather_id) && wp.weather_id !== SUNNY_ID && wp.appearance_rate != null)
    .reduce((sum, wp) => sum + (wp.appearance_rate ?? 0), 0);

  return data.map((wp): RestockItem => {
    // Convert rate_per_day to per-cycle probability so ratePercent() shows
    // values matching wiki probabilities (e.g. Dawn 67%, Rain ~50%).
    let rate: number | null = null;
    if (wp.appearance_rate != null) {
      if (LUNAR_IDS.has(wp.weather_id)) {
        // Lunar probability: rate_per_day / slots_per_day (Dawn 4.02/6 = 67%)
        rate = wp.appearance_rate / LUNAR_SLOTS_PER_DAY;
      } else if (wp.weather_id === SUNNY_ID) {
        // Sunny = default state; show fraction-of-day-active instead.
        rate = wp.duration_ms > 0
          ? (wp.appearance_rate * wp.duration_ms) / (24 * 60 * 60 * 1000)
          : null;
      } else if (regularTotalRate > 0) {
        // Regular weather per-cycle probability: this type / total regular.
        rate = wp.appearance_rate / regularTotalRate;
      }
    }

    return {
      item_id: wp.weather_id,
      shop_type: 'weather',
      current_probability: null,
      appearance_rate: rate,
      predicted_next_ms: null,
      estimated_next_timestamp: wp.estimated_next_timestamp,
      median_interval_ms: wp.average_interval_ms,
      last_seen: wp.last_seen,
      average_quantity: null,
      total_quantity: wp.total_occurrences,
      total_occurrences: wp.total_occurrences,
      algorithm_version: null,
      algorithm_updated_at: null,
      recent_intervals_ms: null,
      empirical_weight: null,
      empirical_probability: null,
      fallback_rate: null,
      baseline_interval_ms: null,
      ema_interval_ms: null,
      weather_intervals: null,
      is_dormant: null,
      current_weather: null,
      weather_baseline_ms: null,
      weather_samples: null,
      weather_used: null,
      weather_rejected_reason: null,
    };
  });
}

/** Subscribe to weather predictions updates. Returns unsubscribe function. */
export function onWeatherPredictionsUpdated(
  listener: (data: WeatherPrediction[]) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<{ data: WeatherPrediction[] }>).detail;
    if (!detail || !Array.isArray(detail.data)) return;
    listener(detail.data);
  };
  window.addEventListener(WEATHER_PREDICTIONS_UPDATED_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(WEATHER_PREDICTIONS_UPDATED_EVENT, handler as EventListener);
  };
}
