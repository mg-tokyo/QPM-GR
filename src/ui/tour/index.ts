// src/ui/tour/index.ts
// Public API for the tour system.

import { getWindow } from '../modalWindow';
import { check, replayTour, teardown, isActive } from './engine';
import { registerTour, hasTour, getAllTours } from './registry';
import { clearTourProgress, migrateLegacyTutorial } from './persistence';
import { ensureTourStyles } from './styles';
import type { TourDefinition } from './types';

export type { TourDefinition, TourStep, TourProgress, TourCategory } from './types';
export { check as checkTour } from './engine';
export { registerTour } from './registry';

/**
 * Initialize the tour system. Call once from main.ts after UI is built.
 * Registers all core tour definitions and injects replay buttons.
 */
export async function initTourSystem(): Promise<void> {
  ensureTourStyles();

  // Import and register all core tour definitions
  const [
    { welcomeTour },
    { panelShellTour },
    { panelHomeTour },
    { petHubTour },
    { shopRestockTour },
    { abilityTrackerTour },
  ] = await Promise.all([
    import('./tours/welcome'),
    import('./tours/panel/shell'),
    import('./tours/panel/home'),
    import('./tours/pets/hub'),
    import('./tours/shops/restock'),
    import('./tours/trackers/ability'),
  ]);

  registerTour(welcomeTour);
  registerTour(panelShellTour);
  registerTour(panelHomeTour);
  registerTour(petHubTour);
  registerTour(shopRestockTour);
  registerTour(abilityTrackerTour);

  // Migrate legacy tutorial key
  migrateLegacyTutorial(welcomeTour.version);
}

/**
 * Inject a `?` replay button into a modal window's header.
 * Call after the window is created. No-op if no tour is registered for that window.
 */
export function injectReplayButton(windowId: string): void {
  if (!hasTour(windowId)) return;

  const win = getWindow(windowId);
  if (!win) return;

  const btnContainer = win.minimizeBtn.parentElement;
  if (!btnContainer) return;

  // Don't inject twice
  if (btnContainer.querySelector('.qpm-tour-replay-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'qpm-tour-replay-btn';
  btn.textContent = '?';
  btn.title = 'Replay tour';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    replayTour(windowId, win.body);
  });

  btnContainer.insertBefore(btn, win.minimizeBtn);
}

/**
 * Reset all tour progress. Used by the "Reset all tutorials" button.
 */
export function resetAllTours(): void {
  for (const tour of getAllTours()) {
    clearTourProgress(tour.windowId);
  }
}
