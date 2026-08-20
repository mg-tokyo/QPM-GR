import type { Point } from '../types';

export type TrackDifficulty = 'hard' | 'normal' | 'relaxed';

export const CLASSIC_TRACK_ID = 'classic';
// Shortest track the validator accepts (built-in or recorded).
export const MIN_TRACK_TILES = 20;

export interface TrackDef {
  readonly id: string;
  readonly corners: readonly Point[];
  readonly builtIn: boolean;
  // Custom tracks only; built-ins resolve their name via TRACK_NAME_KEYS.
  readonly name?: string;
}
