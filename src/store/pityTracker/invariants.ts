import { getPityOutcomes, parsePityCounterKey, type PityKind } from '../../catalogs/pityThresholds';
import { ctx, diag, persist, type PityCounter } from './state';
import { rebuildPityItem } from './rebuild';

export interface PityInvariantViolation {
  kind: PityKind;
  itemId: string;
  pulls: Record<string, number>;
}

/** Every outcome of an egg/capsule sees every pull; a plant's Gold and Rainbow share one roll. */
export function findPityInvariantViolations(counters: Record<string, PityCounter>): PityInvariantViolation[] {
  const groups = new Map<string, PityInvariantViolation>();
  for (const [key, counter] of Object.entries(counters)) {
    const parsed = parsePityCounterKey(key);
    if (!parsed) continue;
    if (parsed.kind === 'seed' && parsed.outcomeId !== 'Gold' && parsed.outcomeId !== 'Rainbow') continue;
    const id = `${parsed.kind}:${parsed.itemId}`;
    const group = groups.get(id) ?? { kind: parsed.kind, itemId: parsed.itemId, pulls: {} };
    group.pulls[parsed.outcomeId] = counter.totalPulls;
    groups.set(id, group);
  }
  const out: PityInvariantViolation[] = [];
  for (const group of groups.values()) {
    const values = Object.values(group.pulls);
    if (values.length > 1 && values.some((v) => v !== values[0])) out.push(group);
  }
  return out;
}

const healed = new Set<string>();

/** Deltas from the lowest counter. Live rolls advance every counter equally, so a
 * historical imbalance keeps a constant signature while a new divergence changes it. */
function imbalanceSignature(pulls: Record<string, number>): string {
  const min = Math.min(...Object.values(pulls));
  return Object.entries(pulls).map(([k, n]) => `${k}=${n - min}`).sort().join(',');
}

/** Warn once and rebuild once per item per session; an imbalance a rebuild cannot
 * clear is baked into the checkpoint — accept it (persisted) and stay silent until
 * the deltas change. */
export function healPityViolations(): PityInvariantViolation[] {
  const found = findPityInvariantViolations(ctx.state.counters);
  let accepted = false;
  for (const v of found) {
    const id = `${v.kind}:${v.itemId}`;
    const signature = imbalanceSignature(v.pulls);
    if (ctx.state.acceptedImbalances[id] === signature) continue;
    const afterRebuild = healed.has(id);
    diag.warn('QPM-STORE-005', { kind: v.kind, itemId: v.itemId, pulls: v.pulls, afterRebuild });
    if (afterRebuild) {
      ctx.state.acceptedImbalances[id] = signature;
      accepted = true;
      continue;
    }
    // Rebuilding before the catalog can supply this item's outcomes would replay
    // nothing and permanently wipe its counters/hits — defer to a later heal pass.
    if (getPityOutcomes({ kind: v.kind, id: v.itemId }).length === 0) continue;
    healed.add(id);
    rebuildPityItem(v.kind, v.itemId);
    // Still violating right after the rebuild ⇒ the imbalance predates the log
    // window — accept now, or an idle session would re-warn at every start.
    const still = findPityInvariantViolations(ctx.state.counters)
      .find((x) => x.kind === v.kind && x.itemId === v.itemId);
    if (still) {
      ctx.state.acceptedImbalances[id] = imbalanceSignature(still.pulls);
      accepted = true;
    }
  }
  if (accepted) persist();
  return found;
}
