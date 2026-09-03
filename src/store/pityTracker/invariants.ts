import { parsePityCounterKey, type PityKind } from '../../catalogs/pityThresholds';
import { ctx, diag, type PityCounter } from './state';
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

/** Warn once and rebuild once per item per session; a repeat only warns. */
export function healPityViolations(): PityInvariantViolation[] {
  const found = findPityInvariantViolations(ctx.state.counters);
  for (const v of found) {
    const id = `${v.kind}:${v.itemId}`;
    const afterRebuild = healed.has(id);
    diag.warn('QPM-STORE-005', { kind: v.kind, itemId: v.itemId, pulls: v.pulls, afterRebuild });
    if (afterRebuild) continue;
    healed.add(id);
    rebuildPityItem(v.kind, v.itemId);
  }
  return found;
}
