// Persistent event log for the Pet Teams feature.
// Tracks ability, feed, and team-apply events with a 5000-event cap and 30-day TTL.

import { storage } from '../utils/storage';
import type { PetLogEvent, PetLogEventType } from '../types/petTeams';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storePetTeamsLogs', 'petTeamsLogs');

const STORAGE_KEY = 'qpm.petTeams.logs.v1';
const MAX_EVENTS = 5000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 2000;

let cachedLogs: PetLogEvent[] = [];
const listeners = new Set<(logs: PetLogEvent[]) => void>();
let feedPetListener: ((e: Event) => void) | null = null;
let persistTimer: number | null = null;
let unloadHandler: (() => void) | null = null;

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pruneOld(events: PetLogEvent[]): PetLogEvent[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  const filtered = events.filter(e => e.timestamp >= cutoff);
  if (filtered.length > MAX_EVENTS) {
    return filtered.slice(filtered.length - MAX_EVENTS);
  }
  return filtered;
}

function persistNow(): void {
  try {
    storage.set(STORAGE_KEY, cachedLogs);
  } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'logs', key: STORAGE_KEY }, error);
  }
}

function schedulePersist(): void {
  if (persistTimer != null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, PERSIST_DEBOUNCE_MS) as unknown as number;
}

function flushPersist(): void {
  if (persistTimer != null) {
    window.clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistNow();
}

function notify(): void {
  if (listeners.size === 0) return;
  const snapshot = [...cachedLogs];
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      diag.warn('QPM-STORE-003', { phase: 'notify' }, error);
    }
  }
}

function appendEvent(event: PetLogEvent): void {
  cachedLogs.push(event);
  if (cachedLogs.length > MAX_EVENTS * 1.1) {
    cachedLogs = pruneOld(cachedLogs);
  }
  schedulePersist();
  notify();
}

export function initPetTeamsLogs(): void {
  diag.register('Loading pet teams event logs from storage');
  try {
    const raw = storage.get<PetLogEvent[]>(STORAGE_KEY, []);
    cachedLogs = pruneOld(Array.isArray(raw) ? raw : []);
    diag.log.debug(`Loaded ${cachedLogs.length} events`);
  } catch (error) {
    cachedLogs = [];
    diag.warn('QPM-STORE-001', { phase: 'load', key: STORAGE_KEY }, error);
  }

  // Subscribe to qpm:feedPet CustomEvents dispatched by instantFeed.ts
  feedPetListener = (e: Event) => {
    const { petItemId, petName, petSpecies, cropSpecies, usedFavoriteFallback } =
      (e as CustomEvent<{
        petItemId?: string;
        petName?: string;
        petSpecies?: string;
        cropSpecies?: string;
        usedFavoriteFallback?: boolean;
      }>).detail ?? {};
    logFeedEvent(
      petItemId ?? '',
      petName ?? null,
      petSpecies ?? null,
      cropSpecies ?? '?',
      usedFavoriteFallback ?? false,
    );
  };
  window.addEventListener('qpm:feedPet', feedPetListener);

  unloadHandler = () => flushPersist();
  window.addEventListener('pagehide', unloadHandler);
  window.addEventListener('beforeunload', unloadHandler);

  diag.publishOk('Pet teams logs initialised', { events: cachedLogs.length });
}

export function stopPetTeamsLogs(): void {
  flushPersist();
  if (feedPetListener) {
    window.removeEventListener('qpm:feedPet', feedPetListener);
    feedPetListener = null;
  }
  if (unloadHandler) {
    window.removeEventListener('pagehide', unloadHandler);
    window.removeEventListener('beforeunload', unloadHandler);
    unloadHandler = null;
  }
  listeners.clear();
}

// Logging helpers

export function logAbilityEvent(
  petItemId: string,
  petName: string | null,
  petSpecies: string | null,
  abilityName: string,
  extra?: Record<string, unknown>,
): void {
  const event: PetLogEvent = {
    id: generateId(),
    type: 'ability',
    petItemId,
    detail: `${petName ?? petSpecies ?? 'Pet'}: ${abilityName}`,
    timestamp: Date.now(),
  };
  if (petName) event.petName = petName;
  if (petSpecies) event.petSpecies = petSpecies;
  if (extra) event.extra = extra;
  appendEvent(event);
}

export function logFeedEvent(
  petItemId: string,
  petName: string | null,
  petSpecies: string | null,
  cropSpecies: string,
  usedFavoriteFallback: boolean,
): void {
  const event: PetLogEvent = {
    id: generateId(),
    type: 'feed',
    petItemId,
    detail: `Fed ${petName ?? petSpecies ?? 'Pet'} → ${cropSpecies}${usedFavoriteFallback ? ' (fav fallback)' : ''}`,
    timestamp: Date.now(),
    extra: { cropSpecies, usedFavoriteFallback },
  };
  if (petName) event.petName = petName;
  if (petSpecies) event.petSpecies = petSpecies;
  appendEvent(event);
}

export function logTeamEvent(
  teamId: string,
  teamName: string,
  appliedCount: number,
  errors: string[],
): void {
  appendEvent({
    id: generateId(),
    type: 'team',
    detail: errors.length === 0
      ? `Applied "${teamName}" (${appliedCount} pets)`
      : `Applied "${teamName}" with ${errors.length} error(s)`,
    timestamp: Date.now(),
    extra: { teamId, teamName, appliedCount, errors },
  });
}

// Read API

export function getLogs(type?: PetLogEventType, limit?: number): PetLogEvent[] {
  let result = type ? cachedLogs.filter(e => e.type === type) : [...cachedLogs];
  if (limit != null && result.length > limit) {
    result = result.slice(result.length - limit);
  }
  return result.reverse(); // newest first
}

export function clearLogs(): void {
  cachedLogs = [];
  flushPersist();
  notify();
}

export function onLogsChange(cb: (logs: PetLogEvent[]) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
