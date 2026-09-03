import { PITY_LAUNCH_TS } from '../../catalogs/pityThresholds';
import { getEggCatalog, getEggType } from '../../catalogs/gameCatalogs';
import { getPetActivityEvents } from '../petActivity';
import { recordRoll } from './rolls';
import { growthMutationOf } from './garden';
import { MAX_PENDING_HATCHES, ctx, hasEggStreaks, isEggKey, rememberKey, type PendingHatch } from './state';

/**
 * Both rolls of one hatch. The species candidates are catalog data, so a hatch seen
 * before the egg catalog is captured is parked in `pendingHatches` — otherwise only its
 * Gold/Rainbow roll would count and the species streak would silently drift.
 */
export function applyHatch(hatch: PendingHatch): void {
  if (!getEggType(hatch.eggId)) {
    if (ctx.state.pendingHatches.length >= MAX_PENDING_HATCHES) ctx.state.pendingHatches.shift();
    ctx.state.pendingHatches.push(hatch);
    return;
  }
  recordRoll('egg', hatch.eggId, 'species', hatch.species, hatch.at);
  recordRoll('egg', hatch.eggId, 'mutation', hatch.mutation, hatch.at);
}

export function drainPendingHatches(): boolean {
  if (ctx.state.pendingHatches.length === 0) return false;
  const ready = ctx.state.pendingHatches.filter((h) => getEggType(h.eggId));
  if (ready.length === 0) return false;
  ctx.state.pendingHatches = ctx.state.pendingHatches.filter((h) => !getEggType(h.eggId));
  for (const hatch of ready.sort((a, b) => a.at - b.at)) applyHatch(hatch);
  return true;
}

/**
 * Fresh store only: rebuild egg streaks from QPM's persisted pet-activity history. Its ids
 * are the same `ts|action|petId` keys, so replayed hatches are marked seen and never counted
 * twice. The pet-activity store initialises after this one, so this retries until it has events.
 */
export function replayHatchHistory(): boolean {
  if (ctx.historyReplayed) return false;
  if (!ctx.enabled.egg) return false;
  if (hasEggStreaks()) { ctx.historyReplayed = true; return false; }
  // The catalog usually lands after the first myData update; replaying before it would park every hatch.
  if (!getEggCatalog()) return false;
  const all = getPetActivityEvents();
  if (all.length === 0) return false;
  ctx.historyReplayed = true;
  // Hatches already parked from a live session are the same events — never count them twice.
  const parked = new Set(ctx.state.pendingHatches.map((h) => h.key));
  const events = all
    .filter((e) => e.kind === 'hatch' && e.source === 'server' && e.ts >= PITY_LAUNCH_TS && !parked.has(e.id))
    .sort((a, b) => a.ts - b.ts);
  let applied = 0;
  for (const event of events) {
    const egg = event.targets.find((target) => target.kind === 'egg');
    if (!egg || egg.kind !== 'egg') continue;
    applyHatch({
      key: event.id,
      eggId: egg.eggId,
      species: event.pet.species,
      mutation: growthMutationOf(event.pet.mutations),
      at: event.ts,
    });
    rememberKey(event.id);
    applied++;
  }
  // Replayed history predates any gap already on record, so those gaps still apply to these counters.
  for (const [key, counter] of Object.entries(ctx.state.counters)) {
    if (isEggKey(key) && counter.hits === 0) counter.gapBase = 0;
  }
  const first = events[0];
  if (applied > 0 && first) ctx.state.observedSince = Math.min(ctx.state.observedSince, first.ts);
  return applied > 0;
}
