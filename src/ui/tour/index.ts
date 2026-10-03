// src/ui/tour/index.ts
// Public API for the tour system.

import { getCamera3dRuntime, getCamera3dView, onCamera3dViewChange, type Camera3dView } from '../../features/camera3d';
import { getWindow } from '../core/modalWindow';
import { check, replayTour, teardown, isActive } from './engine';
import { registerTour, hasTour, getAllTours, hasHelp, getAllDiscoveryWindowIds } from './registry';
import { clearTourProgress, clearDiscoveryProgress, migrateLegacyTutorial } from './persistence';
import { ensureTourStyles } from './styles';
import type { TourDefinition } from './types';

export type { TourDefinition, TourStep, TourProgress, TourCategory } from './types';
export { check as checkTour } from './engine';
export { registerTour } from './registry';
export { areToursEnabled as getToursEnabled, setToursEnabled } from './persistence';
export { registerDiscovery, registerHelp } from './registry';
export { startDiscovery, stopDiscovery, rescanDiscovery } from './discovery/engine';
export { openHelpPanel, closeHelpPanel } from './help/panel';

/**
 * Initialize the tour system. Call once from main.ts after UI is built.
 * Registers all core tour definitions and injects replay buttons.
 */
export async function initTourSystem(): Promise<void> {
  ensureTourStyles();

  const { registerDiscovery: regDisc, registerHelp: regHelp } = await import('./registry');

  const [
    { welcomeTour },
    { panelShellTour },
    { panelHomeTour },
    { hubTour },
    { petManagerTour },
    { petOptimizerTour },
    { shopRestockTour },
    { publicRoomsTour },
    { statsHubTour },
    { abilityTrackerTour },
    { cropBoostTour },
    { xpTrackerTour },
    { turtleTimerTour },
    { battleshipTour },
    { camera3dTour },
  ] = await Promise.all([
    import('./tours/welcome'),
    import('./tours/panel/shell'),
    import('./tours/panel/home'),
    import('./tours/panel/hub'),
    import('./tours/pets/manager'),
    import('./tours/pets/optimizer'),
    import('./tours/shops/restock'),
    import('./tours/tools/publicRooms'),
    import('./tours/tools/statsHub'),
    import('./tours/trackers/ability'),
    import('./tours/trackers/cropBoost'),
    import('./tours/trackers/xpTracker'),
    import('./tours/trackers/turtleTimer'),
    import('./tours/garden/battleship'),
    import('./tours/garden/camera3d'),
  ]);

  registerTour(welcomeTour);
  registerTour(panelShellTour);
  registerTour(panelHomeTour);
  registerTour(hubTour);
  registerTour(petManagerTour);
  registerTour(petOptimizerTour);
  registerTour(shopRestockTour);
  registerTour(publicRoomsTour);
  registerTour(statsHubTour);
  registerTour(abilityTrackerTour);
  registerTour(cropBoostTour);
  registerTour(xpTrackerTour);
  registerTour(turtleTimerTour);
  registerTour(battleshipTour);
  registerTour(camera3dTour);

  migrateLegacyTutorial(welcomeTour.version);

  const [
    { hubDiscovery },
    { petManagerDiscovery, petOptimizerDiscovery },
    { statsHubDiscovery, publicRoomsDiscovery },
    { cropBoostDiscovery, xpTrackerDiscovery, turtleTimerDiscovery },
  ] = await Promise.all([
    import('./discovery/hub'),
    import('./discovery/pets'),
    import('./discovery/tools'),
    import('./discovery/trackers'),
  ]);
  regDisc(hubDiscovery);
  regDisc(petManagerDiscovery);
  regDisc(petOptimizerDiscovery);
  regDisc(statsHubDiscovery);
  regDisc(publicRoomsDiscovery);
  regDisc(cropBoostDiscovery);
  regDisc(xpTrackerDiscovery);
  regDisc(turtleTimerDiscovery);

  const [
    { hubHelp },
    { petManagerHelp, petOptimizerHelp },
    { statsHubHelp, publicRoomsHelp },
    { cropBoostHelp, xpTrackerHelp, turtleTimerHelp },
  ] = await Promise.all([
    import('./help/hub'),
    import('./help/pets'),
    import('./help/tools'),
    import('./help/trackers'),
  ]);
  regHelp(hubHelp);
  regHelp(petManagerHelp);
  regHelp(petOptimizerHelp);
  regHelp(statsHubHelp);
  regHelp(publicRoomsHelp);
  regHelp(cropBoostHelp);
  regHelp(xpTrackerHelp);
  regHelp(turtleTimerHelp);
}

/**
 * Offers the 3D camera tour the first time 3D is ready this session. Mouse devices only: looking around is a
 * right-drag. Returns the disposer.
 */
export function watchCamera3dTour(): () => void {
  if (typeof window.matchMedia !== 'function' || !window.matchMedia('(any-pointer: fine)').matches) return () => {};
  const start = (v: Camera3dView): boolean => {
    const canvas = getCamera3dRuntime()?.caps.scene.renderer.canvas;
    if (!v.ready || !canvas) return false;
    check('camera3d', canvas);
    return true;
  };
  if (start(getCamera3dView())) return () => {};
  const off = onCamera3dViewChange((v) => { if (start(v)) off(); });
  return off;
}

/**
 * Inject a `?` help button into a modal window's header.
 * Opens the help panel if one is registered; falls back to tour replay.
 */
export function injectReplayButton(windowId: string, getActiveWindowId?: () => string): void {
  const hasContent = hasTour(windowId) || hasHelp(windowId);
  if (!hasContent) return;

  const win = getWindow(windowId);
  if (!win) return;

  const btnContainer = win.minimizeBtn.parentElement;
  if (!btnContainer) return;

  if (btnContainer.querySelector('.qpm-tour-replay-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'qpm-tour-replay-btn';
  btn.textContent = '?';
  btn.title = 'Help & tips';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();

    const resolveWindowId = getActiveWindowId ?? (() => windowId);
    const activeId = resolveWindowId();

    if (hasHelp(activeId)) {
      import('./help/panel').then(({ openHelpPanel, isHelpPanelOpen, closeHelpPanel }) => {
        if (isHelpPanelOpen()) {
          closeHelpPanel();
        } else {
          openHelpPanel(win.body, resolveWindowId);
        }
      });
    } else {
      // Fallback: replay the tour (for windows without help definitions yet)
      replayTour(activeId, win.body);
    }
  });

  btnContainer.insertBefore(btn, win.minimizeBtn);
}

/**
 * Reset all tour and discovery progress. Used by the "Reset all tutorials" button.
 */
export function resetAllTours(): void {
  for (const tour of getAllTours()) {
    clearTourProgress(tour.windowId);
  }
  for (const windowId of getAllDiscoveryWindowIds()) {
    clearDiscoveryProgress(windowId);
  }
}
