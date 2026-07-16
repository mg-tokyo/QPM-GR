import { ready, sleep, getGameHudRoot, getSharedDomObserverStats, initDomObserverDebugBridge } from '../utils/dom/dom';
import { healthBus } from '../diagnostics/healthBus';
import { waitForAriesDetection, getAriesDetectionInfo } from '../integrations/ariesDetection';
import { isVerboseLogsEnabled } from '../diagnostics/logger';
import { diag, publishOk as publishInitOk, warnCore } from './_diagnostics';
import { yieldToBrowser } from '../utils/scheduling/scheduling';
import { createOriginalUI, setCfg, openPublicRoomsWindow, openJournalCheckerWindow } from '../ui/core/originalPanel';
import { shareGlobal } from '../core/pageContext';
import { startVersionChecker } from '../utils/versionChecker';
import { initPublicRooms } from '../features/standalone/publicRooms';
import {
  initSpriteSystem,
  startSpriteV2Diagnostics,
  reportSpriteV2InitFailed,
} from '../sprite-v2/index';
import type { SpriteService } from '../sprite-v2/types';
import { setSpriteService, inspectPetSprites } from '../sprite-v2/compat';
import { initStitcherHydrationListener } from '../sprite-v2/stitcher';
import { initLocale } from '../i18n';
import { initPetHutchWindow, togglePetHutchWindow, openPetHutchWindow, closePetHutchWindow } from '../ui/pets/hutchWindow';
import { initPetsWindow, togglePetsWindow } from '../ui/pets/petsWindow';
import { toggleWindow, registerWindowOpener, restoreOpenWindows } from '../ui/core/modalWindow';
import { openShopRestockWindow } from '../ui/shop/restockWindow';
import { openPetOptimizerWindow } from '../ui/pets/optimizerWindow';
import { openCropBoostTrackerWindow } from '../ui/pets/cropBoostTrackerWindow';
import { openStatsHubWindow } from '../ui/stats/statsHubWindow';
import { registerHubGroups, toggleHub, HUB_WINDOW_ID } from '../ui/hub';
import { migrateHubStorage } from '../ui/hub/migration';
import { getTrackersGroup } from '../ui/hub/groups/trackersGroup';
import { getItemsGroup } from '../ui/hub/groups/itemsGroup';
import { getGardenGroup } from '../ui/hub/groups/gardenGroup';
import { getConfigGroup } from '../ui/hub/groups/configGroup';
import { getToolsGroup } from '../ui/hub/groups/toolsGroup';
import { registerPersistedItemRestockDetailOpeners } from '../ui/shop/itemRestockDetailWindow';
import { startJotaiBridgeDiagnostics } from '../core/jotaiBridge';
import { runAtomHealthCheck, startAtomRegistryDiagnostics } from '../core/atomRegistry';
import { initStateTree, startStateTreeDiagnostics } from '../core/stateTree';
import { initializeStorage, storage, startStorageDiagnostics } from '../utils/storage';
import { startPixiSceneDiagnostics } from '../core/pixiScene';
import { isDevModeEnabled } from '../core/devMode';
import { isDebugGlobalsEnabled } from '../utils/debugGlobals';
import { registerDebugBootstrap } from '../debug/debugBootstrap';
import { visibleInterval, startTimerManagerDiagnostics } from '../utils/scheduling/timerManager';
import { TEXTURE_MANIPULATOR_ENABLED } from '../features/standalone/textureSwapper';
import { initCustomSkins } from '../features/bloblingCustomiser/customSkins';
import { initBloblingPresets } from '../features/bloblingCustomiser/presets/store';
import { initGardenPainterPresets } from '../features/standalone/textureSwapper/presets/store';
import { initRiveEngine, initRivFetchInterceptor, initCanvasRuntimeTrap } from '../rive-engine';
import { initRiveControl } from '../features/standalone/riveControl';
import { openTextureSwapperWindow } from '../ui/standalone/textureSwapperWindow';
import { startShopRestockAlerts } from '../ui/shop/restockAlerts';
import { fetchWeatherPredictions, startRestockDataDiagnostics } from '../utils/restock/dataService';
import { initNotifications } from '../core/notifications';
import { startDawnShopTracker } from '../features/dawn/shop';
import { startCapsuleTracker } from '../features/dawn/capsule';
import { startDawnCaptureTracker } from '../features/dawn/capture';
import { startThunderchargerTracker } from '../features/thunder/charger';
import { startChargedAbilities } from '../features/chargedAbilities';
import { startSuperCleanser } from '../features/superCleanser';
import { initDawnEconomy } from '../store/dawnEconomy';
import { initGmExportBridge } from '../utils/gmExportBridge';
import { startWebsocketDiagnostics } from '../websocket/api';
import {
  initCatalogLoader,
  logCatalogStatus,
  onCatalogsReady,
} from '../catalogs/gameCatalogs';
import { startCatalogsDiagnostics } from '../catalogs/catalogLoader';
import { initDiagnostics, mountDiagnosticsBadge } from '../diagnostics/init';
import { startBundleInfoDiagnostics } from '../diagnostics/bundleInfo';
import { exposeLateDebugApis } from '../debug/mainApi';
import { buildCfg } from './config';
import { initializeGlobalApis } from './globalApis';
import { disposers, installGlobalHandlers } from './shutdown';
import { runFeaturePhases } from './phases';

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

async function waitForGame(): Promise<void> {
  diag.debug('Waiting for game to load');

  await ready;

  const maxWait = 30000;
  const interval = 150;
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    const hudRoot = getGameHudRoot();
    if (hudRoot) {
      const hudContent = hudRoot.querySelector('canvas, button, [data-tm-main-interface], [data-tm-hud-root], [data-tm-player-id]');
      if (hudContent) {
        diag.debug('Game UI detected');
        return;
      }
    }

    const anyCanvas = document.querySelector('#App canvas');
    if (anyCanvas) {
      diag.debug('Game UI detected');
      return;
    }

    await sleep(interval);
  }

  diag.debug('Game UI not detected within timeout, proceeding anyway');
}

async function initialize(): Promise<void> {
  diag.debug('Quinoa Pet Manager initializing');

  // Install the canvas-runtime trap FIRST. It must be in place before the
  // game's first RiveFile constructor runs (otherwise we miss the only
  // assignment that ever exposes the canvas-advanced runtime instance).
  // The trap auto-removes once both expected rive runtimes are wrapped.
  try {
    disposers.canvasRuntimeTrap = initCanvasRuntimeTrap();
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'canvasRuntimeTrap' }, error);
  }

  // Install the .riv fetch hook next — must be in place before the game's
  // initial bundle loads run, otherwise we miss every .riv request and
  // setAssetInterceptor can't reverse-resolve bytes back to a URL.
  // initRivFetchInterceptor is idempotent and has no init dependencies.
  try {
    disposers.rivFetchInterceptor = initRivFetchInterceptor();
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'rivFetchInterceptor' }, error);
  }

  registerDebugBootstrap();
  const debugGlobalsEnabled = isDebugGlobalsEnabled();
  initializeGlobalApis(debugGlobalsEnabled);

  // Diagnostics layer (Phase 1 foundation). Must be up before any subsystem
  // could call into the health bus or named-logger pipeline.
  initDiagnostics();
  initNotifications();
  startWebsocketDiagnostics();
  startAtomRegistryDiagnostics();
  startStateTreeDiagnostics();
  startCatalogsDiagnostics();
  startJotaiBridgeDiagnostics();
  startSpriteV2Diagnostics();
  startRestockDataDiagnostics();
  startBundleInfoDiagnostics();
  startTimerManagerDiagnostics();
  startPixiSceneDiagnostics();

  const cfg = buildCfg();

  // Initialize catalog loader (hooks Object.* methods to capture game data)
  // MUST be called early, before game code runs
  initCatalogLoader();
  diag.debug('Catalog loader initialized');

  // RiveEngine — start it as soon as the catalog loader is running so the
  // load wrapper has a chance to install before the game's first
  // rive.load() call. Catalog loader is what populates the Jotai bridge's
  // cached store; once that's running we can poll for lowLevelRiveAtom.
  // Phase 8 (the old call site) is far too late — the game has already
  // loaded all .riv bundles into its shared cache by then, and no future
  // pet-card open will trigger a fresh rive.load(). Errors are non-fatal.
  try {
    disposers.riveEngine = initRiveEngine();
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'riveEngine' }, error);
  }

  try {
    disposers.riveControl = initRiveControl();
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'riveControl' }, error);
  }

  // Blobling custom skins — fetch interceptor must install before the game
  // requests cosmetic PNGs at startup (otherwise the per-session decoded-image
  // cache in setAvatarImage.ts locks in vanilla bytes for the rest of the
  // session). See spec 2026-06-26-blobling-custom-skins-design.md Phase 0
  // and §2.4. Errors are non-fatal — the feature is purely visual.
  try {
    disposers.customSkins = initCustomSkins();
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'customSkins' }, error);
  }

  void initBloblingPresets().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'bloblingPresets' }, error);
  });
  void initGardenPainterPresets().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'gardenPainterPresets' }, error);
  });
  // Auto reconnect disabled — no longer permitted by the game.
  // Force-disable only when a legacy user still has it flipped on; skip the
  // write on every subsequent boot.
  if (storage.get<boolean>('qpm.autoReconnect.enabled.v1', false) === true) {
    storage.set('qpm.autoReconnect.enabled.v1', false);
  }

  // Log when catalogs become ready (for timing analysis)
  onCatalogsReady(() => {
    const timeMs = performance.now();
    diag.debug('Catalogs ready', { atSeconds: Number((timeMs / 1000).toFixed(1)) });
    if (isVerboseLogsEnabled()) {
      logCatalogStatus();
    }
  });

  // Initialize sprite system (sprite-v2) - must be done early to hook PIXI
  // OPTIMIZATION: Don't block other initialization on sprite loading
  let spriteService: SpriteService | null = null;
  const spriteInit = initSpriteSystem().then((service) => {
    spriteService = service;
    setSpriteService(service);
    initStitcherHydrationListener();
    if (debugGlobalsEnabled) {
      shareGlobal('Sprites', service);
    }
    diag.debug('Sprite system v2 initialized');

    // Export sprite inspector after sprites are ready
    if (debugGlobalsEnabled && typeof window !== 'undefined') {
      const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      (targetWindow as any).inspectPetSprites = inspectPetSprites;
      diag.debug('inspectPetSprites() available in console');
    }
  }).catch((err) => {
    reportSpriteV2InitFailed(err);
  });

  // Wait for game to be ready (parallel with sprite init)
  await waitForGame();

  // Kick off Aries co-existence detection — resolves in the background via the
  // shared DOM observer. Timeout well before startShopEnhancer() runs in Phase 8,
  // so isAriesInstalled() is authoritative by then. See ariesDetection.ts and
  // features/shop/enhancer for the gate that consumes this.
  void waitForAriesDetection(3000).then((detected) => {
    const info = getAriesDetectionInfo();
    diag.debug('Aries detection resolved', { detected: detected ? 1 : 0, via: info.detectedVia ?? 'n/a' });
  });

  // Install the __QPM_DOM_OBSERVER__ debug bridge for console-driven inspection
  // of the shared-observer stats (predicates, mutationsRate, coalesceRatio).
  initDomObserverDebugBridge();

  // Register the domObserver subsystem + sample every 2s. Thresholds match
  // design doc §4: mutationsRate>300/s or lastFlushMs>5ms → degraded.
  healthBus.register('domObserver', {
    category: 'core',
    status: 'starting',
    message: 'Awaiting first sample',
  });
  visibleInterval('qpm-dom-observer-sample', () => {
    const stats = getSharedDomObserverStats();
    const degraded = stats.mutationsRate > 300 || stats.lastFlushMs > 5;
    healthBus.publish({
      subsystem: 'domObserver',
      category: 'core',
      status: degraded ? 'degraded' : 'ok',
      message: degraded
        ? `Elevated: ${stats.mutationsRate}/s, flush=${stats.lastFlushMs}ms`
        : `${stats.mutationsRate}/s`,
      metrics: {
        predicates: stats.predicates,
        mutationsRate: stats.mutationsRate,
        flushRate: stats.flushRate,
        coalesceRatio: stats.coalesceRatio,
        lastFlushMs: stats.lastFlushMs,
      },
    });
  }, 2000);

  const scheduleIdleHealthCheck = typeof requestIdleCallback === 'function'
    ? (cb: () => void) => requestIdleCallback(cb, { timeout: 5000 })
    : (cb: () => void) => setTimeout(cb, 2000);
  scheduleIdleHealthCheck(() => {
    try { runAtomHealthCheck(); } catch (e) { warnCore('QPM-INIT-001', { what: 'atomHealthCheck' }, e); }
  });

  // State-tree init: subscribe once to stateAtom so shop/weather/userSlots
  // reads and hutch subscribe through a memoizing fan-out. Non-fatal — if this
  // fails, atomRegistry reads fall through to the legacy label/atom paths.
  await initStateTree().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'stateTree' }, error);
  });

  // Reactive subscription manager: attaches to stateTree.subscribeToPatches
  // (and later to DOM input events). Kill switches (`qpm.perf.reactive.*Enabled`)
  // stay off until explicit rollout — the manager stays idle until a
  // subscriber routes through it via a hint. See design at
  // .claude/plans/2026-07-07-reactive-systems-design.md.
  try {
    const {
      initReactiveManager,
      reactiveManager,
      isReactiveTierEnabled,
    } = await import('../core/reactive/manager');
    const { installReactiveHook } = await import('../core/jotaiBridge');
    initReactiveManager();
    installReactiveHook({
      isTierEnabled: isReactiveTierEnabled,
      subscribe: reactiveManager.subscribe.bind(reactiveManager),
    });
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'reactiveManager' }, error);
  }

  // Store/feature init phases 1–9 (see phases.ts)
  await runFeaturePhases(cfg);

  // Phase 10: Public rooms, garden inspector, and late debug-API exposure
  initPublicRooms();
  await exposeLateDebugApis(debugGlobalsEnabled);

  // Set configuration for UI
  setCfg(cfg);

  // Initialise locale detection before any UI renders
  try {
    initLocale();
  } catch (err) {
    warnCore('QPM-INIT-001', { what: 'initLocale' }, err);
  }

  // OPTIMIZATION: Wait for sprite system ONLY before creating UI
  // This allows other features to initialize while sprites load in background
  await spriteInit;
  await yieldToBrowser();

  // Tours must be registered BEFORE createOriginalUI: the panel synchronously
  // calls checkTour('panel-shell') and checkTour('panel-home'). If tours aren't
  // registered yet, the lookup silently returns undefined and those tours never
  // fire — not even on later panel opens.
  const { initTourSystem, checkTour } = await import('../ui/tour');
  await initTourSystem();

  // Create UI (needs sprites to be ready)
  await createOriginalUI();

  // Mount the Diagnostics titlebar badge once the panel DOM exists.
  // Invisible-when-ok, so no visual change during a healthy boot.
  mountDiagnosticsBadge();
  // Keep alerts non-blocking: never let this feature break core UI bootstrap.
  try {
    startShopRestockAlerts();
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'shopRestockAlerts' }, error);
  }

  await yieldToBrowser();

  // Phase 11 — Dawn features (weather-gated shop, capsule tracker, capture cooldowns)
  try {
    startDawnShopTracker();
    startCapsuleTracker();
    startDawnCaptureTracker();
    startThunderchargerTracker();
    initDawnEconomy();
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'dawnFeatures' }, error);
  }

  // Phase 11a — Charged Abilities (depends on pets store, garden bridge,
  // sprites, mount state, and the Thunder + Dawn trackers above).
  try {
    startChargedAbilities();
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'chargedAbilities' }, error);
  }

  // Phase 11b — Super Cleanser (reactive selector + capture-phase keydown,
  // independent of instaAction. Depends on stateTree + atomRegistry ready.)
  try {
    startSuperCleanser();
  } catch (error) {
    warnCore('QPM-INIT-001', { what: 'superCleanser' }, error);
  }

  // Phase 11b — Weather predictions (lightweight, non-blocking)
  await yieldToBrowser();
  fetchWeatherPredictions().catch((error) => {
    warnCore('QPM-INIT-001', { what: 'weatherPredictions' }, error);
  });
  visibleInterval('weather-predictions-poll', () => {
    fetchWeatherPredictions().catch(() => { /* silent retry — recurring per-tick refresh; next tick will re-attempt */ });
  }, 5 * 60 * 1000);

  initPetsWindow();

  // Register window openers and restore previously open windows
  registerWindowOpener('public-rooms', openPublicRoomsWindow);
  registerWindowOpener('journal-checker-window', openJournalCheckerWindow);
  registerWindowOpener('qpm-pets-window', togglePetsWindow);
  registerWindowOpener('shop-restock', openShopRestockWindow);
  registerWindowOpener('pet-optimizer', openPetOptimizerWindow);
  registerWindowOpener('crop-boost-tracker', openCropBoostTrackerWindow);
  registerWindowOpener(HUB_WINDOW_ID, toggleHub);
  registerWindowOpener('stats-hub', openStatsHubWindow);
  registerWindowOpener('calculator', () => import('../ui/economy/cropCalculatorWindow').then(({ openCalculatorWindow }) => openCalculatorWindow()));
  if (TEXTURE_MANIPULATOR_ENABLED) {
    registerWindowOpener('texture-swapper', openTextureSwapperWindow);
  }

  // Rive Control (dev-gated window shell). Registration is unconditional so
  // the lazy loader is ready when dev mode is enabled; the launcher in the
  // Garden Painter footer is what dev-gates VISIBILITY.
  const { registerRiveControlWindow } = await import('../ui/riveControl/window');
  registerRiveControlWindow();
  registerWindowOpener('pet-hub', () => {
    const render = (root: HTMLElement) => import('../ui/pets/hubWindow').then(({ renderPetHubWindow }) => renderPetHubWindow(root));
    toggleWindow('pet-hub', '🐾 Pet Hub', render, '1600px', '92vh');
  });

  // Migrate old hub storage and register unified hub groups
  migrateHubStorage();
  registerHubGroups([
    getTrackersGroup(),
    getItemsGroup(),
    getGardenGroup(),
    getConfigGroup(),
    getToolsGroup(),
  ]);

  registerPersistedItemRestockDetailOpeners();

  restoreOpenWindows();

  // Start version checker (checks for updates periodically)
  startVersionChecker();

  // Check welcome tour after UI settles (same timing as old tutorialPopup)
  setTimeout(() => {
    const panel = document.querySelector('.qpm-panel') as HTMLElement | null;
    if (panel) {
      checkTour('welcome', panel);
    }
  }, 1500);

  publishInitOk('Initialized');
}

export async function bootstrap(): Promise<void> {
  installGlobalHandlers();
  await initializeStorage();
  startStorageDiagnostics();
  if (isDevModeEnabled()) diag.debug('Dev mode on');
  initGmExportBridge();
  await initialize();
}
