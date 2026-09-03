import { storage } from '../../utils/storage';
import {
  CAPSULE_PITY_THRESHOLDS,
  GROWTH_PITY_THRESHOLDS,
  RARE_PATCH_VARIANTS,
  getPityOutcomes,
  type PityKind,
  type PityRoll,
} from '../../catalogs/pityThresholds';
import { LOG_STORAGE_KEY, MAX_LOG_ENTRIES, ctx, type PityHit } from './state';
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
}

const LOG_VERSION = 1;

interface LogEnvelope { version: number; entries: PullLogEntry[] }

function isEntry(value: unknown): value is PullLogEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return typeof e.t === 'number' && typeof e.k === 'string' && typeof e.i === 'string'
    && typeof e.r === 'string' && (typeof e.h === 'string' || e.h === null) && typeof e.g === 'number';
}

export function loadLog(): PullLogEntry[] {
  const raw = storage.get<Partial<LogEnvelope> | null>(LOG_STORAGE_KEY, null);
  if (!raw || raw.version !== LOG_VERSION || !Array.isArray(raw.entries)) return [];
  return raw.entries.filter(isEntry).sort((a, b) => a.t - b.t);
}

export function saveLog(): void {
  storage.set(LOG_STORAGE_KEY, { version: LOG_VERSION, entries: ctx.log } satisfies LogEnvelope);
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
