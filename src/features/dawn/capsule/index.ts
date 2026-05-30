// src/features/dawnCapsule/index.ts
// Tracks Dawn Capsule opens via activity log atom.
// Records pull history to local storage and computes rate statistics.

import { log } from '../../../utils/logger';
import { storage } from '../../../utils/storage';
import { getAtomByLabel, subscribeAtom } from '../../../core/jotaiBridge';
import {
  CAPSULE_OPEN_ACTION,
  CAPSULE_PULLS_STORAGE_KEY,
  MAX_PULL_RECORDS,
  DAWN_CAPSULE_RATES,
} from './constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CapsulePullRecord {
  timestamp: number;
  speciesIds: string[];
  capsuleType: string;
}

export interface CapsuleStats {
  totalOpens: number;
  totalSpecies: number;
  speciesDistribution: Record<string, number>;
  expectedRates: Record<string, number>;
  actualRates: Record<string, number>;
  pullsSinceLast: Record<string, number>;
  sessionOpens: number;
  sessionSpecies: string[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pullHistory: CapsulePullRecord[] = [];
let sessionPulls: CapsulePullRecord[] = [];
let myDataUnsubscribe: (() => void) | null = null;
let lastSeenLogLength = 0;
let initialized = false;

const listeners = new Set<(stats: CapsuleStats) => void>();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadHistory(): void {
  const stored = storage.get<CapsulePullRecord[] | null>(CAPSULE_PULLS_STORAGE_KEY, null);
  if (Array.isArray(stored)) {
    pullHistory = stored.slice(-MAX_PULL_RECORDS);
  } else {
    pullHistory = [];
  }
}

function saveHistory(): void {
  if (pullHistory.length > MAX_PULL_RECORDS) {
    pullHistory = pullHistory.slice(-MAX_PULL_RECORDS);
  }
  storage.set(CAPSULE_PULLS_STORAGE_KEY, pullHistory);
}

// ---------------------------------------------------------------------------
// Stats computation
// ---------------------------------------------------------------------------

function computeStats(): CapsuleStats {
  const speciesDistribution: Record<string, number> = {};
  let totalSpecies = 0;

  for (const record of pullHistory) {
    for (const species of record.speciesIds) {
      speciesDistribution[species] = (speciesDistribution[species] ?? 0) + 1;
      totalSpecies++;
    }
  }

  const actualRates: Record<string, number> = {};
  if (totalSpecies > 0) {
    for (const [species, count] of Object.entries(speciesDistribution)) {
      actualRates[species] = count / totalSpecies;
    }
  }

  // Compute "pulls since last" for rare species
  const pullsSinceLast: Record<string, number> = {};
  const rareSpecies = ['Ube', 'Dawnbreaker'];
  for (const rare of rareSpecies) {
    let sinceLast = 0;
    let found = false;
    for (let i = pullHistory.length - 1; i >= 0; i--) {
      for (const species of pullHistory[i]!.speciesIds) {
        if (species === rare) {
          found = true;
          break;
        }
        sinceLast++;
      }
      if (found) break;
    }
    pullsSinceLast[rare] = found ? sinceLast : totalSpecies;
  }

  const sessionSpecies: string[] = [];
  for (const record of sessionPulls) {
    sessionSpecies.push(...record.speciesIds);
  }

  return {
    totalOpens: pullHistory.length,
    totalSpecies,
    speciesDistribution,
    expectedRates: { ...DAWN_CAPSULE_RATES },
    actualRates,
    pullsSinceLast,
    sessionOpens: sessionPulls.length,
    sessionSpecies,
  };
}

function emit(): void {
  const stats = computeStats();
  for (const listener of listeners) {
    try {
      listener(stats);
    } catch (error) {
      log('[CapsuleTracker] listener error', error);
    }
  }
}

// ---------------------------------------------------------------------------
// Activity log processing
// ---------------------------------------------------------------------------

function processActivityLogs(rawValue: unknown): void {
  if (!rawValue || typeof rawValue !== 'object') return;

  // myDataAtom contains activityLog as an array
  const data = rawValue as Record<string, unknown>;
  const activityLog = data.activityLog;
  if (!Array.isArray(activityLog)) return;

  // Only process new entries since last seen
  if (activityLog.length <= lastSeenLogLength) {
    lastSeenLogLength = activityLog.length;
    return;
  }

  const newEntries = activityLog.slice(lastSeenLogLength);
  lastSeenLogLength = activityLog.length;

  let changed = false;
  for (const entry of newEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const logEntry = entry as Record<string, unknown>;

    if (logEntry.action !== CAPSULE_OPEN_ACTION) continue;

    const params = logEntry.parameters as Record<string, unknown> | undefined;
    if (!params) continue;

    const speciesIds = params.speciesIds;
    if (!Array.isArray(speciesIds)) continue;

    const validSpecies = speciesIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (validSpecies.length === 0) continue;

    const timestamp =
      typeof logEntry.timestamp === 'number'
        ? logEntry.timestamp < 1_000_000_000_000
          ? logEntry.timestamp * 1000
          : logEntry.timestamp
        : Date.now();

    const record: CapsulePullRecord = {
      timestamp,
      speciesIds: validSpecies,
      capsuleType: 'DawnCapsule',
    };

    pullHistory.push(record);
    sessionPulls.push(record);
    changed = true;
    log(`[CapsuleTracker] Capsule opened: ${validSpecies.join(', ')}`);
  }

  if (changed) {
    saveHistory();
    emit();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startCapsuleTracker(): void {
  if (initialized) return;
  initialized = true;
  lastSeenLogLength = 0;
  sessionPulls = [];
  loadHistory();

  const myDataAtom = getAtomByLabel('myDataAtom');
  if (myDataAtom) {
    void subscribeAtom<unknown>(myDataAtom, (value) => {
      processActivityLogs(value);
    })
      .then((unsubscribe) => {
        if (!initialized) {
          unsubscribe();
          return;
        }
        myDataUnsubscribe = unsubscribe;
      })
      .catch((error) => {
        log('[CapsuleTracker] Failed to subscribe to myDataAtom', error);
      });
  }

  log('[CapsuleTracker] Started');
}

export function stopCapsuleTracker(): void {
  if (!initialized) return;
  initialized = false;
  myDataUnsubscribe?.();
  myDataUnsubscribe = null;
  listeners.clear();
  lastSeenLogLength = 0;
}

export function subscribeCapsuleStats(listener: (stats: CapsuleStats) => void): () => void {
  listeners.add(listener);
  if (initialized) {
    try {
      listener(computeStats());
    } catch (error) {
      log('[CapsuleTracker] immediate listener error', error);
    }
  }
  return () => { listeners.delete(listener); };
}

export function getCapsuleStats(): CapsuleStats {
  return computeStats();
}

export function getCapsulePullHistory(): readonly CapsulePullRecord[] {
  return pullHistory;
}
