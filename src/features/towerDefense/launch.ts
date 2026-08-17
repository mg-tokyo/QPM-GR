import { notify as coreNotify } from '../../core/notifications';
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
  clearSavedGame,
  hasSavedGame,
  loadSavedGame,
  saveGame,
} from './persistence';
import type { MatchSnapshot } from './types';
import { initStage, stopStage } from './render/stage';
import { renderPath, clearPath } from './render/pathRender';
import { initTowerRender, stopTowerRender } from './render/towerRender';
import { initBalloonRender, stopBalloonRender } from './render/balloonRender';
import { initProjectileRender, stopProjectileRender } from './render/projectileRender';
import { initEffects, stopEffects } from './render/effects';
import { initPetHider, stopPetHider } from './render/petHider';
import { injectStyles, removeStyles } from './ui/styles';
import { mountHud } from './ui/hud';
import { mountTowerBar } from './ui/towerBar';
import { mountTowerPanel } from './ui/towerPanel';
import { mountNextRoundPanel } from './ui/nextRoundPanel';
import { mountGameOverModal, showResumeDialog } from './ui/gameOverModal';
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
  const snap = getMatchSnapshot();
  if (snap.phase === 'inRound' || snap.phase === 'preRound') {
    try { saveGame(snap); } catch { /* best-effort */ }
  }
}

export function initTowerDefense(): void {
  if (unloadInstalled) return;
  window.addEventListener('beforeunload', onBeforeUnload);
  unloadInstalled = true;
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

function proceed(saved?: MatchSnapshot | null): void {
  try {
    initMatchState();
    if (saved) hydrateFromSnapshot(saved);
    else resetForNewMatch();
    resetTowerEngine(getMatchSnapshot().towers);
    injectStyles();

    if (!initStage()) {
      throw new Error('td_stage_init_failed');
    }
    renderPath();
    initTowerRender();
    initBalloonRender();
    initProjectileRender();
    initEffects();
    initPetHider();

    hostEl = document.createElement('div');
    hostEl.className = 'qpm-td-root';
    document.body.appendChild(hostEl);

    cleanups.push(mountHud(hostEl, quitTowerDefense));
    cleanups.push(mountTowerBar(hostEl));
    cleanups.push(mountTowerPanel(hostEl));
    cleanups.push(mountNextRoundPanel(hostEl));
    cleanups.push(
      mountGameOverModal(
        hostEl,
        () => {
          resetForNewMatch();
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
    initTdDebugBridge();
    initPerfOverlay(hostEl);
    tdPlay('matchStart');
  } catch (err) {
    reportLaunchFailure(err);
    quitTowerDefense();
  }
}

export async function launchTowerDefense(): Promise<void> {
  if (hostEl) return;

  if (hasSavedGame()) {
    // Peek the saved payload before offering resume. loadSavedGame() wipes
    // legacy or version-mismatched saves; skipping the resume dialog in that
    // case avoids showing a resume option we couldn't honour.
    const saved = loadSavedGame();
    if (saved === null) {
      coreNotify({
        feature: 'towerDefense',
        level: 'info',
        message: t('feature.towerDefense.saveWipeToast'),
      });
      proceed();
      return;
    }
    showResumeDialog(
      document.body,
      () => {
        clearSavedGame();
        proceed(saved);
      },
      () => {
        clearSavedGame();
        proceed();
      },
    );
    return;
  }

  proceed();
}

export function quitTowerDefense(): void {
  if (!hostEl && cleanups.length === 0) return;
  try {
    const snap = getMatchSnapshot();
    if ((snap.phase === 'inRound' || snap.phase === 'preRound') && snap.lives > 0) {
      saveGame(snap);
    }
  } catch { /* best-effort save on quit */ }
  try { stopPerfOverlay(); } catch { /* ignore */ }
  try { stopPlayerInput(); } catch { /* ignore */ }
  try { stopLoop(); } catch { /* ignore */ }
  for (const c of cleanups.splice(0)) {
    try { c(); } catch { /* teardown must not throw */ }
  }
  try { stopPetHider(); } catch { /* ignore */ }
  try { stopEffects(); } catch { /* ignore */ }
  try { stopProjectileRender(); } catch { /* ignore */ }
  try { stopBalloonRender(); } catch { /* ignore */ }
  try { stopTowerRender(); } catch { /* ignore */ }
  try { clearPath(); } catch { /* ignore */ }
  try { stopStage(); } catch { /* ignore */ }
  try { removeStyles(); } catch { /* ignore */ }
  if (hostEl) {
    try { hostEl.remove(); } catch { /* ignore */ }
    hostEl = null;
  }
  try { stopMatchState(); } catch { /* ignore */ }
}
