import { t } from '../../../i18n';
import { createNamedLogger } from '../../../diagnostics/logger';
import type { SaveEntry } from '../saves/types';
import { bakeWaypoints } from './bake';
import { BUILTIN_TRACKS, TRACK_NAME_KEYS, getBuiltinTrack, getClassicTrack, isBuiltinTrackId } from './builtins';
import type { TrackDef, TrackDifficulty } from './types';

const log = createNamedLogger('td-tracks');
// Warn once per unknown id — thumbnails re-resolve on every Saved Runs render.
const warnedIds = new Set<string>();

export function listTracks(): readonly TrackDef[] {
  return BUILTIN_TRACKS;
}

export function resolveTrackById(id: string): TrackDef | null {
  return getBuiltinTrack(id);
}

// Never null: unknown ids fall back to classic so a save always loads.
export function resolveTrack(entry: SaveEntry): TrackDef {
  const found = resolveTrackById(entry.trackId);
  if (found) return found;
  if (!warnedIds.has(entry.trackId)) {
    warnedIds.add(entry.trackId);
    log.warn('QPM-TDTRK-002', { trackId: entry.trackId });
  }
  return getClassicTrack();
}

export function getTrackDisplayName(track: TrackDef): string {
  if (track.builtIn && isBuiltinTrackId(track.id)) return t(TRACK_NAME_KEYS[track.id]);
  return track.name ?? track.id;
}

export function getTrackLength(track: TrackDef): number {
  const baked = bakeWaypoints(track.corners);
  const last = baked[baked.length - 1];
  return last ? last.cumulativeDistance : 0;
}

export function difficultyFor(lengthTiles: number): TrackDifficulty {
  if (lengthTiles < 50) return 'hard';
  if (lengthTiles > 90) return 'relaxed';
  return 'normal';
}

export function getTrackDifficulty(track: TrackDef): TrackDifficulty {
  return difficultyFor(getTrackLength(track));
}

export function getDifficultyLabel(d: TrackDifficulty): string {
  if (d === 'hard') return t('feature.towerDefense.tracks.difficulty.hard');
  if (d === 'relaxed') return t('feature.towerDefense.tracks.difficulty.relaxed');
  return t('feature.towerDefense.tracks.difficulty.normal');
}
