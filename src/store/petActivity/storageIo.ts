import { storage } from '../../utils/storage';
import { MAX_AGE_MS, MAX_EVENTS, PET_ACTIVITY_STORAGE_KEY, buildEnvelope, parseEnvelope, pruneEvents } from './persistence';
import type { PetActivityEvent } from './types';

export function loadEvents(now = Date.now()): PetActivityEvent[] {
  const parsed = parseEnvelope(storage.get<unknown>(PET_ACTIVITY_STORAGE_KEY, null));
  parsed.sort((a, b) => a.ts - b.ts);
  return pruneEvents(parsed, now, { maxEvents: MAX_EVENTS, maxAgeMs: MAX_AGE_MS });
}

export function saveEvents(events: PetActivityEvent[]): void {
  storage.set(PET_ACTIVITY_STORAGE_KEY, buildEnvelope(events));
}
