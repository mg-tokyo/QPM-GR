// src/websocket/sequencerStale.ts
// CS-4 stale-drop arming and its two storage switches. The server rule is that
// stale/duplicate commandSequence numbers get NO result, so once a room frame
// executes past an in-flight envelope's number that send is definitely lost;
// this module decides when to start counting down on such an entry. Settling
// the entry stays in commandSequencer.ts — only the timing policy lives here.

import { storage } from '../utils/storage';

export const STALE_DETECT_ENABLED_KEY = 'qpm.ws.sequencer.staleDetect.enabled';
export const STALE_GRACE_MS_KEY = 'qpm.ws.sequencer.staleGraceMs';
// The grace covers the ~100 ms result window observed in v1040 with headroom;
// a live frame→result measurement (Runtime Verification Suite, CS-4 entry)
// sets the final default.
const DEFAULT_STALE_GRACE_MS = 750;

export function getStaleGraceMs(): number {
  const raw = storage.get<number>(STALE_GRACE_MS_KEY, DEFAULT_STALE_GRACE_MS);
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_STALE_GRACE_MS;
}

export interface StaleCandidate {
  wire: number | null;
  staleTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Arm a stale-drop timer on every candidate whose commandSequence the room has
 * already executed. Cheap when nothing is in flight (the common case) and
 * driven by frames, not by a poll. `onStale` must clear `staleTimer` itself.
 */
export function armStaleTimers<T extends StaleCandidate>(
  entries: Iterable<T>,
  frontier: number,
  onStale: (entry: T) => void,
): void {
  if (storage.get<boolean>(STALE_DETECT_ENABLED_KEY, true) === false) return;
  const grace = getStaleGraceMs();
  for (const entry of entries) {
    if (entry.wire !== null && entry.wire <= frontier && entry.staleTimer === null) {
      entry.staleTimer = setTimeout(() => onStale(entry), grace);
    }
  }
}
