// src/ui/itemRestockDetailWindow.ts
// Per-item restock history with overview card + navigable event accuracy cards.

import { openWindow, destroyWindow, registerWindowOpener } from '../core/modalWindow';
import { fetchItemEvents, fetchAlgorithmHistory, type AlgorithmVersionEntry } from '../../utils/itemEventService';
import type { RestockItem, RestockPredictionAccuracyAggregate } from '../../utils/restock/dataService';
import {
  canonicalItemId,
  fetchRestockPredictionAccuracyAggregate,
  getItemIdVariants,
  getItemProbability,
  getRestockDataSync,
  patchCachedItemLastSeen,
  RESTOCK_MODEL_ACCURACY_MIN_SCORED,
} from '../../utils/restock/dataService';
import { getPetSpriteCanvas, getCropSpriteCanvas, getAnySpriteDataUrl } from '../../sprite-v2/compat';
import { canvasToDataUrl } from '../../utils/dom/canvasHelpers';
import { storage } from '../../utils/storage';
import { getWeatherDef } from '../../catalogs/gameCatalogs';
import {
  getAccuracyWindows,
  computeAccuracyScore,
  computeEventAccuracy as computeEventAccuracyNew,
  getConfidenceInterval,
  type EventAccuracy,
  type EventStatus,
} from '../../utils/restock/accuracy';
import { getWeatherSnapshot } from '../../store/weatherHub';
import { t } from '../../i18n';

const INITIAL_ROWS = 5;
const DETAIL_WINDOW_REGISTRY_KEY = 'qpm.restock.detailWindows.v1';
const DETAIL_WINDOW_REGISTRY_MAX = 160;
const ARIEDAM_KEY = 'qpm.ariedam.gamedata';
const DETAIL_WINDOW_SCALE_KEY = 'qpm.restock.detailScale.v1';
const DETAIL_WINDOW_SCALE_MIN = 0.5;
const DETAIL_WINDOW_SCALE_MAX = 2.2;
const DETAIL_WINDOW_SCALE_DEFAULT = 1;
let detailScaleLegacyCleared = false;

type DetailShopType = 'seed' | 'egg' | 'decor' | 'tool' | 'weather' | 'dawn';

interface DetailWindowRegistryEntry {
  shopType: DetailShopType;
  itemId: string;
  itemName: string;
  updatedAt: number;
}

function isDetailShopType(value: unknown): value is DetailShopType {
  return value === 'seed' || value === 'egg' || value === 'decor' || value === 'tool' || value === 'weather' || value === 'dawn';
}

function clampDetailScale(value: number): number {
  if (!Number.isFinite(value)) return DETAIL_WINDOW_SCALE_DEFAULT;
  return Math.min(DETAIL_WINDOW_SCALE_MAX, Math.max(DETAIL_WINDOW_SCALE_MIN, value));
}

function loadDetailWindowRegistry(): DetailWindowRegistryEntry[] {
  const raw = storage.get<unknown>(DETAIL_WINDOW_REGISTRY_KEY, []);
  if (!Array.isArray(raw)) return [];

  const rows: DetailWindowRegistryEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const shopType = row.shopType;
    const itemId = row.itemId;
    const itemName = row.itemName;
    const updatedAt = Number(row.updatedAt);
    if (!isDetailShopType(shopType)) continue;
    if (typeof itemId !== 'string' || itemId.length === 0) continue;
    if (typeof itemName !== 'string' || itemName.length === 0) continue;
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue;
    rows.push({ shopType, itemId, itemName, updatedAt });
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows.slice(0, DETAIL_WINDOW_REGISTRY_MAX);
}

function saveDetailWindowRegistry(entries: DetailWindowRegistryEntry[]): void {
  storage.set(DETAIL_WINDOW_REGISTRY_KEY, entries.slice(0, DETAIL_WINDOW_REGISTRY_MAX));
}

function getDetailWindowId(shopType: DetailShopType, itemId: string): string {
  return `item-detail-${shopType}-${itemId}`;
}

function makeFallbackDetailItem(shopType: DetailShopType, itemId: string): RestockItem {
  return {
    item_id: itemId,
    shop_type: shopType,
    current_probability: null,
    appearance_rate: null,
    predicted_next_ms: null,
    estimated_next_timestamp: null,
    median_interval_ms: null,
    last_seen: null,
    average_quantity: null,
    total_quantity: null,
    total_occurrences: null,
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
}

function computeWeatherConditionalMedian(
  item: RestockItem,
): { median: number; weather: string } | null {
  if (item.weather_used !== true) return null;
  const wi = item.weather_intervals;
  if (!wi || typeof wi !== 'object') return null;
  const currentWeather = getWeatherSnapshot().kind;
  if (!currentWeather || currentWeather === 'unknown') return null;
  // Try exact match, then title-case variant
  const bucket =
    wi[currentWeather] ??
    wi[currentWeather.charAt(0).toUpperCase() + currentWeather.slice(1)] ??
    null;
  if (!Array.isArray(bucket) || bucket.length < 3) return null;
  const sorted = bucket.filter((v) => typeof v === 'number' && v > 0).sort((a, b) => a - b);
  if (sorted.length < 3) return null;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
  return { median, weather: currentWeather };
}

function resolveDetailRestockItem(
  shopType: DetailShopType,
  itemId: string,
  fallback?: RestockItem,
): RestockItem {
  const canonicalId = canonicalItemId(shopType, itemId);
  const variants = new Set<string>(getItemIdVariants(shopType, canonicalId));
  variants.add(canonicalId);
  variants.add(itemId);
  const cached = getRestockDataSync() ?? [];
  const found = cached.find((row) => row.shop_type === shopType && variants.has(row.item_id));
  if (found) {
    return {
      ...found,
      shop_type: shopType,
      item_id: canonicalId,
    };
  }
  if (fallback) {
    return {
      ...fallback,
      shop_type: shopType,
      item_id: canonicalId,
    };
  }
  return makeFallbackDetailItem(shopType, canonicalId);
}

function rememberDetailWindow(shopType: DetailShopType, itemId: string, itemName: string): void {
  const canonicalId = canonicalItemId(shopType, itemId);
  const label = itemName.trim() || canonicalId;
  const now = Date.now();
  const existing = loadDetailWindowRegistry();
  const nextEntry: DetailWindowRegistryEntry = {
    shopType,
    itemId: canonicalId,
    itemName: label,
    updatedAt: now,
  };
  const merged = [
    nextEntry,
    ...existing.filter((entry) => !(entry.shopType === shopType && entry.itemId === canonicalId)),
  ];
  saveDetailWindowRegistry(merged);
}

function registerDetailWindowOpener(shopType: DetailShopType, itemId: string, itemName: string): void {
  const canonicalId = canonicalItemId(shopType, itemId);
  const label = itemName.trim() || canonicalId;
  const winId = getDetailWindowId(shopType, canonicalId);
  registerWindowOpener(winId, () => {
    const restockItem = resolveDetailRestockItem(shopType, canonicalId);
    openItemRestockDetail(restockItem, label);
  });
}

export function registerPersistedItemRestockDetailOpeners(): void {
  const entries = loadDetailWindowRegistry();
  for (const entry of entries) {
    registerDetailWindowOpener(entry.shopType, entry.itemId, entry.itemName);
  }
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtTimestamp(ts: number): string {
  const d    = new Date(ts);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date}  ${time}`;
}

function fmtAbsoluteWithZone(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

function fmtDuration(ms: number): string {
  const abs = Math.abs(ms);
  const d   = Math.floor(abs / 86_400_000);
  const h   = Math.floor((abs % 86_400_000) / 3_600_000);
  const m   = Math.floor((abs % 3_600_000)  / 60_000);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (!d && !h) parts.push(`${m}m`);
  else if (m && !d) parts.push(`${m}m`);
  return parts.join(' ') || '0m';
}

function fmtRelative(ts: number | null): string {
  if (!ts) return t('feature.itemDetail.neverSeen');
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('feature.shopRestock.justNow');
  if (diff < 3_600_000) return t('feature.shopRestock.minutesAgo', { m: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('feature.shopRestock.hoursAgo', { h: Math.floor(diff / 3_600_000) });
  return t('feature.shopRestock.daysAgo', { d: Math.floor(diff / 86_400_000) });
}

function fmtPercent(rate: number | null): string {
  if (rate == null) return '\u2014';
  const pct = rate * 100;
  if (!Number.isFinite(pct)) return '\u2014';
  const formatted = pct.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return `${formatted}%`;
}

function fmtCountdown(ts: number | null): string {
  if (!ts) return '\u2014';
  const diff = ts - Date.now();
  if (diff <= 0) return t('feature.shopRestock.overdue');
  return `~${fmtDuration(diff)}`;
}

function aggregateModelAccuracyMetric(
  aggregate: RestockPredictionAccuracyAggregate | null,
  medianMs: number | null,
  intervals: number[] | null,
): { score: number; title: string; avgErrorMs: number; count: number } | null {
  if (!aggregate || aggregate.scored_predictions < RESTOCK_MODEL_ACCURACY_MIN_SCORED) return null;
  if (aggregate.median_abs_error_min == null || !Number.isFinite(aggregate.median_abs_error_min)) return null;
  const medianErrorMs = aggregate.median_abs_error_min * 60_000;
  const windows = getAccuracyWindows(medianMs, intervals);
  const score = computeAccuracyScore(medianErrorMs, windows);
  const details: string[] = [t('feature.itemDetail.scoredPredictions', { count: aggregate.scored_predictions })];
  if (aggregate.mae_min != null) details.push(t('feature.itemDetail.mae', { duration: fmtDuration(aggregate.mae_min * 60_000) }));
  details.push(t('feature.itemDetail.medianError', { duration: fmtDuration(medianErrorMs) }));
  return {
    score: Math.min(100, Math.max(0, score)),
    title: details.join(' | '),
    avgErrorMs: medianErrorMs,
    count: aggregate.scored_predictions,
  };
}

// ── Accuracy tier (adaptive, using restockAccuracy module) ───────────────────

type Tier = 'good' | 'warn' | 'bad' | 'none';

const TIER_COLOR: Record<Tier, string> = {
  good: '#4ade80',
  warn: '#fbbf24',
  bad:  '#f87171',
  none: 'rgba(143,130,255,0.22)',
};


// ── Row data ─────────────────────────────────────────────────────────────────

interface RowData {
  timestamp: number;
  quantity:  number | null;
  predicted_next_ms: number | null;
  gapMs:     number | null;
  errorMs:   number | null;
}

function normalizeEpochMs(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  // Guard mixed epoch units from backend/rpc: convert unix-seconds to ms.
  if (value < 1_000_000_000_000) return Math.round(value * 1000);
  return Math.round(value);
}

function sortEventsNewestFirst<T extends { timestamp: number }>(events: readonly T[]): T[] {
  return events
    .filter((event) => Number.isFinite(event.timestamp) && event.timestamp > 0)
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
}

// ── Algorithm update markers ──────────────────────────────────────────────

interface AlgorithmMarkerSlot {
  timestampMs: number;
  label: string;
  insertIdx: number;
  context: MarkerPositionContext;
  inserted: boolean;
}

type MarkerPositionContext = 'between' | 'after-latest' | 'before-oldest';

function buildAlgorithmMarkerSlots(
  rows: RowData[],
  dbUpdatedAtMs: number | null,
  history: AlgorithmVersionEntry[],
): AlgorithmMarkerSlot[] {
  // Collect unique timestamps — prefer history entries, fall back to single DB value.
  const seen = new Set<number>();
  const entries: { timestampMs: number; label: string }[] = [];

  for (const h of history) {
    if (!Number.isFinite(h.updated_at_ms) || seen.has(h.updated_at_ms)) continue;
    seen.add(h.updated_at_ms);
    entries.push({
      timestampMs: h.updated_at_ms,
      label: t('feature.itemDetail.algoUpdated', { date: fmtAbsoluteWithZone(h.updated_at_ms) }),
    });
  }

  // Fall back to single DB value if history was empty / RPC unavailable.
  if (entries.length === 0 && dbUpdatedAtMs != null && Number.isFinite(dbUpdatedAtMs)) {
    entries.push({
      timestampMs: dbUpdatedAtMs,
      label: t('feature.itemDetail.algoUpdated', { date: fmtAbsoluteWithZone(dbUpdatedAtMs) }),
    });
  }

  const slots = entries.map((e) => {
    const insertIdx = (() => {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i]!.timestamp <= e.timestampMs) return i;
      }
      return rows.length;
    })();
    const context: MarkerPositionContext =
      insertIdx <= 0 ? 'after-latest' : insertIdx >= rows.length ? 'before-oldest' : 'between';
    return { ...e, insertIdx, context, inserted: false };
  });

  // Collapse entries at the same insertIdx — keep only the newest per position.
  const byIdx = new Map<number, AlgorithmMarkerSlot>();
  for (const slot of slots) {
    const existing = byIdx.get(slot.insertIdx);
    if (!existing || slot.timestampMs > existing.timestampMs) {
      byIdx.set(slot.insertIdx, slot);
    }
  }
  return Array.from(byIdx.values());
}

function makeAlgorithmUpdateMarkerEl(slot: AlgorithmMarkerSlot): HTMLElement {
  const marker = document.createElement('div');
  marker.style.cssText = [
    'display:flex',
    'align-items:center',
    'padding:6px 10px',
    'margin:4px 0 6px',
    'border-radius:6px',
    'border:1px solid rgba(143,130,255,0.25)',
    'background:rgba(143,130,255,0.08)',
    'font-size:10px',
    'letter-spacing:0.2px',
    'color:rgba(220,210,255,0.72)',
    'text-transform:uppercase',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
  ].join(';');
  const suffix = slot.context === 'after-latest'
    ? ` ${t('feature.itemDetail.afterLatest')}`
    : slot.context === 'before-oldest'
      ? ` ${t('feature.itemDetail.beforeOldest')}`
      : '';
  marker.textContent = `${slot.label}${suffix}`;
  marker.title = t('feature.itemDetail.updatedAt', { date: new Date(slot.timestampMs).toISOString() });
  return marker;
}

// ── Sprite helper ────────────────────────────────────────────────────────────

function getItemSpriteUrl(shopType: string, itemId: string): string | null {
  // Weather events use the weather catalog spriteId
  if (shopType === 'weather') {
    const def = getWeatherDef(itemId);
    const spriteId = def && typeof def.spriteId === 'string' ? def.spriteId : null;
    if (spriteId) return getAnySpriteDataUrl(spriteId) || null;
    return null;
  }

  const tryResolve = (candidateId: string): string | null => {
    let url: string | null = null;
    try { url = canvasToDataUrl(getPetSpriteCanvas(candidateId)) || null; } catch { /* */ }
    if (!url) {
      try { url = canvasToDataUrl(getCropSpriteCanvas(candidateId)) || null; } catch { /* */ }
    }
    return url;
  };

  // Dawn shop items are seeds/eggs — resolve using seed/egg sprite lookups
  const resolveShopType = shopType === 'dawn' ? 'seed' : shopType;

  const directUrl = tryResolve(itemId);
  if (directUrl) return directUrl;

  for (const variantId of getItemIdVariants(resolveShopType, itemId)) {
    if (!variantId || variantId === itemId) continue;
    const variantUrl = tryResolve(variantId);
    if (variantUrl) return variantUrl;
  }

  if (shopType === 'tool') {
    const candidates = new Set<string>([itemId, ...getItemIdVariants(shopType, itemId)]);
    if (itemId.endsWith('s') && itemId.length > 1) candidates.add(itemId.slice(0, -1));
    if (!itemId.endsWith('s')) candidates.add(`${itemId}s`);

    const cached = storage.get<{ data?: unknown } | null>(ARIEDAM_KEY, null);
    const data = cached?.data;
    const items = data && typeof data === 'object'
      ? ((data as Record<string, unknown>).items as Record<string, unknown> | undefined)
      : undefined;
    if (items && typeof items === 'object') {
      for (const candidateId of candidates) {
        const row = items[candidateId];
        if (!row || typeof row !== 'object') continue;
        const sprite = (row as Record<string, unknown>).sprite;
        if (typeof sprite === 'string' && sprite.trim()) return sprite;
      }
    }

    const normalizedId = itemId.endsWith('s') && itemId.length > 1 ? itemId.slice(0, -1) : itemId;
    return `https://mg-api.ariedam.fr/assets/sprites/items/${encodeURIComponent(normalizedId)}.png`;
  }

  return null;
}

// ── Category & status helpers ────────────────────────────────────────────────

function shopLabel(shopType: string): string {
  const keys: Record<string, string> = {
    seed: 'feature.shopRestock.filterSeeds',
    egg: 'feature.shopRestock.filterEggs',
    decor: 'feature.shopRestock.filterDecor',
    tool: 'feature.shopRestock.filterTools',
    weather: 'feature.shopRestock.filterWeather',
    dawn: 'feature.shopRestock.filterDawn',
  };
  return t(keys[shopType] ?? '', undefined, shopType);
}

/** Thin wrapper: compute accuracy for a RowData using the new module. */
function computeRowEventAccuracy(
  row: RowData,
  prevRow: RowData | null,
  medianMs: number | null,
  intervals?: number[] | null,
): EventAccuracy {
  return computeEventAccuracyNew(row, prevRow, medianMs, intervals);
}

function computeMedianRowRegularity(
  row: RowData,
  prevRow: RowData | null,
  medianMs: number | null,
  intervals?: number[] | null,
): EventAccuracy {
  return computeEventAccuracyNew(
    { timestamp: row.timestamp },
    prevRow ? { timestamp: prevRow.timestamp } : null,
    medianMs,
    intervals,
  );
}


function getStatusConfig(): Record<EventStatus, { icon: string; label: string; color: string; bg: string }> {
  return {
    accurate: { icon: '\u2713', label: t('feature.itemDetail.statusAccurate'), color: '#4ade80', bg: 'rgba(74,222,128,0.10)' },
    early:    { icon: '\u21D7', label: t('feature.itemDetail.statusEarly'),    color: '#60a5fa', bg: 'rgba(96,165,250,0.10)' },
    late:     { icon: '\u23F1', label: t('feature.itemDetail.statusLate'),     color: '#fbbf24', bg: 'rgba(251,191,36,0.10)' },
    first:    { icon: '\u2014', label: t('feature.itemDetail.statusFirstEvent'), color: 'rgba(232,224,255,0.5)', bg: 'rgba(143,130,255,0.06)' },
  };
}

// ── Shared card styles ───────────────────────────────────────────────────────

const CARD_STYLE = [
  'flex-shrink:0',
  'margin:12px 12px 0',
  'border-radius:12px',
  'border:1px solid rgba(143,130,255,0.3)',
  'background:rgba(143,130,255,0.06)',
  'overflow:hidden',
].join(';');

function makeCardHeader(
  itemName: string,
  shopType: string,
  spriteUrl: string | null,
): { header: HTMLElement; statusIcon: HTMLElement } {
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px 16px 10px;';

  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.style.cssText = 'width:36px;height:36px;object-fit:contain;image-rendering:pixelated;border-radius:6px;';
    header.appendChild(img);
  }

  const headerText = document.createElement('div');
  headerText.style.cssText = 'flex:1;min-width:0;';

  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'font-size:15px;font-weight:700;color:#e8e0ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  nameEl.textContent = itemName;
  headerText.appendChild(nameEl);

  const catBadge = document.createElement('span');
  catBadge.style.cssText = [
    'display:inline-block', 'margin-top:3px',
    'font-size:10px', 'font-weight:600',
    'padding:1px 8px', 'border-radius:10px',
    'color:#a78bfa',
    'background:rgba(143,130,255,0.12)',
    'border:1px solid rgba(143,130,255,0.2)',
    'text-transform:uppercase', 'letter-spacing:0.4px',
  ].join(';');
  catBadge.textContent = shopLabel(shopType);
  headerText.appendChild(catBadge);
  header.appendChild(headerText);

  const statusIcon = document.createElement('div');
  statusIcon.style.cssText = 'font-size:20px;flex-shrink:0;';
  header.appendChild(statusIcon);

  return { header, statusIcon };
}

// ── Overview card ────────────────────────────────────────────────────────────

interface OverviewHandle {
  container: HTMLElement;
  setEventCount: (count: number, totalSightings?: number) => void;
  setModelAccuracy: (score: number, avgErrorMs?: number, predictionCount?: number, detailTitle?: string) => void;
  setLastSeen: (timestamp: number | null) => void;
  browseBtn: HTMLButtonElement;
}

function buildOverviewCard(
  itemName: string,
  shopType: string,
  item: RestockItem,
  spriteUrl: string | null,
): OverviewHandle {
  const card = document.createElement('div');
  card.style.cssText = CARD_STYLE;

  const { header, statusIcon } = makeCardHeader(itemName, shopType, spriteUrl);
  const prob = getItemProbability(item);
  if (prob != null && prob >= 0.5) {
    statusIcon.textContent = '\u{1F525}';
    statusIcon.title = t('feature.itemDetail.highProbability');
  } else {
    statusIcon.textContent = '\u{1F4CA}';
    statusIcon.title = t('feature.itemDetail.overview');
  }
  card.appendChild(header);

  // Stats chips
  const statsRow = document.createElement('div');
  statsRow.style.cssText = 'display:flex;border-top:1px solid rgba(143,130,255,0.12);border-bottom:1px solid rgba(143,130,255,0.12);';

  const makeChip = (value: string, label: string, color = '#e8e0ff'): HTMLElement => {
    const chip = document.createElement('div');
    chip.style.cssText = [
      'flex:1', 'display:flex', 'flex-direction:column', 'align-items:center',
      'padding:10px 6px', 'gap:2px', 'min-width:0', 'overflow:hidden',
      'border-right:1px solid rgba(143,130,255,0.08)',
    ].join(';');
    const v = document.createElement('div');
    v.style.cssText = `font-size:15px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;white-space:nowrap;`;
    v.textContent = value;
    const l = document.createElement('div');
    l.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:0.55px;color:rgba(224,224,224,0.32);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;';
    l.textContent = label;
    chip.append(v, l);
    return chip;
  };

  const eventCountChip = makeChip(String(item.total_occurrences ?? 0), t('feature.itemDetail.sightings'));
  statsRow.appendChild(eventCountChip);
  if (item.median_interval_ms != null) {
    let medianLabel = t('feature.itemDetail.median');
    if (item.recent_intervals_ms && item.recent_intervals_ms.length >= 5) {
      const ci = getConfidenceInterval(item.recent_intervals_ms, 0.80);
      if (ci) {
        medianLabel = t('feature.itemDetail.medianWithCI', { low: fmtDuration(ci[0]), high: fmtDuration(ci[1]) });
      }
    }
    // Weather-conditional median when >= 3 intervals for current weather
    const weatherEta = computeWeatherConditionalMedian(item);
    if (weatherEta) {
      medianLabel += ` ${t('feature.itemDetail.weatherMedian', { duration: fmtDuration(weatherEta.median), weather: weatherEta.weather })}`;
    }
    statsRow.appendChild(makeChip(fmtDuration(item.median_interval_ms), medianLabel, '#a78bfa'));
  }
  if (item.ema_interval_ms != null && item.median_interval_ms != null) {
    const trendPct = Math.round(((item.ema_interval_ms - item.median_interval_ms) / item.median_interval_ms) * 100);
    if (Math.abs(trendPct) >= 5) {
      const trendLabel = trendPct > 0 ? `+${trendPct}% trend` : `${trendPct}% trend`;
      const trendColor = trendPct > 0 ? 'rgba(251,191,36,0.85)' : 'rgba(74,222,128,0.85)';
      statsRow.appendChild(makeChip(fmtDuration(item.ema_interval_ms), t('feature.itemDetail.emaTrend', { trend: trendLabel }), trendColor));
    }
  }
  if (item.average_quantity != null && item.average_quantity > 0) {
    const qty = item.average_quantity >= 10
      ? `~${Math.round(item.average_quantity)}`
      : `~${item.average_quantity.toFixed(1)}`;
    statsRow.appendChild(makeChip(qty, t('feature.itemDetail.avgQty')));
  }
  const lastChip = statsRow.lastElementChild as HTMLElement | null;
  if (lastChip) lastChip.style.borderRight = 'none';
  card.appendChild(statsRow);

  // Prediction + last seen section
  const infoSection = document.createElement('div');
  infoSection.style.cssText = 'padding:12px 16px;display:flex;flex-direction:column;gap:8px;';

  // Last seen
  const lastSeenRow = document.createElement('div');
  lastSeenRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
  const lastSeenLabel = document.createElement('span');
  lastSeenLabel.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);';
  lastSeenLabel.textContent = t('feature.itemDetail.lastSeen');
  const lastSeenValue = document.createElement('span');
  lastSeenValue.style.cssText = 'font-size:13px;font-weight:600;color:#e8e0ff;';
  const setLastSeen = (timestamp: number | null): void => {
    lastSeenValue.textContent = timestamp ? fmtRelative(timestamp) : t('feature.itemDetail.never');
    lastSeenValue.title = timestamp ? fmtAbsoluteWithZone(timestamp) : t('feature.itemDetail.neverSeen');
  };
  setLastSeen(item.last_seen ?? null);
  lastSeenRow.append(lastSeenLabel, lastSeenValue);
  infoSection.appendChild(lastSeenRow);

  // Next estimated
  const nextRow = document.createElement('div');
  nextRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
  const nextLabel = document.createElement('span');
  nextLabel.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);';
  nextLabel.textContent = t('feature.itemDetail.nextEstimated');
  const nextValue = document.createElement('span');
  const isOverdue = item.estimated_next_timestamp != null && item.estimated_next_timestamp <= Date.now();
  nextValue.style.cssText = `font-size:13px;font-weight:600;color:${isOverdue ? '#4ade80' : '#e8e0ff'};`;
  nextValue.textContent = item.estimated_next_timestamp
    ? fmtCountdown(item.estimated_next_timestamp)
    : '\u2014';
  nextRow.append(nextLabel, nextValue);
  infoSection.appendChild(nextRow);

  // Current probability bar
  if (prob != null) {
    const probRow = document.createElement('div');
    probRow.style.cssText = 'margin-top:4px;';
    const probHeader = document.createElement('div');
    probHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;';
    const probLabel = document.createElement('span');
    probLabel.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);';
    probLabel.textContent = t('feature.itemDetail.currentProbability');
    const probValue = document.createElement('span');
    probValue.style.cssText = [
      'font-size:18px', 'font-weight:800',
      'background:linear-gradient(to right, #8f82ff, #f0abfc)',
      '-webkit-background-clip:text', '-webkit-text-fill-color:transparent',
      'background-clip:text',
    ].join(';');
    probValue.textContent = fmtPercent(prob);
    probHeader.append(probLabel, probValue);
    probRow.appendChild(probHeader);

    const barTrack = document.createElement('div');
    barTrack.style.cssText = 'width:100%;height:8px;border-radius:4px;background:rgba(143,130,255,0.12);overflow:hidden;';
    const barFill = document.createElement('div');
    barFill.style.cssText = `height:100%;border-radius:4px;background:linear-gradient(to right, #8f82ff, #f0abfc);width:${Math.round(prob * 100)}%;`;
    barTrack.appendChild(barFill);
    probRow.appendChild(barTrack);
    infoSection.appendChild(probRow);
  }

  // Prediction decomposition (collapsible)
  if (item.empirical_weight != null) {
    const decompRow = document.createElement('div');
    decompRow.style.cssText = 'margin-top:8px;';

    const decompToggle = document.createElement('button');
    decompToggle.type = 'button';
    decompToggle.style.cssText = [
      'display:flex', 'align-items:center', 'gap:6px', 'width:100%',
      'background:none', 'border:none', 'cursor:pointer', 'padding:0',
      'font-size:11px', 'font-weight:600', 'color:rgba(232,224,255,0.5)',
      'text-transform:uppercase', 'letter-spacing:0.3px',
    ].join(';');
    decompToggle.textContent = '\u25B6 ' + t('feature.itemDetail.predictionDetails');

    const decompContent = document.createElement('div');
    decompContent.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;border-radius:8px;background:rgba(143,130,255,0.04);border:1px solid rgba(143,130,255,0.10);';
    let decompOpen = false;
    decompToggle.addEventListener('click', () => {
      decompOpen = !decompOpen;
      decompContent.style.display = decompOpen ? '' : 'none';
      decompToggle.textContent = `${decompOpen ? '\u25BC' : '\u25B6'} ${t('feature.itemDetail.predictionDetails')}`;
    });

    const decompGrid = document.createElement('div');
    decompGrid.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:3px 12px;font-size:12px;';

    const addDecompLine = (label: string, value: string, color = '#e8e0ff'): void => {
      const lbl = document.createElement('span');
      lbl.style.cssText = 'color:rgba(232,224,255,0.5);';
      lbl.textContent = label;
      const val = document.createElement('span');
      val.style.cssText = `font-weight:600;color:${color};text-align:right;font-variant-numeric:tabular-nums;`;
      val.textContent = value;
      decompGrid.append(lbl, val);
    };

    if (item.fallback_rate != null) {
      const ratePct = (item.fallback_rate * 100).toFixed(2);
      const oneIn = item.fallback_rate > 0 ? Math.round(1 / item.fallback_rate) : 0;
      addDecompLine(t('feature.itemDetail.baseRate'), oneIn > 0 ? t('feature.itemDetail.baseRateOneIn', { pct: ratePct, oneIn }) : `${ratePct}%`);
    }
    if (item.empirical_probability != null) {
      addDecompLine(t('feature.itemDetail.empirical'), t('feature.itemDetail.pctConditional', { pct: (item.empirical_probability * 100).toFixed(2) }));
    }
    if (item.empirical_weight != null) {
      addDecompLine(t('feature.itemDetail.blendWeight'), t('feature.itemDetail.pctEmpirical', { pct: Math.round(item.empirical_weight * 100) }));
    }
    if (prob != null) {
      addDecompLine(t('feature.itemDetail.finalProbability'), fmtPercent(prob), '#a78bfa');
    }

    decompContent.appendChild(decompGrid);
    decompRow.append(decompToggle, decompContent);
    infoSection.appendChild(decompRow);
  }

  // Interval distribution histogram
  if (item.recent_intervals_ms && item.recent_intervals_ms.length >= 2) {
    const histRow = document.createElement('div');
    histRow.style.cssText = 'margin-top:8px;';

    const histLabel = document.createElement('div');
    histLabel.style.cssText = 'font-size:11px;font-weight:600;color:rgba(232,224,255,0.5);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:6px;';
    histLabel.textContent = t('feature.itemDetail.intervalDistribution');
    histRow.appendChild(histLabel);

    const intervals = item.recent_intervals_ms;
    const bucketCount = Math.min(12, Math.max(5, Math.ceil(intervals.length / 3)));
    const minVal = Math.min(...intervals);
    const maxVal = Math.max(...intervals);
    const range = maxVal - minVal;

    if (range > 0) {
      const bucketSize = range / bucketCount;
      const buckets = new Array<number>(bucketCount).fill(0);
      for (const val of intervals) {
        const idx = Math.min(Math.floor((val - minVal) / bucketSize), bucketCount - 1);
        buckets[idx] = (buckets[idx] ?? 0) + 1;
      }
      const maxBucket = Math.max(...buckets);

      const histContainer = document.createElement('div');
      histContainer.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:32px;padding:0 2px;';

      const medianVal = item.median_interval_ms ?? 0;
      const medianBucket = range > 0 ? Math.min(Math.floor((medianVal - minVal) / bucketSize), bucketCount - 1) : -1;

      for (let i = 0; i < bucketCount; i++) {
        const bar = document.createElement('div');
        const heightPct = maxBucket > 0 ? Math.max(4, Math.round((buckets[i]! / maxBucket) * 100)) : 4;
        const isMedian = i === medianBucket;
        bar.style.cssText = [
          'flex:1',
          `height:${heightPct}%`,
          'border-radius:2px 2px 0 0',
          `background:${isMedian ? '#a78bfa' : 'rgba(143,130,255,0.25)'}`,
          'transition:height 0.2s',
          'min-width:4px',
        ].join(';');
        const bucketStart = minVal + i * bucketSize;
        const bucketEnd = bucketStart + bucketSize;
        bar.title = `${fmtDuration(bucketStart)}\u2013${fmtDuration(bucketEnd)}: ${buckets[i]!} interval${buckets[i] !== 1 ? 's' : ''}${isMedian ? ' (median)' : ''}`;
        histContainer.appendChild(bar);
      }

      histRow.appendChild(histContainer);

      // Range labels
      const rangeRow = document.createElement('div');
      rangeRow.style.cssText = 'display:flex;justify-content:space-between;font-size:9px;color:rgba(232,224,255,0.3);margin-top:2px;';
      const minLabel = document.createElement('span');
      minLabel.textContent = fmtDuration(minVal);
      const maxLabel = document.createElement('span');
      maxLabel.textContent = fmtDuration(maxVal);
      rangeRow.append(minLabel, maxLabel);
      histRow.appendChild(rangeRow);
    } else {
      const uniformNote = document.createElement('div');
      uniformNote.style.cssText = 'font-size:11px;color:rgba(232,224,255,0.3);';
      uniformNote.textContent = t('feature.itemDetail.allIntervals', { count: intervals.length, duration: fmtDuration(minVal) });
      histRow.appendChild(uniformNote);
    }

    infoSection.appendChild(histRow);
  }

  const modelAccuracyRow = document.createElement('div');
  modelAccuracyRow.style.cssText = 'margin-top:4px;display:none;';
  const modelAccuracyHeader = document.createElement('div');
  modelAccuracyHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;';
  const modelAccuracyLabel = document.createElement('span');
  modelAccuracyLabel.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);';
  modelAccuracyLabel.textContent = t('feature.itemDetail.predictionAccuracy');
  const modelAccuracyValue = document.createElement('span');
  modelAccuracyValue.style.cssText = 'font-size:16px;font-weight:700;color:#e8e0ff;';
  modelAccuracyHeader.append(modelAccuracyLabel, modelAccuracyValue);
  modelAccuracyRow.appendChild(modelAccuracyHeader);

  const modelAccBarTrack = document.createElement('div');
  modelAccBarTrack.style.cssText = 'width:100%;height:6px;border-radius:3px;background:rgba(143,130,255,0.12);overflow:hidden;';
  const modelAccBarFill = document.createElement('div');
  modelAccBarFill.style.cssText = 'height:100%;border-radius:3px;transition:width 0.3s ease;';
  modelAccBarTrack.appendChild(modelAccBarFill);
  modelAccuracyRow.appendChild(modelAccBarTrack);
  const modelAccContext = document.createElement('div');
  modelAccContext.style.cssText = 'font-size:10px;color:rgba(232,224,255,0.35);margin-top:4px;display:none;';
  modelAccuracyRow.appendChild(modelAccContext);
  infoSection.appendChild(modelAccuracyRow);
  card.appendChild(infoSection);

  // Browse events button
  const btnWrap = document.createElement('div');
  btnWrap.style.cssText = 'padding:0 16px 14px;';
  const browseBtn = document.createElement('button');
  browseBtn.type = 'button';
  browseBtn.textContent = t('feature.itemDetail.loadingEvents');
  browseBtn.disabled = true;
  browseBtn.style.cssText = [
    'display:block', 'width:100%', 'padding:9px',
    'font-size:13px', 'font-weight:600', 'cursor:pointer',
    'background:rgba(143,130,255,0.12)',
    'border:1px solid rgba(143,130,255,0.3)',
    'border-radius:8px', 'color:#c8c0ff',
    'transition:background 0.15s',
    'opacity:0.6',
  ].join(';');
  browseBtn.addEventListener('mouseenter', () => {
    if (!browseBtn.disabled) browseBtn.style.background = 'rgba(143,130,255,0.22)';
  });
  browseBtn.addEventListener('mouseleave', () => {
    browseBtn.style.background = 'rgba(143,130,255,0.12)';
  });
  btnWrap.appendChild(browseBtn);
  card.appendChild(btnWrap);

  return {
    container: card,
    setEventCount: (count: number, totalSightings?: number) => {
      browseBtn.disabled = count === 0;
      browseBtn.style.opacity = count === 0 ? '0.4' : '1';
      browseBtn.style.cursor = count === 0 ? 'default' : 'pointer';
      browseBtn.textContent = count > 0
        ? (count === 1 ? t('feature.itemDetail.browseEvent', { count }) : t('feature.itemDetail.browseEvents', { count }))
        : t('feature.itemDetail.noEventsRecorded');
      const chipValue = eventCountChip.firstElementChild as HTMLElement | null;
      if (chipValue) chipValue.textContent = String(totalSightings ?? count);
    },
    setModelAccuracy: (score: number, avgErrorMs?: number, predictionCount?: number, detailTitle?: string) => {
      modelAccuracyRow.style.display = '';
      modelAccuracyRow.title = detailTitle ?? '';
      const capped = Math.min(99, Math.round(score));
      modelAccuracyValue.textContent = `${capped}%`;
      const color = capped >= 70 ? '#4ade80' : capped >= 40 ? '#fbbf24' : '#f87171';
      modelAccBarFill.style.width = `${capped}%`;
      modelAccBarFill.style.background = color;
      modelAccuracyValue.style.color = color;
      if (avgErrorMs != null && predictionCount != null) {
        modelAccContext.style.display = '';
        modelAccContext.textContent = t('feature.itemDetail.accuracyContext', {
          duration: fmtDuration(avgErrorMs),
          count: predictionCount,
        });
      }
    },
    setLastSeen,
    browseBtn,
  };
}

// ── Event accuracy card ──────────────────────────────────────────────────────

interface EventCardHandle {
  container: HTMLElement;
  update: (index: number) => void;
}

function buildEventCard(
  itemName: string,
  shopType: string,
  rows: RowData[],
  medianMs: number | null,
  intervals: number[] | null,
  spriteUrl: string | null,
  onNavigate: (index: number) => void,
  onBack: () => void,
): EventCardHandle {
  const card = document.createElement('div');
  card.style.cssText = CARD_STYLE;

  const { header, statusIcon } = makeCardHeader(itemName, shopType, spriteUrl);
  card.appendChild(header);

  // Score section
  const scoreSection = document.createElement('div');
  scoreSection.style.cssText = 'padding:0 16px 12px;';

  const scoreRow = document.createElement('div');
  scoreRow.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;';
  const scoreLabel = document.createElement('span');
  scoreLabel.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);font-weight:600;';
  scoreLabel.textContent = t('feature.itemDetail.predictionAccuracy');
  const scoreValue = document.createElement('span');
  scoreValue.style.cssText = [
    'font-size:20px', 'font-weight:800',
    'background:linear-gradient(to right, #8f82ff, #f0abfc)',
    '-webkit-background-clip:text', '-webkit-text-fill-color:transparent',
    'background-clip:text',
    'font-variant-numeric:tabular-nums',
  ].join(';');
  scoreRow.append(scoreLabel, scoreValue);
  scoreSection.appendChild(scoreRow);

  const barTrack = document.createElement('div');
  barTrack.style.cssText = 'width:100%;height:8px;border-radius:4px;background:rgba(143,130,255,0.12);overflow:hidden;';
  const barFill = document.createElement('div');
  barFill.style.cssText = 'height:100%;border-radius:4px;background:linear-gradient(to right, #8f82ff, #f0abfc);transition:width 0.3s ease;';
  barTrack.appendChild(barFill);
  scoreSection.appendChild(barTrack);
  card.appendChild(scoreSection);

  // Time comparison
  const timeSection = document.createElement('div');
  timeSection.style.cssText = 'padding:0 16px 12px;display:flex;flex-direction:column;gap:8px;';

  const makeTimeBox = (labelText: string, iconChar: string, color: string, bgColor: string): { box: HTMLElement; valueEl: HTMLElement; labelEl: HTMLElement } => {
    const box = document.createElement('div');
    box.style.cssText = `border-radius:8px;border:1px solid ${color}30;background:${bgColor};padding:10px 12px;`;
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    const icon = document.createElement('span');
    icon.style.cssText = `font-size:12px;color:${color};`;
    icon.textContent = iconChar;
    const lbl = document.createElement('span');
    lbl.style.cssText = `font-size:11px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.3px;`;
    lbl.textContent = labelText;
    topRow.append(icon, lbl);
    const valueEl = document.createElement('div');
    valueEl.style.cssText = 'font-size:13px;font-weight:600;color:#e8e0ff;font-variant-numeric:tabular-nums;';
    box.append(topRow, valueEl);
    return { box, valueEl, labelEl: lbl };
  };

  const estimated = makeTimeBox(t('feature.itemDetail.estimatedRestock'), '\u{1F52E}', '#a78bfa', 'rgba(143,130,255,0.06)');
  const actual    = makeTimeBox(t('feature.itemDetail.actualRestock'), '\u{1F4CD}', '#f0abfc', 'rgba(255,143,230,0.06)');
  timeSection.append(estimated.box, actual.box);
  card.appendChild(timeSection);

  // Status + diff
  const statusSection = document.createElement('div');
  statusSection.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid rgba(143,130,255,0.12);';

  const statusBadge = document.createElement('span');
  statusBadge.style.cssText = 'font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;';

  const diffText = document.createElement('span');
  diffText.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.6);font-variant-numeric:tabular-nums;';

  statusSection.append(statusBadge, diffText);
  card.appendChild(statusSection);

  // Navigation
  const navSection = document.createElement('div');
  navSection.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 16px 12px;border-top:1px solid rgba(143,130,255,0.08);';

  const makeNavBtn = (text: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = [
      'padding:4px 12px', 'font-size:12px', 'font-weight:600',
      'border-radius:6px', 'cursor:pointer',
      'background:rgba(143,130,255,0.10)',
      'border:1px solid rgba(143,130,255,0.2)',
      'color:#c8c0ff', 'transition:background 0.15s',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(143,130,255,0.20)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(143,130,255,0.10)'; });
    return btn;
  };

  const prevBtn = makeNavBtn('\u25C0 ' + t('feature.itemDetail.prev'));
  const nextBtn = makeNavBtn(t('feature.itemDetail.nextNav') + ' \u25B6');
  const counter = document.createElement('span');
  counter.style.cssText = 'font-size:12px;color:rgba(232,224,255,0.5);font-variant-numeric:tabular-nums;min-width:60px;text-align:center;';

  let currentIndex = 0;

  prevBtn.addEventListener('click', () => {
    if (currentIndex < rows.length - 1) {
      update(currentIndex + 1);
      onNavigate(currentIndex);
    }
  });
  nextBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
      update(currentIndex - 1);
      onNavigate(currentIndex);
    }
  });

  navSection.append(prevBtn, counter, nextBtn);
  card.appendChild(navSection);

  // Back to overview link
  const backRow = document.createElement('div');
  backRow.style.cssText = 'text-align:center;padding:0 16px 10px;';
  const backLink = document.createElement('button');
  backLink.type = 'button';
  backLink.textContent = '\u2190 ' + t('feature.itemDetail.backToOverview');
  backLink.style.cssText = [
    'background:none', 'border:none', 'cursor:pointer',
    'font-size:11px', 'color:rgba(200,192,255,0.55)',
    'text-decoration:underline', 'text-underline-offset:2px',
  ].join(';');
  backLink.addEventListener('mouseenter', () => { backLink.style.color = '#c8c0ff'; });
  backLink.addEventListener('mouseleave', () => { backLink.style.color = 'rgba(200,192,255,0.55)'; });
  backLink.addEventListener('click', onBack);
  backRow.appendChild(backLink);
  card.appendChild(backRow);

  function update(index: number): void {
    currentIndex = index;
    const row = rows[index]!;
    const prevRow = index + 1 < rows.length ? rows[index + 1]! : null;
    const acc = computeRowEventAccuracy(row, prevRow, medianMs, intervals);
    const cfg = getStatusConfig()[acc.status];
    const hasLoggedPrediction = row.predicted_next_ms != null;

    statusIcon.textContent = cfg.icon;
    statusIcon.style.color = cfg.color;
    scoreLabel.textContent = hasLoggedPrediction ? t('feature.itemDetail.predictionAccuracy') : t('feature.itemDetail.gapConsistency');

    if (acc.status === 'first') {
      scoreValue.textContent = '\u2014';
      barFill.style.width = '0%';
    } else {
      const capped = Math.min(99, Math.round(acc.score));
      scoreValue.textContent = `${capped}%`;
      barFill.style.width = `${capped}%`;
    }

    if (acc.status === 'first') {
      estimated.labelEl.textContent = t('feature.itemDetail.estimatedRestock');
      estimated.valueEl.textContent = '\u2014';
      estimated.valueEl.style.color = 'rgba(232,224,255,0.3)';
      actual.valueEl.textContent = fmtTimestamp(acc.actualTs);
      actual.valueEl.style.color = '#e8e0ff';
    } else {
      estimated.labelEl.textContent = hasLoggedPrediction ? t('feature.itemDetail.predictedRestock') : t('feature.itemDetail.medianEstimate');
      estimated.valueEl.textContent = acc.estimatedTs != null ? fmtTimestamp(acc.estimatedTs) : '\u2014';
      estimated.valueEl.style.color = '#e8e0ff';
      actual.valueEl.textContent = fmtTimestamp(acc.actualTs);
      actual.valueEl.style.color = '#e8e0ff';
    }

    statusBadge.textContent = `${cfg.icon}  ${cfg.label}`;
    statusBadge.style.color = cfg.color;
    statusBadge.style.background = cfg.bg;
    statusBadge.style.border = `1px solid ${cfg.color}30`;

    if (acc.status === 'first') {
      diffText.textContent = t('feature.itemDetail.firstRecorded');
    } else {
      const absDiff = Math.abs(acc.diffMs);
      const dir = acc.diffMs < 0 ? 'early' : acc.diffMs > 0 ? 'late' : 'exact';
      diffText.textContent = dir === 'exact'
        ? t('feature.itemDetail.exactMatch')
        : dir === 'early'
          ? t('feature.itemDetail.durationEarly', { duration: fmtDuration(absDiff) })
          : t('feature.itemDetail.durationLate', { duration: fmtDuration(absDiff) });
    }

    counter.textContent = t('feature.itemDetail.counterOf', { current: index + 1, total: rows.length });
    prevBtn.disabled = index >= rows.length - 1;
    nextBtn.disabled = index <= 0;
    prevBtn.style.opacity = prevBtn.disabled ? '0.3' : '1';
    nextBtn.style.opacity = nextBtn.disabled ? '0.3' : '1';
    prevBtn.style.cursor = prevBtn.disabled ? 'default' : 'pointer';
    nextBtn.style.cursor = nextBtn.disabled ? 'default' : 'pointer';
  }

  return { container: card, update };
}

// ── Row element ──────────────────────────────────────────────────────────────

function makeRowEl(
  row: RowData,
  prevRow: RowData | null,
  index: number,
  medianMs: number | null,
  intervals: number[] | null,
  onClick: (i: number) => void,
): HTMLElement {
  const acc = computeRowEventAccuracy(row, prevRow, medianMs, intervals);
  const { color, pill } = acc.status === 'first'
    ? { color: TIER_COLOR.none, pill: '' }
    : acc.status === 'accurate'
      ? { color: TIER_COLOR.good, pill: '\u2713 ' + t('feature.itemDetail.onTime') }
      : {
          color: Math.abs(acc.diffMs) <= getAccuracyWindows(medianMs, intervals).warnMs
            ? TIER_COLOR.warn
            : TIER_COLOR.bad,
          pill: acc.diffMs < 0 ? t('feature.itemDetail.durationEarly', { duration: fmtDuration(acc.diffMs) }) : t('feature.itemDetail.durationLate', { duration: fmtDuration(acc.diffMs) }),
        };
  const rowAccuracy = acc.status === 'first' ? null : acc.score;

  const el = document.createElement('div');
  el.style.cssText = [
    'display:grid',
    'grid-template-columns:1fr 76px 96px',
    'align-items:center',
    `border-left:3px solid ${color}`,
    'padding:7px 10px 7px 11px',
    'border-radius:0 6px 6px 0',
    'margin-bottom:2px',
    'cursor:pointer',
    'transition:background 0.15s',
  ].join(';');
  el.addEventListener('mouseenter', () => {
    if (!el.dataset.active) el.style.background = 'rgba(143,130,255,0.08)';
  });
  el.addEventListener('mouseleave', () => {
    if (!el.dataset.active) el.style.background = '';
  });
  el.addEventListener('click', () => onClick(index));

  const tsEl = document.createElement('span');
  tsEl.style.cssText = 'font-size:12px;font-variant-numeric:tabular-nums;color:rgba(232,224,255,0.50);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  tsEl.textContent = fmtTimestamp(row.timestamp);
  el.appendChild(tsEl);

  const gapEl = document.createElement('span');
  gapEl.style.cssText = 'font-size:13px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;';
  if (rowAccuracy !== null) {
    gapEl.style.color = color;
    gapEl.textContent = `${Math.min(99, Math.round(rowAccuracy))}%`;
  } else {
    gapEl.style.color = 'rgba(232,224,255,0.18)';
    gapEl.textContent = '\u2014';
  }
  el.appendChild(gapEl);

  const pillCell = document.createElement('div');
  pillCell.style.cssText = 'display:flex;justify-content:flex-end;min-width:0;';
  if (pill) {
    const badge = document.createElement('span');
    badge.style.cssText = [
      `color:${color}`,
      `background:${color}14`,
      `border:1px solid ${color}38`,
      'font-size:10px', 'font-weight:600',
      'padding:2px 7px', 'border-radius:20px',
      'white-space:nowrap', 'font-variant-numeric:tabular-nums',
    ].join(';');
    badge.textContent = pill;
    pillCell.appendChild(badge);
  }
  el.appendChild(pillCell);

  return el;
}

// ── Public entry ─────────────────────────────────────────────────────────────

export function openItemRestockDetail(item: RestockItem, itemName: string): void {
  if (!detailScaleLegacyCleared) {
    // Old manual scale controls were removed; clear any stale persisted value once.
    storage.remove(DETAIL_WINDOW_SCALE_KEY);
    detailScaleLegacyCleared = true;
  }

  const shopType = item.shop_type;
  if (!isDetailShopType(shopType)) return;

  const canonicalId = canonicalItemId(shopType, item.item_id);
  const safeItemName = itemName.trim() || canonicalId;
  const selectedItem = resolveDetailRestockItem(shopType, canonicalId, item);

  rememberDetailWindow(shopType, canonicalId, safeItemName);
  registerDetailWindowOpener(shopType, canonicalId, safeItemName);

  const winId = getDetailWindowId(shopType, canonicalId);
  destroyWindow(winId);

  openWindow(winId, `${safeItemName} \u2014 ${t('feature.itemDetail.restockHistory')}`, (root) => {
    root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
    const item = selectedItem;

    const contentViewport = document.createElement('div');
    contentViewport.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;';
    root.appendChild(contentViewport);

    const contentRoot = document.createElement('div');
    contentRoot.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;transform-origin:top left;will-change:transform;';
    contentViewport.appendChild(contentRoot);

    const manualScale = DETAIL_WINDOW_SCALE_DEFAULT;
    let linkedScaleFactor = 1;
    let baseViewportWidth: number | null = null;
    let baseViewportHeight: number | null = null;
    const hostWindow = root.closest('.qpm-window') as HTMLElement | null;

    const renderScale = (): void => {
      let effectiveScale = clampDetailScale(manualScale * linkedScaleFactor);

      const applyScale = (scale: number): void => {
        contentRoot.style.transform = `scale(${scale.toFixed(3)})`;
        contentRoot.style.width = `${(100 / scale).toFixed(3)}%`;
      };

      applyScale(effectiveScale);

      // Safety correction: if scaled content still overflows horizontally, shrink further.
      const viewportRect = contentViewport.getBoundingClientRect();
      const visualRect = contentRoot.getBoundingClientRect();
      if (viewportRect.width > 0 && visualRect.width > viewportRect.width + 1) {
        const ratio = viewportRect.width / visualRect.width;
        if (Number.isFinite(ratio) && ratio > 0) {
          effectiveScale = clampDetailScale(effectiveScale * ratio);
          applyScale(effectiveScale);
        }
      }
    };

    const updateLinkedScaleFromWindow = (): void => {
      const viewportWidth = contentViewport.clientWidth;
      const viewportHeight = contentViewport.clientHeight;
      if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) return;
      if (baseViewportWidth == null || baseViewportHeight == null) {
        baseViewportWidth = viewportWidth;
        baseViewportHeight = viewportHeight;
        linkedScaleFactor = 1;
        renderScale();
        return;
      }
      const widthRatio = viewportWidth / baseViewportWidth;
      const heightRatio = viewportHeight / baseViewportHeight;
      if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) return;
      // Use the tighter dimension so content always scales down enough to fit.
      linkedScaleFactor = Math.min(widthRatio, heightRatio);
      renderScale();
    };

    let resizeObserver: ResizeObserver | null = null;
    let detachObserver: MutationObserver | null = null;
    if (hostWindow && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateLinkedScaleFromWindow();
      });
      resizeObserver.observe(hostWindow);
      resizeObserver.observe(contentViewport);
      updateLinkedScaleFromWindow();

      detachObserver = new MutationObserver(() => {
        if (root.isConnected) return;
        resizeObserver?.disconnect();
        detachObserver?.disconnect();
        resizeObserver = null;
        detachObserver = null;
      });
      detachObserver.observe(document.body, { childList: true, subtree: true });
    } else {
      renderScale();
    }

    const spriteUrl = getItemSpriteUrl(item.shop_type, item.item_id);
    const medianMs = item.median_interval_ms;
    const itemIntervals = item.recent_intervals_ms ?? null;
    const algorithmUpdatedAtMs = normalizeEpochMs(item.algorithm_updated_at);

    // ── Overview card (shown immediately with RestockItem data) ──
    const overview = buildOverviewCard(safeItemName, item.shop_type, item, spriteUrl);
    contentRoot.appendChild(overview.container);

    // ── Placeholder for event card (hidden initially) ──
    let eventCard: EventCardHandle | null = null;
    let eventCardEl: HTMLElement | null = null;

    // ── Event list container (populated after fetch) ──
    const eventListSection = document.createElement('div');
    eventListSection.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;';

    const spinner = document.createElement('div');
    spinner.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:20px;font-size:12px;color:rgba(224,224,224,0.4);';
    spinner.textContent = '\u23F3 ' + t('feature.itemDetail.loadingEvents');
    eventListSection.appendChild(spinner);
    contentRoot.appendChild(eventListSection);
    updateLinkedScaleFromWindow();

    // ── Shared state ──
    let rows: RowData[] = [];
    const rowElements: HTMLElement[] = [];
    let activeRowIndex = -1;

    function setActiveRow(index: number): void {
      const prev = rowElements[activeRowIndex];
      if (prev) {
        delete prev.dataset.active;
        prev.style.background = '';
      }
      activeRowIndex = index;
      const next = rowElements[index];
      if (next) {
        next.dataset.active = '1';
        next.style.background = 'rgba(143,130,255,0.10)';
        next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    function showOverview(): void {
      overview.container.style.display = '';
      if (eventCardEl) eventCardEl.style.display = 'none';
      setActiveRow(-1);
    }

    function showEventCard(index: number): void {
      if (!eventCard || !eventCardEl || rows.length === 0) return;
      overview.container.style.display = 'none';
      eventCardEl.style.display = '';
      eventCard.update(index);
      setActiveRow(index);
    }

    // ── Fetch events + algorithm history ──
    void (async () => {
      let events: Awaited<ReturnType<typeof fetchItemEvents>> = [];
      let algoHistory: AlgorithmVersionEntry[] = [];
      let modelAccuracyAggregate: Awaited<ReturnType<typeof fetchRestockPredictionAccuracyAggregate>> = null;
      try {
        [events, algoHistory, modelAccuracyAggregate] = await Promise.all([
          fetchItemEvents(item.shop_type, item.item_id).catch(() => [] as Awaited<ReturnType<typeof fetchItemEvents>>),
          fetchAlgorithmHistory().catch(() => [] as AlgorithmVersionEntry[]),
          fetchRestockPredictionAccuracyAggregate(item.shop_type, item.item_id).catch(() => null),
        ]);
      } catch {
        /* network error — both stay [] */
      }

      if (!eventListSection.contains(spinner)) return; // window closed
      eventListSection.removeChild(spinner);
      const aggregateModelMetric = aggregateModelAccuracyMetric(modelAccuracyAggregate, medianMs, itemIntervals);
      if (aggregateModelMetric) {
        overview.setModelAccuracy(aggregateModelMetric.score, aggregateModelMetric.avgErrorMs, aggregateModelMetric.count, aggregateModelMetric.title);
      }

      if (!events.length) {
        overview.setEventCount(0);
        const empty = document.createElement('div');
        empty.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:24px;font-size:12px;color:rgba(224,224,224,0.35);';
        empty.textContent = t('feature.itemDetail.noEventHistory');
        eventListSection.appendChild(empty);
        updateLinkedScaleFromWindow();
        return;
      }

      const normalizedEvents = events
        .map((ev) => {
          const ts = normalizeEpochMs(ev.timestamp);
          if (ts == null) return null;
          return {
            timestamp: ts,
            quantity: ev.quantity,
            predicted_next_ms: normalizeEpochMs(ev.predicted_next_ms),
          };
        })
        .filter((ev): ev is { timestamp: number; quantity: number | null; predicted_next_ms: number | null } => ev !== null);
      const orderedEvents = sortEventsNewestFirst(normalizedEvents);
      overview.setEventCount(orderedEvents.length, item.total_occurrences ?? undefined);

      rows = orderedEvents.map((ev, i): RowData => {
        const prev    = i + 1 < orderedEvents.length ? orderedEvents[i + 1]! : null;
        const gapMs   = prev !== null ? ev.timestamp - prev.timestamp : null;
        const errorMs = (gapMs !== null && medianMs != null) ? gapMs - medianMs : null;
        return {
          timestamp: ev.timestamp,
          quantity: ev.quantity,
          predicted_next_ms: ev.predicted_next_ms,
          gapMs,
          errorMs,
        };
      });

      const latestEventTs = rows[0]?.timestamp ?? null;
      if (latestEventTs != null) {
        if ((item.last_seen ?? 0) < latestEventTs) {
          item.last_seen = latestEventTs;
          patchCachedItemLastSeen(item.shop_type, item.item_id, latestEventTs);
        }
        overview.setLastSeen(item.last_seen ?? latestEventTs);
      }

      if (!aggregateModelMetric) {
        const modelResults = rows
          .map((row, i) => {
            if (row.predicted_next_ms == null) return null;
            const prevRow = i + 1 < rows.length ? rows[i + 1]! : null;
            const acc = computeRowEventAccuracy(row, prevRow, medianMs, itemIntervals);
            if (acc.status === 'first') return null;
            return { score: acc.score, errorMs: Math.abs(acc.diffMs) };
          })
          .filter((r): r is { score: number; errorMs: number } => r !== null);
        if (modelResults.length > 0) {
          const avgScore = modelResults.reduce((s, r) => s + r.score, 0) / modelResults.length;
          const avgErrorMs = modelResults.reduce((s, r) => s + r.errorMs, 0) / modelResults.length;
          const detailTitle = modelResults.length === 1
            ? t('feature.itemDetail.loggedPrediction', { count: modelResults.length })
            : t('feature.itemDetail.loggedPredictions', { count: modelResults.length });
          overview.setModelAccuracy(avgScore, avgErrorMs, modelResults.length, detailTitle);
        }
      }

      // Build event card (hidden initially)
      eventCard = buildEventCard(
        safeItemName, item.shop_type, rows, medianMs, itemIntervals, spriteUrl,
        (index) => setActiveRow(index),
        showOverview,
      );
      eventCardEl = eventCard.container;
      eventCardEl.style.display = 'none';
      contentRoot.insertBefore(eventCardEl, eventListSection);

      // Wire browse button
      overview.browseBtn.addEventListener('click', () => {
        if (rows.length > 0) showEventCard(0);
      });

      // ── Summary strip ──
      const strip = document.createElement('div');
      strip.style.cssText = 'display:flex;flex-shrink:0;border-bottom:1px solid rgba(143,130,255,0.15);margin-top:8px;';

      const makeChip = (value: string, label: string, color = 'rgba(232,224,255,0.9)'): HTMLElement => {
        const chip = document.createElement('div');
        chip.style.cssText = [
          'flex:1', 'display:flex', 'flex-direction:column', 'align-items:center',
          'padding:10px 8px', 'gap:2px', 'min-width:0', 'overflow:hidden',
          'border-right:1px solid rgba(143,130,255,0.08)',
        ].join(';');
        const v = document.createElement('div');
        v.style.cssText = `font-size:15px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;white-space:nowrap;`;
        v.textContent = value;
        const l = document.createElement('div');
        l.style.cssText = 'font-size:9px;text-transform:uppercase;letter-spacing:0.55px;color:rgba(224,224,224,0.32);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;';
        l.textContent = label;
        chip.append(v, l);
        return chip;
      };

      strip.appendChild(makeChip(String(rows.length), t('feature.itemDetail.events')));
      if (medianMs != null) {
        strip.appendChild(makeChip(fmtDuration(medianMs), t('feature.itemDetail.medianGap'), '#a78bfa'));
      }
      const modelErrors = rows
        .filter((r) => r.predicted_next_ms != null)
        .map((r) => Math.abs(r.timestamp - r.predicted_next_ms!));
      const withError = rows.filter(r => r.errorMs !== null);
      if (modelErrors.length > 0) {
        const avgErr = modelErrors.reduce((s, v) => s + v, 0) / modelErrors.length;
        const c = avgErr < 1_800_000 ? '#4ade80' : avgErr < 10_800_000 ? '#fbbf24' : '#f87171';
        strip.appendChild(makeChip(fmtDuration(avgErr), t('feature.itemDetail.avgModelError'), c));
      } else if (withError.length > 0) {
        const avgErr = withError.reduce((s, r) => s + Math.abs(r.errorMs!), 0) / withError.length;
        const c = avgErr < 1_800_000 ? '#4ade80' : avgErr < 10_800_000 ? '#fbbf24' : '#f87171';
        strip.appendChild(makeChip(fmtDuration(avgErr), t('feature.itemDetail.avgErrorLabel'), c));
      }
      const lastChip = strip.lastElementChild as HTMLElement | null;
      if (lastChip) lastChip.style.borderRight = 'none';
      eventListSection.appendChild(strip);

      // ── Column headers ──
      const colHdr = document.createElement('div');
      colHdr.style.cssText = [
        'display:grid', 'grid-template-columns:1fr 76px 96px',
        'padding:6px 10px 3px 18px',
        'font-size:10px', 'font-weight:700', 'letter-spacing:0.5px',
        'text-transform:uppercase', 'color:rgba(224,224,224,0.25)',
        'flex-shrink:0',
      ].join(';');
      const hL = document.createElement('span');
      hL.textContent = t('feature.itemDetail.restocked');
      const hM = document.createElement('span');
      hM.style.textAlign = 'right';
      hM.textContent = t('feature.itemDetail.accuracy');
      const hR = document.createElement('span');
      hR.style.textAlign = 'right';
      hR.textContent = t('feature.itemDetail.statusHeader');
      colHdr.append(hL, hM, hR);
      eventListSection.appendChild(colHdr);

      // ── Scrollable event list ──
      const listWrap = document.createElement('div');
      listWrap.style.cssText = 'flex:1;overflow-y:auto;min-height:0;padding:4px 10px 10px;';

      const handleRowClick = (index: number): void => {
        showEventCard(index);
      };

      let renderedCount = 0;
      const markerSlots = buildAlgorithmMarkerSlots(rows, algorithmUpdatedAtMs, algoHistory);

      const appendMarkersIfNeeded = (beforeIndex: number): void => {
        for (const slot of markerSlots) {
          if (slot.inserted || slot.insertIdx !== beforeIndex) continue;
          listWrap.appendChild(makeAlgorithmUpdateMarkerEl(slot));
          slot.inserted = true;
        }
      };

      for (let i = 0; i < Math.min(INITIAL_ROWS, rows.length); i++) {
        appendMarkersIfNeeded(i);
        const rowEl = makeRowEl(rows[i]!, i + 1 < rows.length ? rows[i + 1]! : null, i, medianMs, itemIntervals, handleRowClick);
        rowElements[i] = rowEl;
        listWrap.appendChild(rowEl);
        renderedCount++;
      }
      appendMarkersIfNeeded(renderedCount);

      if (rows.length > INITIAL_ROWS) {
        const remaining = rows.length - INITIAL_ROWS;
        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.textContent = t('feature.itemDetail.showMore', { count: remaining });
        moreBtn.style.cssText = [
          'display:block', 'width:100%', 'margin-top:6px', 'padding:7px',
          'font-size:12px', 'font-weight:600', 'cursor:pointer',
          'background:rgba(143,130,255,0.08)',
          'border:1px solid rgba(143,130,255,0.2)',
          'border-radius:7px', 'color:rgba(200,192,255,0.55)',
          'transition:background 0.1s',
        ].join(';');
        moreBtn.addEventListener('mouseenter', () => { moreBtn.style.background = 'rgba(143,130,255,0.14)'; });
        moreBtn.addEventListener('mouseleave', () => { moreBtn.style.background = 'rgba(143,130,255,0.08)'; });
        moreBtn.addEventListener('click', () => {
          moreBtn.remove();
          for (let i = renderedCount; i < rows.length; i++) {
            appendMarkersIfNeeded(i);
            const rowEl = makeRowEl(rows[i]!, i + 1 < rows.length ? rows[i + 1]! : null, i, medianMs, itemIntervals, handleRowClick);
            rowElements[i] = rowEl;
            listWrap.appendChild(rowEl);
          }
          appendMarkersIfNeeded(rows.length);
          if (activeRowIndex >= 0) setActiveRow(activeRowIndex);
          updateLinkedScaleFromWindow();
        });
        listWrap.appendChild(moreBtn);
      }

      eventListSection.appendChild(listWrap);
      updateLinkedScaleFromWindow();
    })();
  }, '520px', '80vh');
}
