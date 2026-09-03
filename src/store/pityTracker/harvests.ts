import { GROWTH_PITY_THRESHOLDS, pityBucketFor } from '../../catalogs/pityThresholds';
import { MAX_PENDING_GRANTS, asRecord, ctx } from './state';
import { recordRoll } from './rolls';
import { type SlotRecord } from './garden';


function grantKey(plantSpecies: string, mutation: string): string {
  return `${pityBucketFor(plantSpecies)}:${mutation}`;
}

/** Pet abilities log `{ pet, growSlot: { species, … }, mutation }` — fallback attribution when a harvest has no slot match. */
export function recordGrant(params: Record<string, unknown>): boolean {
  const growSlot = asRecord(params.growSlot);
  const species = growSlot && typeof growSlot.species === 'string' ? growSlot.species : null;
  const mutation = typeof params.mutation === 'string' ? params.mutation : null;
  if (!species || !mutation || !(mutation in GROWTH_PITY_THRESHOLDS)) return false;
  const key = grantKey(species, mutation);
  ctx.state.pendingGrants[key] = Math.min(MAX_PENDING_GRANTS, (ctx.state.pendingGrants[key] ?? 0) + 1);
  return true;
}

function consumeGrant(cropSpecies: string, mutation: string | null): boolean {
  if (!mutation) return false;
  const key = grantKey(cropSpecies, mutation);
  const pending = ctx.state.pendingGrants[key] ?? 0;
  if (pending <= 0) return false;
  if (pending === 1) delete ctx.state.pendingGrants[key];
  else ctx.state.pendingGrants[key] = pending - 1;
  return true;
}

/** Game guide: granted mutations neither reset a counter nor count as misses; unknown origins are skipped, never guessed. */
function applyGrowthRoll(bucket: string, slot: SlotRecord, at: number): boolean {
  if (slot.origin === 'granted' || slot.origin === 'unknown') return false;
  recordRoll('seed', bucket, 'mutation', slot.origin === 'natural' ? slot.mutation : null, at);
  return true;
}

/** Pairs harvested crops with the slots that vanished, by species bucket + growth mutation. */
export function matchHarvests(now: number): boolean {
  let changed = false;
  for (const gone of ctx.pendingGone) {
    const bucket = pityBucketFor(gone.slot.species);
    const idx = ctx.pendingCrops.findIndex((c) => c.bucket === bucket && c.mutation === gone.slot.mutation);
    if (idx === -1) continue;
    const crop = ctx.pendingCrops.splice(idx, 1)[0];
    gone.expires = 0;
    if (crop && applyGrowthRoll(bucket, gone.slot, crop.at)) changed = true;
  }
  ctx.pendingGone = ctx.pendingGone.filter((g) => g.expires > now);
  // Crops with no slot to attribute them to (slot unseen before this session) fall back to the granter-log ledger.
  const stale = ctx.pendingCrops.filter((c) => c.expires <= now);
  ctx.pendingCrops = ctx.pendingCrops.filter((c) => c.expires > now);
  for (const crop of stale) {
    if (consumeGrant(crop.species, crop.mutation)) continue;
    recordRoll('seed', crop.bucket, 'mutation', crop.mutation, crop.at);
    changed = true;
  }
  return changed;
}
