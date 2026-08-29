// Observed Bad Luck Protection streaks. The game's real counters are server-only
// (player schema `serverOnly.pityCounters` is stripped before the client), so this
// store only counts pulls QPM has watched via `myData.activityLogs` — a rolling
// 25-entry window, so nothing can be backfilled. Crop growth rolls are attributed
// per garden slot (see pityTrackerGarden.ts) so granted mutations never count.

import { storage } from '../utils/storage';
import { subscribeAtomValue } from '../core/atomRegistry';
import { createStoreDiagnostics } from './_storeDiagnostics';
import {
  CAPSULE_PITY_THRESHOLDS,
  GROWTH_PITY_THRESHOLDS,
  RARE_PATCH_VARIANTS,
  PITY_LAUNCH_TS,
  estimatePityCount,
  getPityOutcomes,
  pityBucketFor,
  pityCounterKey,
  pityLaunchFloor,
  type PityKind,
  type PityOutcome,
} from '../catalogs/pityThresholds';
import { getEggSpeciesPityThresholds } from '../catalogs/gameCatalogs';
import { fetchGameAccountInfo } from '../services/gameAccount';
import { getPetActivityEvents, serverEntryKey } from './petActivity';
import { diffGardenSlots, growthMutationOf, readGardenSlots, type SlotMap, type SlotRecord } from './pityTrackerGarden';

const diag = createStoreDiagnostics('storePityTracker', 'pityTracker');

const STORAGE_KEY = 'qpm.pityTracker.v1';
const ENABLED_KEYS: Readonly<Record<PityKind, string>> = {
  seed: 'qpm.pityTracker.enabled.seed.v1',
  egg: 'qpm.pityTracker.enabled.egg.v1',
  capsule: 'qpm.pityTracker.enabled.capsule.v1',
};
// v4: self-correcting estimates + unobserved-pull gaps from lifetime stats.
const CURRENT_VERSION = 4;
const MAX_SEEN_KEYS = 200;
const MAX_HITS = 50;
const MAX_PENDING_GRANTS = 500;
const ACCOUNT_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** A harvest's log entry and its garden patch normally share one update; allow a little drift. */
const HARVEST_MATCH_WINDOW_MS = 5000;
/** Game keeps this many activity-log entries; an update where all of them are new may have overflowed. */
const ACTIVITY_LOG_CAP = 25;

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

export interface PityTrackerState {
  counters: Record<string, PityCounter>;
  hits: PityHit[];
  account: PityAccount | null;
  /** `${plantSpecies}:${mutation}` → granter log entries not yet matched to a harvest (fallback when no slot matched). */
  pendingGrants: Record<string, number>;
  slotOrigins: SlotMap;
  /** Running total of pulls per kind that happened while QPM was not watching. */
  gaps: Record<PityKind, number>;
  /** Last seen lifetime totals from `myData.stats`, the source for gap detection. */
  lifetime: PityLifetime;
  seenKeys: string[];
  observedSince: number;
  meta: { version: number; updatedAt: number };
}

type ActivityEntry = { action?: unknown; timestamp?: unknown; parameters?: unknown };

interface PendingCrop { species: string; bucket: string; mutation: string | null; at: number; expires: number }
interface PendingGone { slot: SlotRecord; expires: number }

function defaultState(): PityTrackerState {
  const now = Date.now();
  return {
    counters: {},
    hits: [],
    account: null,
    pendingGrants: {},
    slotOrigins: {},
    gaps: { egg: 0, seed: 0, capsule: 0 },
    lifetime: { eggs: null, crops: null, capsules: {} },
    seenKeys: [],
    observedSince: now,
    meta: { version: CURRENT_VERSION, updatedAt: now },
  };
}

let state: PityTrackerState = defaultState();
let started = false;
let seeded = false;
let unsubscribe: (() => void) | null = null;
const seen = new Set<string>();
const listeners = new Set<(s: PityTrackerState) => void>();
const enabled: Record<PityKind, boolean> = { seed: true, egg: true, capsule: true };
const enabledListeners = new Set<(kind: PityKind, value: boolean) => void>();
let pendingCrops: PendingCrop[] = [];
let pendingGone: PendingGone[] = [];
let historyReplayed = false;
/** Pulls applied during the current update, per kind — compared against lifetime totals on overflow. */
let observedNow: Record<PityKind, number> = { egg: 0, seed: 0, capsule: 0 };

function notify(): void {
  for (const cb of listeners) {
    try { cb(state); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'notify' }, error); }
  }
}

function persist(): void {
  state.seenKeys = Array.from(seen).slice(-MAX_SEEN_KEYS);
  state.meta.updatedAt = Date.now();
  try { storage.set(STORAGE_KEY, state); } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'pity', key: STORAGE_KEY }, error);
  }
}

function migrateCounters(counters: Record<string, Partial<PityCounter>>): Record<string, PityCounter> {
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

function load(): void {
  try {
    const saved = storage.get<Partial<PityTrackerState> | null>(STORAGE_KEY, null);
    const version = saved?.meta?.version;
    state = saved && saved.counters && (version === CURRENT_VERSION || version === 3)
      ? {
        ...defaultState(),
        ...saved,
        counters: migrateCounters(saved.counters),
        hits: Array.isArray(saved.hits) ? saved.hits : [],
        account: saved.account ?? null,
        pendingGrants: saved.pendingGrants ?? {},
        slotOrigins: saved.slotOrigins ?? {},
        gaps: { ...defaultState().gaps, ...(saved.gaps ?? {}) },
        lifetime: { ...defaultState().lifetime, ...(saved.lifetime ?? {}) },
        seenKeys: Array.isArray(saved.seenKeys) ? saved.seenKeys : [],
        meta: { version: CURRENT_VERSION, updatedAt: saved.meta?.updatedAt ?? Date.now() },
      }
      : defaultState();
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'load', key: STORAGE_KEY }, error);
    state = defaultState();
  }
  seen.clear();
  for (const key of state.seenKeys) seen.add(key);
}

function entryKey(entry: ActivityEntry): string {
  return serverEntryKey(entry) ?? `${String(entry.timestamp)}|${String(entry.action)}`;
}

function rememberKey(key: string): void {
  seen.add(key);
  if (seen.size > MAX_SEEN_KEYS) {
    const excess = seen.size - MAX_SEEN_KEYS;
    const iter = seen.values();
    for (let i = 0; i < excess; i++) {
      const v = iter.next().value;
      if (v !== undefined) seen.delete(v);
    }
  }
}

function counterFor(kind: PityKind, key: string, now: number): PityCounter {
  let counter = state.counters[key];
  if (!counter) {
    counter = {
      misses: 0, hits: 0, totalPulls: 0, lastHitAt: null, lastPullAt: null, observedSince: now, correction: 0, gapBase: state.gaps[kind],
    };
    state.counters[key] = counter;
  }
  return counter;
}

/** Pulls of this kind that happened unobserved since the counter's last reset — a hit in there would have reset the game's counter. */
export function pityGapFor(snapshot: PityTrackerState, kind: PityKind, counter: PityCounter): number {
  return Math.max(0, (snapshot.gaps[kind] ?? 0) - counter.gapBase);
}

function recordHit(key: string, counter: PityCounter, outcome: PityOutcome | undefined, at: number): void {
  if (!outcome) return;
  state.hits.push({
    key,
    at,
    observedMisses: counter.misses,
    estimate: estimatePityCount(counter, outcome.thresholdPulls, state.account?.createdAt ?? null),
    thresholdPulls: outcome.thresholdPulls,
  });
  if (state.hits.length > MAX_HITS) state.hits.splice(0, state.hits.length - MAX_HITS);
}

/**
 * A pull is forced once threshold-1 misses are on the counter. A miss arriving with the
 * estimate already there proves the real counter was lower: clamp it to threshold-1.
 */
function correctAfterMiss(counter: PityCounter, outcome: PityOutcome | undefined): void {
  if (!outcome) return;
  const createdAt = state.account?.createdAt ?? null;
  const cap = outcome.thresholdPulls - 1;
  if (estimatePityCount(counter, outcome.thresholdPulls, createdAt) <= cap) return;
  const floor = counter.hits === 0 ? pityLaunchFloor(outcome.thresholdPulls, createdAt) : 0;
  counter.correction = cap - floor - counter.misses;
}

/** One roll: `hitId` resets its counter; every other candidate takes a miss. */
function recordRoll(kind: PityKind, itemId: string, candidates: string[], hitId: string | null, at: number): void {
  const outcomes = getPityOutcomes({ kind, id: itemId });
  for (const outcomeId of candidates) {
    const key = pityCounterKey(kind, itemId, outcomeId);
    const counter = counterFor(kind, key, at);
    const outcome = outcomes.find((o) => o.outcomeId === outcomeId);
    counter.totalPulls++;
    counter.lastPullAt = at;
    if (outcomeId === hitId) {
      recordHit(key, counter, outcome, at);
      counter.hits++;
      counter.misses = 0;
      counter.lastHitAt = at;
      counter.correction = 0;
      counter.gapBase = state.gaps[kind];
    } else {
      counter.misses++;
      correctAfterMiss(counter, outcome);
    }
  }
}

function grantKey(plantSpecies: string, mutation: string): string {
  return `${pityBucketFor(plantSpecies)}:${mutation}`;
}

/** Pet abilities log `{ pet, growSlot: { species, … }, mutation }` — fallback attribution when a harvest has no slot match. */
function recordGrant(params: Record<string, unknown>): boolean {
  const growSlot = asRecord(params.growSlot);
  const species = growSlot && typeof growSlot.species === 'string' ? growSlot.species : null;
  const mutation = typeof params.mutation === 'string' ? params.mutation : null;
  if (!species || !mutation || !(mutation in GROWTH_PITY_THRESHOLDS)) return false;
  const key = grantKey(species, mutation);
  state.pendingGrants[key] = Math.min(MAX_PENDING_GRANTS, (state.pendingGrants[key] ?? 0) + 1);
  return true;
}

function consumeGrant(cropSpecies: string, mutation: string | null): boolean {
  if (!mutation) return false;
  const key = grantKey(cropSpecies, mutation);
  const pending = state.pendingGrants[key] ?? 0;
  if (pending <= 0) return false;
  if (pending === 1) delete state.pendingGrants[key];
  else state.pendingGrants[key] = pending - 1;
  return true;
}

function normalizeTimestamp(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return Date.now();
  return raw < 1_000_000_000_000 ? raw * 1000 : raw;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function applyEntry(entry: ActivityEntry, now: number): boolean {
  const params = asRecord(entry.parameters);
  if (!params) return false;
  const at = normalizeTimestamp(entry.timestamp);
  const growthIds = Object.keys(GROWTH_PITY_THRESHOLDS);

  switch (entry.action) {
    case 'hatchEgg': {
      if (!enabled.egg) return false;
      const eggId = typeof params.eggId === 'string' ? params.eggId : null;
      const pet = asRecord(params.pet);
      if (!eggId || !pet) return false;
      const species = Object.keys(getEggSpeciesPityThresholds(eggId));
      const hatched = typeof pet.petSpecies === 'string' ? pet.petSpecies : null;
      if (species.length > 0) recordRoll('egg', eggId, species, hatched, at);
      recordRoll('egg', eggId, growthIds, growthMutationOf(pet.mutations), at);
      observedNow.egg++;
      return true;
    }
    case 'harvest': {
      if (!enabled.seed) return false;
      if (!Array.isArray(params.crops)) return false;
      let changed = false;
      for (const crop of params.crops) {
        const rec = asRecord(crop);
        const species = rec && typeof rec.species === 'string' ? rec.species : null;
        if (!species) continue;
        const bucket = pityBucketFor(species);
        const variant = RARE_PATCH_VARIANTS[bucket];
        if (variant) recordRoll('seed', bucket, [variant], species === variant ? variant : null, at);
        // Growth roll waits for the slot that produced this crop (see matchHarvests).
        pendingCrops.push({ species, bucket, mutation: growthMutationOf(rec?.mutations), at, expires: now + HARVEST_MATCH_WINDOW_MS });
        observedNow.seed++;
        changed = true;
      }
      return changed;
    }
    default: {
      if (params.growSlot && typeof params.mutation === 'string') {
        if (!enabled.seed) return false;
        return recordGrant(params);
      }
      const m = typeof entry.action === 'string' ? /^open([A-Z]\w*)$/.exec(entry.action) : null;
      const toolId = m?.[1];
      const thresholds = toolId ? CAPSULE_PITY_THRESHOLDS[toolId] : undefined;
      if (!toolId || !thresholds || !Array.isArray(params.speciesIds)) return false;
      if (!enabled.capsule) return false;
      const candidates = Object.keys(thresholds);
      for (const pulled of params.speciesIds) {
        recordRoll('capsule', toolId, candidates, typeof pulled === 'string' ? pulled : null, at);
        observedNow.capsule++;
      }
      return true;
    }
  }
}

/** Game guide: granted mutations neither reset a counter nor count as misses; unknown origins are skipped, never guessed. */
function applyGrowthRoll(bucket: string, slot: SlotRecord, at: number): boolean {
  if (slot.origin === 'granted' || slot.origin === 'unknown') return false;
  recordRoll('seed', bucket, Object.keys(GROWTH_PITY_THRESHOLDS), slot.origin === 'natural' ? slot.mutation : null, at);
  return true;
}

/** Pairs harvested crops with the slots that vanished, by species bucket + growth mutation. */
function matchHarvests(now: number): boolean {
  let changed = false;
  for (const gone of pendingGone) {
    const bucket = pityBucketFor(gone.slot.species);
    const idx = pendingCrops.findIndex((c) => c.bucket === bucket && c.mutation === gone.slot.mutation);
    if (idx === -1) continue;
    const crop = pendingCrops.splice(idx, 1)[0];
    gone.expires = 0;
    if (crop && applyGrowthRoll(bucket, gone.slot, crop.at)) changed = true;
  }
  pendingGone = pendingGone.filter((g) => g.expires > now);
  // Crops with no slot to attribute them to (slot unseen before this session) fall back to the granter-log ledger.
  const stale = pendingCrops.filter((c) => c.expires <= now);
  pendingCrops = pendingCrops.filter((c) => c.expires > now);
  for (const crop of stale) {
    if (consumeGrant(crop.species, crop.mutation)) continue;
    recordRoll('seed', crop.bucket, Object.keys(GROWTH_PITY_THRESHOLDS), crop.mutation, crop.at);
    changed = true;
  }
  return changed;
}

function readLifetime(data: Record<string, unknown>): PityLifetime {
  const stats = asRecord(data.stats);
  const player = asRecord(stats?.player);
  const capsules: Record<string, number> = {};
  for (const [toolId, raw] of Object.entries(asRecord(stats?.capsulePulls) ?? {})) {
    const opens = asCount(asRecord(raw)?.numOpens);
    if (opens !== null) capsules[toolId] = opens;
  }
  return { eggs: asCount(player?.numEggsHatched), crops: asCount(player?.numCropsHarvested), capsules };
}

function addGap(kind: PityKind, pulls: number): boolean {
  if (!(pulls > 0)) return false;
  state.gaps[kind] += pulls;
  return true;
}

function capsuleDelta(prev: Record<string, number>, next: Record<string, number>): number {
  let total = 0;
  for (const [toolId, opens] of Object.entries(next)) {
    const before = prev[toolId];
    if (before !== undefined) total += opens - before;
  }
  return total;
}

/**
 * Lifetime totals grow with every pull, watched or not. At session start the whole delta is a gap;
 * mid-session only a full-buffer update (possible overflow) is checked, sized by delta minus what was applied.
 */
function detectGaps(lifetime: PityLifetime, checkOverflow: boolean): boolean {
  const prev = state.lifetime;
  let changed = false;
  const compare = (kind: PityKind, before: number | null, after: number | null): void => {
    if (before === null || after === null) return;
    if (!enabled[kind]) return;
    const unobserved = after - before - (seeded ? observedNow[kind] : 0);
    if (addGap(kind, unobserved)) changed = true;
  };
  if (!seeded || checkOverflow) {
    compare('egg', prev.eggs, lifetime.eggs);
    compare('seed', prev.crops, lifetime.crops);
    compare('capsule', 0, capsuleDelta(prev.capsules, lifetime.capsules));
  }
  state.lifetime = {
    eggs: lifetime.eggs ?? prev.eggs,
    crops: lifetime.crops ?? prev.crops,
    capsules: { ...prev.capsules, ...lifetime.capsules },
  };
  return changed;
}

/**
 * Fresh store only: rebuild egg streaks from QPM's persisted pet-activity history. Its ids
 * are the same `ts|action|petId` keys, so replayed hatches are marked seen and never counted
 * twice. The pet-activity store initialises after this one, so this retries until it has events.
 */
function replayHatchHistory(): boolean {
  if (historyReplayed) return false;
  if (!enabled.egg) return false;
  if (Object.keys(state.counters).length > 0 || state.hits.length > 0) { historyReplayed = true; return false; }
  const all = getPetActivityEvents();
  if (all.length === 0) return false;
  historyReplayed = true;
  const events = all
    .filter((e) => e.kind === 'hatch' && e.source === 'server' && e.ts >= PITY_LAUNCH_TS)
    .sort((a, b) => a.ts - b.ts);
  let applied = 0;
  for (const event of events) {
    const egg = event.targets.find((target) => target.kind === 'egg');
    if (!egg || egg.kind !== 'egg') continue;
    const species = Object.keys(getEggSpeciesPityThresholds(egg.eggId));
    if (species.length > 0) recordRoll('egg', egg.eggId, species, event.pet.species, event.ts);
    recordRoll('egg', egg.eggId, Object.keys(GROWTH_PITY_THRESHOLDS), growthMutationOf(event.pet.mutations), event.ts);
    rememberKey(event.id);
    applied++;
  }
  const first = events[0];
  if (applied > 0 && first) state.observedSince = Math.min(state.observedSince, first.ts);
  return applied > 0;
}

function processMyData(rawValue: unknown): void {
  const data = asRecord(rawValue);
  if (!data) return;
  const now = Date.now();
  let changed = false;
  observedNow = { egg: 0, seed: 0, capsule: 0 };
  if (replayHatchHistory()) changed = true;

  const logs = Array.isArray(data.activityLogs) ? data.activityLogs : data.activityLog;
  let newEntries = 0;
  if (Array.isArray(logs)) {
    for (const raw of logs) {
      const entry = asRecord(raw) as ActivityEntry | null;
      if (!entry) continue;
      const key = entryKey(entry);
      if (seen.has(key)) continue;
      rememberKey(key);
      newEntries++;
      // The first snapshot after start is history, not new pulls.
      if (seeded && applyEntry(entry, now)) changed = true;
    }
  }
  const overflowed = seeded && Array.isArray(logs) && logs.length >= ACTIVITY_LOG_CAP && newEntries === logs.length;
  if (detectGaps(readLifetime(data), overflowed)) changed = true;

  const prevSlots = state.slotOrigins;
  const { next, gone } = diffGardenSlots(prevSlots, readGardenSlots(data), !seeded);
  state.slotOrigins = next;
  const gardenDirty = gone.length > 0
    || Object.keys(next).length !== Object.keys(prevSlots).length
    || Object.keys(next).some((key) => next[key] !== prevSlots[key]);
  if (seeded) {
    for (const slot of gone) pendingGone.push({ slot, expires: now + HARVEST_MATCH_WINDOW_MS });
    if (matchHarvests(now)) changed = true;
  }

  if (!seeded) {
    seeded = true;
    persist();
    if (changed) notify();
    return;
  }
  if (changed || gardenDirty) persist();
  if (changed) notify();
}

function refreshAccount(): void {
  const account = state.account;
  if (account && account.createdAt !== null && Date.now() - account.fetchedAt < ACCOUNT_REFRESH_MS) return;
  fetchGameAccountInfo()
    .then((info) => {
      if (!started || !info) return;
      state.account = { createdAt: info.createdAt, fetchedAt: Date.now() };
      persist();
      notify();
    })
    .catch((error) => diag.warn('QPM-STORE-003', { phase: 'account' }, error));
}

export function startPityTracker(): void {
  if (started) return;
  started = true;
  seeded = false;
  pendingCrops = [];
  pendingGone = [];
  historyReplayed = false;
  diag.register('Loading observed pity streaks and subscribing to myData');
  loadEnabled();
  load();
  refreshAccount();

  void subscribeAtomValue('myData', (value) => {
    try { processMyData(value); } catch (error) {
      diag.warn('QPM-STORE-003', { phase: 'processMyData' }, error);
    }
  })
    .then((unsub) => {
      if (!unsub) { diag.warn('QPM-STORE-002', { atom: 'myData' }); return; }
      if (!started) { unsub(); return; }
      unsubscribe = unsub;
    })
    .catch((error) => diag.error('QPM-STORE-001', { phase: 'subscribe' }, error));

  diag.publishOk('Pity tracker started', {
    counters: Object.keys(state.counters).length,
    observedSince: state.observedSince,
  });
}

export function stopPityTracker(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  seeded = false;
}

export function getPitySnapshot(): PityTrackerState {
  return state;
}

export function getPityCounter(key: string): PityCounter | null {
  return state.counters[key] ?? null;
}

export function getPityAccountCreatedAt(): number | null {
  return state.account?.createdAt ?? null;
}

export function subscribePity(listener: (s: PityTrackerState) => void): () => void {
  listeners.add(listener);
  try { listener(state); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'subscribeInitial' }, error); }
  return () => { listeners.delete(listener); };
}

function loadEnabled(): void {
  for (const kind of ['seed', 'egg', 'capsule'] as const) {
    try { enabled[kind] = storage.get<boolean>(ENABLED_KEYS[kind], true); }
    catch (error) { diag.warn('QPM-STORE-001', { phase: 'loadEnabled', kind }, error); enabled[kind] = true; }
  }
}

export function isPityKindEnabled(kind: PityKind): boolean {
  return enabled[kind];
}

/** Persist the per-kind toggle. Disabling stops future counting/gap detection for that kind
 * and re-enabling resumes from the current lifetime totals (no backfill of the disabled window). */
export function setPityKindEnabled(kind: PityKind, value: boolean): void {
  if (enabled[kind] === value) return;
  enabled[kind] = value;
  try { storage.set(ENABLED_KEYS[kind], value); } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'pityEnabled', key: ENABLED_KEYS[kind] }, error);
  }
  for (const cb of enabledListeners) {
    try { cb(kind, value); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'enabledNotify' }, error); }
  }
}

export function subscribePityEnabled(listener: (kind: PityKind, value: boolean) => void): () => void {
  enabledListeners.add(listener);
  return () => { enabledListeners.delete(listener); };
}

/** Clears observed streaks, hits and gaps; keeps the seen-key ledger, slot origins, lifetime totals and account info. */
export function resetPityTracker(): void {
  const keys = Array.from(seen);
  const { account, slotOrigins, lifetime } = state;
  state = defaultState();
  state.account = account;
  state.slotOrigins = slotOrigins;
  state.lifetime = lifetime;
  seen.clear();
  for (const key of keys) seen.add(key);
  // A reset rebuilds from QPM's own hatch history on the next update.
  historyReplayed = false;
  persist();
  notify();
}
