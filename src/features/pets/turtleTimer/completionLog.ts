import { log } from '../../../utils/logger';
import { storage } from '../../../utils/storage';
import { COMPLETION_LOG_KEY, MAX_LOG_ENTRIES } from './constants';
import type { CompletionLogEntry } from './types';

let completionLog: CompletionLogEntry[] = [];
const trackedSlots = new Map<string, { startedAt: number; estimatedDuration: number; type: 'plant' | 'egg'; species: string }>();

function loadCompletionLog(): void {
  try {
    const stored = storage.get<CompletionLogEntry[] | null>(COMPLETION_LOG_KEY, null);
    if (Array.isArray(stored)) {
      completionLog = stored.slice(-MAX_LOG_ENTRIES);
    }
  } catch (error) {
    log('⚠️ Failed to load completion log', error);
  }
}

function saveCompletionLog(): void {
  try {
    storage.set(COMPLETION_LOG_KEY, completionLog.slice(-MAX_LOG_ENTRIES));
  } catch (error) {
    log('⚠️ Failed to save completion log', error);
  }
}

export function getCompletionLog(): CompletionLogEntry[] {
  return [...completionLog];
}

export function clearCompletionLog(): void {
  completionLog = [];
  trackedSlots.clear();
  saveCompletionLog();
}

function trackSlotStart(tileId: string, slotIndex: number, type: 'plant' | 'egg', species: string, estimatedMs: number): void {
  const key = `${tileId}:${slotIndex}`;
  trackedSlots.set(key, {
    startedAt: Date.now(),
    estimatedDuration: estimatedMs,
    type,
    species,
  });
}

function trackSlotCompletion(tileId: string, slotIndex: number, hadTurtles: boolean): void {
  const key = `${tileId}:${slotIndex}`;
  const tracked = trackedSlots.get(key);
  if (!tracked) return;

  const completedAt = Date.now();
  const actualDuration = completedAt - tracked.startedAt;

  const entry: CompletionLogEntry = {
    id: `${tileId}:${slotIndex}:${completedAt}`,
    type: tracked.type,
    species: tracked.species,
    tileId,
    slotIndex,
    startedAt: tracked.startedAt,
    completedAt,
    estimatedDuration: tracked.estimatedDuration,
    actualDuration,
    hadTurtles,
  };

  completionLog.push(entry);
  if (completionLog.length > MAX_LOG_ENTRIES) {
    completionLog = completionLog.slice(-MAX_LOG_ENTRIES);
  }
  saveCompletionLog();
  trackedSlots.delete(key);
}
