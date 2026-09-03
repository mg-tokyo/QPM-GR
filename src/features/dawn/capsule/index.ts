import { storage } from '../../../utils/storage';
import { subscribeAtomValue } from '../../../core/atomRegistry';
import { getToolSpawnWeights } from '../../../catalogs/shopEligibility';
import { createFeatureDiagnostics } from '../../../diagnostics/featureDiagnostics';
import type { Subsystem } from '../../../diagnostics/types';
import {
  CAPSULE_OPEN_ACTION_RE,
  OPEN_ACTION_PREFIX_RE,
  CAPSULE_PULLS_STORAGE_KEY,
  MAX_PULL_RECORDS,
  RARE_PULL_RATE_THRESHOLD,
} from './constants';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:dawnCapsule';
const { diag, ensureBusRegistered, publishOk, warnFeature } =
  createFeatureDiagnostics(FEATURE_SUBSYSTEM, 'dawnCapsule');

export interface CapsulePullRecord {
  timestamp: number;
  speciesIds: string[];
  /** Tool id of the capsule (`DawnCapsule`, …). */
  capsuleType: string;
}

export interface CapsuleTypeStats {
  toolId: string;
  totalOpens: number;
  totalSpecies: number;
  speciesDistribution: Record<string, number>;
  /** Normalised from the tool blueprint's `floraSpawnWeights`; empty until catalogs load. */
  expectedRates: Record<string, number>;
  actualRates: Record<string, number>;
  /** Local count only — the game's pity counters are server-side and not mirrored here. */
  pullsSinceLast: Record<string, number>;
  sessionOpens: number;
  sessionSpecies: string[];
}

export interface CapsuleStats {
  byCapsule: Record<string, CapsuleTypeStats>;
  totalOpens: number;
  sessionOpens: number;
}

let pullHistory: CapsulePullRecord[] = [];
let sessionPulls: CapsulePullRecord[] = [];
let myDataUnsubscribe: (() => void) | null = null;
let lastSeenLogLength = 0;
let initialized = false;

const listeners = new Set<(stats: CapsuleStats) => void>();

function loadHistory(): void {
  const stored = storage.get<CapsulePullRecord[] | null>(CAPSULE_PULLS_STORAGE_KEY, null);
  pullHistory = Array.isArray(stored) ? stored.slice(-MAX_PULL_RECORDS) : [];
}

function saveHistory(): void {
  if (pullHistory.length > MAX_PULL_RECORDS) {
    pullHistory = pullHistory.slice(-MAX_PULL_RECORDS);
  }
  storage.set(CAPSULE_PULLS_STORAGE_KEY, pullHistory);
}

function resolveCapsuleToolId(action: unknown): string | null {
  if (typeof action !== 'string') return null;
  const direct = CAPSULE_OPEN_ACTION_RE.exec(action);
  if (direct) return direct[1]!;
  const generic = OPEN_ACTION_PREFIX_RE.exec(action);
  if (generic && Object.keys(getToolSpawnWeights(generic[1]!)).length > 0) return generic[1]!;
  return null;
}

function computeExpectedRates(toolId: string): Record<string, number> {
  const weights = getToolSpawnWeights(toolId);
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  if (total <= 0) return {};
  const rates: Record<string, number> = {};
  for (const [species, weight] of Object.entries(weights)) rates[species] = weight / total;
  return rates;
}

function computeTypeStats(toolId: string, records: CapsulePullRecord[], session: CapsulePullRecord[]): CapsuleTypeStats {
  const speciesDistribution: Record<string, number> = {};
  let totalSpecies = 0;
  for (const record of records) {
    for (const species of record.speciesIds) {
      speciesDistribution[species] = (speciesDistribution[species] ?? 0) + 1;
      totalSpecies++;
    }
  }

  const actualRates: Record<string, number> = {};
  if (totalSpecies > 0) {
    for (const [species, count] of Object.entries(speciesDistribution)) actualRates[species] = count / totalSpecies;
  }

  const expectedRates = computeExpectedRates(toolId);
  const pullsSinceLast: Record<string, number> = {};
  for (const [rare, rate] of Object.entries(expectedRates)) {
    if (rate >= RARE_PULL_RATE_THRESHOLD) continue;
    let sinceLast = 0;
    let found = false;
    for (let i = records.length - 1; i >= 0 && !found; i--) {
      for (const species of records[i]!.speciesIds) {
        if (species === rare) { found = true; break; }
        sinceLast++;
      }
    }
    pullsSinceLast[rare] = found ? sinceLast : totalSpecies;
  }

  const sessionSpecies: string[] = [];
  for (const record of session) sessionSpecies.push(...record.speciesIds);

  return {
    toolId,
    totalOpens: records.length,
    totalSpecies,
    speciesDistribution,
    expectedRates,
    actualRates,
    pullsSinceLast,
    sessionOpens: session.length,
    sessionSpecies,
  };
}

function computeStats(): CapsuleStats {
  const historyByType = new Map<string, CapsulePullRecord[]>();
  for (const record of pullHistory) {
    const bucket = historyByType.get(record.capsuleType) ?? [];
    bucket.push(record);
    historyByType.set(record.capsuleType, bucket);
  }
  const sessionByType = new Map<string, CapsulePullRecord[]>();
  for (const record of sessionPulls) {
    const bucket = sessionByType.get(record.capsuleType) ?? [];
    bucket.push(record);
    sessionByType.set(record.capsuleType, bucket);
  }

  const byCapsule: Record<string, CapsuleTypeStats> = {};
  for (const [toolId, records] of historyByType) {
    byCapsule[toolId] = computeTypeStats(toolId, records, sessionByType.get(toolId) ?? []);
  }

  return { byCapsule, totalOpens: pullHistory.length, sessionOpens: sessionPulls.length };
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
  // Game key is `activityLogs` (plural, verified v1019); singular kept as a fallback.
  const activityLog = Array.isArray(data.activityLogs) ? data.activityLogs : data.activityLog;
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

    const toolId = resolveCapsuleToolId(logEntry.action);
    if (!toolId) continue;

    const params = logEntry.parameters as Record<string, unknown> | undefined;
    if (!params) continue;

    // Dawn logs `speciesIds` (flora); Amber logs `toolIds` (crystals). Same pull
    // semantics — Amber tool ids are stored in the record's speciesIds field (v1 shape).
    const rawPulls = Array.isArray(params.speciesIds) ? params.speciesIds
      : Array.isArray(params.toolIds) ? params.toolIds : null;
    if (!rawPulls) continue;

    const validSpecies = rawPulls.filter(
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
      capsuleType: toolId,
    };

    pullHistory.push(record);
    sessionPulls.push(record);
    changed = true;
    diag.debug(`${toolId} opened: ${validSpecies.join(', ')}`);
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
