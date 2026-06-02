// src/utils/restockParser.ts
// Parsing, normalization, and deduplication for restock API responses.
// Pure functions — no side effects, no shared state.

import { type RestockItem, RESTOCK_ITEM_FIELDS } from './types';

// Known item ID aliases for deduplication (legacy → canonical).
// Scoped to "shop_type:oldId" to avoid cross-shop confusion.
const ITEM_ID_ALIASES: Record<string, string> = {
  'seed:Dawnbinder': 'DawnCelestial',
  'seed:DawnbinderPod': 'DawnCelestial',
  'seed:Moonbinder': 'MoonCelestial',
  'seed:MoonbinderPod': 'MoonCelestial',
  'seed:StarweaverPod': 'Starweaver',
};

/** Resolve canonical item_id for known aliases within a shop_type. */
export function canonicalItemId(shopType: string, itemId: string): string {
  return ITEM_ID_ALIASES[`${shopType}:${itemId}`] ?? itemId;
}

/** Get all known item_id variants for a (shopType, itemId) pair. */
export function getItemIdVariants(shopType: string, itemId: string): string[] {
  const canonical = canonicalItemId(shopType, itemId);
  const variants = new Set<string>([itemId, canonical]);
  for (const [key, target] of Object.entries(ITEM_ID_ALIASES)) {
    if (target === canonical) {
      const alias = key.split(':')[1];
      if (alias && key.startsWith(`${shopType}:`)) variants.add(alias);
    }
  }
  return Array.from(variants);
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/** Convert a raw Supabase timestamp value to Unix ms regardless of format. */
export function toMs(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    const d = new Date(v).getTime();
    if (Number.isFinite(d)) return d;
  }
  return null;
}

/** Same as toMs but for duration/interval columns (ms). */
export function toMsDuration(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Safely parse a float from a raw value (probability, rate, quantity). */
export function toFloat(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function toBoolean(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (normalized === 'true' || normalized === 't' || normalized === '1') return true;
    if (normalized === 'false' || normalized === 'f' || normalized === '0') return false;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row deduplication
// ---------------------------------------------------------------------------

function numOrNegInf(value: number | null | undefined): number {
  return value == null || !Number.isFinite(value) ? Number.NEGATIVE_INFINITY : value;
}

function pickPreferredRow(a: RestockItem, b: RestockItem): RestockItem {
  const aLast = numOrNegInf(a.last_seen);
  const bLast = numOrNegInf(b.last_seen);
  if (aLast !== bLast) return bLast > aLast ? b : a;

  const aOcc = numOrNegInf(a.total_occurrences);
  const bOcc = numOrNegInf(b.total_occurrences);
  if (aOcc !== bOcc) return bOcc > aOcc ? b : a;

  return b;
}

function mergeDuplicateItemRows(existing: RestockItem, incoming: RestockItem): RestockItem {
  const preferred = pickPreferredRow(existing, incoming);
  const fallback = preferred === existing ? incoming : existing;
  const mergedLastSeen = Math.max(numOrNegInf(existing.last_seen), numOrNegInf(incoming.last_seen));
  const mergedAlgorithmUpdatedAt = Math.max(
    numOrNegInf(existing.algorithm_updated_at),
    numOrNegInf(incoming.algorithm_updated_at),
  );

  return {
    item_id: preferred.item_id,
    shop_type: preferred.shop_type,
    current_probability: preferred.current_probability ?? fallback.current_probability ?? null,
    appearance_rate: preferred.appearance_rate ?? fallback.appearance_rate ?? null,
    predicted_next_ms: preferred.predicted_next_ms ?? fallback.predicted_next_ms ?? null,
    estimated_next_timestamp: preferred.estimated_next_timestamp ?? fallback.estimated_next_timestamp ?? null,
    median_interval_ms: preferred.median_interval_ms ?? fallback.median_interval_ms ?? null,
    last_seen: Number.isFinite(mergedLastSeen) ? mergedLastSeen : null,
    average_quantity: preferred.average_quantity ?? fallback.average_quantity ?? null,
    total_quantity: Math.max(numOrNegInf(existing.total_quantity), numOrNegInf(incoming.total_quantity)),
    total_occurrences: Math.max(numOrNegInf(existing.total_occurrences), numOrNegInf(incoming.total_occurrences)),
    algorithm_version: preferred.algorithm_version ?? fallback.algorithm_version ?? null,
    algorithm_updated_at: Number.isFinite(mergedAlgorithmUpdatedAt) ? mergedAlgorithmUpdatedAt : null,
    recent_intervals_ms: preferred.recent_intervals_ms ?? fallback.recent_intervals_ms ?? null,
    empirical_weight: preferred.empirical_weight ?? fallback.empirical_weight ?? null,
    empirical_probability: preferred.empirical_probability ?? fallback.empirical_probability ?? null,
    fallback_rate: preferred.fallback_rate ?? fallback.fallback_rate ?? null,
    baseline_interval_ms: preferred.baseline_interval_ms ?? fallback.baseline_interval_ms ?? null,
    ema_interval_ms: preferred.ema_interval_ms ?? fallback.ema_interval_ms ?? null,
    weather_intervals: preferred.weather_intervals ?? fallback.weather_intervals ?? null,
    is_dormant: preferred.is_dormant ?? fallback.is_dormant ?? null,
    current_weather: preferred.current_weather ?? fallback.current_weather ?? null,
    weather_baseline_ms: preferred.weather_baseline_ms ?? fallback.weather_baseline_ms ?? null,
    weather_samples: preferred.weather_samples ?? fallback.weather_samples ?? null,
    weather_used: preferred.weather_used ?? fallback.weather_used ?? null,
    weather_rejected_reason: preferred.weather_rejected_reason ?? fallback.weather_rejected_reason ?? null,
  };
}

/** Merge duplicate items (same canonical ID + shop_type), preserving freshest last_seen data. */
export function deduplicateItems(items: RestockItem[]): RestockItem[] {
  const map = new Map<string, RestockItem>();
  for (const item of items) {
    const canonical = canonicalItemId(item.shop_type, item.item_id);
    const key = `${item.shop_type}:${canonical}`;
    const normalized = canonical !== item.item_id ? { ...item, item_id: canonical } : item;
    const existing = map.get(key);
    map.set(key, existing ? mergeDuplicateItemRows(existing, normalized) : normalized);
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    total_quantity: Number.isFinite(row.total_quantity ?? NaN) ? row.total_quantity : null,
    total_occurrences: Number.isFinite(row.total_occurrences ?? NaN) ? row.total_occurrences : null,
  }));
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeShopType(value: unknown): string {
  const shopType = String(value ?? '').trim().toLowerCase();
  if (shopType === 'seeds') return 'seed';
  if (shopType === 'eggs') return 'egg';
  if (shopType === 'decors') return 'decor';
  if (shopType === 'tools') return 'tool';
  return shopType;
}

/**
 * Normalize a raw API object (camelCase or snake_case) to the RestockItem interface (snake_case).
 */
function toNumberArray(v: unknown): number[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return null;
  const result: number[] = [];
  for (const item of v) {
    const n = typeof item === 'number' ? item : Number(item);
    if (Number.isFinite(n)) result.push(n);
  }
  return result.length > 0 ? result : null;
}

function parseWeatherIntervals(v: unknown): Record<string, number[]> | null {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return null;
  const result: Record<string, number[]> = {};
  let hasAny = false;
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (!key || typeof key !== 'string') continue;
    const arr = toNumberArray(val);
    if (arr && arr.length > 0) {
      result[key] = arr;
      hasAny = true;
    }
  }
  return hasAny ? result : null;
}

export function normalizeRestockItem(raw: Record<string, unknown>): RestockItem {
  return {
    item_id: String(raw.item_id ?? raw.itemId ?? ''),
    shop_type: normalizeShopType(raw.shop_type ?? raw.shopType),
    current_probability: toFloat(raw.current_probability ?? raw.currentProbability),
    appearance_rate: toFloat(
      raw.appearance_rate
      ?? raw.appearanceRate
      ?? raw.base_rate
      ?? raw.baseRate
    ),
    predicted_next_ms: toMs(raw.predicted_next_ms ?? raw.predictedNextMs),
    estimated_next_timestamp: toMs(raw.estimated_next_timestamp ?? raw.estimatedNextTimestamp),
    median_interval_ms: toMsDuration(
      raw.median_interval_ms
      ?? raw.medianIntervalMs
      ?? raw.expected_interval_ms
      ?? raw.expectedIntervalMs
      ?? raw.averageIntervalMs
    ),
    last_seen: toMs(raw.last_seen ?? raw.lastSeen),
    average_quantity: toFloat(raw.average_quantity ?? raw.averageQuantity),
    total_quantity: toFloat(raw.total_quantity ?? raw.totalQuantity),
    total_occurrences: toFloat(raw.total_occurrences ?? raw.totalOccurrences),
    algorithm_version: typeof (raw.algorithm_version ?? raw.algorithmVersion) === 'string'
      ? String(raw.algorithm_version ?? raw.algorithmVersion)
      : null,
    algorithm_updated_at: toMs(raw.algorithm_updated_at_ms ?? raw.algorithmUpdatedAtMs),
    recent_intervals_ms: toNumberArray(raw.recent_intervals_ms ?? raw.recentIntervalsMs),
    empirical_weight: toFloat(raw.empirical_weight ?? raw.empiricalWeight),
    empirical_probability: toFloat(raw.empirical_probability ?? raw.empiricalProbability),
    fallback_rate: toFloat(raw.fallback_rate ?? raw.fallbackRate),
    baseline_interval_ms: toMsDuration(raw.baseline_interval_ms ?? raw.baselineIntervalMs),
    ema_interval_ms: toMsDuration(raw.ema_interval_ms ?? raw.emaIntervalMs),
    weather_intervals: parseWeatherIntervals(raw.weather_intervals ?? raw.weatherIntervals),
    is_dormant: !!(raw.is_dormant ?? raw.isDormant) || null,
    current_weather: typeof (raw.current_weather ?? raw.currentWeather) === 'string'
      ? String(raw.current_weather ?? raw.currentWeather)
      : null,
    weather_baseline_ms: toMsDuration(raw.weather_baseline_ms ?? raw.weatherBaselineMs),
    weather_samples: toFloat(raw.weather_samples ?? raw.weatherSamples),
    weather_used: toBoolean(raw.weather_used ?? raw.weatherUsed),
    weather_rejected_reason: typeof (raw.weather_rejected_reason ?? raw.weatherRejectedReason) === 'string'
      ? String(raw.weather_rejected_reason ?? raw.weatherRejectedReason)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Envelope unwrapping
// ---------------------------------------------------------------------------

const ENVELOPE_KEYS = ['items', 'data', 'rows', 'results'] as const;
const NESTED_KEYS = [...ENVELOPE_KEYS, 'list', 'records', 'entries'] as const;

/** Return true if value looks like a RestockItem (has at least one known field). */
function looksLikeRestockItem(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.keys(v as object).some((k) => RESTOCK_ITEM_FIELDS.has(k));
}

/**
 * Try extracting an array of RestockItems from a dict.
 * Filters out any non-object or non-RestockItem-like values (e.g. numeric metadata).
 */
function dictToItems(val: unknown): RestockItem[] | null {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
  const items = Object.values(val as Record<string, unknown>).filter(looksLikeRestockItem);
  return items.length > 0 ? (items as RestockItem[]) : null;
}

/**
 * Walk a parsed JSON value looking for the first array of restock items.
 */
export function extractItemsArray(raw: unknown): RestockItem[] | null {
  if (Array.isArray(raw)) return raw as RestockItem[];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  // First pass: check each envelope key at the top level - both array and dict formats.
  for (const key of ENVELOPE_KEYS) {
    const val = obj[key];
    if (Array.isArray(val)) return val as RestockItem[];
    const fromDict = dictToItems(val);
    if (fromDict) return fromDict;
  }

  // Second pass: one level deeper.
  for (const key of ENVELOPE_KEYS) {
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      for (const nk of NESTED_KEYS) {
        const nval = nested[nk];
        if (Array.isArray(nval)) return nval as RestockItem[];
        const fromDict = dictToItems(nval);
        if (fromDict) return fromDict;
      }
    }
  }

  // Last resort: treat the entire top-level object as a dict of items.
  const fromRoot = dictToItems(obj);
  if (fromRoot) return fromRoot;

  return null;
}
