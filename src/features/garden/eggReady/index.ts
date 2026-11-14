import { getGardenSnapshot, onGardenSnapshot, type GardenSnapshot } from '../bridge';
import { getServerNowMs } from '../../../store/serverClock';
import { createEggSchedule, walkEggs, type EggEntry, type EggState } from './schedule';

export { createEggSchedule, walkEggs, EGG_BATCH_WINDOW_MS } from './schedule';
export type { EggEntry, EggState, EggScheduleStep } from './schedule';

const TIMER_MARGIN_MS = 50;
const MAX_LEAD_MINUTES = 180;

const schedule = createEggSchedule();
const listeners = new Set<(batch: EggEntry[]) => void>();
let started = false;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let nextWakeAt: number | null = null;
let leadMinutes = 0;
let lastBatch: { at: number; firedLateMs: number; eggs: EggEntry[] } | null = null;
const counts = { steps: 0, batches: 0, arms: 0 };

const nowMs = (): number => getServerNowMs() ?? Date.now();

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

// No patch arrives at maturity, so one one-shot to the next due egg re-runs the step.
// A null garden is a gap in the feed, not an empty garden; the schedule is kept across it.
function evaluate(snapshot: GardenSnapshot): void {
  if (!started || !snapshot) return;
  const now = nowMs();
  const leadMs = leadMinutes * 60_000;
  const { batch, nextFireAt } = schedule.step(walkEggs(snapshot), now, leadMs);
  counts.steps += 1;
  if (batch.length > 0) {
    const first = batch[0];
    lastBatch = { at: now, firedLateMs: first ? now - (first.maturedAt - leadMs) : 0, eggs: batch };
    counts.batches += 1;
    for (const cb of listeners) {
      try { cb(batch); } catch { /* one listener failing must not stop the others */ }
    }
  }
  clearTimer();
  nextWakeAt = nextFireAt;
  if (nextFireAt === null) return;
  counts.arms += 1;
  timer = setTimeout(() => {
    timer = null;
    evaluate(getGardenSnapshot());
  }, Math.max(0, nextFireAt - now) + TIMER_MARGIN_MS);
}

export function startEggReady(): void {
  if (started) return;
  started = true;
  unsubscribe = onGardenSnapshot(evaluate);
}

export function stopEggReady(): void {
  started = false;
  unsubscribe?.();
  unsubscribe = null;
  clearTimer();
  nextWakeAt = null;
  schedule.reset();
  lastBatch = null;
  counts.steps = 0;
  counts.batches = 0;
  counts.arms = 0;
}

export function onEggBatch(cb: (batch: EggEntry[]) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function setEggReadyLeadMinutes(minutes: number): boolean {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_LEAD_MINUTES) return false;
  leadMinutes = minutes;
  evaluate(getGardenSnapshot());
  return true;
}

export function getEggReadyState(): {
  running: boolean;
  leadMinutes: number;
  serverNowMs: number;
  nextWakeAt: number | null;
  eggs: Array<EggEntry & { state: EggState; msLeft: number }>;
  lastBatch: typeof lastBatch;
  steps: number;
  batches: number;
  arms: number;
} {
  const now = nowMs();
  return {
    running: started,
    leadMinutes,
    serverNowMs: now,
    nextWakeAt,
    eggs: schedule.entries().map((e) => ({ ...e, msLeft: e.maturedAt - now })),
    lastBatch,
    ...counts,
  };
}
