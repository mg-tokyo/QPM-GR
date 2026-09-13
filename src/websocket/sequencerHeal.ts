// src/websocket/sequencerHeal.ts
// Pure helpers for commandSequencer's counter arithmetic (CS-1 idle-drift
// resync, CS-18 frontier refresh). Kept as a separate module so
// commandSequencer.ts stays under the size cap and every predicate is
// trivially testable without a socket.

export interface HealSnapshot {
  wire: number;
  frontier: number;
  outstanding: number;
  pending: number;
  /** CS-18: highest number put on the wire that never came back. */
  unansweredFloor: number;
}

/**
 * True when the wire counter has drifted ahead of the resync target while
 * nothing is in flight — a burned sequence number that the next envelope
 * would otherwise trip `invalid_sequence` on. Comparing against `nextWire`
 * rather than the raw frontier keeps this false (instead of firing on every
 * frame) while the counter is legitimately parked above a spent number.
 */
export function shouldIdleResync(s: HealSnapshot): boolean {
  return s.outstanding === 0 && s.pending === 0 && s.wire > nextWire(s);
}

/**
 * CS-18: where the wire counter should be pinned on a resync or heal. The
 * frontier is the server's executed counter; `unansweredFloor` is the highest
 * number QPM put on the wire and never heard back about. Re-emitting that
 * number is unrecoverable (the server answers stale numbers with silence),
 * while overshooting it is not (`invalid_sequence` is answered and heals), so
 * the floor always wins.
 */
export function nextWire(s: { frontier: number; unansweredFloor: number }): number {
  return Math.max(s.frontier, s.unansweredFloor);
}

/**
 * CS-18: read the game's own executed-command counter defensively. Returns
 * null for anything that is not a finite number, so a renamed or removed
 * game-side field degrades to "no information" instead of throwing or
 * poisoning the counter with NaN.
 */
export function readExecutedSequence(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
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
