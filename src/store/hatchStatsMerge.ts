import type { HatchBucket, HatchEvent, HatchStatsState, SpeciesCounts } from './hatchStatsStore';

export const HATCH_STATS_VERSION = 1;
export const HATCH_MAX_EVENTS = 100;
export const HATCH_MAX_SEEDED_IDS = 5000;

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function normalizeBucket(raw: unknown): HatchBucket {
  const bucket: HatchBucket = { totalHatched: 0, bySpecies: {}, byAbility: {} };
  if (!isRecord(raw)) return bucket;
  bucket.totalHatched = count(raw.totalHatched);
  if (isRecord(raw.bySpecies)) {
    for (const [species, c] of Object.entries(raw.bySpecies)) {
      if (!isRecord(c)) continue;
      bucket.bySpecies[species] = { total: count(c.total), normal: count(c.normal), gold: count(c.gold), rainbow: count(c.rainbow) };
    }
  }
  if (isRecord(raw.byAbility)) {
    for (const [ability, n] of Object.entries(raw.byAbility)) bucket.byAbility[ability] = count(n);
  }
  return bucket;
}

function isEvent(value: unknown): value is HatchEvent {
  return isRecord(value) && typeof value.species === 'string' && typeof value.timestamp === 'number'
    && (value.rarity === 'normal' || value.rarity === 'gold' || value.rarity === 'rainbow') && Array.isArray(value.abilities);
}

/** A stored copy, or `undefined` for a missing or other-version copy (the store then starts from defaults). */
export function normalizeHatchStats(raw: unknown): HatchStatsState | undefined {
  if (!isRecord(raw) || !isRecord(raw.meta) || raw.meta.version !== HATCH_STATS_VERSION) return undefined;
  const meta: HatchStatsState['meta'] = { version: HATCH_STATS_VERSION, updatedAt: count(raw.meta.updatedAt) };
  if (typeof raw.meta.cleanedAt === 'number') meta.cleanedAt = raw.meta.cleanedAt;
  const session = isRecord(raw.session) ? raw.session : {};
  return {
    lifetime: normalizeBucket(raw.lifetime),
    session: { ...normalizeBucket(session), start: count(session.start) },
    recentEvents: Array.isArray(raw.recentEvents) ? raw.recentEvents.filter(isEvent) : [],
    seededPetIds: Array.isArray(raw.seededPetIds) ? raw.seededPetIds.filter((id): id is string => typeof id === 'string') : [],
    meta,
  };
}

const covers = (a: SpeciesCounts, b: SpeciesCounts): boolean =>
  a.total >= b.total && a.normal >= b.normal && a.gold >= b.gold && a.rainbow >= b.rainbow;

/** PD2: each copy undercounts the account's true history, so the per-field maximum never over-counts. */
function mergeLifetime(a: HatchBucket, b: HatchBucket): HatchBucket {
  let changed = false;
  const bySpecies = { ...a.bySpecies };
  for (const [species, theirs] of Object.entries(b.bySpecies)) {
    const ours = bySpecies[species];
    if (ours && covers(ours, theirs)) continue;
    bySpecies[species] = ours
      ? { total: Math.max(ours.total, theirs.total), normal: Math.max(ours.normal, theirs.normal), gold: Math.max(ours.gold, theirs.gold), rainbow: Math.max(ours.rainbow, theirs.rainbow) }
      : { ...theirs };
    changed = true;
  }
  const byAbility = { ...a.byAbility };
  for (const [ability, n] of Object.entries(b.byAbility)) {
    if (n > (byAbility[ability] ?? 0)) { byAbility[ability] = n; changed = true; }
  }
  if (!changed && b.totalHatched <= a.totalHatched) return a;
  const speciesSum = Object.values(bySpecies).reduce((sum, c) => sum + c.total, 0);
  return { totalHatched: Math.max(a.totalHatched, b.totalHatched, speciesSum), bySpecies, byAbility };
}

const eventKey = (e: HatchEvent): string => `${e.timestamp}|${e.species}|${e.rarity}`;

function mergeEvents(a: HatchEvent[], b: HatchEvent[]): HatchEvent[] {
  const seen = new Set(a.map(eventKey));
  const added = b.filter((e) => !seen.has(eventKey(e)));
  if (added.length === 0) return a;
  const merged = [...a, ...added].sort((x, y) => y.timestamp - x.timestamp).slice(0, HATCH_MAX_EVENTS);
  return merged.length === a.length && merged.every((e, i) => e === a[i]) ? a : merged;
}

function mergeSeededIds(a: string[], b: string[]): string[] {
  const seen = new Set(a);
  const added = b.filter((id) => !seen.has(id));
  if (added.length === 0) return a;
  const merged = [...a, ...added];
  return merged.length > HATCH_MAX_SEEDED_IDS ? merged.slice(merged.length - HATCH_MAX_SEEDED_IDS) : merged;
}

/** Returns `a` itself when `b` adds nothing (player-scoped helper contract). Session stays `a`'s. */
export function mergeHatchStats(a: HatchStatsState, b: HatchStatsState): HatchStatsState {
  const lifetime = mergeLifetime(a.lifetime, b.lifetime);
  const recentEvents = mergeEvents(a.recentEvents, b.recentEvents);
  const seededPetIds = mergeSeededIds(a.seededPetIds, b.seededPetIds);
  if (lifetime === a.lifetime && recentEvents === a.recentEvents && seededPetIds === a.seededPetIds) return a;
  const meta: HatchStatsState['meta'] = { version: HATCH_STATS_VERSION, updatedAt: Math.max(a.meta.updatedAt, b.meta.updatedAt) };
  // An uncleaned copy may carry pre-cleanup junk; without the stamp the store's one-time cleanup re-runs on the result.
  if (a.meta.cleanedAt !== undefined && b.meta.cleanedAt !== undefined) meta.cleanedAt = Math.max(a.meta.cleanedAt, b.meta.cleanedAt);
  return { lifetime, session: a.session, recentEvents, seededPetIds, meta };
}
