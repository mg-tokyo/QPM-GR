// Pure — imported by scripts/check-pet-activity.mjs under node. No storage/catalog/DOM imports.
import type { PetActivityEnvelope, PetActivityEvent } from './types';

export const PET_ACTIVITY_STORAGE_KEY = 'qpm.petActivity.v1';
export const PET_ACTIVITY_UI_KEY = 'qpm.petActivity.ui.v1';
export const MAX_EVENTS = 5000;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface PruneOptions { maxEvents: number; maxAgeMs: number }

/** Drops events older than maxAgeMs, then keeps the newest maxEvents. Input order preserved (oldest→newest). */
export function pruneEvents(events: PetActivityEvent[], now: number, opts: PruneOptions): PetActivityEvent[] {
  const cutoff = now - opts.maxAgeMs;
  const fresh = events.filter((e) => e.ts >= cutoff);
  return fresh.length > opts.maxEvents ? fresh.slice(fresh.length - opts.maxEvents) : fresh;
}

function isEvent(v: unknown): v is PetActivityEvent {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.ts === 'number' && typeof r.kind === 'string'
    && typeof r.action === 'string' && !!r.pet && typeof r.pet === 'object' && Array.isArray(r.targets);
}

export function parseEnvelope(raw: unknown): PetActivityEvent[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.events)) return [];
  return r.events.filter(isEvent);
}

export function buildEnvelope(events: PetActivityEvent[]): PetActivityEnvelope {
  return { version: 1, events };
}
