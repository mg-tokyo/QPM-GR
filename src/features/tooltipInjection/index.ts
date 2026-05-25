// src/features/tooltipInjection/index.ts
// Public entry point for the tooltip injection subsystem.
// Merges cropSizeIndicator + tileValueIndicator into one shared observer.

import { log } from '../../utils/logger';
import { subscribeTooltipAtoms } from './atoms';
import {
  startObserver,
  stopObserver,
  reinjectAll,
  registerInjector,
  unregisterInjector,
} from './observer';
import {
  loadCropSizeConfig,
  getCropSizeConfig,
  setCropSizeConfig,
  isBadgesEnabled,
  injectJournalBadges,
} from './journalBadges';
import {
  loadTileValueConfig,
  getTileValueConfig,
  setTileValueConfig,
  injectTileValue,
  startFriendBonusWatch,
  stopFriendBonusWatch,
} from './valueIndicator';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isActive = false;
let atomUnsub: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function initTooltipInjection(): void {
  if (isActive) return;

  // Load configs (with legacy key migration)
  loadCropSizeConfig();
  loadTileValueConfig();

  const cropCfg = getCropSizeConfig();
  const tileCfg = getTileValueConfig();

  // If neither is enabled, nothing to do
  if (!cropCfg.enabled && !tileCfg.enabled) {
    log('[TooltipInjection] Both features disabled, skipping init');
    return;
  }

  isActive = true;
  log('[TooltipInjection] Starting');

  // Register injectors based on config
  if (cropCfg.enabled && cropCfg.showJournalIndicators) {
    registerInjector('journal-badges', injectJournalBadges);
  }
  if (tileCfg.enabled) {
    registerInjector('tile-value', injectTileValue);
  }

  // Subscribe to atoms (shared, with retry)
  subscribeTooltipAtoms(() => reinjectAll())
    .then((unsub) => {
      atomUnsub = unsub;
    })
    .catch(() => {});

  // Friend bonus re-renders
  if (tileCfg.enabled) {
    startFriendBonusWatch(reinjectAll);
  }

  // Start the single shared observer
  startObserver();
}

export function stopTooltipInjection(): void {
  if (!isActive) return;

  stopObserver();
  stopFriendBonusWatch();
  atomUnsub?.();
  atomUnsub = null;
  unregisterInjector('journal-badges');
  unregisterInjector('tile-value');

  isActive = false;
  log('[TooltipInjection] Stopped');
}

// ---------------------------------------------------------------------------
// Config wrappers (re-register/unregister injectors on toggle)
// ---------------------------------------------------------------------------

/** Get crop size (journal badges) config. */
function getCropSizeIndicatorConfig(): ReturnType<typeof getCropSizeConfig> {
  return getCropSizeConfig();
}

/** Update crop size (journal badges) config. */
function setCropSizeIndicatorConfig(updates: Parameters<typeof setCropSizeConfig>[0]): void {
  setCropSizeConfig(updates);
  const cfg = getCropSizeConfig();

  if (cfg.enabled && isBadgesEnabled()) {
    registerInjector('journal-badges', injectJournalBadges);
  } else {
    unregisterInjector('journal-badges');
  }

  // Ensure observer is running if either feature is enabled
  if (cfg.enabled || getTileValueConfig().enabled) {
    if (!isActive) initTooltipInjection();
    reinjectAll();
  } else {
    stopTooltipInjection();
  }
}

/** Get tile value (sell price) config. */
function getTileValueIndicatorConfig(): ReturnType<typeof getTileValueConfig> {
  return getTileValueConfig();
}

/** Update tile value (sell price) config. */
function setTileValueIndicatorConfig(updates: Parameters<typeof setTileValueConfig>[0]): void {
  setTileValueConfig(updates);
  const cfg = getTileValueConfig();

  if (cfg.enabled) {
    registerInjector('tile-value', injectTileValue);
    startFriendBonusWatch(reinjectAll);
  } else {
    unregisterInjector('tile-value');
    stopFriendBonusWatch();
  }

  // Ensure observer is running if either feature is enabled
  if (cfg.enabled || getCropSizeConfig().enabled) {
    if (!isActive) initTooltipInjection();
    reinjectAll();
  } else {
    stopTooltipInjection();
  }
}

// ---------------------------------------------------------------------------
// Public exports (matching old API for external consumers)
// ---------------------------------------------------------------------------

export {
  getCropSizeIndicatorConfig,
  setCropSizeIndicatorConfig,
  getTileValueIndicatorConfig as getTileValueConfig,
  setTileValueIndicatorConfig as setTileValueConfig,
};
