// Object.* method hooks — intercept Object.keys/values/entries in the game
// context to feed maybeCapture.

import { maybeCapture } from './scan';
import { diagLog } from './diagnostics';
import { registerForeignSignal } from '../../diagnostics/modDetection';
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

// QPM's installed wrappers — used to identity-guard restore so we never wipe
// a wrapper another mod layered on top of ours.
let hookedKeysRef: typeof Object.keys | null = null;
let hookedValuesRef: typeof Object.values | null = null;
let hookedEntriesRef: typeof Object.entries | null = null;

function isNonNative(fn: unknown): boolean {
  try {
    return typeof fn === 'function' && !Function.prototype.toString.call(fn).includes('[native code]');
  } catch {
    return false;
  }
}

/**
 * Install hooks on Object.keys, Object.values, Object.entries
 * These intercept all iterations over objects in the game code
 */
export function installHooks(): void {
  registerForeignSignal('Object.keys', () => {
    const env = getHookEnvironment();
    return env.originalWasNonNative || (!env.objectKeysCurrentlyOurs && !env.objectKeysCurrentlyNative);
  });
  try {
    // If another mod wrapped Object.* before QPM loaded, our module-scope
    // "original" snapshot is their wrapper, not the native fn. Capture still
    // works (we delegate to it), but surface it once for diagnosability.
    if (isNonNative(originalKeys) || isNonNative(originalValues) || isNonNative(originalEntries)) {
      diagLog.warn('QPM-CATALOG-004', { what: 'non-native-original-snapshot' });
    }

    hookedKeysRef = function hookedKeys(target: object): string[] {
      maybeCapture(target);
      return originalKeys.call(NativeObject, target);
    };
    NativeObject.keys = hookedKeysRef;

    if (originalValues) {
      hookedValuesRef = function hookedValues<T>(target: Record<string, T>): T[] {
        maybeCapture(target);
        return originalValues.call(NativeObject, target);
      } as typeof Object.values;
      NativeObject.values = hookedValuesRef;
    }

    if (originalEntries) {
      hookedEntriesRef = function hookedEntries<T>(target: Record<string, T>): [string, T][] {
        maybeCapture(target);
        return originalEntries.call(NativeObject, target);
      } as typeof Object.entries;
      NativeObject.entries = hookedEntriesRef;
    }

    catalogLog('Object.* hooks installed');
  } catch (e) {
    diagLog.warn('QPM-CATALOG-004', { what: 'install-hooks' }, e);
  }
}

/**
 * Restore original Object methods — identity-guarded: only restore a slot if
 * it still holds QPM's wrapper; a later mod's wrapper is left in place
 * (it delegates to ours, which delegates to the original — chain stays sound).
 */
export function removeHooks(): void {
  try {
    if (!hookedKeysRef || NativeObject.keys === hookedKeysRef) {
      NativeObject.keys = originalKeys;
    } else {
      catalogLog('Object.keys wrapped by third party — leaving in place');
    }
    if (originalValues) {
      if (!hookedValuesRef || NativeObject.values === hookedValuesRef) {
        NativeObject.values = originalValues;
      } else {
        catalogLog('Object.values wrapped by third party — leaving in place');
      }
    }
    if (originalEntries) {
      if (!hookedEntriesRef || NativeObject.entries === hookedEntriesRef) {
        NativeObject.entries = originalEntries;
      } else {
        catalogLog('Object.entries wrapped by third party — leaving in place');
      }
    }
    catalogLog('Object.* hooks removed');
  } catch {
    // Ignore
  }
}

/** Who owns Object.keys — surfaces other mods' Object.* wrappers (and whether
 * ours pre- or post-dates them) in supportReport for remote diagnosis. */
export function getHookEnvironment(): {
  originalWasNonNative: boolean;
  objectKeysCurrentlyOurs: boolean;
  objectKeysCurrentlyNative: boolean;
} {
  return {
    originalWasNonNative: isNonNative(originalKeys) || isNonNative(originalValues) || isNonNative(originalEntries),
    objectKeysCurrentlyOurs: hookedKeysRef !== null && NativeObject.keys === hookedKeysRef,
    objectKeysCurrentlyNative: !isNonNative(NativeObject.keys),
  };
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
