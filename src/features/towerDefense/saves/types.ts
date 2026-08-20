import type { MatchSnapshot } from '../types';

export const MAX_SAVE_SLOTS = 10;
export const TD_SAVES_KEY = 'qpm.td.saves.v1';
// Pre-save-system single-slot autosave. Migrated into the autosave entry on
// first initTdSaves(); the key is removed afterwards.
export const LEGACY_SAVE_GAME_KEY = 'qpm.td.saveGame.v1';
// Canonical id lives with the track model; re-exported so saves/store.ts and
// debug.ts keep their existing import path.
export { CLASSIC_TRACK_ID } from '../tracks/types';

export type SaveSlotRef =
  | { readonly kind: 'auto' }
  | { readonly kind: 'slot'; readonly index: number };

export const AUTO_REF: SaveSlotRef = { kind: 'auto' };

export interface SaveEntry {
  readonly savedAt: number;
  readonly balanceVersion: number;
  readonly trackId: string;
  readonly snapshot: MatchSnapshot;
}

export interface TDSavesV1 {
  readonly version: 1;
  autosave: SaveEntry | null;
  slots: Array<SaveEntry | null>;
}

export function slotRef(index: number): SaveSlotRef {
  return { kind: 'slot', index };
}

export function sameRef(a: SaveSlotRef | null, b: SaveSlotRef | null): boolean {
  if (!a || !b) return false;
  if (a.kind === 'auto') return b.kind === 'auto';
  return b.kind === 'slot' && a.index === b.index;
}
