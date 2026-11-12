import { getPityOutcomes, type PityKind } from '../../catalogs/pityThresholds';
import { MAX_HITS, ctx, migrateCounters, notify, persist, publishPityRow, type PityCounter, type PityHit } from './state';
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

/**
 * Replays a merged log once every logged item has outcomes: `applyRoll` takes hits and corrections
 * from the catalog, so an earlier replay would drop them. Seeds need the plant catalog, eggs the egg catalog.
 */
export function applyPendingRebuild(): boolean {
  if (!ctx.pendingRebuild) return false;
  const checked = new Set<string>();
  for (const e of ctx.log) {
    const id = `${e.k}:${e.i}`;
    if (checked.has(id)) continue;
    checked.add(id);
    if (getPityOutcomes({ kind: e.k, id: e.i }).length === 0) return false;
  }
  ctx.pendingRebuild = null;
  // The cleared flag lives in the log envelope.
  ctx.logDirty = true;
  rebuildPityAll();
  publishPityRow();
  return true;
}
