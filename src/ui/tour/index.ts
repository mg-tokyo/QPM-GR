// src/ui/tour/index.ts
// Public API for the tour system.

import { getWindow } from '../modalWindow';
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
  // Tour system disabled pending final QA
  return;
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
