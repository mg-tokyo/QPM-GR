import { showConfirmDialog } from '../../../ui/components';
import { t } from '../../../i18n';
import { STARTING_CASH } from '../constants';
import { getActiveTrack, setActiveTrack } from '../engine/path';
import { cancelPlacement, resetTowerEngine } from '../engine/tower';
import { renderPath } from '../render/pathRender';
import {
  getMatchSnapshot,
  notify,
  resetForNewMatch,
  setCash,
  setPhase,
  setSelectedTower,
  setTowers,
  setTrackId,
} from '../state';
import { autosaveRun, unbindActiveSlot } from '../saves/store';
import { saveSettings } from '../persistence';
import { tdPlay } from '../sounds';
import type { MatchSnapshot } from '../types';
import { getTrackDisplayName, resolveTrackById } from './registry';
import type { TrackDef } from './types';

export type SwitchTrackResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'locked' | 'unknown' | 'cancelled' | 'bake_failed' };

// Available while a match is running (post-launch, pre-quit). Idle/ended
// hides the affordance entirely — those states mean no TD HUD is up anyway.
export function canSwitchTrack(snap: MatchSnapshot = getMatchSnapshot()): boolean {
  return snap.phase !== 'idle' && snap.phase !== 'ended';
}

// The ONLY place engine/path's baked track and state.trackId change together.
// launch.ts calls it once per proceed() (after initStage), switchTrack after
// the board reset. renderPath is a no-op before the stage exists.
export function applyTrack(track: TrackDef): boolean {
  if (!setActiveTrack(track)) return false;
  setTrackId(track.id);
  renderPath();
  notify();
  return true;
}

export async function switchTrack(id: string): Promise<SwitchTrackResult> {
  const snap = getMatchSnapshot();
  if (!canSwitchTrack(snap)) return { ok: false, reason: 'locked' };
  const track = resolveTrackById(id);
  if (!track) return { ok: false, reason: 'unknown' };
  if (track.id === getActiveTrack().id) return { ok: true };

  // Fresh board (round 0 with no towers placed) = the setup screen — swap
  // silently. Anywhere else, the switch abandons a run in progress and starts
  // a new one on the new track, autosaving the old one first.
  const isFreshBoard = snap.round === 0 && snap.towers.length === 0;
  if (!isFreshBoard) {
    const accepted = await showConfirmDialog({
      title: t('feature.towerDefense.tracks.switchTitle', { name: getTrackDisplayName(track) }),
      message: t('feature.towerDefense.tracks.switchBody'),
      confirmLabel: t('feature.towerDefense.tracks.switchConfirm'),
    });
    if (!accepted) return { ok: false, reason: 'cancelled' };
    // The dialog is async — TD may have quit while it was open.
    if (!canSwitchTrack()) return { ok: false, reason: 'locked' };
    // Best-effort autosave; autosaveRun is a no-op for unsaveable snapshots
    // (game-over etc.). Unbind so the fresh run starts as its own autosave.
    try { autosaveRun(getMatchSnapshot()); } catch { /* ignore */ }
    unbindActiveSlot();
    resetForNewMatch(track.id);
    // launch.ts uses the same idle→preRound transition after resetForNewMatch
    // so the tower bar exposes "Start Next Round".
    setPhase('preRound');
  }
  cancelPlacement();
  setSelectedTower(null);
  if (isFreshBoard) {
    setTowers([]);
    setCash(STARTING_CASH);
  }
  resetTowerEngine();
  if (!applyTrack(track)) return { ok: false, reason: 'bake_failed' };
  saveSettings({ lastTrackId: track.id });
  tdPlay('uiClick');
  return { ok: true };
}
