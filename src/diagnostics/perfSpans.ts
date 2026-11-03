// Time-stamped QPM spans for long-task attribution. Dependency-free so the timer
// manager and DOM observer can record into it (perfMonitor imports both).
import { overlapWithTasks, type Interval, type Overlap, type Span } from './longTaskOverlap';

// Long-task entries arrive shortly after their task ends; the ring only has to
// reach back that far: ~4.5 s at 144 Hz with every probe live. Older time is `unseenMs`.
export const SPAN_RING = 2048;

let starts: Float64Array | null = null;
let durations: Float32Array | null = null;
let names: string[] = [];
let idx = 0;
let n = 0;

export function setSpanRecording(on: boolean): void {
  if (on) {
    starts ??= new Float64Array(SPAN_RING);
    durations ??= new Float32Array(SPAN_RING);
    if (names.length === 0) names = new Array<string>(SPAN_RING).fill('');
    return;
  }
  starts = null;
  durations = null;
  names = [];
  idx = 0;
  n = 0;
}

export function isSpanRecording(): boolean {
  return starts !== null;
}

/** For probes that only know their duration; reads no clock while recording is off. */
export function recordSpanEndingNow(name: string, ms: number): void {
  if (!starts || !(ms > 0)) return;
  const end = performance.now();
  recordSpan(name, end - ms, end);
}

/** `name` should be a pre-built string: this runs per frame. */
export function recordSpan(name: string, start: number, end: number): void {
  if (!starts || !durations || !(end > start)) return;
  starts[idx] = start;
  durations[idx] = end - start;
  names[idx] = name;
  idx = (idx + 1) % SPAN_RING;
  if (n < SPAN_RING) n += 1;
}

export function attributeLongTasks(entries: readonly { startTime: number; duration: number }[], into: Overlap): Overlap {
  const tasks: Interval[] = entries.map((e) => ({ start: e.startTime, end: e.startTime + e.duration }));
  const spans: Span[] = [];
  if (starts && durations && tasks.length > 0) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of tasks) { lo = Math.min(lo, t.start); hi = Math.max(hi, t.end); }
    for (let i = 0; i < n; i++) {
      const start = starts[i] ?? 0;
      const end = start + (durations[i] ?? 0);
      if (end > lo && start < hi) spans.push({ name: names[i] ?? '', start, end });
    }
    if (n === SPAN_RING) {
      const oldest = starts[idx] ?? 0;
      for (const t of tasks) if (t.start < oldest) into.unseenMs += Math.min(t.end, oldest) - t.start;
    }
  }
  return overlapWithTasks(spans, tasks, into);
}
