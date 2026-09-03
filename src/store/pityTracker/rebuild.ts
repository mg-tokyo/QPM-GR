import type { PityKind } from '../../catalogs/pityThresholds';
import { MAX_HITS, ctx, migrateCounters, notify, persist, type PityCounter, type PityHit } from './state';
import { applyRoll } from './rolls';

function keyPrefix(kind: PityKind, itemId: string): string {
  return `${kind}:${itemId}:`;
}

/**
 * Counters for `keys` are replaced by checkpoint + replayed log. Hits inside the log window
 * for those keys are regenerated; older hits are kept because the checkpoint already folded them.
 */
function rebuildKeys(match: (key: string) => boolean, entries: (e: { k: PityKind; i: string }) => boolean): void {
  const checkpoint = ctx.state.checkpoint;
  const scratch: Record<string, PityCounter> = {};
  for (const [key, counter] of Object.entries(checkpoint.counters)) if (match(key)) scratch[key] = counter;
  const target = { counters: migrateCounters(scratch), hits: [] as PityHit[], account: ctx.state.account };
  for (const e of ctx.log) if (entries(e)) applyRoll(target, e.k, e.i, e.r, e.h, e.t, e.g);

  for (const key of Object.keys(ctx.state.counters)) if (match(key)) delete ctx.state.counters[key];
  Object.assign(ctx.state.counters, target.counters);
  ctx.state.hits = [...ctx.state.hits.filter((h) => !(match(h.key) && h.at >= checkpoint.since)), ...target.hits]
    .sort((a, b) => a.at - b.at);
  if (ctx.state.hits.length > MAX_HITS) ctx.state.hits.splice(0, ctx.state.hits.length - MAX_HITS);
  persist();
  notify();
}

export function rebuildPityItem(kind: PityKind, itemId: string): void {
  const prefix = keyPrefix(kind, itemId);
  rebuildKeys((key) => key.startsWith(prefix), (e) => e.k === kind && e.i === itemId);
}

export function rebuildPityAll(): void {
  rebuildKeys(() => true, () => true);
}
