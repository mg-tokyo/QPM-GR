// Observed Bad Luck Protection streaks. The game's real counters are server-only
// (player schema `serverOnly.pityCounters` is stripped before the client), so this
// store only counts pulls QPM has watched via `myData.activityLogs` — a rolling
// 25-entry window, so nothing can be backfilled. Crop growth rolls are attributed
// per garden slot (see pityTrackerGarden.ts) so granted mutations never count.

import { storage } from '../../utils/storage';
import { createStoreDiagnostics } from '../_storeDiagnostics';
import { type PityKind } from '../../catalogs/pityThresholds';
import { serverEntryKey } from '../petActivity';
import { type SlotMap, type SlotRecord } from './garden';
import { loadLog, saveLog, type PullLogEntry } from './log';

export const diag = createStoreDiagnostics('storePityTracker', 'pityTracker');

export const STORAGE_KEY = 'qpm.pityTracker.v1';
export const ENABLED_KEYS: Readonly<Record<PityKind, string>> = {
  seed: 'qpm.pityTracker.enabled.seed.v1',
  egg: 'qpm.pityTracker.enabled.egg.v1',
  capsule: 'qpm.pityTracker.enabled.capsule.v1',
};
// v4: self-correcting estimates + unobserved-pull gaps from lifetime stats.
// v5: egg streaks rebuilt — earlier versions dropped species rolls when the catalog was absent.
// v6: pull log + checkpoint so counters can be rebuilt by replay.
export const CURRENT_VERSION = 6;
export const LOG_STORAGE_KEY = 'qpm.pityTracker.log.v1';
export const MAX_LOG_ENTRIES = 3000;
export const MAX_SEEN_KEYS = 200;
export const MAX_HITS = 50;
export const MAX_PENDING_GRANTS = 500;
export const MAX_PENDING_HATCHES = 500;
export const ACCOUNT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
// While account is still unknown (e.g. JWT was expired at startup), don't
// hammer /me — retry at most this often. Once we have a createdAt, ACCOUNT_REFRESH_MS
// takes over.
export const ACCOUNT_RETRY_MS = 5 * 60 * 1000;
/** A harvest's log entry and its garden patch normally share one update; allow a little drift. */
export const HARVEST_MATCH_WINDOW_MS = 5000;
/** Game keeps this many activity-log entries; an update where all of them are new may have overflowed. */
export const ACTIVITY_LOG_CAP = 25;

export interface PityCounter {
  /** Misses since the last observed hit (or since observation began). */
  misses: number;
  hits: number;
  totalPulls: number;
  lastHitAt: number | null;
  lastPullAt: number | null;
  observedSince: number;
  /** ≤ 0; set when a miss proved the estimate too high (see recordRoll). */
  correction: number;
  /** `gaps[kind]` when this counter was created or last reset. */
  gapBase: number;
}

/** An observed hit, with the estimate QPM held at that moment — the only way to sanity-check the model. */
export interface PityHit {
  key: string;
  at: number;
  observedMisses: number;
  estimate: number;
  thresholdPulls: number;
}

export interface PityAccount {
  createdAt: number | null;
  fetchedAt: number;
}

export interface PityLifetime {
  eggs: number | null;
  crops: number | null;
  capsules: Record<string, number>;
}

export interface PityCheckpoint {
  counters: Record<string, PityCounter>;
  /** ms epoch: pulls at or after this are in the log; earlier ones are folded into `counters`. */
  since: number;
}

/**
 * A hatch seen while the egg catalog was absent. Its species candidates come from the
 * catalog, so the roll waits (persisted) until the egg is known instead of being dropped.
 */
export interface PendingHatch {
  key: string;
  eggId: string;
  species: string | null;
  mutation: string | null;
  at: number;
}

export interface PityTrackerState {
  counters: Record<string, PityCounter>;
  hits: PityHit[];
  account: PityAccount | null;
  /** `${plantSpecies}:${mutation}` → granter log entries not yet matched to a harvest (fallback when no slot matched). */
  pendingGrants: Record<string, number>;
  pendingHatches: PendingHatch[];
  slotOrigins: SlotMap;
  /** Running total of pulls per kind that happened while QPM was not watching. */
  gaps: Record<PityKind, number>;
  /** Last seen lifetime totals from `myData.stats`, the source for gap detection. */
  lifetime: PityLifetime;
  checkpoint: PityCheckpoint;
  /** `${kind}:${itemId}` → relative-imbalance signature a rebuild could not clear
   * (historical, baked into the checkpoint). Suppresses repeat QPM-STORE-005 warns
   * until the deltas change (a genuinely new divergence). */
  acceptedImbalances: Record<string, string>;
  seenKeys: string[];
  observedSince: number;
  meta: { version: number; updatedAt: number };
}

export type ActivityEntry = { action?: unknown; timestamp?: unknown; parameters?: unknown };

export interface PendingCrop { species: string; bucket: string; mutation: string | null; at: number; expires: number }
export interface PendingGone { slot: SlotRecord; expires: number }

export function defaultState(): PityTrackerState {
  const now = Date.now();
  return {
    counters: {},
    hits: [],
    account: null,
    pendingGrants: {},
    pendingHatches: [],
    slotOrigins: {},
    gaps: { egg: 0, seed: 0, capsule: 0 },
    lifetime: { eggs: null, crops: null, capsules: {} },
    checkpoint: { counters: {}, since: now },
    acceptedImbalances: {},
    seenKeys: [],
    observedSince: now,
    meta: { version: CURRENT_VERSION, updatedAt: now },
  };
}

export const ctx = {
  state: defaultState() as PityTrackerState,
  started: false,
  seeded: false,
  unsubscribe: null as (() => void) | null,
  seen: new Set<string>(),
  listeners: new Set<(s: PityTrackerState) => void>(),
  enabled: { seed: true, egg: true, capsule: true } as Record<PityKind, boolean>,
  enabledListeners: new Set<(kind: PityKind, value: boolean) => void>(),
  pendingCrops: [] as PendingCrop[],
  pendingGone: [] as PendingGone[],
  historyReplayed: false,
  observedNow: { egg: 0, seed: 0, capsule: 0 } as Record<PityKind, number>,
  lastAccountAttempt: 0,
  log: [] as PullLogEntry[],
  logDirty: false,
};

export function notify(): void {
  for (const cb of ctx.listeners) {
    try { cb(ctx.state); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'notify' }, error); }
  }
}

export function persist(): void {
  ctx.state.seenKeys = Array.from(ctx.seen).slice(-MAX_SEEN_KEYS);
  ctx.state.meta.updatedAt = Date.now();
  try { storage.set(STORAGE_KEY, ctx.state); } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'pity', key: STORAGE_KEY }, error);
  }
  if (ctx.logDirty) {
    try { saveLog(); ctx.logDirty = false; } catch (error) {
      diag.warn('QPM-STORE-004', { what: 'pityLog', key: LOG_STORAGE_KEY }, error);
    }
  }
}

export function migrateCounters(counters: Record<string, Partial<PityCounter>>): Record<string, PityCounter> {
  const out: Record<string, PityCounter> = {};
  for (const [key, c] of Object.entries(counters)) {
    out[key] = {
      misses: c.misses ?? 0,
      hits: c.hits ?? 0,
      totalPulls: c.totalPulls ?? 0,
      lastHitAt: c.lastHitAt ?? null,
      lastPullAt: c.lastPullAt ?? null,
      observedSince: c.observedSince ?? Date.now(),
      correction: c.correction ?? 0,
      gapBase: c.gapBase ?? 0,
    };
  }
  return out;
}

export function load(): void {
  try {
    const saved = storage.get<Partial<PityTrackerState> | null>(STORAGE_KEY, null);
    const version = saved?.meta?.version;
    ctx.state = saved && saved.counters && typeof version === 'number' && version >= 3 && version <= CURRENT_VERSION
      ? {
        ...defaultState(),
        ...saved,
        counters: migrateCounters(saved.counters),
        hits: Array.isArray(saved.hits) ? saved.hits : [],
        account: saved.account ?? null,
        pendingGrants: saved.pendingGrants ?? {},
        pendingHatches: Array.isArray(saved.pendingHatches) ? saved.pendingHatches : [],
        slotOrigins: saved.slotOrigins ?? {},
        gaps: { ...defaultState().gaps, ...(saved.gaps ?? {}) },
        lifetime: { ...defaultState().lifetime, ...(saved.lifetime ?? {}) },
        acceptedImbalances: saved.acceptedImbalances ?? {},
        seenKeys: Array.isArray(saved.seenKeys) ? saved.seenKeys : [],
        checkpoint: saved.checkpoint && saved.checkpoint.counters
          ? { counters: migrateCounters(saved.checkpoint.counters), since: saved.checkpoint.since ?? Date.now() }
          : { counters: {}, since: Date.now() },
        meta: { version: CURRENT_VERSION, updatedAt: saved.meta?.updatedAt ?? Date.now() },
      }
      : defaultState();
    if (typeof version === 'number' && version < 5) dropEggStreaks();
    if (typeof version === 'number' && version < 6) {
      // Existing counters become the checkpoint; the log starts empty from here.
      ctx.state.checkpoint = { counters: migrateCounters(ctx.state.counters), since: Date.now() };
      ctx.log = [];
      ctx.logDirty = true;
    } else if (version === CURRENT_VERSION) {
      ctx.log = loadLog();
    } else {
      // Fresh or unreadable store: a leftover log would not match the empty checkpoint.
      ctx.log = [];
      ctx.logDirty = true;
    }
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'load', key: STORAGE_KEY }, error);
    ctx.state = defaultState();
    ctx.log = [];
    ctx.logDirty = true;
  }
  ctx.seen.clear();
  for (const key of ctx.state.seenKeys) ctx.seen.add(key);
}

export function isEggKey(key: string): boolean {
  return key.startsWith('egg:');
}

export function hasEggStreaks(): boolean {
  return Object.keys(ctx.state.counters).some(isEggKey) || ctx.state.hits.some((h) => isEggKey(h.key));
}

/** Pre-v5 egg streaks may be missing species rolls; the next update rebuilds them from pet-activity history. */
function dropEggStreaks(): void {
  for (const key of Object.keys(ctx.state.counters)) if (isEggKey(key)) delete ctx.state.counters[key];
  ctx.state.hits = ctx.state.hits.filter((h) => !isEggKey(h.key));
}

export function entryKey(entry: ActivityEntry): string {
  return serverEntryKey(entry) ?? `${String(entry.timestamp)}|${String(entry.action)}`;
}

export function rememberKey(key: string): void {
  ctx.seen.add(key);
  if (ctx.seen.size > MAX_SEEN_KEYS) {
    const excess = ctx.seen.size - MAX_SEEN_KEYS;
    const iter = ctx.seen.values();
    for (let i = 0; i < excess; i++) {
      const v = iter.next().value;
      if (v !== undefined) ctx.seen.delete(v);
    }
  }
}

export function normalizeTimestamp(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return Date.now();
  return raw < 1_000_000_000_000 ? raw * 1000 : raw;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
