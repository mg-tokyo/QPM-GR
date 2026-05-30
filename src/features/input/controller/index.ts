/**
 * Controller feature — public lifecycle API.
 * Used by main.ts and controllerSection.ts (enable/disable toggle + live refs).
 */

import { storage } from '../../../utils/storage';
import { initializeController } from './controllerFeature';
import type { GamepadPoller } from './gamepad';
import type { Cursor } from './cursor';

const ENABLED_KEY = 'qpm.controller.enabled.v1';

let cleanupFn: (() => void) | null = null;
let runningPoller: GamepadPoller | null = null;
let runningCursor: Cursor | null = null;

export async function startController(): Promise<void> {
  const enabled = storage.get<boolean>(ENABLED_KEY, true);
  if (!enabled || cleanupFn) return;
  try {
    const { cleanup, poller, cursor } = await initializeController();
    cleanupFn = cleanup;
    runningPoller = poller;
    runningCursor = cursor;
  } catch (err) {
    console.error('[QPM Controller] Failed to start', err);
  }
}

export function stopController(): void {
  cleanupFn?.();
  cleanupFn = null;
  runningPoller = null;
  runningCursor = null;
}

export function isControllerEnabled(): boolean {
  return storage.get<boolean>(ENABLED_KEY, true);
}

/** Returns the live GamepadPoller while the feature is running, null otherwise. */
export function getRunningPoller(): GamepadPoller | null {
  return runningPoller;
}

/** Returns the live Cursor while the feature is running, null otherwise. */
export function getRunningCursor(): Cursor | null {
  return runningCursor;
}
