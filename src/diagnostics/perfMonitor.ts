// QPM-owned per-frame cost probes + page long-task counter, published as the
// `perf` bus row and the copy report's `Perf:` line. Exists because the
// 2026-09-07 lag reports carried no performance signal at all (spec D3).
import { healthBus } from './healthBus';
import { createNamedLogger } from './logger';
import type { Subsystem } from './types';
import { visibleInterval } from '../utils/scheduling/timerManager';
import { getAnchorWalkStats } from '../features/standalone/tooltipInjection/pixiAnchor';

const SUBSYSTEM: Subsystem = 'perf';
const log = createNamedLogger(SUBSYSTEM);

export type ProbeName = 'anchor.tick' | 'stateTree.event' | 'reactive.flush';
const PROBE_NAMES: readonly ProbeName[] = ['anchor.tick', 'stateTree.event', 'reactive.flush'];
// p95 budgets (ms) at which QPM's own work becomes a felt stall: anchor.tick
// runs per rAF (7800X3D 0.1 ms), stateTree.event once per server frame and
// brackets every consumer callback (7800X3D 4–5 ms; a slow laptop sits at
// ~15 ms while still healthy), reactive.flush per coalesced microtask.
const BUDGET_MS: Readonly<Record<ProbeName, number>> = { 'anchor.tick': 2, 'stateTree.event': 25, 'reactive.flush': 8 };
const RING = 256;
const MIN_WINDOW_SAMPLES = 10;
const PUBLISH_MS = 15_000;
const LONG_TASK_WARN_PER_WINDOW = 8;
const LONG_TASK_WARN_MAX_MS = 500;

interface Summary { p50: number; p95: number; max: number }
// `last` is the previous complete publish window — what the report shows — so
// a boot spike ages out after 15 s instead of sitting in a 256-sample ring
// for minutes (at ~1 server frame/s the ring alone spans ~4 min).
interface Probe { samples: Float64Array; n: number; idx: number; count: number; overBudgetWindows: number; last: Summary | null }
const probes = new Map<ProbeName, Probe>();
for (const name of PROBE_NAMES) probes.set(name, { samples: new Float64Array(RING), n: 0, idx: 0, count: 0, overBudgetWindows: 0, last: null });

let longTaskWindow = { count: 0, max: 0 };
let lastWindow = { count: 0, max: 0 };
let longTasksSupported = false;
let badWindows = 0;
let observer: PerformanceObserver | null = null;
let stopPublish: (() => void) | null = null;
let started = false;

export function recordProbe(name: ProbeName, ms: number): void {
  const p = probes.get(name);
  if (!p || !Number.isFinite(ms)) return;
  p.samples[p.idx] = ms;
  p.idx = (p.idx + 1) % RING;
  if (p.n < RING) p.n += 1;
  p.count += 1;
}

/** Pure: p50/p95/max over the ring. Exported for tests. */
export function summarize(samples: ArrayLike<number>, n: number): Summary {
  if (n === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = Array.from({ length: n }, (_, i) => samples[i] ?? 0).sort((a, b) => a - b);
  // Nearest-rank percentile: floor(q * n) so p95 over 5 samples picks index 4
  // (the top sample), not index 3.
  const at = (q: number): number => sorted[Math.min(n - 1, Math.floor(q * n))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), max: sorted[n - 1] ?? 0 };
}

// Before the first publish the open window is all there is.
function currentSummary(p: Probe): Summary {
  return p.last ?? summarize(p.samples, p.n);
}

export function getPerfSnapshot(): {
  probes: Record<ProbeName, Summary & { count: number }>;
  longTasks: { count: number; max: number; supported: boolean };
  anchor: ReturnType<typeof getAnchorWalkStats>;
} {
  const out = {} as Record<ProbeName, Summary & { count: number }>;
  for (const [name, p] of probes) out[name] = { ...currentSummary(p), count: p.count };
  return { probes: out, longTasks: { ...lastWindow, supported: longTasksSupported }, anchor: getAnchorWalkStats() };
}

const fmt = (ms: number): string => (ms >= 10 ? Math.round(ms).toString() : ms.toFixed(1));

export function formatPerfLine(): string | null {
  if (!started) return null;
  const s = getPerfSnapshot();
  // Firefox/Safari have no Long Tasks API; "0/15s" there would read as healthy.
  const parts = [s.longTasks.supported
    ? `longtasks ${s.longTasks.count}/15s (max ${Math.round(s.longTasks.max)}ms)`
    : 'longtasks n/a'];
  for (const name of PROBE_NAMES) {
    const p = s.probes[name];
    if (p.count === 0) continue;
    parts.push(`${name} p95 ${fmt(p.p95)}ms`);
  }
  parts.push(`anchor walk ${s.anchor.lastVisited}/${s.anchor.maxVisited} nodes${s.anchor.rootMissing ? ` (${s.anchor.rootMissing} missing)` : ''}`);
  return `Perf: ${parts.join('  ')}`;
}

function publish(): void {
  lastWindow = longTaskWindow;
  longTaskWindow = { count: 0, max: 0 };
  const problems: string[] = [];
  const metrics: Record<string, number> = { longTasks: lastWindow.count, longTaskMaxMs: Math.round(lastWindow.max) };
  for (const [name, p] of probes) {
    const s = summarize(p.samples, p.n);
    const windowSamples = p.n;
    p.last = s;
    p.n = 0;
    p.idx = 0;
    metrics[`${name}.p95`] = Math.round(s.p95 * 100) / 100;
    if (windowSamples >= MIN_WINDOW_SAMPLES && s.p95 > BUDGET_MS[name]) {
      p.overBudgetWindows += 1;
      if (p.overBudgetWindows === 2) log.warn('QPM-PERF-002', { probe: name, p95: s.p95, budget: BUDGET_MS[name] });
      if (p.overBudgetWindows >= 2) problems.push(`${name} p95 ${fmt(s.p95)}ms > ${BUDGET_MS[name]}ms`);
    } else {
      p.overBudgetWindows = 0;
    }
  }
  const bad = lastWindow.count >= LONG_TASK_WARN_PER_WINDOW || lastWindow.max >= LONG_TASK_WARN_MAX_MS;
  badWindows = bad ? badWindows + 1 : 0;
  if (badWindows === 2) log.warn('QPM-PERF-001', { longTasks: lastWindow.count, maxMs: Math.round(lastWindow.max) });
  if (badWindows >= 2) problems.push(`longtasks ${lastWindow.count}/15s`);
  healthBus.publish({
    subsystem: SUBSYSTEM,
    category: 'core',
    status: problems.length === 0 ? 'ok' : 'degraded',
    message: problems.length === 0 ? (formatPerfLine() ?? 'ok').replace(/^Perf: /, '') : problems.join('; '),
    metrics,
  });
}

export function startPerfMonitor(): void {
  if (started) return;
  started = true;
  healthBus.register(SUBSYSTEM, { category: 'core', status: 'ok', message: 'collecting' });
  try {
    longTasksSupported = typeof PerformanceObserver !== 'undefined'
      && (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask');
    if (longTasksSupported) {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          longTaskWindow.count += 1;
          if (e.duration > longTaskWindow.max) longTaskWindow.max = e.duration;
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    }
  } catch { observer = null; longTasksSupported = false; }
  stopPublish = visibleInterval('qpm-perf-monitor', publish, PUBLISH_MS);
}

export function stopPerfMonitor(): void {
  if (!started) return;
  started = false;
  try { observer?.disconnect(); } catch { /* ignore */ }
  observer = null;
  stopPublish?.();
  stopPublish = null;
  for (const p of probes.values()) { p.n = 0; p.idx = 0; p.count = 0; p.overBudgetWindows = 0; p.last = null; }
  longTaskWindow = { count: 0, max: 0 };
  lastWindow = { count: 0, max: 0 };
  longTasksSupported = false;
  badWindows = 0;
}
