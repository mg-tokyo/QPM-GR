import { log } from '../../../utils/logger';
import type { ActionKey, TypeFilter, OrderFilter, ActivityLogEntry } from './types';
import { S } from './state';
import {
  isReplaySafeEntry,
  normalizeWhitespace,
  normalizeToken,
  readString,
  readEntryMessage,
  entryKey,
  deepClone,
  getEntryElements,
  visibleRowSignature,
} from './parsing';
import {
  loadHistory,
  saveHistory,
  loadFilters,
  loadSummaryDebugPreference,
  saveSummaryDebugPreference,
  loadEnabledPreference,
  saveEnabledPreference,
  persistFilters,
  runLegacyMigrationOnce,
  importAriesHistory,
  triggerExportJson,
  invalidateVirtualCaches,
  flushPendingHistory,
  installPersistenceUnloadHandler,
  uninstallPersistenceUnloadHandler,
} from './persistence';
import { resetVirtualMode, clearReplayHydrationTimer, getOrderedHistoryRefs } from './virtualList';
import { getOrderedHistory } from './patchHooks';
import { uninstallMyDataReadPatch } from './patchHooks';
import {
  startModalObserver,
  stopModalObserver,
  startMyDataActivitySubscription,
  stopMyDataActivitySubscription,
  queueReplay,
  scheduleModalRefresh,
} from './modal';

export function setActivityLogEnhancerSummaryVisible(enabled?: boolean): boolean {
  if (typeof enabled === 'boolean') {
    S.showSummaryInDebug = enabled;
    saveSummaryDebugPreference();
    if (S.modalHandles) {
      scheduleModalRefresh(S.modalHandles);
    }
  }
  return S.showSummaryInDebug;
}

export function getActivityLogEnhancerStatus(): {
  enabled: boolean;
  started: boolean;
  historyCount: number;
  replaySafeCount: number;
  order: OrderFilter;
  type: TypeFilter;
  action: ActionKey;
  petSpecies: string;
  plantSpecies: string;
  replaySupported: boolean | null;
  replayMode: 'unknown' | 'write' | 'read_patch' | 'none';
  ariesFilterPresent: boolean;
  mode: 'collapsed' | 'virtual-expanded';
  virtualizationActive: boolean;
  windowStart: number;
  windowEnd: number;
  totalFiltered: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
} {
  const supported = S.replayMode === 'write' || S.replayMode === 'read_patch'
    ? true
    : (S.replayMode === 'none' ? false : null);
  return {
    enabled: S.enhancerEnabled,
    started: S.started,
    historyCount: S.history.length,
    replaySafeCount: S.history.filter((entry) => isReplaySafeEntry(entry)).length,
    order: S.filters.order,
    type: S.filters.type,
    action: S.filters.action,
    petSpecies: S.filters.petSpecies || '',
    plantSpecies: S.filters.plantSpecies || '',
    replaySupported: supported,
    replayMode: S.replayMode,
    ariesFilterPresent: Boolean(S.modalHandles?.ariesFilterPresent),
    mode: S.virtualMode,
    virtualizationActive: S.virtualMode === 'virtual-expanded',
    windowStart: S.virtualWindowStart,
    windowEnd: S.virtualWindowEnd,
    totalFiltered: S.virtualTotalFiltered,
    topSpacerPx: S.virtualTopSpacerPx,
    bottomSpacerPx: S.virtualBottomSpacerPx,
  };
}

export function forceActivityLogEnhancerReplay(): boolean {
  if (!S.started) return false;
  queueReplay('manual');
  return true;
}

export function verifyActivityLogEnhancerEntries(): {
  historyCount: number;
  duplicateEntryKeys: number;
  semanticDuplicateGroups: number;
  visibleRows: number;
  visibleDuplicateRows: number;
} {
  const keyCount = new Map<string, number>();
  const semanticCount = new Map<string, number>();

  for (const entry of S.history) {
    const key = entryKey(entry);
    keyCount.set(key, (keyCount.get(key) ?? 0) + 1);

    const semantic = `${normalizeToken(readString(entry.action) ?? 'other')}|${normalizeToken(readEntryMessage(entry))}|${Math.round(entry.timestamp / 1000)}`;
    semanticCount.set(semantic, (semanticCount.get(semantic) ?? 0) + 1);
  }

  const duplicateEntryKeys = Array.from(keyCount.values()).filter((count) => count > 1).length;
  const semanticDuplicateGroups = Array.from(semanticCount.values()).filter((count) => count > 1).length;

  const rows = S.modalHandles ? getEntryElements(S.modalHandles.list) : [];
  const visibleRows = rows.filter((row) => row.style.display !== 'none').length;
  const rowCount = new Map<string, number>();
  for (const row of rows) {
    if (row.style.display === 'none') continue;
    const signature = visibleRowSignature(row);
    rowCount.set(signature, (rowCount.get(signature) ?? 0) + 1);
  }
  const visibleDuplicateRows = Array.from(rowCount.values()).filter((count) => count > 1).length;

  return {
    historyCount: S.history.length,
    duplicateEntryKeys,
    semanticDuplicateGroups,
    visibleRows,
    visibleDuplicateRows,
  };
}

export function listActivityLogEnhancerEntries(): unknown[] {
  return S.history.map((entry) => deepClone(entry));
}

export function exportActivityLogEnhancerEntries(): number {
  return triggerExportJson(getOrderedHistory(S.filters.order));
}

export function clearActivityLogEnhancerEntries(): number {
  const removed = S.history.length;
  S.history = [];
  S.lastSnapshot = [];
  S.replayHydratedCount = 0;
  S.readPatchStartIndex = 0;
  S.readPatchOrder = S.filters.order;
  S.readPatchMaxEntries = null;
  resetVirtualMode();
  clearReplayHydrationTimer();
  saveHistory(S.history);
  if (S.modalHandles) {
    queueReplay('clear-history');
    scheduleModalRefresh(S.modalHandles);
  }
  return removed;
}

export function isActivityLogEnhancerEnabled(): boolean {
  return S.enhancerEnabled;
}

export async function setActivityLogEnhancerEnabled(enabled: boolean): Promise<boolean> {
  const next = Boolean(enabled);
  if (S.enhancerEnabled === next) {
    if (next && !S.started) {
      await startActivityLogEnhancer();
    }
    return S.enhancerEnabled;
  }

  S.enhancerEnabled = next;
  saveEnabledPreference();

  if (!next) {
    stopActivityLogEnhancer();
    return S.enhancerEnabled;
  }

  try {
    await startActivityLogEnhancer();
  } catch (error) {
    S.enhancerEnabled = false;
    saveEnabledPreference();
    stopActivityLogEnhancer();
    throw error;
  }

  return S.enhancerEnabled;
}

export async function startActivityLogEnhancer(): Promise<void> {
  S.enhancerEnabled = loadEnabledPreference();
  if (!S.enhancerEnabled) {
    log('[ActivityLogNative] disabled by config');
    return;
  }
  if (S.started) return;
  S.started = true;
  installPersistenceUnloadHandler();

  try {
    S.replayMode = 'unknown';
    S.replayHydratedCount = 0;
    S.readPatchStartIndex = 0;
    S.readPatchOrder = 'newest';
    S.readPatchMaxEntries = null;
    S.lastIngestLength = -1;
    S.lastIngestFirstTs = 0;
    S.lastIngestLastTs = 0;
    resetVirtualMode();
    S.petLookupEntriesCache = null;
    S.plantLookupEntriesCache = null;
    S.petSpeciesOptionsCache = null;
    S.plantSpeciesOptionsCache = null;
    S.history = loadHistory();
    S.historyRevision += 1;
    S.orderedHistoryCacheKey = '';
    S.orderedHistoryNewestCache = null;
    S.orderedHistoryOldestCache = null;
    S.filters = loadFilters();
    S.readPatchOrder = S.filters.order;
    S.showSummaryInDebug = loadSummaryDebugPreference();
    runLegacyMigrationOnce();
    const ariesMerged = importAriesHistory();
    S.history = loadHistory();
    S.historyRevision += 1;

    startModalObserver();
    await startMyDataActivitySubscription();

    if (ariesMerged > 0) {
      log(`[ActivityLogNative] Imported ${ariesMerged} entries from Aries history`);
    }
    log(`[ActivityLogNative] started (${S.history.length} history entries)`);
  } catch (error) {
    stopActivityLogEnhancer();
    throw error;
  }
}

export function stopActivityLogEnhancer(): void {
  if (!S.started) return;
  S.started = false;

  stopMyDataActivitySubscription();
  stopModalObserver();

  S.replayQueued = false;
  S.replayInFlight = false;
  S.suppressIngestUntil = 0;
  S.writeSupported = null;
  S.replayMode = 'unknown';
  S.replayHydratedCount = 0;
  S.readPatchStartIndex = 0;
  S.readPatchOrder = S.filters.order;
  S.readPatchMaxEntries = null;
  S.lastIngestLength = -1;
  S.lastIngestFirstTs = 0;
  S.lastIngestLastTs = 0;
  resetVirtualMode();
  S.petLookupEntriesCache = null;
  S.plantLookupEntriesCache = null;
  S.petSpeciesOptionsCache = null;
  S.plantSpeciesOptionsCache = null;
  S.orderedHistoryCacheKey = '';
  S.orderedHistoryNewestCache = null;
  S.orderedHistoryOldestCache = null;
  clearReplayHydrationTimer();
  uninstallMyDataReadPatch();

  saveHistory(S.history);
  flushPendingHistory(true);
  uninstallPersistenceUnloadHandler();
  persistFilters();
  saveSummaryDebugPreference();
  saveEnabledPreference();
  log('[ActivityLogNative] stopped');
}
