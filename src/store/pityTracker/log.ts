import {
  CAPSULE_PITY_THRESHOLDS,
  GROWTH_PITY_THRESHOLDS,
  RARE_PATCH_VARIANTS,
  getPityOutcomes,
  type PityKind,
  type PityRoll,
} from '../../catalogs/pityThresholds';
import { MAX_LOG_ENTRIES, ctx, type PityHit } from './state';
import { applyRoll } from './rolls';

/** One counted roll. Candidates are re-derived from the catalog on replay, so they are not stored. */
export interface PullLogEntry {
  t: number;
  k: PityKind;
  i: string;
  r: PityRoll;
  h: string | null;
  /** `state.gaps[k]` when recorded — keeps gapBase exact on replay. */
  g: number;
  /** `<activity entry key>#<crop or pull index>`; with `r` it names one roll, so two copies of a log de-duplicate. Absent before REL-5. */
  s?: string;
}

const LOG_VERSION = 1;

/** Counters wait for a replay of a merged log; `dropped` = entries the merge could not place (PD1). */
export interface PendingRebuild { dropped: number }

interface LogEnvelope { version: number; entries: PullLogEntry[]; rebuild?: PendingRebuild }

function isEntry(value: unknown): value is PullLogEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return typeof e.t === 'number' && typeof e.k === 'string' && typeof e.i === 'string'
    && typeof e.r === 'string' && (typeof e.h === 'string' || e.h === null) && typeof e.g === 'number'
    && (e.s === undefined || typeof e.s === 'string');
}

export function parseLog(raw: unknown): PullLogEntry[] {
  const envelope = raw && typeof raw === 'object' ? (raw as Partial<LogEnvelope>) : null;
  if (!envelope || envelope.version !== LOG_VERSION || !Array.isArray(envelope.entries)) return [];
  return envelope.entries.filter(isEntry).sort((a, b) => a.t - b.t);
}

/** Builds without `rebuild` read the envelope through `parseLog`, which ignores the extra field. */
export function buildLogEnvelope(entries: PullLogEntry[], rebuild: PendingRebuild | null): LogEnvelope {
  return rebuild ? { version: LOG_VERSION, entries, rebuild } : { version: LOG_VERSION, entries };
}

export function parseRebuild(raw: unknown): PendingRebuild | null {
  const rebuild = raw && typeof raw === 'object' ? (raw as Partial<LogEnvelope>).rebuild : undefined;
  if (!rebuild || typeof rebuild !== 'object') return null;
  const dropped = (rebuild as Partial<PendingRebuild>).dropped;
  return { dropped: typeof dropped === 'number' && Number.isFinite(dropped) ? dropped : 0 };
}

/** Outcomes this roll competed for — mirrors what recordRoll counted when it was live. */
export function candidatesFor(entry: PullLogEntry): string[] {
  switch (entry.r) {
    case 'mutation': return Object.keys(GROWTH_PITY_THRESHOLDS);
    case 'variant': { const v = RARE_PATCH_VARIANTS[entry.i]; return v ? [v] : []; }
    case 'species':
      if (entry.k === 'capsule') return Object.keys(CAPSULE_PITY_THRESHOLDS[entry.i] ?? {});
      return getPityOutcomes({ kind: entry.k, id: entry.i }).filter((o) => o.roll === 'species').map((o) => o.outcomeId);
    default: return [];
  }
}

export function appendPull(entry: PullLogEntry): void {
  ctx.log.push(entry);
  ctx.logDirty = true;
  trimLog();
}

/** Fold the oldest entries into the checkpoint so `checkpoint + log` stays equal to the live counters. */
export function trimLog(): void {
  const excess = ctx.log.length - MAX_LOG_ENTRIES;
  if (excess <= 0) return;
  const folded = ctx.log.splice(0, excess);
  const target = { counters: ctx.state.checkpoint.counters, hits: [] as PityHit[], account: ctx.state.account };
  for (const e of folded) applyRoll(target, e.k, e.i, e.r, e.h, e.t, e.g);
  const oldest = ctx.log[0];
  ctx.state.checkpoint.since = oldest ? oldest.t : Date.now();
  ctx.logDirty = true;
}
