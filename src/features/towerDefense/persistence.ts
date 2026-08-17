import { storage } from '../../utils/storage';
import type { MatchSnapshot, Speed } from './types';
import { TD_BALANCE_VERSION } from './constants';

const HIGH_SCORE_KEY = 'qpm.td.highScore.v1';
const SETTINGS_KEY = 'qpm.td.settings.v1';
const SAVE_GAME_KEY = 'qpm.td.saveGame.v1';

export interface HighScore {
  readonly highestRoundReached: number;
  readonly isEndless: boolean;
  readonly lastPlayedAt: number;
}

export interface TdSettings {
  readonly autoStart: boolean;
  readonly defaultSpeed: Speed;
}

const DEFAULT_HIGH_SCORE: HighScore = {
  highestRoundReached: 0,
  isEndless: false,
  lastPlayedAt: 0,
};

const DEFAULT_SETTINGS: TdSettings = {
  autoStart: false,
  defaultSpeed: 1,
};

function isSpeed(v: unknown): v is Speed {
  return v === 1 || v === 2 || v === 3;
}

export function loadHighScore(): HighScore {
  const raw = storage.get<unknown>(HIGH_SCORE_KEY, null);
  if (!raw || typeof raw !== 'object') return DEFAULT_HIGH_SCORE;
  const r = raw as Record<string, unknown>;
  if (typeof r.highestRoundReached !== 'number') return DEFAULT_HIGH_SCORE;
  return {
    highestRoundReached: r.highestRoundReached,
    isEndless: typeof r.isEndless === 'boolean' ? r.isEndless : false,
    lastPlayedAt: typeof r.lastPlayedAt === 'number' ? r.lastPlayedAt : 0,
  };
}

export function saveHighScore(round: number, isEndless: boolean): HighScore {
  const current = loadHighScore();
  if (round <= current.highestRoundReached) return current;
  const next: HighScore = {
    highestRoundReached: round,
    isEndless,
    lastPlayedAt: Date.now(),
  };
  storage.set(HIGH_SCORE_KEY, next);
  return next;
}

export function loadSettings(): TdSettings {
  const raw = storage.get<unknown>(SETTINGS_KEY, null);
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
  const r = raw as Record<string, unknown>;
  return {
    autoStart: typeof r.autoStart === 'boolean' ? r.autoStart : DEFAULT_SETTINGS.autoStart,
    defaultSpeed: isSpeed(r.defaultSpeed) ? r.defaultSpeed : DEFAULT_SETTINGS.defaultSpeed,
  };
}

export function saveSettings(patch: Partial<TdSettings>): TdSettings {
  const merged: TdSettings = { ...loadSettings(), ...patch };
  storage.set(SETTINGS_KEY, merged);
  return merged;
}

export function loadSavedGame(): MatchSnapshot | null {
  const raw = storage.get<unknown>(SAVE_GAME_KEY, null);
  if (!raw || typeof raw !== 'object') return null;
  const wrapper = raw as Record<string, unknown>;
  const version = wrapper.balanceVersion;
  const snapshot = wrapper.snapshot;
  if (typeof version !== 'number' || !snapshot || typeof snapshot !== 'object') {
    // Legacy bare-snapshot format (pre-wrapper) — wipe.
    clearSavedGame();
    return null;
  }
  if (version !== TD_BALANCE_VERSION) {
    clearSavedGame();
    return null;
  }
  const r = snapshot as Record<string, unknown>;
  if (typeof r.round !== 'number' || typeof r.cash !== 'number' || typeof r.lives !== 'number') return null;
  if (r.lives <= 0) return null;
  if (!Array.isArray(r.towers)) return null;
  return snapshot as MatchSnapshot;
}

export function saveGame(snap: MatchSnapshot): void {
  // Only between-rounds state is persisted — Set<string> on projectile hitIds
  // and mid-flight positions don't round-trip through JSON cleanly.
  const clean: MatchSnapshot = {
    ...snap,
    phase: 'preRound',
    balloons: [],
    projectiles: [],
    pendingPlacement: null,
    selectedTowerId: null,
    paused: false,
  };
  storage.set(SAVE_GAME_KEY, { balanceVersion: TD_BALANCE_VERSION, snapshot: clean });
}

export function clearSavedGame(): void {
  storage.remove(SAVE_GAME_KEY);
}

export function hasSavedGame(): boolean {
  // Raw presence check — loadSavedGame() has wipe side effects and we want the
  // caller (launch.ts) to distinguish "had stored data" from "loaded cleanly".
  return storage.get<unknown>(SAVE_GAME_KEY, null) !== null;
}
