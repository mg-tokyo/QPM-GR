import { getSlotOwnerId } from '../../core/slotOwner';
import type { GridPosition } from '../../types/gameAtoms';
import { isRecord } from '../../utils/typeGuards';
import { createDirector, DIRECTOR_KEEP_MS, directorTiming, type Director, type DirectorConfig } from './director';
import { lastActionOf, type SeatedPlayer } from './players';
import type { SpectatorSettings } from './settings';
import type { SpectatorStore } from './state';

// S §7: an early switch needs 1.5× the current player's score.
const MARGIN = 1.5;
// Timestamps already counted per player: the game's log holds 25 entries (live 1448), so this outlasts any repeat.
const MAX_COUNTED = 64;
// A refused follow (the roster changed under the pick) waits this long before the director picks again.
const RETRY_MS = 1000;

export interface DirectorDeps {
  store: SpectatorStore;
  roster(): readonly SeatedPlayer[];
  onRoster(cb: (list: readonly SeatedPlayer[]) => void): () => void;
  slots(): unknown;
  onSlots(cb: () => void): () => void;
  /** The avatar system's tile for a player, culled ones included. */
  tileOf(id: string): GridPosition | null;
  /** True for a pet ability (catalog): its log entries are the pet's, not the player's. */
  isAbility(action: string): boolean;
  /** followPlayer: true when the camera is now headed to them (it calls picked). */
  follow(id: string): boolean;
  homing(): boolean;
  settings(): Readonly<Pick<SpectatorSettings, 'directorEverySec' | 'directorEarly'>>;
  /** The frame clock (performance.now, as the ticker's lastTime) and the game's timestamp clock (Date.now). */
  perfNow(): number;
  wallNow(): number;
}

export interface DirectorSession {
  isOn(): boolean;
  /** Sets store.director; the game state is watched only while on. */
  set(on: boolean): void;
  /** A follow landed, the director's own or a manual pick: the dwell restarts on them. */
  picked(id: string): void;
  /** Once per spectator frame, before the game's. */
  frame(nowMs: number): void;
  /** Debug: each candidate's activity score now. */
  scores(): Record<string, number>;
  uninstall(): void;
}

interface Seen { act: number; logs: unknown; logTs: number; counted: number[] }

/** The director's adapter (S §7): game events and the frame clock in, followPlayer out. */
export function installDirector(deps: DirectorDeps): DirectorSession {
  let director: Director | null = null;
  let offs: Array<() => void> = [];
  let candidates: string[] = [];
  const seen = new Map<string, Seen>();
  const tiles = new Map<string, GridPosition>();
  let every = 0;
  let early = true;
  let pending = false;
  let holdUntil = -Infinity;
  let installed = true;

  const nextConfig = (): DirectorConfig => {
    const s = deps.settings();
    every = s.directorEverySec;
    early = s.directorEarly;
    return { ...directorTiming(every), early, margin: MARGIN };
  };

  // A player who drops out keeps no tile, so coming back is never taken for a walk.
  const setRoster = (list: readonly SeatedPlayer[]): void => {
    candidates = list.filter((p) => p.online).map((p) => p.id);
    for (const id of tiles.keys()) if (!candidates.includes(id)) tiles.delete(id);
  };

  // lastActionEvent and the activity log share an event's timestamp (live 1448: purchaseEgg in both), and either can
  // land first, so a timestamp counts once per player. The log adds actions a single lastActionEvent patch collapsed.
  // Only a first sight places events by the game's timestamps; later ones count from their arrival, so a client clock
  // that differs from the server's can only shift the seed.
  function ingest(): void {
    const d = director;
    const slots = deps.slots();
    if (!d || !Array.isArray(slots)) return;
    const wall = deps.wallNow();
    const perf = deps.perfNow();
    for (const slot of slots) {
      const id = getSlotOwnerId(slot);
      if (!id || !isRecord(slot)) continue;
      let s = seen.get(id);
      const seeding = !s;
      if (!s) { s = { act: -Infinity, logs: undefined, logTs: -Infinity, counted: [] }; seen.set(id, s); }
      const fresh: number[] = [];
      const last = lastActionOf(slot);
      if (last && last.at > s.act) {
        s.act = last.at;
        if (!deps.isAbility(last.action)) fresh.push(last.at);
      }
      const logs = isRecord(slot.data) ? slot.data.activityLogs : undefined;
      if (logs !== s.logs) {
        s.logs = logs;
        let top = s.logTs;
        for (const e of Array.isArray(logs) ? logs : []) {
          const ts = isRecord(e) && typeof e.timestamp === 'number' ? e.timestamp : null;
          if (ts === null || ts <= s.logTs) continue;
          top = Math.max(top, ts);
          if (isRecord(e) && typeof e.action === 'string' && !deps.isAbility(e.action)) fresh.push(ts);
        }
        s.logTs = top;
      }
      for (const ts of fresh) {
        const age = seeding ? Math.max(0, wall - ts) : 0;
        if (age > DIRECTOR_KEEP_MS || s.counted.includes(ts)) continue;
        s.counted.push(ts);
        if (s.counted.length > MAX_COUNTED) s.counted.shift();
        d.observe({ id, at: perf - age, kind: 'action' });
      }
    }
  }

  function stop(): void {
    for (const off of offs.splice(0)) {
      try { off(); } catch { /* isolate */ }
    }
    director = null;
    candidates = [];
    seen.clear();
    tiles.clear();
    pending = false;
    holdUntil = -Infinity;
  }

  return {
    isOn: () => director !== null,
    set(on) {
      if (!installed || on === (director !== null)) return;
      if (on) {
        const d = createDirector(nextConfig());
        director = d;
        setRoster(deps.roster());
        offs = [deps.onRoster(setRoster), deps.onSlots(ingest)];
        ingest();
        const s = deps.store.get();
        d.reset(s.mode === 'follow' ? s.targetId : null, deps.perfNow());
      } else {
        stop();
      }
      deps.store.patch({ director: on });
    },
    picked(id) {
      director?.reset(id, deps.perfNow());
      holdUntil = -Infinity;
    },
    frame(now) {
      const d = director;
      if (!d) return;
      // A remote avatar's entry is a new object every frame (live 1448), so the tile is compared by value.
      for (const id of candidates) {
        const t = deps.tileOf(id);
        if (!t) continue;
        const prev = tiles.get(id);
        if (prev && prev.x === t.x && prev.y === t.y) continue;
        if (prev) d.observe({ id, at: now, kind: 'move' });
        tiles.set(id, t);
      }
      const s = deps.store.get();
      // A game window open counts too: the camera never jumps to someone else behind it.
      if (pending || now < holdUntil || deps.homing() || s.paused !== null) return;
      const st = deps.settings();
      if (st.directorEverySec !== every || st.directorEarly !== early) d.configure(nextConfig());
      const current = s.mode === 'follow' ? s.targetId : null;
      const pick = d.tick(now, current, candidates);
      if (pick === null || pick === current) return;
      // Outside the game's frame: following redraws the bar and opens the info card.
      pending = true;
      queueMicrotask(() => {
        if (director !== d) return;
        pending = false;
        if (!deps.follow(pick)) holdUntil = deps.perfNow() + RETRY_MS;
      });
    },
    scores() {
      const d = director;
      const now = deps.perfNow();
      return d ? Object.fromEntries(candidates.map((id) => [id, d.score(id, now)])) : {};
    },
    uninstall() {
      if (!installed) return;
      installed = false;
      stop();
    },
  };
}
