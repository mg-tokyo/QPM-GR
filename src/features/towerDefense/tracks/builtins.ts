import type { Point } from '../types';
import { CLASSIC_TRACK_ID, type TrackDef } from './types';

export type BuiltinTrackId = 'classic' | 'gauntlet' | 'pillars' | 'spiral';

const P = (x: number, y: number): Point => ({ x, y });

// Classic S-curve (unchanged from the pre-tracks engine/path.ts:13-24). 70 tiles.
const CLASSIC_CORNERS: readonly Point[] = [
  P(0, 2), P(10, 2), P(10, 5), P(1, 5), P(1, 8), P(21, 8), P(21, 5), P(12, 5), P(12, 2), P(22, 2),
];
// Short zigzag with two deep jogs. 32 tiles — the hard track.
const GAUNTLET_CORNERS: readonly Point[] = [
  P(0, 3), P(6, 3), P(6, 8), P(16, 8), P(16, 3), P(22, 3),
];
// Six vertical passes. 76 tiles.
const PILLARS_CORNERS: readonly Point[] = [
  P(0, 1), P(3, 1), P(3, 10), P(6, 10), P(6, 1), P(9, 1), P(9, 10),
  P(13, 10), P(13, 1), P(16, 1), P(16, 10), P(19, 10), P(19, 1), P(22, 1),
];
// Rectangular spiral that exits at the board centre (deliberate interior
// exit — the only built-in that breaks the outer-ring exit rule). 120 tiles.
const SPIRAL_CORNERS: readonly Point[] = [
  P(0, 1), P(21, 1), P(21, 10), P(1, 10), P(1, 3), P(19, 3),
  P(19, 8), P(3, 8), P(3, 5), P(17, 5), P(17, 6), P(11, 6),
];

export const BUILTIN_TRACKS: readonly TrackDef[] = Object.freeze([
  { id: CLASSIC_TRACK_ID, corners: CLASSIC_CORNERS, builtIn: true },
  { id: 'gauntlet', corners: GAUNTLET_CORNERS, builtIn: true },
  { id: 'pillars', corners: PILLARS_CORNERS, builtIn: true },
  { id: 'spiral', corners: SPIRAL_CORNERS, builtIn: true },
]);

// Literal keys (not template strings) so scripts/check-i18n-keys.mjs sees them.
export const TRACK_NAME_KEYS: Readonly<Record<BuiltinTrackId, string>> = {
  classic: 'feature.towerDefense.tracks.name.classic',
  gauntlet: 'feature.towerDefense.tracks.name.gauntlet',
  pillars: 'feature.towerDefense.tracks.name.pillars',
  spiral: 'feature.towerDefense.tracks.name.spiral',
};

export function isBuiltinTrackId(id: string): id is BuiltinTrackId {
  return id === 'classic' || id === 'gauntlet' || id === 'pillars' || id === 'spiral';
}

export function getBuiltinTrack(id: string): TrackDef | null {
  for (const t of BUILTIN_TRACKS) if (t.id === id) return t;
  return null;
}

export function getClassicTrack(): TrackDef {
  const c = BUILTIN_TRACKS[0];
  if (!c) throw new Error('td_builtin_tracks_empty');
  return c;
}
