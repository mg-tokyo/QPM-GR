import { storage } from '../../../utils/storage';
import type {
  UnknownRecord,
  ActivityLogEntry,
  FilterState,
  OrderFilter,
  TypeFilter,
  HistoryEnvelope,
} from './types';
import {
  HISTORY_STORAGE_KEY,
  HISTORY_BACKUP_STORAGE_KEY,
  HISTORY_META_STORAGE_KEY,
  FILTER_ACTION_STORAGE_KEY,
  FILTER_TYPE_STORAGE_KEY,
  FILTER_ORDER_STORAGE_KEY,
  FILTER_PET_SPECIES_STORAGE_KEY,
  FILTER_PLANT_SPECIES_STORAGE_KEY,
  MIGRATION_STORAGE_KEY,
  SUMMARY_DEBUG_STORAGE_KEY,
  ARIES_IMPORT_STORAGE_KEY,
  ACTIVITY_LOG_ENABLED_STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
  TYPE_OPTIONS,
} from './constants';
import { S } from './state';
import {
  isRecord,
  readString,
  normalizeList,
  normalizeEntry,
  normalizeToken,
  trimAndSortHistory,
  buildHistoryEnvelope,
  parseHistorySource,
  entryKey,
  entriesEqual,
  readEntryMessage,
  inferActionFromMessage,
  normalizeTimestamp,
  diffSnapshots,
} from './parsing';

export function invalidateVirtualCaches(): void {
  S.virtualFilteredCacheKey = '';
  S.virtualFilteredCache = [];
  S.historyFilterMetaCacheRevision = -1;
  S.historyFilterMetaCache.clear();
}

export function persistHistoryEnvelope(envelope: HistoryEnvelope): void {
  storage.set(HISTORY_STORAGE_KEY, envelope);
  storage.set(HISTORY_BACKUP_STORAGE_KEY, envelope);
  storage.set(HISTORY_META_STORAGE_KEY, {
    version: envelope.version,
    savedAt: envelope.savedAt,
    count: envelope.count,
    checksum: envelope.checksum,
    firstTimestamp: envelope.firstTimestamp,
    lastTimestamp: envelope.lastTimestamp,
  });
}

export function writeHistoryWithBackup(entries: ActivityLogEntry[]): void {
  const envelope = buildHistoryEnvelope(entries);
  S.history = envelope.entries;
  S.historyRevision += 1;
  invalidateVirtualCaches();
  persistHistoryEnvelope(envelope);
}

export function loadHistory(): ActivityLogEntry[] {
  const primaryRaw = storage.get<unknown>(HISTORY_STORAGE_KEY, null);
  const backupRaw = storage.get<unknown>(HISTORY_BACKUP_STORAGE_KEY, null);
  const primary = parseHistorySource(primaryRaw);
  const backup = parseHistorySource(backupRaw);

  if (primary && backup) {
    const chosen = primary.savedAt >= backup.savedAt ? primary : backup;
    const stale = chosen === primary ? backup : primary;
    if (
      stale.savedAt !== chosen.savedAt
      || stale.count !== chosen.count
      || stale.checksum !== chosen.checksum
    ) {
      persistHistoryEnvelope(chosen);
    }
    return chosen.entries;
  }

  if (primary) {
    persistHistoryEnvelope(primary);
    return primary.entries;
  }

  if (backup) {
    persistHistoryEnvelope(backup);
    return backup.entries;
  }

  const empty = trimAndSortHistory([]);
  persistHistoryEnvelope(buildHistoryEnvelope(empty));
  return empty;
}

export function saveHistory(entries: ActivityLogEntry[]): void {
  writeHistoryWithBackup(entries);
}

function tryReadLocalStorageJson(key: string): unknown {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function importAriesHistory(): number {
  const imported = new Map<string, ActivityLogEntry>();

  const collect = (candidate: unknown): void => {
    const entries = normalizeList(candidate);
    for (const entry of entries) {
      imported.set(entryKey(entry), entry);
    }
  };

  const ariesRoot = tryReadLocalStorageJson('aries_mod');
  if (isRecord(ariesRoot)) {
    const activityLog = isRecord(ariesRoot.activityLog) ? ariesRoot.activityLog : null;
    if (activityLog) {
      collect(activityLog.history);
    }
  }

  collect(tryReadLocalStorageJson('activityLog.history'));
  collect(tryReadLocalStorageJson('qws:activityLogs:history:v1'));

  if (!imported.size) return 0;

  const map = new Map<string, ActivityLogEntry>();
  for (const entry of S.history) {
    map.set(entryKey(entry), entry);
  }

  let mergedCount = 0;
  for (const [key, entry] of imported.entries()) {
    const existing = map.get(key);
    if (!existing || !entriesEqual(existing, entry)) {
      map.set(key, entry);
      mergedCount += 1;
    }
  }

  if (mergedCount > 0) {
    saveHistory(Array.from(map.values()));
  }

  storage.set(ARIES_IMPORT_STORAGE_KEY, {
    lastImportedAt: Date.now(),
    mergedCount,
    candidateCount: imported.size,
    totalHistory: S.history.length,
  });

  return mergedCount;
}

export function loadFilters(): FilterState {
  const action = readString(storage.get<unknown>(FILTER_ACTION_STORAGE_KEY, 'all')) as import('./types').ActionKey | null;
  const type = readString(storage.get<unknown>(FILTER_TYPE_STORAGE_KEY, 'all')) as TypeFilter | null;
  const order = readString(storage.get<unknown>(FILTER_ORDER_STORAGE_KEY, 'newest')) as OrderFilter | null;
  const petSpecies = readString(storage.get<unknown>(FILTER_PET_SPECIES_STORAGE_KEY, '')) ?? '';
  const plantSpecies = readString(storage.get<unknown>(FILTER_PLANT_SPECIES_STORAGE_KEY, '')) ?? '';

  return {
    action: action ?? 'all',
    type: type && TYPE_OPTIONS.some((option) => option.value === type) ? type : 'all',
    order: order === 'oldest' ? 'oldest' : 'newest',
    petSpecies,
    plantSpecies,
  };
}

export function persistFilters(): void {
  storage.set(FILTER_ACTION_STORAGE_KEY, String(S.filters.action));
  storage.set(FILTER_TYPE_STORAGE_KEY, String(S.filters.type));
  storage.set(FILTER_ORDER_STORAGE_KEY, String(S.filters.order));
  storage.set(FILTER_PET_SPECIES_STORAGE_KEY, String(S.filters.petSpecies || ''));
  storage.set(FILTER_PLANT_SPECIES_STORAGE_KEY, String(S.filters.plantSpecies || ''));
}

export function loadSummaryDebugPreference(): boolean {
  return Boolean(storage.get(SUMMARY_DEBUG_STORAGE_KEY, false));
}

export function saveSummaryDebugPreference(): void {
  storage.set(SUMMARY_DEBUG_STORAGE_KEY, S.showSummaryInDebug);
}

export function loadEnabledPreference(): boolean {
  return Boolean(storage.get<boolean>(ACTIVITY_LOG_ENABLED_STORAGE_KEY, false));
}

export function saveEnabledPreference(): void {
  storage.set(ACTIVITY_LOG_ENABLED_STORAGE_KEY, S.enhancerEnabled);
}

function normalizeLegacyEntry(raw: unknown): ActivityLogEntry | null {
  if (!isRecord(raw)) return null;
  const timestamp = normalizeTimestamp(raw.timestamp ?? raw.time ?? raw.createdAt ?? raw.loggedAt);
  if (!timestamp) return null;

  const message = readString(raw.message) ?? readString(raw.rawMessage) ?? null;
  const action = readString(raw.action) ?? (message ? String(inferActionFromMessage(message)) : 'Activity');

  const legacyParameters: Record<string, unknown> = {};
  if (message) legacyParameters.message = message;
  const itemLabel = readString(raw.itemLabel);
  const petSpecies = readString(raw.petSpecies);
  const plantSpecies = readString(raw.plantSpecies);
  const secondaryLabel = readString(raw.secondaryLabel);
  const quantity = Number(raw.quantity);
  const priceCoins = Number(raw.priceCoins);
  if (itemLabel) legacyParameters.itemLabel = itemLabel;
  if (petSpecies) legacyParameters.petSpecies = petSpecies;
  if (plantSpecies) legacyParameters.plantSpecies = plantSpecies;
  if (secondaryLabel) legacyParameters.secondaryLabel = secondaryLabel;
  if (Number.isFinite(quantity)) legacyParameters.quantity = quantity;
  if (Number.isFinite(priceCoins)) legacyParameters.priceCoins = priceCoins;
  legacyParameters.qpmMigrated = true;

  return normalizeEntry({
    timestamp,
    action,
    message,
    parameters: legacyParameters,
  });
}

function semanticMigrationKey(entry: ActivityLogEntry): string {
  const action = normalizeToken(readString(entry.action) ?? 'other');
  const message = normalizeToken(readEntryMessage(entry));
  const secondBucket = Math.round(entry.timestamp / 1000);
  return `${action}|${message}|${secondBucket}`;
}

export function runLegacyMigrationOnce(): void {
  const marker = storage.get<UnknownRecord | null>(MIGRATION_STORAGE_KEY, null);
  if (marker && marker.done === true) {
    return;
  }

  const imported: ActivityLogEntry[] = [];
  for (const key of LEGACY_STORAGE_KEYS) {
    const parsed = storage.get<unknown>(key, []);
    if (!Array.isArray(parsed)) continue;
    for (const raw of parsed) {
      const converted = normalizeLegacyEntry(raw);
      if (converted) imported.push(converted);
    }
  }

  const map = new Map<string, ActivityLogEntry>();
  for (const entry of S.history) {
    map.set(entryKey(entry), entry);
  }

  const semanticSeen = new Set<string>();
  for (const entry of imported) {
    const semanticKey = semanticMigrationKey(entry);
    if (semanticSeen.has(semanticKey)) continue;
    semanticSeen.add(semanticKey);
    const key = entryKey(entry);
    if (!map.has(key)) {
      map.set(key, entry);
      continue;
    }
    const current = map.get(key);
    if (current && !entriesEqual(current, entry)) {
      map.set(key, entry);
    }
  }

  const merged = trimAndSortHistory(Array.from(map.values()));
  saveHistory(merged);
  storage.set(MIGRATION_STORAGE_KEY, {
    done: true,
    migratedAt: Date.now(),
    imported: imported.length,
    total: merged.length,
  });
}

export function mergeSnapshots(prevSnapshot: ActivityLogEntry[], nextSnapshot: ActivityLogEntry[]): boolean {
  const { added, updated } = diffSnapshots(prevSnapshot, nextSnapshot);
  if (!added.length && !updated.length) return false;

  const map = new Map<string, ActivityLogEntry>();
  for (const entry of S.history) {
    map.set(entryKey(entry), entry);
  }

  let changed = false;
  const upsert = (entry: ActivityLogEntry): void => {
    const key = entryKey(entry);
    const current = map.get(key);
    if (!current || !entriesEqual(current, entry)) {
      map.set(key, entry);
      changed = true;
    }
  };

  for (const entry of updated) upsert(entry);
  for (const entry of added) upsert(entry);

  if (!changed) return false;
  saveHistory(Array.from(map.values()));
  return true;
}

export function triggerExportJson(entriesToExport: ActivityLogEntry[]): number {
  const payload = JSON.stringify(entriesToExport, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `qpm-activity-log-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return entriesToExport.length;
}
