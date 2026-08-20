import { storage } from '../../utils/storage';
import type { Speed } from './types';

const HIGH_SCORE_KEY = 'qpm.td.highScore.v1';
const SETTINGS_KEY = 'qpm.td.settings.v1';

export interface HighScore {
  readonly highestRoundReached: number;
  readonly isEndless: boolean;
  readonly lastPlayedAt: number;
}

export interface TdSettings {
  readonly autoStart: boolean;
  readonly defaultSpeed: Speed;
  // Track chosen most recently; a fresh New Game starts on it if it still resolves.
  readonly lastTrackId?: string;
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
    ...(typeof r.lastTrackId === 'string' ? { lastTrackId: r.lastTrackId } : {}),
  };
}

export function saveSettings(patch: Partial<TdSettings>): TdSettings {
  const merged: TdSettings = { ...loadSettings(), ...patch };
  storage.set(SETTINGS_KEY, merged);
  return merged;
}
