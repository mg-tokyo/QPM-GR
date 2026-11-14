// In-game day-cycle clock (ALR-3.2). The cycle is counted from the Unix epoch, itself an in-game
// midnight, and the first stage of the run order starts there (beta common/…/systems/dayNight.ts:43-50,118-123).
import { getDayCycle, onDayStageChange } from './dayCycleCatalog';
import type { DayCycleData } from './dayCycleCatalog';

export interface DayCycleClockStage {
  id: string;
  startOffsetMs: number;   // after in-game midnight
  endOffsetMs: number;     // exclusive
}

export interface DayCycleClock {
  cycleMs: number;
  stages: readonly DayCycleClockStage[];
  offsetMs: number;        // ALR-4.2 re-anchor: in-game midnight sits at epoch + offsetMs (mod cycleMs)
}

export interface DayStageWindow {
  stage: string;
  startsAtMs: number;
  endsAtMs: number;        // exclusive: the next stage starts here
}

// ALR-4 D1: nightfall is the start of sunset, the game's own "night" (beta dayNight.ts:10-11,59-63).
export const NIGHTFALL_STAGE = 'sunset';

const MINUTE_MS = 60_000;
/** ALR-4 D1: an observed nightfall further than this from the computed one re-anchors the clock. */
export const NIGHTFALL_TOLERANCE_MS = 60_000;
// The game publishes the stage from a per-frame draw (beta DayNightSystem.ts:97,121-125): a hidden tab or the
// first frames after load report a stage change late, so only changes seen after this much visible time count.
export const DRIFT_SETTLE_MS = 60_000;

let anchorOffsetMs = 0;

/** Null until both the stage minutes and the run order are parsed and name the same stages. */
export function getDayCycleClock(data: DayCycleData = getDayCycle()): DayCycleClock | null {
  const { stages, stageOrder } = data;
  if (!stages || !stageOrder || stages.length !== stageOrder.length) return null;
  const minutesById = new Map(stages.map((s) => [s.id, s.minutes]));
  const out: DayCycleClockStage[] = [];
  let offset = 0;
  for (const id of stageOrder) {
    const minutes = minutesById.get(id);
    if (minutes === undefined) return null;
    const end = offset + Math.round(minutes * MINUTE_MS);
    out.push({ id, startOffsetMs: offset, endOffsetMs: end });
    offset = end;
  }
  return offset > 0 ? { cycleMs: offset, stages: out, offsetMs: anchorOffsetMs } : null;
}

function cycleStartMs(clock: DayCycleClock, nowMs: number): number {
  return Math.floor((nowMs - clock.offsetMs) / clock.cycleMs) * clock.cycleMs + clock.offsetMs;
}

export function getDayStageWindowAt(nowMs: number, clock: DayCycleClock | null = getDayCycleClock()): DayStageWindow | null {
  if (!clock) return null;
  const base = cycleStartMs(clock, nowMs);
  const offset = nowMs - base;
  const stage = clock.stages.find((s) => s.startOffsetMs !== s.endOffsetMs && offset < s.endOffsetMs);
  if (!stage) return null;
  return { stage: stage.id, startsAtMs: base + stage.startOffsetMs, endsAtMs: base + stage.endOffsetMs };
}

/** The next time `stageId` starts, strictly after `nowMs`. */
export function nextDayStageStart(stageId: string, nowMs: number, clock: DayCycleClock | null = getDayCycleClock()): number | null {
  const stage = clock?.stages.find((s) => s.id === stageId);
  if (!clock || !stage || stage.startOffsetMs === stage.endOffsetMs) return null;
  const at = cycleStartMs(clock, nowMs) + stage.startOffsetMs;
  return at > nowMs ? at : at + clock.cycleMs;
}

/** Start of the next night, strictly after `nowMs`; during a night this is the following one. */
export function nextNightfall(nowMs: number, clock: DayCycleClock | null = getDayCycleClock()): number | null {
  return nextDayStageStart(NIGHTFALL_STAGE, nowMs, clock);
}

/** The night containing `nowMs`: nightfall through the end of the stage that opens the cycle (beta dayNight.ts:202-217). */
export function getNightWindowAt(nowMs: number, clock: DayCycleClock | null = getDayCycleClock()): { startsAtMs: number; endsAtMs: number } | null {
  const fall = clock?.stages.find((s) => s.id === NIGHTFALL_STAGE);
  const first = clock?.stages[0];
  if (!clock || !fall || !first || fall === first) return null;
  const base = cycleStartMs(clock, nowMs);
  const offset = nowMs - base;
  if (offset >= fall.startOffsetMs) return { startsAtMs: base + fall.startOffsetMs, endsAtMs: base + clock.cycleMs + first.endOffsetMs };
  if (offset < first.endOffsetMs) return { startsAtMs: base - clock.cycleMs + fall.startOffsetMs, endsAtMs: base + first.endOffsetMs };
  return null;
}

/** The next in-game midnight (cycle boundary), strictly after `nowMs`. */
export function nextMidnight(nowMs: number, clock: DayCycleClock | null = getDayCycleClock()): number | null {
  return clock ? cycleStartMs(clock, nowMs) + clock.cycleMs : null;
}

export interface NightfallDriftReadout {
  watching: boolean;
  lastComputedMs: number | null;
  lastObservedMs: number | null;
  deltaMs: number | null;              // observed − computed for the last counted nightfall
  reanchors: number;
  offsetMs: number;
  skipped: { notFromPrevStage: number; notSettled: number; noClock: number };
}

const drift = { lastComputedMs: null as number | null, lastObservedMs: null as number | null, deltaMs: null as number | null, reanchors: 0 };
const skipped = { notFromPrevStage: 0, notSettled: 0, noClock: 0 };
const anchorListeners = new Set<() => void>();
let watchCleanups: Array<() => void> = [];
let watching = false;
let settledFromMs = 0;

function centredOffset(ms: number, cycleMs: number): number {
  const m = ((ms % cycleMs) + cycleMs) % cycleMs;
  return m > cycleMs / 2 ? m - cycleMs : m;
}

function nearestStageStart(stage: DayCycleClockStage, atMs: number, clock: DayCycleClock): number {
  const at = cycleStartMs(clock, atMs) + stage.startOffsetMs;
  const candidates = [at - clock.cycleMs, at, at + clock.cycleMs];
  return candidates.reduce((best, c) => (Math.abs(c - atMs) < Math.abs(best - atMs) ? c : best));
}

/** One stage change seen `settledMs` after the tab last became visible. Exported for tests. */
export function observeDayStage(stage: string, prev: string | null, observedMs: number, settledMs: number, clock: DayCycleClock | null = getDayCycleClock()): void {
  if (stage !== NIGHTFALL_STAGE || prev === null) return;
  if (!clock) { skipped.noClock += 1; return; }
  const idx = clock.stages.findIndex((s) => s.id === NIGHTFALL_STAGE);
  const fall = clock.stages[idx];
  const before = clock.stages[(idx - 1 + clock.stages.length) % clock.stages.length];
  if (!fall || before?.id !== prev) { skipped.notFromPrevStage += 1; return; }
  if (settledMs < DRIFT_SETTLE_MS) { skipped.notSettled += 1; return; }
  const computed = nearestStageStart(fall, observedMs, clock);
  const delta = observedMs - computed;
  drift.lastComputedMs = computed;
  drift.lastObservedMs = observedMs;
  drift.deltaMs = delta;
  if (Math.abs(delta) <= NIGHTFALL_TOLERANCE_MS) return;
  anchorOffsetMs = centredOffset(clock.offsetMs + delta, clock.cycleMs);
  drift.reanchors += 1;
  for (const cb of Array.from(anchorListeners)) {
    try { cb(); } catch { /* a listener's failure must not stop the others */ }
  }
}

/** Fires after a re-anchor moved every computed stage time. */
export function onDayClockAnchorChange(cb: () => void): () => void {
  anchorListeners.add(cb);
  return () => { anchorListeners.delete(cb); };
}

/** `now` is the server-aligned clock the rest of the maths runs on (catalogs do not import the store). */
export function startDayClockDriftCheck(now: () => number): void {
  if (watching) return;
  watching = true;
  settledFromMs = now();
  const onVisibility = (): void => { if (document.visibilityState === 'visible') settledFromMs = now(); };
  document.addEventListener('visibilitychange', onVisibility);
  watchCleanups.push(() => { document.removeEventListener('visibilitychange', onVisibility); });
  watchCleanups.push(onDayStageChange((stage, prev) => {
    const at = now();
    observeDayStage(stage, prev, at, document.visibilityState === 'visible' ? at - settledFromMs : 0);
  }));
}

export function stopDayClockDriftCheck(): void {
  watching = false;
  for (const fn of watchCleanups.splice(0)) fn();
  anchorOffsetMs = 0;
  drift.lastComputedMs = null;
  drift.lastObservedMs = null;
  drift.deltaMs = null;
  drift.reanchors = 0;
  skipped.notFromPrevStage = 0;
  skipped.notSettled = 0;
  skipped.noClock = 0;
}

export function getNightfallDrift(): NightfallDriftReadout {
  return { watching, ...drift, offsetMs: anchorOffsetMs, skipped: { ...skipped } };
}
