// src/websocket/sequencerHeal.ts
// Pure helpers for commandSequencer's idle-drift resync (CS-1). Kept as a
// separate module so commandSequencer.ts stays close to the soft size cap and
// the heal predicate is trivially testable.

export interface HealSnapshot {
  wire: number;
  frontier: number;
  outstanding: number;
  pending: number;
}

/**
 * True when the wire counter has drifted ahead of the server frontier while
 * nothing is in flight — a burned sequence number that the next envelope
 * would otherwise trip `invalid_sequence` on.
 */
export function shouldIdleResync(s: HealSnapshot): boolean {
  return s.outstanding === 0 && s.pending === 0 && s.wire > s.frontier;
}

/**
 * Count assigned entries younger than `ttlMs`. Entries older than the result
 * timeout are treated as lost (a game command that never got a result cannot
 * block resync forever).
 */
export function countOutstanding(
  entries: Iterable<{ at: number }>,
  now: number,
  ttlMs: number,
): number {
  let n = 0;
  for (const e of entries) {
    if (now - e.at < ttlMs) n += 1;
  }
  return n;
}
