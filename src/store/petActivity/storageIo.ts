import { createPlayerScoped, type PlayerScopedHandle, type PlayerScopedLayout } from '../playerScoped';
import { MAX_AGE_MS, MAX_EVENTS, PET_ACTIVITY_STORAGE_KEY, buildEnvelope, mergePetActivity, parseEnvelope, pruneEvents } from './persistence';
import type { PetActivityEvent } from './types';

export function loadEvents(raw: unknown, now = Date.now()): PetActivityEvent[] {
  const parsed = parseEnvelope(raw);
  parsed.sort((a, b) => a.ts - b.ts);
  return pruneEvents(parsed, now, { maxEvents: MAX_EVENTS, maxAgeMs: MAX_AGE_MS });
}

const layout: PlayerScopedLayout<PetActivityEvent[]> = {
  parts: [PET_ACTIVITY_STORAGE_KEY],
  join: ([raw]) => loadEvents(raw),
  split: (events) => [buildEnvelope(events)],
};

/** `onReady` receives the player's merged copy; the store must copy it before mutating. */
export function createEventsHandle(onReady: (events: PetActivityEvent[]) => void, flush: () => void): PlayerScopedHandle<PetActivityEvent[]> {
  return createPlayerScoped<PetActivityEvent[]>({
    baseKey: PET_ACTIVITY_STORAGE_KEY,
    fallback: [],
    merge: (a, b) => mergePetActivity(a, b),
    onReady,
    flush,
  }, layout);
}
