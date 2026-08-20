import { notify as coreNotify } from '../../core/notifications';
import { showConfirmDialog } from '../../ui/components';
import { t } from '../../i18n';
import {
  getMatchSnapshot,
  hydrateFromSnapshot,
  initMatchState,
  notify,
  resetForNewMatch,
  setPhase,
  stopMatchState,
} from './state';
import {
  autosaveRun,
  bindActiveSlot,
  deleteSave,
  getActiveSlot,
  getAutosave,
  getEntry,
  hasAnySave,
  initTdSaves,
  promoteAutosaveToFreeSlot,
  stopTdSaves,
  unbindActiveSlot,
} from './saves/store';
import { AUTO_REF, sameRef, type SaveSlotRef } from './saves/types';
import type { MatchSnapshot } from './types';
import { initStage, onStageInvalidated, stopStage } from './render/stage';
import { clearPath } from './render/pathRender';
import { applyTrack } from './tracks/active';
import { getClassicTrack } from './tracks/builtins';
import { resolveTrack, resolveTrackById } from './tracks/registry';
import type { TrackDef } from './tracks/types';
import { loadSettings } from './persistence';
import { initTowerRender, stopTowerRender } from './render/towerRender';
import { clearSharedTextures } from './render/textureCache';
import { initBalloonRender, stopBalloonRender } from './render/balloonRender';
import { initProjectileRender, stopProjectileRender } from './render/projectileRender';
import { initEffects, stopEffects } from './render/effects';
import { initStormForgeEffects, stopStormForgeEffects } from './render/stormForgeEffects';
import { initPetHider, stopPetHider } from './render/petHider';
import { injectStyles, removeStyles } from './ui/styles';
import { injectTrackStyles, removeTrackStyles } from './ui/trackStyles';
import { mountHud } from './ui/hud';
import { mountTowerBar } from './ui/towerBar';
import { mountTowerPanel } from './ui/towerPanel';
import { mountNextRoundPanel } from './ui/nextRoundPanel';
import { mountGameOverModal } from './ui/gameOverModal';
import { closeSavesOverlay, openSavesOverlay } from './ui/savesOverlay';
import { closeTrackSelectOverlay, openTrackSelectOverlay } from './ui/trackSelectOverlay';
import { startLoop, stopLoop } from './engine/loop';
import { initPlayerInput, stopPlayerInput } from './engine/playerInput';
import { resetTowerEngine } from './engine/tower';
import { initTdDebugBridge } from './debug';
import { initPerfOverlay, stopPerfOverlay } from './debug/perfOverlay';
import { tdPlay } from './sounds';

const cleanups: Array<() => void> = [];
let hostEl: HTMLElement | null = null;
let unloadInstalled = false;

function onBeforeUnload(): void {
  try { autosaveRun(getMatchSnapshot()); } catch { /* best-effort */ }
}

export function initTowerDefense(): void {
  if (unloadInstalled) return;
  window.addEventListener('beforeunload', onBeforeUnload);
  unloadInstalled = true;
}

// Reconnect seated us in another slot: the stage already went pass-through,
// so save and leave. Deferred — this fires inside the game's Welcome fan-out
// and quitting synchronously would mutate the subscriber Set mid-iteration.
function onStageLost(): void {
  queueMicrotask(() => {
    if (!hostEl) return;
    quitTowerDefense();
    try {
      coreNotify({
        feature: 'towerDefense',
        level: 'warn',
        message: t('feature.towerDefense.error.stageLost'),
      });
    } catch { /* ignore */ }
  });
}

function reportLaunchFailure(err: unknown): void {
  try {
    coreNotify({
      feature: 'towerDefense',
      level: 'error',
      message: t('feature.towerDefense.error.loadFailed'),
    });
  } catch { /* notification failure never blocks teardown */ }
  console.error('[QPM][TowerDefense] launch failed', err);
}

function openInGameSaves(): void {
  if (!hostEl) return;
  const phase = getMatchSnapshot().phase;
  if (phase === 'idle' || phase === 'ended') return;
  openSavesOverlay({ mode: 'inGame', host: hostEl, onLoad: loadSaveIntoRunningMatch });
}

// A fresh New Game starts on the last chosen track if it still resolves.
function trackForNewGame(): TrackDef {
  const last = loadSettings().lastTrackId;
  return (last !== undefined ? resolveTrackById(last) : null) ?? getClassicTrack();
}

// Loading from a numbered slot binds the run to it; loading the autosave
// leaves the run unbound so round-end autosaves keep refreshing "Continue".
function proceed(saved: MatchSnapshot | null, ref: SaveSlotRef | null, track: TrackDef): void {
  try {
    initMatchState();
    if (saved) hydrateFromSnapshot({ ...saved, trackId: track.id });
    else resetForNewMatch(track.id);
    bindActiveSlot(ref && ref.kind === 'slot' ? ref : null);
    resetTowerEngine(getMatchSnapshot().towers);
    injectStyles();
    injectTrackStyles();

    if (!initStage()) {
      throw new Error('td_stage_init_failed');
    }
    cleanups.push(onStageInvalidated(onStageLost));
    // Bakes engine/path to this run's track and draws it (replaces renderPath()).
    if (!applyTrack(track)) {
      throw new Error('td_track_bake_failed');
    }
    initTowerRender();
    initBalloonRender();
    initProjectileRender();
    initEffects();
    initStormForgeEffects();
    initPetHider();

    hostEl = document.createElement('div');
    hostEl.className = 'qpm-td-root';
    document.body.appendChild(hostEl);

    cleanups.push(mountHud(hostEl, quitTowerDefense, openInGameSaves));
    cleanups.push(mountTowerBar(hostEl));
    cleanups.push(mountTowerPanel(hostEl));
    cleanups.push(mountNextRoundPanel(hostEl));
    cleanups.push(
      mountGameOverModal(
        hostEl,
        () => {
          // Restart after death starts a fresh unbound run; the slot keeps
          // its start-of-round checkpoint (Design D4).
          unbindActiveSlot();
          resetForNewMatch(getMatchSnapshot().trackId);
          resetTowerEngine();
          setPhase('preRound');
          notify();
        },
        quitTowerDefense,
      ),
    );

    // Idle→preRound so towerBar.ts:53 reveals the "Start Next Round" button;
    // without this the fresh match has no visible way to begin round 1.
    // hydrateFromSnapshot already forces preRound + notify, so only fresh
    // launches need this transition.
    if (!saved) {
      setPhase('preRound');
      notify();
    }

    initPlayerInput();
    startLoop();
    initTdDebugBridge({ loadSave: loadSaveIntoRunningMatch });
    initPerfOverlay(hostEl);
    tdPlay('matchStart');
  } catch (err) {
    reportLaunchFailure(err);
    quitTowerDefense();
  }
}

// In-game load. Loss-free: the current run is autosaved to its own slot /
// Autosave first — unless the target IS the bound slot (that is a deliberate
// revert to the checkpoint; autosaving first would clobber it). The relaunch
// is deferred one frame so stopStage()'s garden repaint and initStage()'s
// re-entry into the patch stage never run inside the same synchronous tick.
function loadSaveIntoRunningMatch(ref: SaveSlotRef): void {
  const entry = getEntry(ref);
  if (!entry) return;
  if (!sameRef(getActiveSlot(), ref)) {
    try { autosaveRun(getMatchSnapshot()); } catch { /* best-effort */ }
  }
  quitTowerDefense({ keepSaves: true });
  requestAnimationFrame(() => {
    if (hostEl) return;
    proceed(entry.snapshot, ref, resolveTrack(entry));
  });
}

export async function launchTowerDefense(): Promise<void> {
  if (hostEl) return;

  const wiped = initTdSaves();
  if (wiped > 0) {
    coreNotify({
      feature: 'towerDefense',
      level: 'info',
      message: t('feature.towerDefense.saveWipeToast'),
    });
  }

  if (!hasAnySave()) {
    openNewGameTrackPicker(() => stopTdSaves());
    return;
  }

  openSavesOverlay({
    mode: 'launch',
    host: document.body,
    onLoad: (ref) => {
      const entry = getEntry(ref);
      if (entry) proceed(entry.snapshot, ref, resolveTrack(entry));
      else openNewGameTrackPicker(() => stopTdSaves());
    },
    // Track picker gets its own overlay after the saves picker closes.
    // Cancel from the picker returns to the saves picker.
    onNewGame: () => openNewGameTrackPicker(() => { void launchTowerDefense(); }),
    onDismiss: () => stopTdSaves(),
  });
}

// Shared entry point for every "start a new run from scratch" flow: shows
// the track picker, then delegates to proceed(). onCancel decides where the
// user lands if they back out (fresh launch → close TD; from saves overlay →
// re-open it). initialTrackId highlights the last chosen track.
function openNewGameTrackPicker(onCancel: () => void): void {
  void guardAndOpenNewGamePicker(onCancel);
}

// Preserve the previous run's "Continue" autosave before a fresh unbound run
// starts overwriting it. Free slot → silent promote + toast; all slots full
// → ask the user to discard (else cancel back to the caller's fallback).
async function guardAndOpenNewGamePicker(onCancel: () => void): Promise<void> {
  if (getAutosave() !== null) {
    const promoted = promoteAutosaveToFreeSlot();
    if (promoted !== null) {
      try {
        coreNotify({
          feature: 'towerDefense',
          level: 'info',
          message: t('feature.towerDefense.saves.continueMovedToast', { n: promoted + 1 }),
        });
      } catch { /* toast failure never blocks the launch */ }
    } else {
      const ok = await showConfirmDialog({
        title: t('feature.towerDefense.saves.newGameFullTitle'),
        message: t('feature.towerDefense.saves.newGameFullBody'),
        confirmLabel: t('feature.towerDefense.saves.newGameFullConfirm'),
        variant: 'danger',
      });
      if (!ok) { onCancel(); return; }
      deleteSave(AUTO_REF);
    }
  }
  const lastId = loadSettings().lastTrackId;
  const initialOpts: { initialTrackId?: string } =
    typeof lastId === 'string' ? { initialTrackId: lastId } : {};
  openTrackSelectOverlay({
    host: document.body,
    ...initialOpts,
    onPick: (track) => proceed(null, null, track),
    onCancel,
  });
}

export function quitTowerDefense(opts?: { readonly keepSaves?: boolean }): void {
  if (!hostEl && cleanups.length === 0) return;
  const keepSaves = opts?.keepSaves === true;
  try { closeSavesOverlay(); } catch { /* ignore */ }
  try { closeTrackSelectOverlay(); } catch { /* ignore */ }
  if (!keepSaves) {
    try { autosaveRun(getMatchSnapshot()); } catch { /* best-effort save on quit */ }
  }
  try { stopPerfOverlay(); } catch { /* ignore */ }
  try { stopPlayerInput(); } catch { /* ignore */ }
  try { stopLoop(); } catch { /* ignore */ }
  for (const c of cleanups.splice(0)) {
    try { c(); } catch { /* teardown must not throw */ }
  }
  try { stopPetHider(); } catch { /* ignore */ }
  try { stopStormForgeEffects(); } catch { /* ignore */ }
  try { stopEffects(); } catch { /* ignore */ }
  try { stopProjectileRender(); } catch { /* ignore */ }
  try { stopBalloonRender(); } catch { /* ignore */ }
  try { stopTowerRender(); } catch { /* ignore */ }
  try { clearSharedTextures(); } catch { /* ignore */ }
  try { clearPath(); } catch { /* ignore */ }
  try { stopStage(); } catch { /* ignore */ }
  try { removeStyles(); } catch { /* ignore */ }
  try { removeTrackStyles(); } catch { /* ignore */ }
  if (hostEl) {
    try { hostEl.remove(); } catch { /* ignore */ }
    hostEl = null;
  }
  try { stopMatchState(); } catch { /* ignore */ }
  if (!keepSaves) {
    unbindActiveSlot();
    stopTdSaves();
  }
}
