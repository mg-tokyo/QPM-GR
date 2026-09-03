import { subscribeAtomValue } from '../../core/atomRegistry';
import { storage } from '../../utils/storage';
import {
  CAPSULE_PITY_THRESHOLDS,
  RARE_PATCH_VARIANTS,
  pityBucketFor,
  type PityKind,
} from '../../catalogs/pityThresholds';
import { getGameAccountLastError } from '../../services/gameAccount';
import {
  ACTIVITY_LOG_CAP,
  ENABLED_KEYS,
  HARVEST_MATCH_WINDOW_MS,
  asRecord,
  ctx,
  defaultState,
  diag,
  entryKey,
  load,
  normalizeTimestamp,
  notify,
  persist,
  rememberKey,
  type ActivityEntry,
  type PityCounter,
  type PityTrackerState,
} from './state';
import { applyHatch, drainPendingHatches, replayHatchHistory } from './hatches';
import { recordRoll } from './rolls';
import { recordGrant, matchHarvests } from './harvests';
import { readLifetime, detectGaps } from './gaps';
import { refreshAccount } from './account';
import { diffGardenSlots, growthMutationOf, readGardenSlots } from './garden';
import { healPityViolations } from './invariants';

export type { PityCounter, PityHit, PityAccount, PityLifetime, PendingHatch, PityTrackerState } from './state';
export { pityGapFor } from './rolls';
export type { SlotOrigin, SlotRecord, SlotMap, LiveSlot, GardenDiff } from './garden';
export { growthMutationOf, readGardenSlots, diffGardenSlots } from './garden';
export { rebuildPityItem, rebuildPityAll } from './rebuild';
export { healPityViolations, findPityInvariantViolations } from './invariants';
export type { PullLogEntry } from './log';

export function getPityLog(): readonly import('./log').PullLogEntry[] {
  return ctx.log;
}

function applyEntry(entry: ActivityEntry, now: number): boolean {
  const params = asRecord(entry.parameters);
  if (!params) return false;
  const at = normalizeTimestamp(entry.timestamp);

  switch (entry.action) {
    case 'hatchEgg': {
      if (!ctx.enabled.egg) return false;
      const eggId = typeof params.eggId === 'string' ? params.eggId : null;
      const pet = asRecord(params.pet);
      if (!eggId || !pet) return false;
      applyHatch({
        key: entryKey(entry),
        eggId,
        species: typeof pet.petSpecies === 'string' ? pet.petSpecies : null,
        mutation: growthMutationOf(pet.mutations),
        at,
      });
      ctx.observedNow.egg++;
      return true;
    }
    case 'harvest': {
      if (!ctx.enabled.seed) return false;
      if (!Array.isArray(params.crops)) return false;
      let changed = false;
      for (const crop of params.crops) {
        const rec = asRecord(crop);
        const species = rec && typeof rec.species === 'string' ? rec.species : null;
        if (!species) continue;
        const bucket = pityBucketFor(species);
        const variant = RARE_PATCH_VARIANTS[bucket];
        if (variant) recordRoll('seed', bucket, 'variant', species === variant ? variant : null, at);
        // Growth roll waits for the slot that produced this crop (see matchHarvests).
        ctx.pendingCrops.push({ species, bucket, mutation: growthMutationOf(rec?.mutations), at, expires: now + HARVEST_MATCH_WINDOW_MS });
        ctx.observedNow.seed++;
        changed = true;
      }
      return changed;
    }
    default: {
      if (params.growSlot && typeof params.mutation === 'string') {
        if (!ctx.enabled.seed) return false;
        return recordGrant(params);
      }
      const m = typeof entry.action === 'string' ? /^open([A-Z]\w*)$/.exec(entry.action) : null;
      const toolId = m?.[1];
      const thresholds = toolId ? CAPSULE_PITY_THRESHOLDS[toolId] : undefined;
      // Dawn logs `speciesIds` (flora), Amber logs `toolIds` (crystals) — same pull semantics.
      const pulls = Array.isArray(params.speciesIds) ? params.speciesIds
        : Array.isArray(params.toolIds) ? params.toolIds : null;
      if (!toolId || !thresholds || !pulls) return false;
      if (!ctx.enabled.capsule) return false;
      for (const pulled of pulls) {
        recordRoll('capsule', toolId, 'species', typeof pulled === 'string' ? pulled : null, at);
        ctx.observedNow.capsule++;
      }
      return true;
    }
  }
}

function processMyData(rawValue: unknown): void {
  const data = asRecord(rawValue);
  if (!data) return;
  const now = Date.now();
  let changed = false;
  ctx.observedNow = { egg: 0, seed: 0, capsule: 0 };
  if (replayHatchHistory()) changed = true;
  if (drainPendingHatches()) changed = true;

  const logs = Array.isArray(data.activityLogs) ? data.activityLogs : data.activityLog;
  let newEntries = 0;
  if (Array.isArray(logs)) {
    for (const raw of logs) {
      const entry = asRecord(raw) as ActivityEntry | null;
      if (!entry) continue;
      const key = entryKey(entry);
      if (ctx.seen.has(key)) continue;
      rememberKey(key);
      newEntries++;
      // The first snapshot after start is history, not new pulls.
      if (ctx.seeded && applyEntry(entry, now)) changed = true;
    }
  }
  const overflowed = ctx.seeded && Array.isArray(logs) && logs.length >= ACTIVITY_LOG_CAP && newEntries === logs.length;
  if (detectGaps(readLifetime(data), overflowed)) changed = true;

  const prevSlots = ctx.state.slotOrigins;
  const { next, gone } = diffGardenSlots(prevSlots, readGardenSlots(data), !ctx.seeded);
  ctx.state.slotOrigins = next;
  const gardenDirty = gone.length > 0
    || Object.keys(next).length !== Object.keys(prevSlots).length
    || Object.keys(next).some((key) => next[key] !== prevSlots[key]);
  if (ctx.seeded) {
    for (const slot of gone) ctx.pendingGone.push({ slot, expires: now + HARVEST_MATCH_WINDOW_MS });
    if (matchHarvests(now)) changed = true;
  }

  if (!ctx.seeded) {
    ctx.seeded = true;
    persist();
    if (changed) notify();
    return;
  }
  if (changed || gardenDirty) persist();
  if (changed) notify();
  if (changed) healPityViolations();

  // JWT may have refreshed since startup — throttle inside refreshAccount handles cadence.
  if (ctx.state.account?.createdAt == null) refreshAccount();
}

export function startPityTracker(): void {
  if (ctx.started) return;
  ctx.started = true;
  ctx.seeded = false;
  ctx.pendingCrops = [];
  ctx.pendingGone = [];
  ctx.historyReplayed = false;
  diag.register('Loading observed pity streaks and subscribing to myData');
  loadEnabled();
  load();
  healPityViolations();
  refreshAccount();

  void subscribeAtomValue('myData', (value) => {
    try { processMyData(value); } catch (error) {
      diag.warn('QPM-STORE-003', { phase: 'processMyData' }, error);
    }
  })
    .then((unsub) => {
      if (!unsub) { diag.warn('QPM-STORE-002', { atom: 'myData' }); return; }
      if (!ctx.started) { unsub(); return; }
      ctx.unsubscribe = unsub;
    })
    .catch((error) => diag.error('QPM-STORE-001', { phase: 'subscribe' }, error));

  diag.publishOk('Pity tracker started', {
    counters: Object.keys(ctx.state.counters).length,
    observedSince: ctx.state.observedSince,
  });
}

export function stopPityTracker(): void {
  ctx.unsubscribe?.();
  ctx.unsubscribe = null;
  ctx.started = false;
  ctx.seeded = false;
}

export function getPitySnapshot(): PityTrackerState {
  return ctx.state;
}

export function getPityCounter(key: string): PityCounter | null {
  return ctx.state.counters[key] ?? null;
}

export function getPityAccountCreatedAt(): number | null {
  return ctx.state.account?.createdAt ?? null;
}

/** Why the account fetch last failed (null when it succeeded or has not run). */
export function getPityAccountError(): string | null {
  return getGameAccountLastError();
}

export function subscribePity(listener: (s: PityTrackerState) => void): () => void {
  ctx.listeners.add(listener);
  try { listener(ctx.state); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'subscribeInitial' }, error); }
  return () => { ctx.listeners.delete(listener); };
}

function loadEnabled(): void {
  for (const kind of ['seed', 'egg', 'capsule'] as const) {
    try { ctx.enabled[kind] = storage.get<boolean>(ENABLED_KEYS[kind], true); }
    catch (error) { diag.warn('QPM-STORE-001', { phase: 'loadEnabled', kind }, error); ctx.enabled[kind] = true; }
  }
}

export function isPityKindEnabled(kind: PityKind): boolean {
  return ctx.enabled[kind];
}

/** Persist the per-kind toggle. Disabling stops future counting/gap detection for that kind
 * and re-enabling resumes from the current lifetime totals (no backfill of the disabled window). */
export function setPityKindEnabled(kind: PityKind, value: boolean): void {
  if (ctx.enabled[kind] === value) return;
  ctx.enabled[kind] = value;
  try { storage.set(ENABLED_KEYS[kind], value); } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'pityEnabled', key: ENABLED_KEYS[kind] }, error);
  }
  for (const cb of ctx.enabledListeners) {
    try { cb(kind, value); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'enabledNotify' }, error); }
  }
}

export function subscribePityEnabled(listener: (kind: PityKind, value: boolean) => void): () => void {
  ctx.enabledListeners.add(listener);
  return () => { ctx.enabledListeners.delete(listener); };
}

/** Clears observed streaks, hits and gaps; keeps the seen-key ledger, slot origins, lifetime totals and account info. */
export function resetPityTracker(): void {
  const keys = Array.from(ctx.seen);
  const { account, slotOrigins, lifetime } = ctx.state;
  ctx.state = defaultState();
  ctx.state.account = account;
  ctx.state.slotOrigins = slotOrigins;
  ctx.state.lifetime = lifetime;
  ctx.seen.clear();
  for (const key of keys) ctx.seen.add(key);
  // A reset rebuilds from QPM's own hatch history on the next update.
  ctx.historyReplayed = false;
  ctx.log = [];
  ctx.logDirty = true;
  persist();
  notify();
}
