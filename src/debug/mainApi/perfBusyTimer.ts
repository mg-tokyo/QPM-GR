import { visibleInterval } from '../../utils/scheduling/timerManager';

const DEFAULT_MS = 120;
const DEFAULT_EVERY_MS = 1000;
const MAX_MS = 1000;
// Free time between busy-waits, so the returned stop fn can still run.
const MIN_GAP_MS = 250;

export function busyTimerArgs(ms: number, everyMs: number): { ms: number; everyMs: number } {
  const busy = Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_MS) : DEFAULT_MS;
  const every = Number.isFinite(everyMs) && everyMs > 0 ? everyMs : DEFAULT_EVERY_MS;
  return { ms: busy, everyMs: Math.max(every, busy + MIN_GAP_MS) };
}

// Synthetic QPM-owned long task for live checks of long-task attribution. Returns a stop fn.
export function startPerfBusyTimer(ms = DEFAULT_MS, everyMs = DEFAULT_EVERY_MS): () => void {
  const args = busyTimerArgs(ms, everyMs);
  // polling-justified: a deliberate synthetic long task for live verification, not a state read.
  return visibleInterval('qpm-debug-busy-timer', () => {
    const end = performance.now() + args.ms;
    while (performance.now() < end) { /* busy-wait */ }
  }, args.everyMs);
}
