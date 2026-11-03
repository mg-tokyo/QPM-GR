// Pure: how much of the page's long-task time fell inside QPM-instrumented spans.

export interface Interval { start: number; end: number }
export interface Span extends Interval { name: string }
// unseenMs: long-task time older than the span ring reached, so neither QPM's nor the page's.
export interface Overlap { taskMs: number; qpmMs: number; unseenMs: number; byName: Map<string, number> }

export function createOverlap(): Overlap {
  return { taskMs: 0, qpmMs: 0, unseenMs: 0, byName: new Map() };
}

function mergeIntervals(tasks: readonly Interval[]): Interval[] {
  const sorted = tasks.filter((t) => t.end > t.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && t.start <= last.end) last.end = Math.max(last.end, t.end);
    else out.push({ start: t.start, end: t.end });
  }
  return out;
}

// Each instant inside a long task counts once, for the innermost (latest-starting)
// span covering it, so nested probes are never double counted.
export function overlapWithTasks(spans: readonly Span[], tasks: readonly Interval[], into: Overlap = createOverlap()): Overlap {
  for (const t of mergeIntervals(tasks)) {
    into.taskMs += t.end - t.start;
    const clipped: Span[] = [];
    for (const s of spans) {
      const start = Math.max(s.start, t.start);
      const end = Math.min(s.end, t.end);
      if (end > start) clipped.push({ name: s.name, start, end });
    }
    if (clipped.length === 0) continue;
    const edges = Array.from(new Set(clipped.flatMap((s) => [s.start, s.end]))).sort((a, b) => a - b);
    for (let i = 0; i + 1 < edges.length; i++) {
      const a = edges[i] as number;
      const b = edges[i + 1] as number;
      let owner: Span | null = null;
      for (const s of clipped) {
        if (s.start > a || s.end < b) continue;
        if (!owner || s.start > owner.start || (s.start === owner.start && s.end < owner.end)) owner = s;
      }
      if (!owner) continue;
      into.qpmMs += b - a;
      into.byName.set(owner.name, (into.byName.get(owner.name) ?? 0) + (b - a));
    }
  }
  return into;
}

export function topShares(o: Overlap, limit: number): { name: string; pct: number }[] {
  if (o.qpmMs <= 0) return [];
  return Array.from(o.byName, ([name, ms]) => ({ name, ms }))
    .sort((a, b) => b.ms - a.ms)
    .map(({ name, ms }) => ({ name, pct: Math.round((100 * ms) / o.qpmMs) }))
    .filter((t) => t.pct > 0)
    .slice(0, limit);
}

// "≥": only instrumented QPM entry points count, so the QPM share is a lower bound.
export function formatLongTaskSegment(count: number, maxMs: number, o: Overlap): string {
  const head = `longtasks ${count}/15s (max ${Math.round(maxMs)}ms`;
  if (count === 0) return `${head})`;
  const top = topShares(o, 2).map((t) => `${t.name} ${t.pct}%`).join(', ');
  const unseen = Math.round(o.unseenMs);
  // "of qpm:": these shares divide QPM's ms, unlike the degraded row's `qpm ≥X%`, which divides all long-task ms.
  return `${head}, qpm ≥${Math.round(o.qpmMs)}/${Math.round(o.taskMs)}ms${top ? ` [of qpm: ${top}]` : ''}${unseen > 0 ? `, ${unseen}ms unseen` : ''})`;
}

// Degraded-row message (decision D1 (c), 2026-11-03): page long tasks still degrade, but the owner is named.
// `maxMs`: pass it when the single-long-task rule tripped the row, so the message says why.
export function formatLongTaskProblem(count: number, o: Overlap, maxMs?: number): string {
  const pct = o.taskMs > 0 ? Math.round((100 * o.qpmMs) / o.taskMs) : 0;
  const top = topShares(o, 1)[0];
  const max = maxMs === undefined ? '' : `, max ${Math.round(maxMs)}ms`;
  return `page longtasks ${count}/15s${max} (qpm ≥${pct}%${pct > 0 && top ? ` [${top.name}]` : ''})`;
}
