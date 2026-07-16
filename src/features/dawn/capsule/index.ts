import { storage } from '../../../utils/storage';
import { subscribeAtomValue } from '../../../core/atomRegistry';
import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';
import {
  CAPSULE_OPEN_ACTION,
  CAPSULE_PULLS_STORAGE_KEY,
  MAX_PULL_RECORDS,
  DAWN_CAPSULE_RATES,
} from './constants';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:dawnCapsule';
const FEATURE_NAME = 'dawnCapsule';
const diag = createNamedLogger(FEATURE_SUBSYSTEM);
let busRegistered = false;

function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(FEATURE_SUBSYSTEM, { category: 'feature', status: 'starting' });
}

function publishOk(message: string, metrics?: Record<string, number | string>): void {
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

function warnFeature(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

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

let pullHistory: CapsulePullRecord[] = [];
let sessionPulls: CapsulePullRecord[] = [];
let myDataUnsubscribe: (() => void) | null = null;
let lastSeenLogLength = 0;
let initialized = false;

const listeners = new Set<(stats: CapsuleStats) => void>();

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
      warnFeature('QPM-FEATURE-004', { what: 'listener:stats' }, error);
    }
  }
}

function processActivityLogs(rawValue: unknown): void {
  if (!rawValue || typeof rawValue !== 'object') return;

  const data = rawValue as Record<string, unknown>;
  const activityLog = data.activityLog;
  if (!Array.isArray(activityLog)) return;

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
    diag.debug(`Capsule opened: ${validSpecies.join(', ')}`);
  }

  if (changed) {
    saveHistory();
    emit();
  }
}

export function startCapsuleTracker(): void {
  if (initialized) return;
  initialized = true;
  lastSeenLogLength = 0;
  sessionPulls = [];
  loadHistory();
  ensureBusRegistered();

  void subscribeAtomValue('myData', (value) => {
    processActivityLogs(value);
  })
    .then((unsubscribe) => {
      if (!unsubscribe) return;
      if (!initialized) {
        unsubscribe();
        return;
      }
      myDataUnsubscribe = unsubscribe;
    })
    .catch((error) => {
      warnFeature('QPM-FEATURE-003', { what: 'subscribe:myData' }, error);
    });

  publishOk('Started', { historyCount: pullHistory.length });
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
      warnFeature('QPM-FEATURE-004', { what: 'listener:immediate' }, error);
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
