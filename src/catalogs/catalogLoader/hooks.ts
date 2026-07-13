// Object.* method hooks — intercept Object.keys/values/entries in the game
// context to feed maybeCapture.

import { maybeCapture } from './scan';
import { catalogLog, NativeObject, originalEntries, originalKeys, originalValues } from './state';

// Hook lifecycle state (live holder) — timers armed by lifecycle.ts initCatalogLoader.
export const hooksLifecycle: {
  removed: boolean;
  recheckTimer: ReturnType<typeof setInterval> | null;
  hardDeadlineTimer: ReturnType<typeof setTimeout> | null;
} = {
  removed: false,
  recheckTimer: null,
  hardDeadlineTimer: null,
};

/**
 * Install hooks on Object.keys, Object.values, Object.entries
 * These intercept all iterations over objects in the game code
 */
export function installHooks(): void {
  try {
    NativeObject.keys = function hookedKeys(target: object): string[] {
      maybeCapture(target);
      return originalKeys.call(NativeObject, target);
    };

    if (originalValues) {
      NativeObject.values = function hookedValues<T>(target: Record<string, T>): T[] {
        maybeCapture(target);
        return originalValues.call(NativeObject, target);
      };
    }

    if (originalEntries) {
      NativeObject.entries = function hookedEntries<T>(target: Record<string, T>): [string, T][] {
        maybeCapture(target);
        return originalEntries.call(NativeObject, target);
      };
    }

    catalogLog('Object.* hooks installed');
  } catch (e) {
    console.error('[Catalog] Failed to install hooks:', e);
  }
}

/**
 * Remove hooks and restore original Object methods
 */
export function removeHooks(): void {
  try {
    NativeObject.keys = originalKeys;
    if (originalValues) {
      NativeObject.values = originalValues;
    }
    if (originalEntries) {
      NativeObject.entries = originalEntries;
    }
    catalogLog('Object.* hooks removed');
  } catch {
    // Ignore
  }
}

export function tryRemoveHooks(reason: string): void {
  if (hooksLifecycle.removed) return;
  hooksLifecycle.removed = true;
  removeHooks();
  catalogLog(`Hooks removed (${reason})`);
  if (hooksLifecycle.recheckTimer !== null) {
    clearInterval(hooksLifecycle.recheckTimer);
    hooksLifecycle.recheckTimer = null;
  }
  if (hooksLifecycle.hardDeadlineTimer !== null) {
    clearTimeout(hooksLifecycle.hardDeadlineTimer);
    hooksLifecycle.hardDeadlineTimer = null;
  }
}
