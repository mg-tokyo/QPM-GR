import type { ShipSpec } from './types';

export const BOARD_SIZE = 10;

export const FLEET_SPECS: readonly ShipSpec[] = [
  { id: 's5', length: 5 },
  { id: 's4', length: 4 },
  { id: 's3a', length: 3 },
  { id: 's3b', length: 3 },
  { id: 's2', length: 2 },
];

export const CHAT_PREFIX = '⚓';

// Server truncates chat messages at 100 chars (spike findings §3).
export const CHAT_LINE_MAX = 100;

export const TURN_SOFT_TIMEOUT_MS = 120_000;
export const OPPONENT_TIMEOUT_MS = 180_000;
export const AI_THINK_MIN_MS = 1000;
export const AI_THINK_MAX_MS = 2500;

export const STORAGE_KEY_SETTINGS = 'qpm.battleship.v1';
