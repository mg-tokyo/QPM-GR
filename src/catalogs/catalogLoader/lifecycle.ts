// Loader lifecycle — init/cleanup orchestration.

import { HOOKS_HARD_DEADLINE_MS, HOOKS_RECHECK_INTERVAL_MS } from './constants';
import {
  startAbilityColorPolling,
  startCosmeticCatalogPolling,
  startMutationColorPolling,
  startWeatherCatalogPolling,
  stopAbilityColorPolling,
  stopCosmeticCatalogPolling,
  stopMutationColorPolling,
  stopWeatherCatalogPolling,
} from './enrichment';
import { hooksLifecycle, installHooks, removeHooks, tryRemoveHooks } from './hooks';
import { fetchCosmeticOwnership } from './ownership';
import { areHookCapturableCatalogsAllCaptured } from './scan';
import { catalogLog, errorCallbacks, readyCallbacks } from './state';

/**
 * Initialize the catalog loader
 * MUST be called as early as possible (ideally at document-start)
 */
export function initCatalogLoader(): void {
  catalogLog('Initializing catalog loader...');
  installHooks();
  startAbilityColorPolling();
  startMutationColorPolling();
  startWeatherCatalogPolling();
  startCosmeticCatalogPolling();
  void fetchCosmeticOwnership();

  // Hook removal policy: interval re-check clears hooks as soon as every
  // hook-capturable catalog is in; hard deadline is an unconditional
  // upper bound so a never-arriving catalog can't keep the intercept
  // (and its per-Object.keys tax) installed for the whole session.
  hooksLifecycle.recheckTimer = setInterval(() => {
    if (areHookCapturableCatalogsAllCaptured()) {
      tryRemoveHooks('all captured');
    }
  }, HOOKS_RECHECK_INTERVAL_MS);

  hooksLifecycle.hardDeadlineTimer = setTimeout(() => {
    hooksLifecycle.hardDeadlineTimer = null;
    tryRemoveHooks('hard deadline');
  }, HOOKS_HARD_DEADLINE_MS);
}

/**
 * Force cleanup - call when script unloads
 */
export function cleanupCatalogLoader(): void {
  if (hooksLifecycle.recheckTimer !== null) {
    clearInterval(hooksLifecycle.recheckTimer);
    hooksLifecycle.recheckTimer = null;
  }
  if (hooksLifecycle.hardDeadlineTimer !== null) {
    clearTimeout(hooksLifecycle.hardDeadlineTimer);
    hooksLifecycle.hardDeadlineTimer = null;
  }
  removeHooks();
  hooksLifecycle.removed = true;
  stopAbilityColorPolling();
  stopMutationColorPolling();
  stopWeatherCatalogPolling();
  stopCosmeticCatalogPolling();
  readyCallbacks.length = 0;
  errorCallbacks.length = 0;
}
