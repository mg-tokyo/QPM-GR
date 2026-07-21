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
import {
  loadTileEtaConfig,
  getTileEtaConfig,
  setTileEtaConfig,
  injectTileEta,
  startTurtleEtaWatch,
  stopTurtleEtaWatch,
} from './etaIndicator';
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
  loadTileEtaConfig();

  const cropCfg = getCropSizeConfig();
  const tileCfg = getTileValueConfig();
  const etaCfg = getTileEtaConfig();

  // We start even when all indicator features are disabled, because the lock
  // badge is a fourth independent feature that shares the same PIXI anchor +
  // rAF loop and should be available whenever Locker is running.
  isActive = true;
  ensureBusRegistered();
  diag.debug('Starting', {
    crop: String(cropCfg.enabled),
    tileValue: String(tileCfg.enabled),
    tileEta: String(etaCfg.enabled),
  });

  // Register injectors based on config
  if (cropCfg.enabled && cropCfg.showJournalIndicators) {
    registerInjector('journal-badges', injectJournalBadges);
  }
  if (tileCfg.enabled) {
    registerInjector('tile-value', injectTileValue);
  }
  if (etaCfg.enabled) {
    registerInjector('tile-eta', injectTileEta);
  }

  // Start atom subscriptions (idempotent — lockBadge may also register).
  void startTileTracking();
  atomUnsub = onTileChanged(() => reinjectAll());

  // Friend bonus re-renders
  if (tileCfg.enabled) {
    startFriendBonusWatch(reinjectAll);
  }

  // Turtle timer state re-renders
  if (etaCfg.enabled) {
    startTurtleEtaWatch(reinjectAll);
  }

  // Start the single shared observer
  startObserver();

  // lockBadge subscribes to onTileChanged internally for content updates;
  // observer.rAF only drives position. Config changes still route through here.
  lockBadgeUnsub = initLockBadge(() => reinjectAll());

  publishOk('Started', {
    injectors:
      (cropCfg.enabled && cropCfg.showJournalIndicators ? 1 : 0) +
      (tileCfg.enabled ? 1 : 0) +
      (etaCfg.enabled ? 1 : 0),
    cropSize: String(cropCfg.enabled),
    tileValue: String(tileCfg.enabled),
    tileEta: String(etaCfg.enabled),
  });
}

export function stopTooltipInjection(): void {
  if (!isActive) return;

  stopObserver();
  stopFriendBonusWatch();
  stopTurtleEtaWatch();
  atomUnsub?.();
  atomUnsub = null;
  lockBadgeUnsub?.();
  lockBadgeUnsub = null;
  unregisterInjector('journal-badges');
  unregisterInjector('tile-value');
  unregisterInjector('tile-eta');
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

  // Ensure observer is running if any indicator feature is enabled
  if (cfg.enabled || getTileValueConfig().enabled || getTileEtaConfig().enabled) {
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

  // Ensure observer is running if any indicator feature is enabled
  if (cfg.enabled || getCropSizeConfig().enabled || getTileEtaConfig().enabled) {
    if (!isActive) initTooltipInjection();
    reinjectAll();
  } else {
    stopTooltipInjection();
  }
}

/** Get tile ETA (turtle-boosted countdown) config. */
function getTileEtaIndicatorConfig(): ReturnType<typeof getTileEtaConfig> {
  return getTileEtaConfig();
}

/** Update tile ETA config. */
function setTileEtaIndicatorConfig(updates: Parameters<typeof setTileEtaConfig>[0]): void {
  setTileEtaConfig(updates);
  const cfg = getTileEtaConfig();

  if (cfg.enabled) {
    registerInjector('tile-eta', injectTileEta);
    startTurtleEtaWatch(reinjectAll);
  } else {
    unregisterInjector('tile-eta');
    stopTurtleEtaWatch();
  }

  // Ensure observer is running if any indicator feature is enabled
  if (cfg.enabled || getCropSizeConfig().enabled || getTileValueConfig().enabled) {
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
  getTileEtaIndicatorConfig,
  setTileEtaIndicatorConfig,
};
