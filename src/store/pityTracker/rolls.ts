import {
  estimatePityCount,
  getPityOutcomes,
  pityCounterKey,
  pityLaunchFloor,
  type PityKind,
  type PityOutcome,
  type PityRoll,
} from '../../catalogs/pityThresholds';
import { MAX_HITS, ctx, type PityAccount, type PityCounter, type PityHit, type PityTrackerState } from './state';
import { appendPull, candidatesFor } from './log';

export interface RollTarget {
  counters: Record<string, PityCounter>;
  hits: PityHit[];
  account: PityAccount | null;
}

export function pityGapFor(snapshot: PityTrackerState, kind: PityKind, counter: PityCounter): number {
  return Math.max(0, (snapshot.gaps[kind] ?? 0) - counter.gapBase);
}

function counterFor(target: RollTarget, key: string, now: number, gapBase: number): PityCounter {
  let counter = target.counters[key];
  if (!counter) {
    counter = { misses: 0, hits: 0, totalPulls: 0, lastHitAt: null, lastPullAt: null, observedSince: now, correction: 0, gapBase };
    target.counters[key] = counter;
  }
  return counter;
}

function recordHit(target: RollTarget, key: string, counter: PityCounter, outcome: PityOutcome | undefined, at: number): void {
  if (!outcome) return;
  target.hits.push({
    key, at, observedMisses: counter.misses,
    estimate: estimatePityCount(counter, outcome.thresholdPulls, target.account?.createdAt ?? null),
    thresholdPulls: outcome.thresholdPulls,
  });
  if (target.hits.length > MAX_HITS) target.hits.splice(0, target.hits.length - MAX_HITS);
}

/** A pull is forced once threshold-1 misses are on the counter; a miss past that proves the estimate too high. */
function correctAfterMiss(target: RollTarget, counter: PityCounter, outcome: PityOutcome | undefined): void {
  if (!outcome) return;
  const createdAt = target.account?.createdAt ?? null;
  const cap = outcome.thresholdPulls - 1;
  if (estimatePityCount(counter, outcome.thresholdPulls, createdAt) <= cap) return;
  const floor = counter.hits === 0 ? pityLaunchFloor(outcome.thresholdPulls, createdAt) : 0;
  counter.correction = cap - floor - counter.misses;
}

/** One roll onto `target`: `hitId` resets its counter; every other candidate takes a miss. Pure w.r.t. ctx. */
export function applyRoll(
  target: RollTarget, kind: PityKind, itemId: string, roll: PityRoll, hitId: string | null, at: number, gapBase: number,
): void {
  const outcomes = getPityOutcomes({ kind, id: itemId });
  for (const outcomeId of candidatesFor({ t: at, k: kind, i: itemId, r: roll, h: hitId, g: gapBase })) {
    const key = pityCounterKey(kind, itemId, outcomeId);
    const counter = counterFor(target, key, at, gapBase);
    const outcome = outcomes.find((o) => o.outcomeId === outcomeId);
    counter.totalPulls++;
    counter.lastPullAt = at;
    if (outcomeId === hitId) {
      recordHit(target, key, counter, outcome, at);
      counter.hits++;
      counter.misses = 0;
      counter.lastHitAt = at;
      counter.correction = 0;
      counter.gapBase = gapBase;
    } else {
      counter.misses++;
      correctAfterMiss(target, counter, outcome);
    }
  }
}

/** Live roll: applies to state and appends to the pull log. Skips silently when the roll has no candidates. */
export function recordRoll(kind: PityKind, itemId: string, roll: PityRoll, hitId: string | null, at: number): void {
  const gapBase = ctx.state.gaps[kind];
  const entry = { t: at, k: kind, i: itemId, r: roll, h: hitId, g: gapBase };
  if (candidatesFor(entry).length === 0) return;
  applyRoll(ctx.state, kind, itemId, roll, hitId, at, gapBase);
  appendPull(entry);
}
