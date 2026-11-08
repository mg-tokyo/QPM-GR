import { isGameStateReady, readSync } from '../core/gameState';

// The room clock is patched once a second and reads are lazy, so a single
// sample lags the server by up to 1 s. The largest offset seen tracks the true
// one; re-basing after REBASE_MS keeps a local clock jump from sticking.
const REBASE_MS = 30_000;

let bestOffsetMs: number | null = null;
let bestAtMs = 0;

function sampleOffset(nowMs: number): void {
  if (!isGameStateReady()) return;
  const serverMs = readSync('serverTime');
  if (typeof serverMs !== 'number' || !Number.isFinite(serverMs)) return;
  const offset = serverMs - nowMs;
  if (bestOffsetMs === null || offset >= bestOffsetMs || nowMs - bestAtMs > REBASE_MS) {
    bestOffsetMs = offset;
    bestAtMs = nowMs;
  }
}

export function getServerNowMs(): number | null {
  const nowMs = Date.now();
  sampleOffset(nowMs);
  return bestOffsetMs === null ? null : nowMs + bestOffsetMs;
}

export function __resetServerClock(): void {
  bestOffsetMs = null;
  bestAtMs = 0;
}
