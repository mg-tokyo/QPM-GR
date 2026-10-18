export interface DirectorConfig { minMs: number; maxMs: number; early: boolean; margin: number }
export interface DirectorEvent { id: string; at: number; kind: 'action' | 'move' }

export interface Director {
  observe(e: DirectorEvent): void;
  /** The player to switch to now, or null to stay. `candidates`: online players in seat order. */
  tick(nowMs: number, current: string | null, candidates: readonly string[]): string | null;
  /** The camera is now on `current` (a manual pick or the director's own): its dwell starts at `nowMs`. */
  reset(current: string | null, nowMs: number): void;
  configure(cfg: DirectorConfig): void;
  score(id: string, nowMs: number): number;
}

// Every action counts the same (S D9: no table of game action names); an action 10 s old counts half.
const ACTION_HALF_LIFE_MS = 10_000;
/** Events older than this score nothing. */
export const DIRECTOR_KEEP_MS = 60_000;
const MAX_KEPT = 32;
// Walking makes a player worth watching over an idle one, never over one who is doing things.
const MOVE_BONUS = 0.5;
const MOVE_HALF_LIFE_MS = 3_000;
// An early switch needs one fresh action's worth: a walk, or one old action, never moves the camera on its own.
const MIN_EARLY_SCORE = 1;
// Scores this close are a tie, settled by who was watched least recently (round robin when all are idle).
const TIE = 0.05;
// S §7 defaults: 8 s minimum at 30 s maximum.
const MIN_SHARE = 8 / 30;

export function directorTiming(everySec: number): { minMs: number; maxMs: number } {
  const maxMs = everySec * 1000;
  return { minMs: Math.round(maxMs * MIN_SHARE), maxMs };
}

export function activityScore(actions: readonly number[], lastMoveAt: number | null, nowMs: number): number {
  let s = 0;
  for (const at of actions) {
    const age = Math.max(0, nowMs - at);
    if (age <= DIRECTOR_KEEP_MS) s += 2 ** (-age / ACTION_HALF_LIFE_MS);
  }
  if (lastMoveAt !== null) {
    const age = Math.max(0, nowMs - lastMoveAt);
    if (age <= DIRECTOR_KEEP_MS) s += MOVE_BONUS * 2 ** (-age / MOVE_HALF_LIFE_MS);
  }
  return s;
}

/** The auto-director's scoring and timing (S §7). Pure: the adapter feeds it events and the frame clock. */
export function createDirector(initial: DirectorConfig): Director {
  let cfg = initial;
  const actions = new Map<string, number[]>();
  const moved = new Map<string, number>();
  const watchedAt = new Map<string, number>();
  let on: string | null = null;
  let since = 0;

  const score = (id: string, now: number): number => activityScore(actions.get(id) ?? [], moved.get(id) ?? null, now);

  // Everyone within TIE of the top score is tied; of those, the one watched least recently wins, and candidates are
  // walked from the seat after `skip`, so equal ones fall to the next seat in turn.
  function best(now: number, candidates: readonly string[], skip: string | null): string | null {
    const others = candidates.filter((id) => id !== skip);
    if (others.length === 0) return null;
    const scores = others.map((id) => score(id, now));
    const floor = Math.max(...scores) - TIE;
    const start = skip === null ? 0 : candidates.indexOf(skip) + 1;
    let pick: string | null = null;
    let pickWatched = Infinity;
    for (let k = 0; k < candidates.length; k++) {
      const id = candidates[(start + k) % candidates.length]!;
      const i = others.indexOf(id);
      if (i < 0 || scores[i]! < floor) continue;
      const w = watchedAt.get(id) ?? -Infinity;
      if (pick === null || w < pickWatched) { pick = id; pickWatched = w; }
    }
    return pick;
  }

  return {
    observe(e) {
      if (e.kind === 'move') {
        moved.set(e.id, Math.max(moved.get(e.id) ?? -Infinity, e.at));
        return;
      }
      const list = (actions.get(e.id) ?? []).filter((at) => e.at - at <= DIRECTOR_KEEP_MS);
      list.push(e.at);
      if (list.length > MAX_KEPT) list.splice(0, list.length - MAX_KEPT);
      actions.set(e.id, list);
    },
    tick(now, current, candidates) {
      if (candidates.length === 0) return null;
      if (current === null || !candidates.includes(current)) return best(now, candidates, null);
      if (current !== on) { on = current; since = now; }
      const dwell = now - since;
      if (dwell < cfg.minMs) return null;
      if (dwell >= cfg.maxMs) return best(now, candidates, current);
      if (!cfg.early) return null;
      const other = best(now, candidates, current);
      if (other === null) return null;
      const s = score(other, now);
      return s >= MIN_EARLY_SCORE && s >= cfg.margin * score(current, now) ? other : null;
    },
    reset(current, now) {
      on = current;
      since = now;
      if (current !== null) watchedAt.set(current, now);
    },
    configure(next) { cfg = next; },
    score,
  };
}
