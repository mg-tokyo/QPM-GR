// Shared "who was costliest this window" helper for the Perf-line
// attributions (stateTree.event, reactive.flush). One implementation, one
// resolution floor, one wording.

export interface CostWindowEntry { windowMs: number }
export interface CostWindowTop { label: string; ms: number; windowTotalMs: number }

/** Firefox's default clock is 1 ms; below one tick the share is noise, not signal. */
export const COST_WINDOW_MIN_MS = 1;

/** Costliest entry since the last call as a share of the window; resets every entry's window. */
export function takeCostWindow<E extends CostWindowEntry>(
  entries: Iterable<E>,
  labelOf: (e: E) => string,
): CostWindowTop | null {
  const list = Array.from(entries);
  let top: E | null = null;
  let total = 0;
  for (const e of list) {
    total += e.windowMs;
    if (!top || e.windowMs > top.windowMs) top = e;
  }
  const out = top && top.windowMs > 0 && total >= COST_WINDOW_MIN_MS
    ? { label: labelOf(top), ms: top.windowMs, windowTotalMs: total }
    : null;
  for (const e of list) e.windowMs = 0;
  return out;
}

/** `top <label> N%` for the Perf line, or null when there is nothing worth naming. */
export function formatTopShare(top: CostWindowTop | null): string | null {
  return top ? `top ${top.label} ${Math.round((100 * top.ms) / top.windowTotalMs)}%` : null;
}
