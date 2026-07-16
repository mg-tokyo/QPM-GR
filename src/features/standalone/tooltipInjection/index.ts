// src/features/tooltipInjection/index.ts
// Public entry point for the tooltip injection subsystem.
// Merges cropSizeIndicator + tileValueIndicator into one shared observer.

import { diag, ensureBusRegistered, publishOk } from './_diagnostics';
import { onTileChanged, startTileTracking, stopTileTracking } from './atoms';
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
import { initLockBadge } from './lockBadge';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isActive = false;
let atomUnsub: (() => void) | null = null;
let lockBadgeUnsub: (() => void) | null = null;

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

  // We start even when crop-size and tile-value are both disabled, because
  // the lock badge is a third independent feature that shares the same PIXI
  // anchor + rAF loop and should be available whenever Locker is running.
  isActive = true;
  ensureBusRegistered();
  diag.debug('Starting', {
    crop: String(cropCfg.enabled),
    tileValue: String(tileCfg.enabled),
  });

  // Register injectors based on config
  if (cropCfg.enabled && cropCfg.showJournalIndicators) {
    registerInjector('journal-badges', injectJournalBadges);
  }
  if (tileCfg.enabled) {
    registerInjector('tile-value', injectTileValue);
  }

  // Start atom subscriptions (idempotent — lockBadge may also register).
  void startTileTracking();
  atomUnsub = onTileChanged(() => reinjectAll());

  // Friend bonus re-renders
  if (tileCfg.enabled) {
    startFriendBonusWatch(reinjectAll);
  }

  // Start the single shared observer
  startObserver();

  // lockBadge subscribes to onTileChanged internally for content updates;
  // observer.rAF only drives position. Config changes still route through here.
  lockBadgeUnsub = initLockBadge(() => reinjectAll());

  publishOk('Started', {
    injectors: (cropCfg.enabled && cropCfg.showJournalIndicators ? 1 : 0) + (tileCfg.enabled ? 1 : 0),
    cropSize: String(cropCfg.enabled),
    tileValue: String(tileCfg.enabled),
  });
}

export function stopTooltipInjection(): void {
  if (!isActive) return;

  stopObserver();
  stopFriendBonusWatch();
  atomUnsub?.();
  atomUnsub = null;
  lockBadgeUnsub?.();
  lockBadgeUnsub = null;
  unregisterInjector('journal-badges');
  unregisterInjector('tile-value');
  stopTileTracking();

  isActive = false;
  diag.debug('Stopped');
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
