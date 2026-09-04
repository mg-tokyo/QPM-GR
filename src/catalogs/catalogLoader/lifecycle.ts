// Loader lifecycle — init/cleanup orchestration.

import { DEX_AUDIT_DELAY_MS, HOOKS_HARD_DEADLINE_MS, HOOKS_RECHECK_INTERVAL_MS } from './constants';
import { onCatalogsReady } from './readyState';
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
import { ensurePetAbilitiesCatalog } from './fallback';
import { areHookCapturableCatalogsAllCaptured } from './scan';
import { catalogLog, errorCallbacks, petAbilitiesCallbacks, readyCallbacks } from './state';

let hooksInstalledEarly = false;
let dexAuditTimer: ReturnType<typeof setTimeout> | null = null;
let dexAuditUnsub: (() => void) | null = null;

/**
 * Storage-free slice of catalog-loader init: Object.* hook install + the
 * removal timers. Called from bootstrap() BEFORE the first await so catalogs
 * the game iterates during slow GM-storage init aren't missed. Idempotent.
 */
export function initCatalogHooksEarly(): void {
  if (hooksInstalledEarly) return;
  hooksInstalledEarly = true;
  installHooks();

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
    void ensurePetAbilitiesCatalog();
  }, HOOKS_HARD_DEADLINE_MS);
}

/**
 * Initialize the catalog loader
 * MUST be called as early as possible (ideally at document-start)
 */
export function initCatalogLoader(): void {
  catalogLog('Initializing catalog loader...');
  initCatalogHooksEarly();
  startAbilityColorPolling();
  startMutationColorPolling();
  startWeatherCatalogPolling();
  startCosmeticCatalogPolling();
  void fetchCosmeticOwnership();

  // One-shot completeness audit: another mod's enumeration order can hand the
  // hook a partial/lookalike dex; verify every dex catalog against bundle text
  // once, off the load-critical path. Lazy import keeps the parse pipeline out
  // of the startup graph.
  if (!dexAuditUnsub && dexAuditTimer === null) {
    dexAuditUnsub = onCatalogsReady(() => {
      dexAuditUnsub = null;
      dexAuditTimer = setTimeout(() => {
        dexAuditTimer = null;
        void import('./fallback').then((m) => m.runDexCompletenessAudit()).catch(() => {});
      }, DEX_AUDIT_DELAY_MS);
    });
  }
}

/**
 * Force cleanup - call when script unloads
 */
export function cleanupCatalogLoader(): void {
  if (dexAuditTimer !== null) {
    clearTimeout(dexAuditTimer);
    dexAuditTimer = null;
  }
  if (dexAuditUnsub) {
    dexAuditUnsub();
    dexAuditUnsub = null;
  }
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
  petAbilitiesCallbacks.length = 0;
}
