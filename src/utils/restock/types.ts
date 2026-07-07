// Shared type definitions for the restock data service.

export interface RestockItem {
  item_id: string;
  shop_type: string;
  current_probability: number | null;
  appearance_rate: number | null;
  predicted_next_ms: number | null;
  estimated_next_timestamp: number | null;
  median_interval_ms: number | null;
  last_seen: number | null;
  average_quantity: number | null;
  total_quantity: number | null;
  total_occurrences: number | null;
  algorithm_version: string | null;
  algorithm_updated_at: number | null;
  // Model internals (from extended restock_predictions view)
  recent_intervals_ms: number[] | null;
  empirical_weight: number | null;
  empirical_probability: number | null;
  fallback_rate: number | null;
  baseline_interval_ms: number | null;
  // EMA + weather stratification (v7+)
  ema_interval_ms: number | null;
  weather_intervals: Record<string, number[]> | null;
  // Dormancy detection (v9+)
  is_dormant: boolean | null;
  // Weather-conditional predictions (v10+)
  current_weather: string | null;
  weather_baseline_ms: number | null;
  weather_samples: number | null;
  weather_used: boolean | null;
  weather_rejected_reason: string | null;
}

export interface RestockPredictionAccuracyAggregate {
  item_id: string;
  shop_type: string;
  algorithm_version: string | null;
  scored_predictions: number;
  mae_min: number | null;
  median_abs_error_min: number | null;
  within_one_cycle_pct: number | null;
  last_scored_at: number | null;
}

export interface RestockRefreshBudgetState {
  max: number;
  used: number;
  remaining: number;
  windowStartedAt: number;
  resetAt: number;
  blocked: boolean;
  windowMs: number;
}

export interface RestockDataUpdatedDetail {
  fetchedAt: number;
  count: number;
  items?: RestockItem[];
}

export type FetchStatus = 'idle' | 'fetching' | 'ok' | 'error';

export interface CacheEntry {
  data: RestockItem[];
  fetchedAt: number;
}

export interface RefreshBudgetEntry {
  used: number;
  windowStartedAt: number;
}

export type GmXhr = (details: {
  method: 'GET' | 'POST';
  url: string;
  data?: string;
  headers?: Record<string, string>;
  onload?: (res: { status: number; responseText: string }) => void;
  onerror?: (err: unknown) => void;
  ontimeout?: () => void;
  timeout?: number;
}) => void;

export interface FetchTextResult {
  ok: boolean;
  status: number;
  text: string | null;
  error: string | null;
}

export interface WeatherPrediction {
  weather_id: string;
  total_occurrences: number;
  last_seen: number | null;
  average_interval_ms: number | null;
  estimated_next_timestamp: number | null;
  appearance_rate: number | null;
  duration_ms: number;
}

export interface WeatherPredictionCacheEntry {
  data: WeatherPrediction[];
  fetchedAt: number;
}

// Fields present on any legitimate RestockItem row (snake_case and camelCase variants).
export const RESTOCK_ITEM_FIELDS = new Set([
  'item_id',
  'itemId',
  'shop_type',
  'shopType',
  'estimated_next_timestamp',
  'estimatedNextTimestamp',
  'current_probability',
  'currentProbability',
  'appearance_rate',
  'appearanceRate',
  'predicted_next_ms',
  'predictedNextMs',
  'base_rate',
  'baseRate',
  'median_interval_ms',
  'medianIntervalMs',
  'expected_interval_ms',
  'expectedIntervalMs',
  'averageIntervalMs',
  'last_seen',
  'lastSeen',
  'average_quantity',
  'averageQuantity',
  'total_quantity',
  'totalQuantity',
  'total_occurrences',
  'totalOccurrences',
  'algorithm_version',
  'algorithmVersion',
  'algorithm_updated_at_ms',
  'algorithmUpdatedAtMs',
  'recent_intervals_ms',
  'recentIntervalsMs',
  'empirical_weight',
  'empiricalWeight',
  'empirical_probability',
  'empiricalProbability',
  'fallback_rate',
  'fallbackRate',
  'baseline_interval_ms',
  'baselineIntervalMs',
  'ema_interval_ms',
  'emaIntervalMs',
  'weather_intervals',
  'weatherIntervals',
  'is_dormant',
  'isDormant',
  'current_weather',
  'currentWeather',
  'weather_baseline_ms',
  'weatherBaselineMs',
  'weather_samples',
  'weatherSamples',
  'weather_used',
  'weatherUsed',
  'weather_rejected_reason',
  'weatherRejectedReason',
]);
