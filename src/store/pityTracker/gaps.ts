import { type PityKind } from '../../catalogs/pityThresholds';
import { asCount, asRecord, ctx, type PityLifetime } from './state';

export function readLifetime(data: Record<string, unknown>): PityLifetime {
  const stats = asRecord(data.stats);
  const player = asRecord(stats?.player);
  const capsules: Record<string, number> = {};
  for (const [toolId, raw] of Object.entries(asRecord(stats?.capsulePulls) ?? {})) {
    const opens = asCount(asRecord(raw)?.numOpens);
    if (opens !== null) capsules[toolId] = opens;
  }
  return { eggs: asCount(player?.numEggsHatched), crops: asCount(player?.numCropsHarvested), capsules };
}

function addGap(kind: PityKind, pulls: number): boolean {
  if (!(pulls > 0)) return false;
  ctx.state.gaps[kind] += pulls;
  return true;
}

function capsuleDelta(prev: Record<string, number>, next: Record<string, number>): number {
  let total = 0;
  for (const [toolId, opens] of Object.entries(next)) {
    const before = prev[toolId];
    if (before !== undefined) total += opens - before;
  }
  return total;
}

/**
 * Lifetime totals grow with every pull, watched or not. At session start the whole delta is a gap;
 * mid-session only a full-buffer update (possible overflow) is checked, sized by delta minus what was applied.
 */
export function detectGaps(lifetime: PityLifetime, checkOverflow: boolean): boolean {
  const prev = ctx.state.lifetime;
  let changed = false;
  const compare = (kind: PityKind, before: number | null, after: number | null): void => {
    if (before === null || after === null) return;
    if (!ctx.enabled[kind]) return;
    const unobserved = after - before - (ctx.seeded ? ctx.observedNow[kind] : 0);
    if (addGap(kind, unobserved)) changed = true;
  };
  if (!ctx.seeded || checkOverflow) {
    compare('egg', prev.eggs, lifetime.eggs);
    compare('seed', prev.crops, lifetime.crops);
    compare('capsule', 0, capsuleDelta(prev.capsules, lifetime.capsules));
  }
  ctx.state.lifetime = {
    eggs: lifetime.eggs ?? prev.eggs,
    crops: lifetime.crops ?? prev.crops,
    capsules: { ...prev.capsules, ...lifetime.capsules },
  };
  return changed;
}
