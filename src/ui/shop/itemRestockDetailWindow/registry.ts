import { registerWindowOpener } from '../../core/modalWindow';
import type { RestockItem } from '../../../utils/restock/dataService';
import {
  canonicalItemId,
  getItemIdVariants,
  getRestockDataSync,
} from '../../../utils/restock/dataService';
import { storage } from '../../../utils/storage';
import type { DetailShopType, DetailWindowRegistryEntry } from './types';
import { DETAIL_WINDOW_REGISTRY_KEY, DETAIL_WINDOW_REGISTRY_MAX } from './constants';
import { openItemRestockDetail } from './mainWindow';

export function isDetailShopType(value: unknown): value is DetailShopType {
  return value === 'seed' || value === 'egg' || value === 'decor' || value === 'tool' || value === 'weather' || value === 'dawn';
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

export function getDetailWindowId(shopType: DetailShopType, itemId: string): string {
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

export function resolveDetailRestockItem(
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

export function rememberDetailWindow(shopType: DetailShopType, itemId: string, itemName: string): void {
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

export function registerDetailWindowOpener(shopType: DetailShopType, itemId: string, itemName: string): void {
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
