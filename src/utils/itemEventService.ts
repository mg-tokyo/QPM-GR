// src/utils/itemEventService.ts
// Fetches per-item restock events from restock_events table for the detail window.
// Reuses the GM XHR + anon key helpers from restockDataService.

import {
  RESTOCK_ANON_KEY,
  canonicalItemId,
  gmGet,
  getItemIdVariants,
  type GmXhr,
} from './restock/dataService';

const EVENTS_ENDPOINT = 'https://xjuvryjgrjchbhjixwzh.supabase.co/rest/v1/restock_events';
const WEATHER_EVENTS_ENDPOINT = 'https://xjuvryjgrjchbhjixwzh.supabase.co/rest/v1/weather_events';
const EVENTS_RPC_ENDPOINT = 'https://xjuvryjgrjchbhjixwzh.supabase.co/rest/v1/rpc/get_item_restock_events';
const ALGO_HISTORY_RPC_ENDPOINT = 'https://xjuvryjgrjchbhjixwzh.supabase.co/rest/v1/rpc/get_algorithm_version_history';

export interface ItemEvent {
  timestamp: number;
  quantity: number | null;
  predicted_next_ms: number | null;
}

interface VariantItemEvent extends ItemEvent {
  sourceId: string;
}

function resolveGmXhr(): GmXhr | null {
  if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest as unknown as GmXhr;
  const gm = (globalThis as any).GM;
  if (gm?.xmlHttpRequest) return gm.xmlHttpRequest.bind(gm) as GmXhr;
  return null;
}

const EVENTS_TIMEOUT_MS = 3_500;
const DEFAULT_EVENT_LIMIT = 35;
const MIN_EVENT_LIMIT = 5;
const MAX_EVENT_LIMIT = 100;
const EVENT_CACHE_TTL_MS = 3 * 60 * 1000;
const EVENT_CACHE_MAX_ENTRIES = 120;
const SHOP_RESTOCK_CYCLE_MS: Record<string, number> = {
  seed: 5 * 60 * 1000,
  egg: 15 * 60 * 1000,
  decor: 60 * 60 * 1000,
  tool: 10 * 60 * 1000,
  dawn: 0,
};
const EVENT_DEDUP_FACTOR = 0.9;

interface ItemEventCacheEntry {
  fetchedAt: number;
  events: ItemEvent[];
}

const itemEventCache = new Map<string, ItemEventCacheEntry>();
const inflightItemEventFetches = new Map<string, Promise<ItemEvent[]>>();

function clampEventLimit(limit: number | null | undefined): number {
  const n = Number(limit);
  if (!Number.isFinite(n)) return DEFAULT_EVENT_LIMIT;
  const safe = Math.floor(n);
  return Math.max(MIN_EVENT_LIMIT, Math.min(MAX_EVENT_LIMIT, safe));
}

function gmPost(
  gm: GmXhr,
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs = EVENTS_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    gm({
      method: 'POST',
      url,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        apikey: apiKey,
        'Content-Type': 'application/json',
        Prefer: 'count=none',
      },
      timeout: timeoutMs,
      onload: (res) => resolve(res.status >= 200 && res.status < 300 ? res.responseText : null),
      onerror: () => resolve(null),
      ontimeout: () => resolve(null),
      data: JSON.stringify(body),
    });
  });
}

function getItemEventCacheKey(shopType: string, itemId: string, limit: number): string {
  return `${shopType}:${canonicalItemId(shopType, itemId)}:${limit}`;
}

function readItemEventCache(cacheKey: string, now = Date.now()): ItemEvent[] | null {
  const cached = itemEventCache.get(cacheKey);
  if (!cached) return null;
  if (now - cached.fetchedAt > EVENT_CACHE_TTL_MS) {
    itemEventCache.delete(cacheKey);
    return null;
  }
  return cached.events;
}

function writeItemEventCache(cacheKey: string, events: ItemEvent[], now = Date.now()): void {
  if (!events.length) return;
  itemEventCache.set(cacheKey, { fetchedAt: now, events });
  while (itemEventCache.size > EVENT_CACHE_MAX_ENTRIES) {
    const oldestKey = itemEventCache.keys().next().value;
    if (!oldestKey) break;
    itemEventCache.delete(oldestKey);
  }
}

const WEATHER_LOCKED_EGGS = new Set(['SnowEgg', 'DawnEgg']);

function getEventMergeWindowMs(shopType: string, itemId?: string): number {
  // Weather-locked eggs restock every 5 min during their weather, not every 15 min
  if (shopType === 'egg' && itemId && WEATHER_LOCKED_EGGS.has(itemId)) {
    return Math.floor(300_000 * EVENT_DEDUP_FACTOR); // 4.5 min
  }
  const cycleMs = SHOP_RESTOCK_CYCLE_MS[shopType] as number | undefined;
  if (cycleMs == null || !Number.isFinite(cycleMs) || cycleMs <= 0) return 0;
  return Math.floor(cycleMs * EVENT_DEDUP_FACTOR);
}

function isPreferredEventCandidate(
  candidate: VariantItemEvent,
  existing: VariantItemEvent,
  canonicalId: string,
): boolean {
  const candidateQty = candidate.quantity ?? -1;
  const existingQty = existing.quantity ?? -1;
  if (candidateQty !== existingQty) return candidateQty > existingQty;

  const candidateCanonical = candidate.sourceId === canonicalId;
  const existingCanonical = existing.sourceId === canonicalId;
  if (candidateCanonical !== existingCanonical) return candidateCanonical;

  return candidate.timestamp > existing.timestamp;
}

function mergeAndDeduplicateVariantEvents(
  events: VariantItemEvent[],
  shopType: string,
  canonicalId: string,
  limit: number,
): ItemEvent[] {
  if (events.length === 0) return [];

  const mergeWindowMs = getEventMergeWindowMs(shopType, canonicalId);
  const sorted = events
    .filter((ev) => Number.isFinite(ev.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);
  const deduped: VariantItemEvent[] = [];

  for (const event of sorted) {
    const previous = deduped[deduped.length - 1] ?? null;
    if (!previous) {
      deduped.push(event);
      continue;
    }

    const deltaMs = Math.abs(previous.timestamp - event.timestamp);
    const isDuplicate = previous.timestamp === event.timestamp || (mergeWindowMs > 0 && deltaMs <= mergeWindowMs);
    if (isDuplicate) {
      if (isPreferredEventCandidate(event, previous, canonicalId)) {
        deduped[deduped.length - 1] = event;
      }
      continue;
    }

    deduped.push(event);
    if (deduped.length >= limit) break;
  }

  return deduped.slice(0, limit).map(({ timestamp, quantity, predicted_next_ms }) => ({
    timestamp,
    quantity,
    predicted_next_ms: predicted_next_ms ?? null,
  }));
}

/**
 * Preferred server-side path:
 * one RPC call that returns canonicalized, deduplicated item events.
 * Returns null when RPC is unavailable so caller can fallback to legacy path.
 */
async function fetchEventsViaRpc(
  gm: GmXhr,
  shopType: string,
  itemId: string,
  limit: number,
): Promise<ItemEvent[] | null> {
  const payload = {
    p_shop_type: shopType,
    p_item_id: itemId,
    p_limit: limit,
  };

  const text = await gmPost(gm, EVENTS_RPC_ENDPOINT, RESTOCK_ANON_KEY, payload, EVENTS_TIMEOUT_MS);
  if (!text) return null;

  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;

  return rows
    .map((row): ItemEvent | null => {
      const r = row as Record<string, unknown>;
      const rawTs = r.event_ts ?? r.timestamp;
      const ts = typeof rawTs === 'number' ? rawTs : Number(rawTs);
      if (!Number.isFinite(ts)) return null;
      const q = r.quantity;
      const qty = q == null ? null : Number(q);
      const rawPred = r.predicted_next_ms;
      const pred = rawPred == null ? null : Number(rawPred);
      return {
        timestamp: ts,
        quantity: Number.isFinite(qty) ? qty : null,
        predicted_next_ms: pred != null && Number.isFinite(pred) ? pred : null,
      };
    })
    .filter((row): row is ItemEvent => row !== null)
    .slice(0, limit);
}

/** Fetch events for a single item ID. */
async function fetchEventsForId(
  gm: GmXhr,
  shopType: string,
  targetId: string,
  limit: number,
  matchItemIds: ReadonlySet<string>,
): Promise<VariantItemEvent[]> {
  const containsParam = encodeURIComponent(JSON.stringify([{ itemId: targetId }]));
  const url = `${EVENTS_ENDPOINT}?shop_type=eq.${encodeURIComponent(shopType)}&items=cs.${containsParam}&select=timestamp,items&order=timestamp.desc&limit=${limit}`;

  const result = await gmGet(gm, url, RESTOCK_ANON_KEY, EVENTS_TIMEOUT_MS);
  if (!result.ok || !result.text) return [];

  let rows: unknown[];
  try {
    rows = JSON.parse(result.text);
    if (!Array.isArray(rows)) return [];
  } catch {
    return [];
  }

  return rows.map((row): VariantItemEvent => {
    const r = row as Record<string, unknown>;
    const ts = typeof r.timestamp === 'number' ? r.timestamp : Number(r.timestamp);
    let qty: number | null = null;
    if (Array.isArray(r.items)) {
      const match = (r.items as Array<Record<string, unknown>>).find(
        (x) => {
          const itemId = typeof x.itemId === 'string'
            ? x.itemId
            : (typeof x.item_id === 'string' ? x.item_id : null);
          return itemId !== null && matchItemIds.has(itemId);
        },
      );
      if (match) {
        const s = match.stock ?? match.quantity ?? null;
        const parsed = s !== null ? Number(s) : null;
        qty = parsed !== null && Number.isFinite(parsed) ? parsed : null;
      }
    }
    return { timestamp: ts, quantity: qty, predicted_next_ms: null, sourceId: targetId };
  }).filter((e) => Number.isFinite(e.timestamp));
}

/** Fetch weather occurrence events from the weather_events table. */
async function fetchWeatherEventsFromTable(
  gm: GmXhr,
  weatherId: string,
  limit: number,
): Promise<ItemEvent[]> {
  const url = `${WEATHER_EVENTS_ENDPOINT}?weather_id=eq.${encodeURIComponent(weatherId)}&select=timestamp&order=timestamp.desc&limit=${limit}`;
  const result = await gmGet(gm, url, RESTOCK_ANON_KEY, EVENTS_TIMEOUT_MS);
  if (!result.ok || !result.text) return [];

  let rows: unknown[];
  try {
    rows = JSON.parse(result.text);
    if (!Array.isArray(rows)) return [];
  } catch {
    return [];
  }

  return rows
    .map((row): ItemEvent | null => {
      const r = row as Record<string, unknown>;
      const ts = typeof r.timestamp === 'number' ? r.timestamp : Number(r.timestamp);
      if (!Number.isFinite(ts)) return null;
      return { timestamp: ts, quantity: null, predicted_next_ms: null };
    })
    .filter((e): e is ItemEvent => e !== null);
}

/**
 * Fetch up to `limit` restock events for a specific item, newest first.
 * Merges known item-ID aliases and deduplicates near-identical captures.
 */
export async function fetchItemEvents(
  shopType: string,
  itemId: string,
  limit = DEFAULT_EVENT_LIMIT,
): Promise<ItemEvent[]> {
  const normalizedLimit = clampEventLimit(limit);
  const cacheKey = getItemEventCacheKey(shopType, itemId, normalizedLimit);
  const cached = readItemEventCache(cacheKey);
  if (cached) return cached;

  const existing = inflightItemEventFetches.get(cacheKey);
  if (existing) return existing;

  const fetchPromise = (async (): Promise<ItemEvent[]> => {
    const gm = resolveGmXhr();
    if (!gm) return [];

    // Weather events come from a separate table.
    if (shopType === 'weather') {
      const weatherEvents = await fetchWeatherEventsFromTable(gm, itemId, normalizedLimit);
      writeItemEventCache(cacheKey, weatherEvents);
      return weatherEvents;
    }

    // Primary path: server-side canonicalized RPC.
    const rpcEvents = await fetchEventsViaRpc(gm, shopType, itemId, normalizedLimit);
    if (rpcEvents) {
      const canonicalId = canonicalItemId(shopType, itemId);
      const mergedRpc = mergeAndDeduplicateVariantEvents(
        rpcEvents.map((event) => ({
          ...event,
          sourceId: canonicalId,
        })),
        shopType,
        canonicalId,
        normalizedLimit,
      );
      writeItemEventCache(cacheKey, mergedRpc);
      return mergedRpc;
    }

    // Fallback path for pre-migration deployments.
    const variants = getItemIdVariants(shopType, itemId);
    const canonicalId = canonicalItemId(shopType, itemId);
    const matchItemIds = new Set<string>(variants);
    const eventBatches = await Promise.all(
      variants.map((variant) => fetchEventsForId(gm, shopType, variant, normalizedLimit, matchItemIds)),
    );
    const merged = mergeAndDeduplicateVariantEvents(
      eventBatches.flat(),
      shopType,
      canonicalId,
      normalizedLimit,
    );
    writeItemEventCache(cacheKey, merged);
    return merged;
  })();

  inflightItemEventFetches.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inflightItemEventFetches.delete(cacheKey);
  }
}

// ── Algorithm version history ───────────────────────────────────────────────

export interface AlgorithmVersionEntry {
  algorithm_version: string;
  updated_at_ms: number;
  notes: string | null;
}

let algoHistoryCache: { fetchedAt: number; entries: AlgorithmVersionEntry[] } | null = null;
const ALGO_HISTORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

/**
 * Fetch algorithm version history from the server.
 * Returns entries sorted oldest → newest, or an empty array if the RPC
 * doesn't exist yet (pre-migration).
 */
export async function fetchAlgorithmHistory(): Promise<AlgorithmVersionEntry[]> {
  const now = Date.now();
  if (algoHistoryCache && now - algoHistoryCache.fetchedAt < ALGO_HISTORY_CACHE_TTL_MS) {
    return algoHistoryCache.entries;
  }

  const gm = resolveGmXhr();
  if (!gm) return algoHistoryCache?.entries ?? [];

  const text = await gmPost(gm, ALGO_HISTORY_RPC_ENDPOINT, RESTOCK_ANON_KEY, {}, EVENTS_TIMEOUT_MS);
  if (!text) return algoHistoryCache?.entries ?? [];

  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return algoHistoryCache?.entries ?? [];
  }
  if (!Array.isArray(rows)) return algoHistoryCache?.entries ?? [];

  const entries: AlgorithmVersionEntry[] = rows
    .map((row): AlgorithmVersionEntry | null => {
      const r = row as Record<string, unknown>;
      const version = typeof r.algorithm_version === 'string' ? r.algorithm_version : null;
      const ts = typeof r.updated_at_ms === 'number' ? r.updated_at_ms : Number(r.updated_at_ms);
      if (!version || !Number.isFinite(ts)) return null;
      return {
        algorithm_version: version,
        updated_at_ms: ts,
        notes: typeof r.notes === 'string' ? r.notes : null,
      };
    })
    .filter((e): e is AlgorithmVersionEntry => e !== null);

  algoHistoryCache = { fetchedAt: now, entries };
  return entries;
}
