// src/diagnostics/codes/tdTracks.ts — TD track-system codes, split out of
// codes.ts to stay under the 750-line hard cap.

import type { ErrorCodeDefinition } from '../types';

// Keep in sync with CURRENT_VERSION in ../codes.ts (local copy avoids a
// circular import).
const V = '3.3.27';

export const TD_TRACKS_CODES: readonly ErrorCodeDefinition[] = [
  {
    code: 'QPM-TDTRK-002',
    subsystem: 'feature',
    category: 'feature',
    severity: 'warn',
    title: 'TD tracks: unknown track id on load',
    description: 'A saved run referenced a track id that no longer resolves; the run was loaded on the classic track.',
    devNotes: 'src/features/towerDefense/tracks/registry.ts resolveTrack(). context.trackId is the unresolved id. Logged once per id per session.',
    sinceVersion: V,
  },
];
