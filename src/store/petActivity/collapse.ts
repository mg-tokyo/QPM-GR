// Pure — imported by scripts/check-pet-activity.mjs under node.
import type { ActivityRun, PetActivityEvent } from './types';

export interface CollapseOptions { enabled: boolean; gapMs?: number }
export const DEFAULT_GAP_MS = 5 * 60_000;

function runOf(e: PetActivityEvent): ActivityRun {
  const totals: Record<string, number> = {};
  for (const [k, v] of Object.entries(e.values)) if (typeof v === 'number') totals[k] = v;
  return { id: e.id, kind: e.kind, family: e.family, pet: e.pet, events: [e], totals, firstTs: e.ts, lastTs: e.ts };
}

function absorb(run: ActivityRun, e: PetActivityEvent): void {
  run.events.push(e);
  run.firstTs = Math.min(run.firstTs, e.ts);
  for (const [k, v] of Object.entries(e.values)) if (typeof v === 'number') run.totals[k] = (run.totals[k] ?? 0) + v;
}

/**
 * Newest-first. An event joins its pet's previous run only when that run is the
 * same family, is an ability, and the time gap is within gapMs. Other pets'
 * events interleaving do not break a run; a different family from the same pet does.
 */
export function buildRuns(events: PetActivityEvent[], opts: CollapseOptions): ActivityRun[] {
  const sorted = [...events].sort((a, b) => b.ts - a.ts);
  if (!opts.enabled) return sorted.map(runOf);
  const gap = opts.gapMs ?? DEFAULT_GAP_MS;
  const runs: ActivityRun[] = [];
  const openByPet = new Map<string, ActivityRun>();
  for (const e of sorted) {
    const open = openByPet.get(e.pet.id);
    const joins = !!open && open.kind === 'ability' && e.kind === 'ability' && open.family === e.family && (open.firstTs - e.ts) <= gap;
    if (joins && open) { absorb(open, e); continue; }
    const run = runOf(e);
    runs.push(run);
    openByPet.set(e.pet.id, run);
  }
  return runs;
}
