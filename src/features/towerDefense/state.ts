import type {
  Balloon,
  MatchSnapshot,
  PendingPlacement,
  Phase,
  Projectile,
  Speed,
  TargetPriority,
  Tower,
} from './types';
import { STARTING_CASH, STARTING_LIVES } from './constants';
import { CLASSIC_TRACK_ID } from './tracks/types';
import { bumpSnapshot } from './debug/perfCounters';

interface MutableState {
  phase: Phase;
  trackId: string;
  round: number;
  isEndless: boolean;
  cash: number;
  lives: number;
  speed: Speed;
  paused: boolean;
  autoStart: boolean;
  towers: readonly Tower[];
  balloons: readonly Balloon[];
  projectiles: readonly Projectile[];
  selectedTowerId: string | null;
  pendingPlacement: PendingPlacement | null;
  startedAt: number;
}

function makeInitial(): MutableState {
  return {
    phase: 'idle',
    trackId: CLASSIC_TRACK_ID,
    round: 0,
    isEndless: false,
    cash: STARTING_CASH,
    lives: STARTING_LIVES,
    speed: 1,
    paused: false,
    autoStart: false,
    towers: [],
    balloons: [],
    projectiles: [],
    selectedTowerId: null,
    pendingPlacement: null,
    startedAt: 0,
  };
}

let state: MutableState = makeInitial();
let initialized = false;
const listeners = new Set<(s: MatchSnapshot) => void>();

// Cached snapshot: getMatchSnapshot was called ~5000/sec during heavy waves,
// each call allocating a fresh 14-field object literal. Cache the object and
// return the same reference until any setter runs. Every mutation site MUST
// call invalidateSnapshot() — the setters below and the wholesale state=
// reassignments in initMatchState/stopMatchState/resetForNewMatch/
// hydrateFromSnapshot.
let cachedSnapshot: MatchSnapshot | null = null;
function invalidateSnapshot(): void { cachedSnapshot = null; }

function buildSnapshot(): MatchSnapshot {
  bumpSnapshot();
  return {
    phase: state.phase,
    trackId: state.trackId,
    round: state.round,
    isEndless: state.isEndless,
    cash: state.cash,
    lives: state.lives,
    speed: state.speed,
    paused: state.paused,
    autoStart: state.autoStart,
    towers: state.towers,
    balloons: state.balloons,
    projectiles: state.projectiles,
    selectedTowerId: state.selectedTowerId,
    pendingPlacement: state.pendingPlacement,
    startedAt: state.startedAt,
  };
}

export function initMatchState(): void {
  if (initialized) return;
  initialized = true;
  state = makeInitial();
  invalidateSnapshot();
}

export function stopMatchState(): void {
  listeners.clear();
  state = makeInitial();
  initialized = false;
  invalidateSnapshot();
}

export function getMatchSnapshot(): MatchSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  cachedSnapshot = buildSnapshot();
  return cachedSnapshot;
}

export function onMatchChange(cb: (s: MatchSnapshot) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function notify(): void {
  const snap = getMatchSnapshot();
  for (const cb of listeners) {
    try {
      cb(snap);
    } catch {
      /* listener errors never break the tick */
    }
  }
}

// trackId override keeps the current track across Restart-after-death; the
// baked path in engine/path.ts is untouched by this call.
export function resetForNewMatch(trackId?: string): void {
  state = makeInitial();
  if (trackId !== undefined) state.trackId = trackId;
  state.startedAt = Date.now();
  invalidateSnapshot();
  notify();
}

// Restore between-rounds state from a saved snapshot. Transient in-round state
// (balloons, projectiles, pendingPlacement, selectedTower) is dropped, and
// phase is forced to preRound — resume drops the player between waves.
export function hydrateFromSnapshot(snap: MatchSnapshot): void {
  const restoredTowers: Tower[] = snap.towers.map((t) => ({
    id: t.id,
    kind: t.kind,
    tile: t.tile,
    // Re-derive: saves from before the engine-space fix stored pixel = tile + 0.5.
    pixel: { x: t.tile.x, y: t.tile.y },
    fireCooldownMs: 0,
    targetPriority: t.targetPriority,
    upgradesA: t.upgradesA,
    upgradesB: t.upgradesB,
    totalSpent: t.totalSpent,
  }));
  state = {
    phase: 'preRound',
    trackId: snap.trackId,
    round: snap.round,
    isEndless: snap.isEndless,
    cash: snap.cash,
    lives: snap.lives,
    speed: snap.speed,
    paused: false,
    autoStart: snap.autoStart,
    towers: restoredTowers,
    balloons: [],
    projectiles: [],
    selectedTowerId: null,
    pendingPlacement: null,
    startedAt: snap.startedAt || Date.now(),
  };
  invalidateSnapshot();
  notify();
}

type PhaseTransitionHook = (prev: Phase, next: Phase) => void;
const phaseHooks: PhaseTransitionHook[] = [];

export function registerPhaseTransitionHook(hook: PhaseTransitionHook): void {
  phaseHooks.push(hook);
}

export function setPhase(phase: Phase): void {
  const prev = state.phase;
  state.phase = phase;
  invalidateSnapshot();
  if (prev !== phase) {
    for (const h of phaseHooks) {
      try { h(prev, phase); } catch { /* hook errors never break state */ }
    }
  }
}

export function setTrackId(trackId: string): void {
  state.trackId = trackId;
  invalidateSnapshot();
}

export function setSpeed(speed: Speed): void {
  state.speed = speed;
  invalidateSnapshot();
}

export function setPaused(paused: boolean): void {
  state.paused = paused;
  invalidateSnapshot();
}

export function setAutoStart(autoStart: boolean): void {
  state.autoStart = autoStart;
  invalidateSnapshot();
}

export function setCash(cash: number): void {
  state.cash = cash;
  invalidateSnapshot();
}

export function setLives(lives: number): void {
  state.lives = lives;
  invalidateSnapshot();
}

export function setRound(round: number, isEndless: boolean): void {
  state.round = round;
  state.isEndless = isEndless;
  invalidateSnapshot();
}

export function setTowers(towers: readonly Tower[]): void {
  state.towers = towers;
  invalidateSnapshot();
}

export function setBalloons(balloons: readonly Balloon[]): void {
  state.balloons = balloons;
  invalidateSnapshot();
}

export function setProjectiles(projectiles: readonly Projectile[]): void {
  state.projectiles = projectiles;
  invalidateSnapshot();
}

export function setSelectedTower(id: string | null): void {
  state.selectedTowerId = id;
  invalidateSnapshot();
}

export function setPendingPlacement(p: PendingPlacement | null): void {
  state.pendingPlacement = p;
  invalidateSnapshot();
}

export function setTargetPriority(towerId: string, priority: TargetPriority): void {
  const idx = state.towers.findIndex((t) => t.id === towerId);
  if (idx < 0) return;
  const existing = state.towers[idx];
  if (!existing) return;
  const updated: Tower = { ...existing, targetPriority: priority };
  const next = state.towers.slice();
  next[idx] = updated;
  state.towers = next;
  invalidateSnapshot();
}
