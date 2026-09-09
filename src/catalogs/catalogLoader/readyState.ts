// Ready state management

import type { GameCatalogs } from '../types';
import { diagLog, diagState, publishCatalogsHealth, schedulePartialCheck } from './diagnostics';
import {
  capturedCatalogs,
  catalogLog,
  errorCallbacks,
  petAbilitiesCallbacks,
  publishCatalogs,
  readiness,
  readyCallbacks,
} from './state';

/**
 * Check if essential catalogs are loaded and notify waiting callbacks
 */
export function checkAndNotifyReady(): void {
  if (readiness.catalogsReady) return;

  // Consider ready when petCatalog is available (most important for automation)
  // Other catalogs are nice-to-have but not blocking
  const hasEssentials = capturedCatalogs.petCatalog !== null;

  if (hasEssentials) {
    readiness.catalogsReady = true;
    catalogLog('Essential catalogs ready');

    // Expose globally for debugging
    publishCatalogs();

    // Health-bus publish: ready. Watchdog can stand down.
    if (diagState.started) {
      if (diagState.readyWatchdogTimer !== null) {
        clearTimeout(diagState.readyWatchdogTimer);
        diagState.readyWatchdogTimer = null;
      }
      publishCatalogsHealth();
      schedulePartialCheck();
    }

    // Notify all waiting callbacks
    for (const callback of readyCallbacks) {
      try {
        callback(capturedCatalogs);
      } catch (e) {
        diagLog.warn('QPM-CATALOG-004', { what: 'ready-callback' }, e);
      }
    }
    readyCallbacks.length = 0;
  }
}

/**
 * Get current captured catalogs (may be partially loaded)
 */
export function getCatalogs(): GameCatalogs {
  return capturedCatalogs;
}

/**
 * Check if catalogs are ready
 */
export function areCatalogsReady(): boolean {
  return readiness.catalogsReady;
}

/**
 * Wait for catalogs to be ready
 * @param timeoutMs Maximum time to wait (default 15 seconds)
 * @returns Promise that resolves with catalogs or rejects on timeout
 */
export function waitForCatalogs(timeoutMs: number = 15000): Promise<GameCatalogs> {
  return new Promise((resolve, reject) => {
    // Already ready
    if (readiness.catalogsReady) {
      resolve(capturedCatalogs);
      return;
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      // Remove from callbacks
      const readyIdx = readyCallbacks.indexOf(onReady);
      if (readyIdx !== -1) readyCallbacks.splice(readyIdx, 1);
      const errorIdx = errorCallbacks.indexOf(onError);
      if (errorIdx !== -1) errorCallbacks.splice(errorIdx, 1);

      reject(new Error(`Catalogs not ready within ${timeoutMs}ms`));
    }, timeoutMs);

    const onReady = (catalogs: GameCatalogs) => {
      clearTimeout(timeoutId);
      resolve(catalogs);
    };

    const onError = (error: Error) => {
      clearTimeout(timeoutId);
      reject(error);
    };

    readyCallbacks.push(onReady);
    errorCallbacks.push(onError);
  });
}

/**
 * Register callback for when catalogs are ready
 * If already ready, callback is called immediately
 * @returns Unsubscribe function
 */
export function onCatalogsReady(callback: (catalogs: GameCatalogs) => void): () => void {
  if (readiness.catalogsReady) {
    try {
      callback(capturedCatalogs);
    } catch (e) {
      diagLog.warn('QPM-CATALOG-004', { what: 'onCatalogsReady-immediate-callback' }, e);
    }
    return () => {};
  }

  readyCallbacks.push(callback);
  return () => {
    const idx = readyCallbacks.indexOf(callback);
    if (idx !== -1) readyCallbacks.splice(idx, 1);
  };
}

export function arePetAbilitiesCaptured(): boolean {
  return capturedCatalogs.petAbilities !== null;
}

let petAbilitiesInvokeDepth = 0;

function invokePetAbilitiesCallback(cb: () => void, what: string): void {
  petAbilitiesInvokeDepth++;
  try { cb(); } catch (e) { diagLog.warn('QPM-CATALOG-004', { what }, e); }
  finally { petAbilitiesInvokeDepth--; }
}

// Fires on every capture/upgrade/top-up. Listeners persist across fires;
// the snapshot means subscriptions made inside a callback join the NEXT fire.
export function notifyPetAbilitiesCaptured(): void {
  for (const cb of petAbilitiesCallbacks.slice()) {
    invokePetAbilitiesCallback(cb, 'petAbilities-callback');
  }
}

// Persistent subscription. Already-captured subscribers also run once
// immediately — but never from inside another capture callback: the sync
// immediate path recursing through a re-subscribing callback was the
// QPM-CATALOG-004 stack overflow (2026-09-09).
export function onPetAbilitiesCaptured(callback: () => void): () => void {
  petAbilitiesCallbacks.push(callback);
  if (capturedCatalogs.petAbilities !== null && petAbilitiesInvokeDepth === 0) {
    invokePetAbilitiesCallback(callback, 'petAbilities-immediate-callback');
  }
  return () => {
    const idx = petAbilitiesCallbacks.indexOf(callback);
    if (idx !== -1) petAbilitiesCallbacks.splice(idx, 1);
  };
}

// Resolves true on capture, false on timeout; on timeout the bundle-text
// fallback is triggered (lazy import breaks the fallback↔readyState cycle).
export function waitForPetAbilities(timeoutMs = 8000): Promise<boolean> {
  if (capturedCatalogs.petAbilities !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    // `let` + optional call: listeners are persistent now, so the callback
    // must unsubscribe itself — and it can fire synchronously during
    // registration, before the assignment completes.
    let unsub: (() => void) | null = null;
    const timer = setTimeout(() => {
      unsub?.();
      void import('./fallback').then(m => m.ensurePetAbilitiesCatalog()).then((ok) => resolve(ok));
    }, timeoutMs);
    unsub = onPetAbilitiesCaptured(() => { unsub?.(); clearTimeout(timer); resolve(true); });
  });
}
