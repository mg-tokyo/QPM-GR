import {
  MAX_HITS,
  MAX_PENDING_HATCHES,
  MAX_SEEN_KEYS,
  type PityAccount,
  type PityCheckpoint,
  type PityLifetime,
  type PityTrackerState,
} from './state';
import type { PullLogEntry } from './log';

/** One account's pity history as one value: the state key and the log key of one copy. */
export interface PityCopy {
  state: PityTrackerState;
  log: PullLogEntry[];
  /** Set when a merge changed the log or checkpoint: counters wait for a replay that needs the egg catalog. */
  rebuild: { dropped: number } | null;
}

export function checkpointPulls(checkpoint: PityCheckpoint): number {
  let sum = 0;
  for (const counter of Object.values(checkpoint.counters)) sum += counter.totalPulls;
  return sum;
}

function tupleId(e: PullLogEntry): string {
  return JSON.stringify([e.t, e.k, e.i, e.r, e.h]);
}

/**
 * Base keeps every entry. The other copy adds what the base lacks: by `s` + roll type when it has
 * one, else by the larger count of each `(t,k,i,r,h)` tuple, since both copies saw the same server
 * entries. Its unmatched entries before `since` may already be folded into the base checkpoint (PD1).
 */
function mergeLogs(base: PullLogEntry[], other: PullLogEntry[], since: number): { log: PullLogEntry[]; added: number; dropped: number } {
  const sources = new Set<string>();
  const tuples = new Map<string, number>();
  for (const e of base) {
    if (e.s !== undefined) sources.add(`${e.s}|${e.r}`);
    else tuples.set(tupleId(e), (tuples.get(tupleId(e)) ?? 0) + 1);
  }
  const otherCounts = new Map<string, number>();
  const extra: PullLogEntry[] = [];
  let dropped = 0;
  for (const e of other) {
    let duplicate: boolean;
    if (e.s !== undefined) {
      const id = `${e.s}|${e.r}`;
      duplicate = sources.has(id);
      sources.add(id);
    } else {
      const id = tupleId(e);
      const seen = (otherCounts.get(id) ?? 0) + 1;
      otherCounts.set(id, seen);
      duplicate = seen <= (tuples.get(id) ?? 0);
    }
    if (duplicate) continue;
    if (e.t < since) dropped++;
    else extra.push(e);
  }
  if (extra.length === 0) return { log: base, added: 0, dropped };
  return { log: [...base, ...extra].sort((x, y) => x.t - y.t), added: extra.length, dropped };
}

/** `a` itself when `b` adds no id; otherwise the newest `cap` of the union in a fixed order, so a re-merge is a no-op. */
function unionNewest<T>(a: T[], b: T[], id: (x: T) => string, at: (x: T) => number, cap: number): T[] {
  const ids = new Set(a.map(id));
  const added = b.filter((x) => !ids.has(id(x)));
  if (added.length === 0) return a;
  const all = [...a, ...added].sort((x, y) => at(x) - at(y) || (id(x) < id(y) ? -1 : id(x) > id(y) ? 1 : 0));
  const kept = all.slice(-cap);
  return kept.length === a.length && kept.every((x, n) => x === a[n]) ? a : kept;
}

function seenKeyTime(key: string): number {
  const ts = Number.parseInt(key, 10);
  return Number.isFinite(ts) ? ts : 0;
}

function pickAccount(a: PityAccount | null, b: PityAccount | null): PityAccount | null {
  if (!b || b.createdAt === null) return a;
  if (!a || a.createdAt === null) return b;
  return b.fetchedAt > a.fetchedAt ? b : a;
}

function maxCount(x: number | null, y: number | null): number | null {
  if (x === null) return y;
  if (y === null) return x;
  return Math.max(x, y);
}

/** Server lifetime totals only grow, so the larger reading is the newer one. */
function mergeLifetime(a: PityLifetime, b: PityLifetime): PityLifetime {
  const capsules = { ...a.capsules };
  let changed = false;
  for (const [id, n] of Object.entries(b.capsules)) {
    if (n > (capsules[id] ?? -1)) { capsules[id] = n; changed = true; }
  }
  const eggs = maxCount(a.eggs, b.eggs);
  const crops = maxCount(a.crops, b.crops);
  if (!changed && eggs === a.eggs && crops === a.crops) return a;
  return { eggs, crops, capsules };
}

/**
 * Two copies of one account's history (REL-5 D2 + PD1). The copy whose checkpoint holds more pulls
 * is the base; counters stay the base's until `rebuild` replays the merged log. Returns `a` itself
 * when `b` adds nothing. Gaps, pending grants and slot origins stay `a`'s (this site's garden view).
 */
/** On equal checkpoints (usually 0 pulls, nothing folded) the log reaching further back is the base, so nothing is dropped. */
function pickBase(a: PityCopy, b: PityCopy): PityCopy {
  const pullsA = checkpointPulls(a.state.checkpoint);
  const pullsB = checkpointPulls(b.state.checkpoint);
  if (pullsA !== pullsB) return pullsB > pullsA ? b : a;
  return b.state.checkpoint.since < a.state.checkpoint.since ? b : a;
}

export function mergePityCopies(a: PityCopy, b: PityCopy): PityCopy {
  const base = pickBase(a, b);
  const other = base === a ? b : a;
  const logs = mergeLogs(base.log, other.log, base.state.checkpoint.since);
  const logChanged = base !== a || logs.added > 0;

  const hits = unionNewest(a.state.hits, b.state.hits, (h) => `${h.key}|${h.at}`, (h) => h.at, MAX_HITS);
  const seenKeys = unionNewest(a.state.seenKeys, b.state.seenKeys, (k) => k, seenKeyTime, MAX_SEEN_KEYS);
  const pendingHatches = unionNewest(a.state.pendingHatches, b.state.pendingHatches, (h) => h.key, (h) => h.at, MAX_PENDING_HATCHES);
  const account = pickAccount(a.state.account, b.state.account);
  const lifetime = mergeLifetime(a.state.lifetime, b.state.lifetime);
  const imbalancesAdded = Object.keys(b.state.acceptedImbalances).some((id) => !(id in a.state.acceptedImbalances));
  const observedSince = Math.min(a.state.observedSince, b.state.observedSince);

  const unchanged = !logChanged && hits === a.state.hits && seenKeys === a.state.seenKeys
    && pendingHatches === a.state.pendingHatches && account === a.state.account && lifetime === a.state.lifetime
    && !imbalancesAdded && observedSince === a.state.observedSince;
  if (unchanged) return a;

  const state: PityTrackerState = {
    ...a.state,
    counters: base.state.counters,
    checkpoint: base.state.checkpoint,
    hits,
    seenKeys,
    pendingHatches,
    account,
    lifetime,
    acceptedImbalances: { ...b.state.acceptedImbalances, ...a.state.acceptedImbalances },
    observedSince,
    meta: { version: a.state.meta.version, updatedAt: Math.max(a.state.meta.updatedAt, b.state.meta.updatedAt) },
  };
  const rebuild = logChanged
    ? { dropped: (a.rebuild?.dropped ?? 0) + (b.rebuild?.dropped ?? 0) + logs.dropped }
    : a.rebuild;
  return { state, log: logs.log, rebuild };
}
