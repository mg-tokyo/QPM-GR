// src/features/mutationValueTracking.ts
// Tracks gold/rainbow/crop boost generation rates per hour and session value.

import { getAbilityHistorySnapshot } from '../../store/abilityLogs';
import { storage } from '../../utils/storage';
import { debounce } from '../../utils/scheduling/debounce';
import { log } from '../../utils/logger';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { resetWeatherMutationTracking } from './weatherTracking';
import { buildAbilityValuationContext, resolveDynamicAbilityEffect, resolveGrantedMutationName } from '../pets/abilityValuation';
import { calculateMutationValue } from '../../utils/mutationValueCalculator';
import { getMutationMultiplier, getAllAbilities } from '../../catalogs/gameCatalogs';

const STORAGE_KEY = 'qpm.mutationValueTracking.v1';
const SAVE_DEBOUNCE_MS = 3000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Ability IDs handled by the hardcoded paths — excluded from auto-discovery. */
const KNOWN_GRANTER_IDS = new Set([
  'GoldGranter',
  'RainbowGranter',
  'ProduceScaleBoost',
  'ProduceScaleBoostII',
  'ProduceMutationBoost',
  'ProduceMutationBoostII',
]);

/**
 * Get mutation value dynamically from catalog (FUTUREPROOF!)
 * Falls back to conservative estimate based on multiplier
 */
function getMutationValue(mutationId: string): number {
  // Try catalog first
  const catalogValue = calculateMutationValue(mutationId);
  if (catalogValue !== null) return catalogValue;

  // Fallback to conservative estimate based on multiplier
  const multiplier = getMutationMultiplier(mutationId);
  return Math.floor(5000 * multiplier); // 5000 * multiplier as fallback
}

export interface DiscoveredAbilityStats {
  abilityId: string;
  mutationName: string;
  procs: number;
  perHour: number;
  totalValue: number;
  lastProcAt: number | null;
}

export interface MutationValueStats {
  // Gold mutations
  goldProcs: number;
  goldPerHour: number;
  goldTotalValue: number;
  goldLastProcAt: number | null;

  // Rainbow mutations
  rainbowProcs: number;
  rainbowPerHour: number;
  rainbowTotalValue: number;
  rainbowLastProcAt: number | null;

  // Crop size boosts
  cropBoostProcs: number;
  cropBoostPerHour: number;
  cropBoostTotalValue: number;
  cropBoostLastProcAt: number | null;

  // Session totals
  sessionValue: number; // Total value generated this session
  sessionStart: number;

  // Best sessions
  bestHourValue: number;
  bestHourTime: number | null;
  bestSessionValue: number;
  bestSessionTime: number | null;

  // Auto-discovered granter abilities (e.g. SnowGranter, AmberGranter)
  discoveredAbilityStats: Record<string, DiscoveredAbilityStats>;
}

export interface SessionHistory {
  date: string; // YYYY-MM-DD
  value: number;
  goldProcs: number;
  rainbowProcs: number;
  cropBoostProcs: number;
  duration: number; // milliseconds
}

export interface MutationValueSnapshot {
  stats: MutationValueStats;
  sessions: SessionHistory[];
  hourlyBreakdown: Map<number, number>; // Hour of day (0-23) -> avg value
  updatedAt: number;
}

interface PersistedStats {
  goldProcs: number;
  goldPerHour: number;
  goldTotalValue: number;
  goldLastProcAt: number | null;
  rainbowProcs: number;
  rainbowPerHour: number;
  rainbowTotalValue: number;
  rainbowLastProcAt: number | null;
  cropBoostProcs: number;
  cropBoostPerHour: number;
  cropBoostTotalValue: number;
  cropBoostLastProcAt: number | null;
  sessionValue: number;
  sessionStart: number;
  bestHourValue: number;
  bestHourTime: number | null;
  bestSessionValue: number;
  bestSessionTime: number | null;
}

interface PersistedSnapshot {
  version: number;
  stats: PersistedStats;
  sessions: SessionHistory[];
  updatedAt: number;
}

let snapshot: MutationValueSnapshot = {
  stats: {
    goldProcs: 0,
    goldPerHour: 0,
    goldTotalValue: 0,
    goldLastProcAt: null,
    rainbowProcs: 0,
    rainbowPerHour: 0,
    rainbowTotalValue: 0,
    rainbowLastProcAt: null,
    cropBoostProcs: 0,
    cropBoostPerHour: 0,
    cropBoostTotalValue: 0,
    cropBoostLastProcAt: null,
    sessionValue: 0,
    sessionStart: Date.now(),
    bestHourValue: 0,
    bestHourTime: null,
    bestSessionValue: 0,
    bestSessionTime: null,
    discoveredAbilityStats: {},
  },
  sessions: [],
  hourlyBreakdown: new Map(),
  updatedAt: Date.now(),
};

let initialized = false;
const listeners = new Set<(snapshot: MutationValueSnapshot) => void>();

// Dirty flag: total ability event count at last recalculation.
// recalculateStats() is expensive (scans all ability history, catalog lookups, etc.).
// Only run it when new ability events have been logged since the last run.
let lastAbilityEventCount = -1;

function getTotalAbilityEventCount(): number {
  const history = getAbilityHistorySnapshot();
  let count = 0;
  for (const h of history.values()) count += h.events.length;
  return count;
}

function countAbilityProcs(abilityId: string, since: number): {count: number, lastProcAt: number | null} {
  const historySnapshot = getAbilityHistorySnapshot();
  let count = 0;
  let lastProcAt: number | null = null;

  for (const history of historySnapshot.values()) {
    if (history.abilityId === abilityId) {
      const relevantEvents = history.events.filter(e => e.performedAt >= since);
      count += relevantEvents.length;

      if (relevantEvents.length > 0) {
        const latest = Math.max(...relevantEvents.map(e => e.performedAt));
        if (lastProcAt === null || latest > lastProcAt) {
          lastProcAt = latest;
        }
      }
    }
  }

  return { count, lastProcAt };
}

/**
 * Scans the runtime petAbilities catalog for any *Granter ability IDs
 * that aren't already handled by the hardcoded paths.
 * Returns [] when the catalog hasn't loaded yet (safe to call any time).
 */
function discoverExtraGranterAbilities(): string[] {
  return getAllAbilities().filter(
    (id) => id.endsWith('Granter') && !KNOWN_GRANTER_IDS.has(id),
  );
}

/** Build a value-per-proc map for a list of extra granter IDs. */
function buildExtraGranterValues(
  ids: string[],
  context: ReturnType<typeof buildAbilityValuationContext>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const id of ids) {
    const effect = resolveDynamicAbilityEffect(id, context, null);
    const mutationName = resolveGrantedMutationName(id);
    map.set(id, effect?.effectPerProc ?? getMutationValue(mutationName));
  }
  return map;
}

function recalculateStats(): void {
  const now = Date.now();
  const sessionStart = snapshot.stats.sessionStart;
  const duration = Math.max(1, now - sessionStart);
  const hours = duration / HOUR_MS;

  // Get dynamic ability valuations based on current garden state
  const context = buildAbilityValuationContext();
  const goldEffect = resolveDynamicAbilityEffect('GoldGranter', context, null);
  const rainbowEffect = resolveDynamicAbilityEffect('RainbowGranter', context, null);
  const cropBoostEffect1 = resolveDynamicAbilityEffect('ProduceScaleBoost', context, null);
  const cropBoostEffect2 = resolveDynamicAbilityEffect('ProduceScaleBoostII', context, null);

  // Use dynamic values or fallback to catalog-based estimates
  const goldValue = goldEffect?.effectPerProc || getMutationValue('Gold');
  const rainbowValue = rainbowEffect?.effectPerProc || getMutationValue('Rainbow');
  const cropBoost1Value = cropBoostEffect1?.effectPerProc || getMutationValue('Rainbow'); // Crop boost uses similar multiplier
  const cropBoost2Value = cropBoostEffect2?.effectPerProc || getMutationValue('Rainbow'); // Crop boost uses similar multiplier

  // Count gold granters
  const goldData = countAbilityProcs('GoldGranter', sessionStart);
  snapshot.stats.goldProcs = goldData.count;
  snapshot.stats.goldLastProcAt = goldData.lastProcAt;
  snapshot.stats.goldTotalValue = goldData.count * goldValue;
  snapshot.stats.goldPerHour = hours > 0 ? goldData.count / hours : 0;

  // Count rainbow granters
  const rainbowData = countAbilityProcs('RainbowGranter', sessionStart);
  snapshot.stats.rainbowProcs = rainbowData.count;
  snapshot.stats.rainbowLastProcAt = rainbowData.lastProcAt;
  snapshot.stats.rainbowTotalValue = rainbowData.count * rainbowValue;
  snapshot.stats.rainbowPerHour = hours > 0 ? rainbowData.count / hours : 0;

  // Count crop boosts
  const cropBoostData1 = countAbilityProcs('ProduceScaleBoost', sessionStart);
  const cropBoostData2 = countAbilityProcs('ProduceScaleBoostII', sessionStart);
  const totalCropBoosts = cropBoostData1.count + cropBoostData2.count;
  const lastCropBoost = cropBoostData1.lastProcAt && cropBoostData2.lastProcAt
    ? Math.max(cropBoostData1.lastProcAt, cropBoostData2.lastProcAt)
    : (cropBoostData1.lastProcAt || cropBoostData2.lastProcAt);

  // Calculate weighted average for crop boost (ProduceScaleBoost vs II)
  const cropBoostTotalValue =
    (cropBoostData1.count * cropBoost1Value) +
    (cropBoostData2.count * cropBoost2Value);

  snapshot.stats.cropBoostProcs = totalCropBoosts;
  snapshot.stats.cropBoostLastProcAt = lastCropBoost;
  snapshot.stats.cropBoostTotalValue = cropBoostTotalValue;
  snapshot.stats.cropBoostPerHour = hours > 0 ? totalCropBoosts / hours : 0;

  // Auto-discover and count extra granter abilities (SnowGranter, AmberGranter, etc.)
  const extraGranterIds = discoverExtraGranterAbilities();
  const extraGranterValues = buildExtraGranterValues(extraGranterIds, context);
  const newDiscovered: Record<string, DiscoveredAbilityStats> = {};
  let extraTotalValue = 0;
  for (const abilityId of extraGranterIds) {
    const valuePerProc = extraGranterValues.get(abilityId) ?? 0;
    const data = countAbilityProcs(abilityId, sessionStart);
    const totalValue = data.count * valuePerProc;
    extraTotalValue += totalValue;
    newDiscovered[abilityId] = {
      abilityId,
      mutationName: resolveGrantedMutationName(abilityId),
      procs: data.count,
      perHour: hours > 0 ? data.count / hours : 0,
      totalValue,
      lastProcAt: data.lastProcAt,
    };
  }
  snapshot.stats.discoveredAbilityStats = newDiscovered;

  // Calculate session value (includes all discovered granters)
  snapshot.stats.sessionValue =
    snapshot.stats.goldTotalValue +
    snapshot.stats.rainbowTotalValue +
    snapshot.stats.cropBoostTotalValue +
    extraTotalValue;

  // Calculate hourly breakdown
  calculateHourlyBreakdown(context, extraGranterIds, extraGranterValues);

  // Update best hour/session
  const currentHourValue = calculateCurrentHourValue(now, context, extraGranterIds, extraGranterValues);
  if (currentHourValue > snapshot.stats.bestHourValue) {
    snapshot.stats.bestHourValue = currentHourValue;
    snapshot.stats.bestHourTime = now;
  }

  if (snapshot.stats.sessionValue > snapshot.stats.bestSessionValue) {
    snapshot.stats.bestSessionValue = snapshot.stats.sessionValue;
    snapshot.stats.bestSessionTime = now;
  }

  snapshot.updatedAt = now;
  scheduleSave();
  notifyListeners();
}

function calculateCurrentHourValue(
  now: number,
  context: ReturnType<typeof buildAbilityValuationContext>,
  extraGranterIds: string[],
  extraGranterValues: Map<string, number>,
): number {
  const oneHourAgo = now - HOUR_MS;
  const goldData = countAbilityProcs('GoldGranter', oneHourAgo);
  const rainbowData = countAbilityProcs('RainbowGranter', oneHourAgo);
  const cropBoostData1 = countAbilityProcs('ProduceScaleBoost', oneHourAgo);
  const cropBoostData2 = countAbilityProcs('ProduceScaleBoostII', oneHourAgo);

  // Get dynamic values
  const goldEffect = resolveDynamicAbilityEffect('GoldGranter', context, null);
  const rainbowEffect = resolveDynamicAbilityEffect('RainbowGranter', context, null);
  const cropBoostEffect1 = resolveDynamicAbilityEffect('ProduceScaleBoost', context, null);
  const cropBoostEffect2 = resolveDynamicAbilityEffect('ProduceScaleBoostII', context, null);

  const goldValue = goldEffect?.effectPerProc || getMutationValue('Gold');
  const rainbowValue = rainbowEffect?.effectPerProc || getMutationValue('Rainbow');
  const cropBoost1Value = cropBoostEffect1?.effectPerProc || getMutationValue('Rainbow');
  const cropBoost2Value = cropBoostEffect2?.effectPerProc || getMutationValue('Rainbow');

  let extraHourValue = 0;
  for (const id of extraGranterIds) {
    const data = countAbilityProcs(id, oneHourAgo);
    extraHourValue += data.count * (extraGranterValues.get(id) ?? 0);
  }

  return (
    goldData.count * goldValue +
    rainbowData.count * rainbowValue +
    cropBoostData1.count * cropBoost1Value +
    cropBoostData2.count * cropBoost2Value +
    extraHourValue
  );
}

function calculateHourlyBreakdown(
  context: ReturnType<typeof buildAbilityValuationContext>,
  extraGranterIds: string[],
  extraGranterValues: Map<string, number>,
): void {
  const hourlyTotals = new Map<number, {value: number, count: number}>();

  // Get dynamic ability values based on current garden state
  const goldEffect = resolveDynamicAbilityEffect('GoldGranter', context, null);
  const rainbowEffect = resolveDynamicAbilityEffect('RainbowGranter', context, null);
  const cropBoostEffect1 = resolveDynamicAbilityEffect('ProduceScaleBoost', context, null);
  const cropBoostEffect2 = resolveDynamicAbilityEffect('ProduceScaleBoostII', context, null);

  const goldValue = goldEffect?.effectPerProc || getMutationValue('Gold');
  const rainbowValue = rainbowEffect?.effectPerProc || getMutationValue('Rainbow');
  const cropBoost1Value = cropBoostEffect1?.effectPerProc || getMutationValue('Rainbow');
  const cropBoost2Value = cropBoostEffect2?.effectPerProc || getMutationValue('Rainbow');

  const historySnapshot = getAbilityHistorySnapshot();

  for (const history of historySnapshot.values()) {
    for (const event of history.events) {
      const hour = new Date(event.performedAt).getHours();

      let value = 0;
      if (history.abilityId === 'GoldGranter') {
        value = goldValue;
      } else if (history.abilityId === 'RainbowGranter') {
        value = rainbowValue;
      } else if (history.abilityId === 'ProduceScaleBoost') {
        value = cropBoost1Value;
      } else if (history.abilityId === 'ProduceScaleBoostII') {
        value = cropBoost2Value;
      } else {
        value = extraGranterValues.get(history.abilityId) ?? 0;
      }

      if (value > 0) {
        const existing = hourlyTotals.get(hour) || { value: 0, count: 0 };
        existing.value += value;
        existing.count += 1;
        hourlyTotals.set(hour, existing);
      }
    }
  }

  // Calculate averages
  snapshot.hourlyBreakdown = new Map();
  for (const [hour, data] of hourlyTotals) {
    snapshot.hourlyBreakdown.set(hour, data.value / Math.max(1, data.count));
  }
}

function endCurrentSession(): void {
  const now = Date.now();
  const today = new Date(now).toISOString().split('T')[0]!;

  // Save current session
  if (snapshot.stats.sessionValue > 0 || snapshot.stats.goldProcs + snapshot.stats.rainbowProcs + snapshot.stats.cropBoostProcs > 0) {
    snapshot.sessions.push({
      date: today,
      value: snapshot.stats.sessionValue,
      goldProcs: snapshot.stats.goldProcs,
      rainbowProcs: snapshot.stats.rainbowProcs,
      cropBoostProcs: snapshot.stats.cropBoostProcs,
      duration: now - snapshot.stats.sessionStart,
    });

    // Keep only last 30 sessions
    if (snapshot.sessions.length > 30) {
      snapshot.sessions = snapshot.sessions.slice(-30);
    }
  }
}

const scheduleSave = debounce(() => {
  try {
    storage.set(STORAGE_KEY, serializeSnapshot());
  } catch (error) {
    console.error('[mutationValueTracking] Failed to save:', error);
  }
}, SAVE_DEBOUNCE_MS);

function serializeSnapshot(): PersistedSnapshot {
  return {
    version: 1,
    stats: {
      goldProcs: snapshot.stats.goldProcs,
      goldPerHour: snapshot.stats.goldPerHour,
      goldTotalValue: snapshot.stats.goldTotalValue,
      goldLastProcAt: snapshot.stats.goldLastProcAt,
      rainbowProcs: snapshot.stats.rainbowProcs,
      rainbowPerHour: snapshot.stats.rainbowPerHour,
      rainbowTotalValue: snapshot.stats.rainbowTotalValue,
      rainbowLastProcAt: snapshot.stats.rainbowLastProcAt,
      cropBoostProcs: snapshot.stats.cropBoostProcs,
      cropBoostPerHour: snapshot.stats.cropBoostPerHour,
      cropBoostTotalValue: snapshot.stats.cropBoostTotalValue,
      cropBoostLastProcAt: snapshot.stats.cropBoostLastProcAt,
      sessionValue: snapshot.stats.sessionValue,
      sessionStart: snapshot.stats.sessionStart,
      bestHourValue: snapshot.stats.bestHourValue,
      bestHourTime: snapshot.stats.bestHourTime,
      bestSessionValue: snapshot.stats.bestSessionValue,
      bestSessionTime: snapshot.stats.bestSessionTime,
    },
    sessions: snapshot.sessions,
    updatedAt: snapshot.updatedAt,
  };
}

function restoreSnapshot(persisted: PersistedSnapshot | null): void {
  if (!persisted || persisted.version !== 1) return;

  // Only restore best records - all session data starts fresh
  snapshot.stats.bestHourValue = persisted.stats.bestHourValue || 0;
  snapshot.stats.bestHourTime = persisted.stats.bestHourTime || null;
  snapshot.stats.bestSessionValue = persisted.stats.bestSessionValue || 0;
  snapshot.stats.bestSessionTime = persisted.stats.bestSessionTime || null;

  // Keep session history for trends
  snapshot.sessions = persisted.sessions || [];

  // Reset session start to now (current session only)
  snapshot.stats.sessionStart = Date.now();
  snapshot.updatedAt = Date.now();
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('[mutationValueTracking] Listener error:', error);
    }
  }
}

export function initializeMutationValueTracking(): void {
  if (initialized) return;
  initialized = true;

  try {
    const persisted = storage.get<PersistedSnapshot | null>(STORAGE_KEY, null);
    restoreSnapshot(persisted);
    log('🔄 Mutation value tracking initialized - session data reset, tracking only current session');
  } catch (error) {
    console.error('[mutationValueTracking] Failed to restore:', error);
  }

  // Recalculate on init (prime the event count baseline)
  lastAbilityEventCount = getTotalAbilityEventCount();
  recalculateStats();

  // Recalculate periodically — only when new ability events have been logged.
  // Skips the full history scan, catalog lookups, and notifyListeners() on idle ticks.
  visibleInterval('mutation-value-recalc', () => {
    const currentCount = getTotalAbilityEventCount();
    if (currentCount === lastAbilityEventCount) return; // No new procs — skip
    lastAbilityEventCount = currentCount;
    recalculateStats();
  }, 10000);
}

export function clearAllMutationValueHistory(): void {
  // Completely wipe all stored data
  try {
    storage.remove(STORAGE_KEY);
    log('🗑️ [MUTATION-VALUE] All history cleared from storage');
  } catch (error) {
    console.error('[mutationValueTracking] Failed to clear storage:', error);
  }

  // Reset in-memory snapshot to defaults
  snapshot = {
    stats: {
      goldProcs: 0,
      goldPerHour: 0,
      goldTotalValue: 0,
      goldLastProcAt: null,
      rainbowProcs: 0,
      rainbowPerHour: 0,
      rainbowTotalValue: 0,
      rainbowLastProcAt: null,
      cropBoostProcs: 0,
      cropBoostPerHour: 0,
      cropBoostTotalValue: 0,
      cropBoostLastProcAt: null,
      sessionValue: 0,
      sessionStart: Date.now(),
      bestHourValue: 0,
      bestHourTime: null,
      bestSessionValue: 0,
      bestSessionTime: null,
      discoveredAbilityStats: {},
    },
    sessions: [],
    hourlyBreakdown: new Map(),
    updatedAt: Date.now(),
  };

  notifyListeners();
}

export function getMutationValueSnapshot(): MutationValueSnapshot {
  return {
    stats: {
      ...snapshot.stats,
      discoveredAbilityStats: { ...snapshot.stats.discoveredAbilityStats },
    },
    sessions: [...snapshot.sessions],
    hourlyBreakdown: new Map(snapshot.hourlyBreakdown),
    updatedAt: snapshot.updatedAt,
  };
}

export function subscribeToMutationValueTracking(
  listener: (snapshot: MutationValueSnapshot) => void
): () => void {
  listeners.add(listener);
  listener(getMutationValueSnapshot()); // Immediate callback
  return () => listeners.delete(listener);
}

export function resetMutationValueTracking(): void {
  endCurrentSession(); // Save current session before reset

  // Reset weather mutation tracking too
  resetWeatherMutationTracking();

  // Create new snapshot with fresh session start
  const newSessionStart = Date.now();

  snapshot = {
    stats: {
      goldProcs: 0,
      goldPerHour: 0,
      goldTotalValue: 0,
      goldLastProcAt: null,
      rainbowProcs: 0,
      rainbowPerHour: 0,
      rainbowTotalValue: 0,
      rainbowLastProcAt: null,
      cropBoostProcs: 0,
      cropBoostPerHour: 0,
      cropBoostTotalValue: 0,
      cropBoostLastProcAt: null,
      sessionValue: 0,
      sessionStart: newSessionStart,
      bestHourValue: snapshot.stats.bestHourValue, // Keep best records
      bestHourTime: snapshot.stats.bestHourTime,
      bestSessionValue: snapshot.stats.bestSessionValue,
      bestSessionTime: snapshot.stats.bestSessionTime,
      discoveredAbilityStats: {},
    },
    sessions: snapshot.sessions,
    hourlyBreakdown: new Map(),
    updatedAt: Date.now(),
  };

  // Immediately save (don't wait for debounce)
  try {
    storage.set(STORAGE_KEY, serializeSnapshot());
  } catch (error) {
    console.error('[mutationValueTracking] Failed to save after reset:', error);
  }

  // Notify listeners with reset state
  notifyListeners();

  log('✅ [MUTATION-VALUE] Reset complete - session stats cleared');
}
