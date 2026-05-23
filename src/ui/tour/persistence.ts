// src/ui/tour/persistence.ts

import { storage } from '../../utils/storage';
import type { TourProgress } from './types';

const TOUR_KEY_PREFIX = 'qpm.tour.';

/** Legacy tutorial key from tutorialPopup.ts */
const LEGACY_TUTORIAL_KEY = 'qpm_tutorial_shown_v3.1.0';

function tourKey(windowId: string): string {
  return `${TOUR_KEY_PREFIX}${windowId}`;
}

/** Read persisted progress for a tour. Returns null if never started. */
export function readTourProgress(windowId: string): TourProgress | null {
  return storage.get<TourProgress | null>(tourKey(windowId), null);
}

/** Write progress for a tour. */
export function writeTourProgress(windowId: string, progress: TourProgress): void {
  storage.set(tourKey(windowId), progress);
}

/** Clear progress for a single tour (used by replay button). */
export function clearTourProgress(windowId: string): void {
  storage.remove(tourKey(windowId));
}

/**
 * Migrate the legacy tutorialPopup.ts storage key to the new tour system.
 * If the old key is `true`, marks the welcome tour as completed.
 * Safe to call multiple times — no-op if legacy key is absent.
 */
export function migrateLegacyTutorial(welcomeVersion: number): void {
  const legacy = storage.get<boolean>(LEGACY_TUTORIAL_KEY, false);
  if (!legacy) return;

  // Only migrate if we haven't already persisted welcome progress
  const existing = readTourProgress('welcome');
  if (existing) return;

  writeTourProgress('welcome', {
    version: welcomeVersion,
    lastCompletedStep: -1,
    completed: true,
  });

  storage.remove(LEGACY_TUTORIAL_KEY);
}
