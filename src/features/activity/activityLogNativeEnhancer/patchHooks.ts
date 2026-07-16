import { getAtomByLabel } from '../../../core/jotaiBridge';
import { warnFeature } from './_diagnostics';
import type { ActivityLogEntry, OrderFilter } from './types';
import { S } from './state';
import {
  isRecord,
  normalizeList,
  extractActivityArray,
  stableStringify,
  deepClone,
  findAtomReadKey,
  isReplaySafeEntry,
  trimAndSortHistory,
  entryKey,
  entriesEqual,
} from './parsing';
import { getFilteredHistoryEntries, getOrderedHistoryRefs } from './virtualList';

export function buildDisplayLogsWithHistory(
  realLogs: ActivityLogEntry[],
  order: OrderFilter,
  maxEntries?: number | null,
  startIndex = 0,
): ActivityLogEntry[] {
  const map = new Map<string, ActivityLogEntry>();
  for (const entry of S.history) {
    if (!isReplaySafeEntry(entry)) continue;
    map.set(entryKey(entry), entry);
  }
  for (const entry of realLogs) {
    if (!isReplaySafeEntry(entry)) continue;
    const key = entryKey(entry);
    const existing = map.get(key);
    if (!existing || !entriesEqual(existing, entry)) {
      map.set(key, entry);
    }
  }
  const merged = trimAndSortHistory(Array.from(map.values()));
  merged.sort((a, b) => (order === 'oldest' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp));
  const start = Math.max(0, Math.min(merged.length, Math.floor(startIndex)));
  const limit = Number.isFinite(maxEntries)
    ? Math.max(0, Math.min(merged.length - start, Math.floor(maxEntries as number)))
    : (merged.length - start);
  return merged.slice(start, start + limit).map((entry) => deepClone(entry));
}

export function getOrderedHistory(order: OrderFilter, maxEntries?: number, startIndex = 0): ActivityLogEntry[] {
  const refs = getOrderedHistoryRefs(order);
  const start = Math.max(0, Math.min(refs.length, Math.floor(startIndex)));
  const limit = Number.isFinite(maxEntries)
    ? Math.max(0, Math.min(refs.length - start, Math.floor(maxEntries as number)))
    : (refs.length - start);
  const out: ActivityLogEntry[] = [];
  for (let index = start; index < start + limit; index += 1) {
    out.push(deepClone(refs[index]!));
  }
  return out;
}

export function uninstallMyDataReadPatch(): void {
  if (!S.patchedMyDataAtom || !S.patchedMyDataReadKey || !S.patchedMyDataReadOriginal) return;
  try {
    S.patchedMyDataAtom[S.patchedMyDataReadKey] = S.patchedMyDataReadOriginal;
  } catch {}
  S.patchedMyDataAtom = null;
  S.patchedMyDataReadKey = null;
  S.patchedMyDataReadOriginal = null;
  S.readPatchStartIndex = 0;
  S.readPatchMaxEntries = null;
}

export function installMyDataReadPatch(): boolean {
  if (S.patchedMyDataAtom && S.patchedMyDataReadKey && S.patchedMyDataReadOriginal) {
    S.replayMode = 'read_patch';
    return true;
  }

  const atom = getAtomByLabel('myDataAtom');
  if (!atom) return false;
  const readKey = findAtomReadKey(atom);
  if (!readKey) return false;
  const original = (atom as Record<string, unknown>)[readKey];
  if (typeof original !== 'function') return false;

  const wrapped = function patchedActivityLogRead(get: unknown): unknown {
    const real = (original as Function)(get);
    if (!isRecord(real)) return real;
    const realLogs = normalizeList(extractActivityArray(real));
    const mergedLogs = S.virtualMode === 'virtual-expanded'
      ? (() => {
          const filtered = getFilteredHistoryEntries(S.readPatchOrder);
          const total = filtered.length;
          const start = Math.max(0, Math.min(total, Math.floor(S.readPatchStartIndex)));
          const end = Math.max(
            start,
            Math.min(
              total,
              start + Math.max(0, Math.floor(S.readPatchMaxEntries ?? (total - start))),
            ),
          );
          return filtered.slice(start, end).map((entry) => deepClone(entry));
        })()
      : buildDisplayLogsWithHistory(realLogs, S.readPatchOrder, S.readPatchMaxEntries, S.readPatchStartIndex);
    S.replayHydratedCount = mergedLogs.length;
    const currentLogs = Array.isArray((real as Record<string, unknown>).activityLogs) ? (real as Record<string, unknown>).activityLogs as unknown[] : null;
    if (currentLogs && currentLogs.length === mergedLogs.length) {
      let same = true;
      for (let index = 0; index < mergedLogs.length; index += 1) {
        const a = currentLogs[index];
        const b = mergedLogs[index];
        if (stableStringify(a) !== stableStringify(b)) {
          same = false;
          break;
        }
      }
      if (same) return real;
    }
    return {
      ...real,
      activityLogs: mergedLogs,
    };
  };

  try {
    (atom as Record<string, unknown>)[readKey] = wrapped;
    S.patchedMyDataAtom = atom;
    S.patchedMyDataReadKey = readKey;
    S.patchedMyDataReadOriginal = original as (...args: unknown[]) => unknown;
    S.replayMode = 'read_patch';
    return true;
  } catch (error) {
    warnFeature('QPM-FEATURE-003', { what: 'patch:install' }, error);
    uninstallMyDataReadPatch();
    return false;
  }
}
