// src/store/dawnEconomy.ts
// Dawn-specific economy tracking: spend breakdown, harvest value, and ROI.
// Dawn purchases already flow through recordShopPurchase() via ShopCategoryKey 'dawn'.
// This module adds session-scoped Dawn spend/harvest aggregation.

import { log } from '../utils/logger';
import { subscribeToStats, type StatsSnapshot } from './stats';
import { onWeatherSnapshot, type WeatherSnapshot } from './weatherHub';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DawnEconomySnapshot {
  /** Coins spent on Dawn Shop purchases this session */
  coinsSpent: number;
  /** Credits spent on Dawn Shop purchases this session */
  creditsSpent: number;
  /** Total Dawn Shop purchases this session */
  purchaseCount: number;
  /** Estimated harvest value of Dawn crops sold this session (coins) */
  harvestValue: number;
  /** ROI: harvestValue / coinsSpent (0 if no spend) */
  roi: number;
  /** Whether Dawn weather is currently active */
  isDawnActive: boolean;
  /** Number of Dawn weather events observed this session */
  dawnEventsThisSession: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sessionStart = 0;
let coinsSpentAtSessionStart = 0;
let creditsSpentAtSessionStart = 0;
let purchaseCountAtSessionStart = 0;
let harvestValue = 0;
let isDawnActive = false;
let dawnEventsThisSession = 0;
let lastWeatherKind: string | null = null;

let statsUnsubscribe: (() => void) | null = null;
let weatherUnsubscribe: (() => void) | null = null;
let latestStats: StatsSnapshot | null = null;
let initialized = false;

const listeners = new Set<(snapshot: DawnEconomySnapshot) => void>();

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function buildSnapshot(): DawnEconomySnapshot {
  const stats = latestStats;
  const dawnPurchases = stats?.shop.purchasesByCategory.dawn ?? 0;
  const totalCoins = stats?.shop.totalSpentCoins ?? 0;
  const totalCredits = stats?.shop.totalSpentCredits ?? 0;

  // Session-relative values — we track the delta since session start.
  // This is approximate: we don't have per-category coin/credit breakdowns
  // in the stats store, only total. Dawn-specific spend would require
  // augmenting the stats store with per-category currency breakdowns.
  // For now, use purchase count delta as the primary metric.
  const purchaseCount = Math.max(0, dawnPurchases - purchaseCountAtSessionStart);
  const coinsSpent = Math.max(0, totalCoins - coinsSpentAtSessionStart);
  const creditsSpent = Math.max(0, totalCredits - creditsSpentAtSessionStart);
  const roi = coinsSpent > 0 ? harvestValue / coinsSpent : 0;

  return {
    coinsSpent,
    creditsSpent,
    purchaseCount,
    harvestValue,
    roi,
    isDawnActive,
    dawnEventsThisSession,
  };
}

function emit(): void {
  const snapshot = buildSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      log('[DawnEconomy] listener error', error);
    }
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleStats(stats: StatsSnapshot): void {
  latestStats = stats;
  emit();
}

function handleWeather(snapshot: WeatherSnapshot): void {
  const wasDawn = lastWeatherKind === 'dawn';
  const nowDawn = snapshot.kind === 'dawn';
  lastWeatherKind = snapshot.kind;
  isDawnActive = nowDawn;

  if (!wasDawn && nowDawn) {
    dawnEventsThisSession++;
  }

  emit();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initDawnEconomy(): void {
  if (initialized) return;
  initialized = true;
  sessionStart = Date.now();

  statsUnsubscribe = subscribeToStats((stats) => {
    // Capture baseline on first stats snapshot
    if (coinsSpentAtSessionStart === 0 && purchaseCountAtSessionStart === 0) {
      coinsSpentAtSessionStart = stats.shop.totalSpentCoins;
      creditsSpentAtSessionStart = stats.shop.totalSpentCredits;
      purchaseCountAtSessionStart = stats.shop.purchasesByCategory.dawn ?? 0;
    }
    handleStats(stats);
  });

  weatherUnsubscribe = onWeatherSnapshot(handleWeather, true);
  log('[DawnEconomy] Initialized');
}

export function destroyDawnEconomy(): void {
  if (!initialized) return;
  initialized = false;
  statsUnsubscribe?.();
  statsUnsubscribe = null;
  weatherUnsubscribe?.();
  weatherUnsubscribe = null;
  latestStats = null;
  listeners.clear();
  harvestValue = 0;
  dawnEventsThisSession = 0;
  isDawnActive = false;
  lastWeatherKind = null;
}

export function subscribeDawnEconomy(listener: (snapshot: DawnEconomySnapshot) => void): () => void {
  listeners.add(listener);
  if (initialized) {
    try {
      listener(buildSnapshot());
    } catch (error) {
      log('[DawnEconomy] immediate listener error', error);
    }
  }
  return () => { listeners.delete(listener); };
}

export function getDawnEconomySnapshot(): DawnEconomySnapshot {
  return buildSnapshot();
}

/**
 * Record harvest value from a Dawn crop sale (called externally when a
 * Dawn crop sell is detected).
 */
export function recordDawnHarvestValue(coins: number): void {
  if (coins > 0) {
    harvestValue += coins;
    emit();
  }
}
