// Key registry for the storage layer: every known QPM key, dynamic-key prefixes, export exclusions.

/**
 * All QPM storage keys (for comprehensive clearing)
 */
export const QPM_STORAGE_KEYS = [
  // Shop Restock Tracker
  'qpm.shopRestocks.v1',
  'qpm.shopRestockConfig.v1',
  'qpm.shopRestocks.migration',

  // XP Tracker
  'qpm.xpTrackerProcs.v1',
  'qpm.xpTrackerConfig.v1',
  'qpm.petXpObservations.v1',

  // Auto Favorite
  'qpm.autoFavorite.v1',
  'qpm.bulkFavorite.v1',
  'qpm.autoReconnect.enabled.v1',
  'qpm.autoReconnect.delayMs.v1',

  // Pet Hatching Tracker
  'qpm.petHatchingTracker.knownPetIds.v1',
  'qpm.hatchStats.v1',

  // Bad Luck Protection observed streaks
  'qpm.pityTracker.v1',
  'qpm.pityTracker.log.v1',
  'qpm.pityTracker.enabled.seed.v1',
  'qpm.pityTracker.enabled.egg.v1',
  'qpm.pityTracker.enabled.capsule.v1',

  // Garden Battleship
  'qpm.battleship.record.v1',

  // Stats
  'quinoa:stats:v1',

  // Mutation Tracking
  'qpm.mutationValueTracking.v1',
  'qpm.weatherMutationTracking.v1',

  // Pet Food Rules
  'quinoa-pet-food-rules',

  // XP Tracker window layout
  'qpm.xpTrackerWindow.layout.v1',

  // Ability Tracker window layout
  'qpm.trackerWindow.layout.v1',

  // Turtle Timer window layout
  'qpm.turtleTimerWindow.layout.v1',

  // UI State
  'quinoa-ui-panel-position',
  'quinoa-ui-panel-collapsed',
  'quinoa-ui-notifications-collapsed',
  'quinoa-ui-notifications-detail-expanded',
  'quinoa-ui-tracker-target-mode',
  'quinoa-ui-tracker-target-pet',
  'quinoa-ui-tracker-ability-filter',
  'quinoa-ui-mutation-tracker-source',
  'quinoa-ui-mutation-tracker-detail',
  'qpm-tracker-settings',
  'qpm.home-tiles.v1',
  'qpm.home-tiles.v2',
  'qpm.home-tiles.v3',

  // Main data
  'quinoa-pet-manager',
  'quinoaData',

  // Player identity
  'quinoa:selfPlayerId',

  // Pet Teams
  'qpm.petTeams.config.v1',
  'qpm.petTeams.feedPolicy.v1',
  'qpm.petTeams.logs.v1',
  'qpm.petTeams.uiState.v1',
  'qpm.petActivity.v1',
  'qpm.petActivity.ui.v1',
  'qpm.petFloatingCards.v1',
  'qpm.petTeams.sync.enabled.v1',
  'qpm.petTeams.sync.idMap.v1',

  // Charged Abilities (player-activated ability awareness panel)
  'qpm.chargedAbilities.panel.v1',
  'qpm.chargedAbilities.expanded.v1',
  'qpm.chargedAbilities.autoOpenOverlay.v1',

  // Super Cleanser (multi-slot cleanse fanout)
  'qpm.superCleanser.enabled.v1',
  'qpm.superCleanser.autoOpenPanel.v1',
  'qpm.superCleanser.filterMode.v1',
  'qpm.superCleanser.filterMutations.v1',
  'qpm.superCleanser.panel.position.v1',

  // Blobling Customiser presets
  'qpm.bloblingPresets.v1',

  // Shop Restock (Supabase)
  'qpm.restockCache',
  'qpm.restockCache.v2',
  'qpm.restockCache.v3',
  'qpm.restock.refreshBudget.v1',
  'qpm.restock.dismissedCycles.v1',
  'qpm.restock.detailWindows.v1',
  'qpm.restock.detailScale.v1',
  'qpm.restock.soundConfig.v1',
  'qpm.restock.customSounds.v1',
  'qpm.dashboardModules',

  // Pet Optimizer
  'qpm.petOptimizer.config.v4',
  'petOptimizer:config.v2',
  'petOptimizer:config.v3',

  // Sprite Debug
  'qpm.debug.sprite.allowLegacyFallbackOnKtx2',

  // Dev mode
  'qpm.dev.enabled',

  // Activity Log Enhancer
  'qpm.activityLogEnhanced.entries.v1',
  'qpm.activityLogEnhanced.entries.v2',
  'qpm.activityLogEnhanced.entries.v3',
  'qpm.activityLogEnhanced.filters.v1',
  'qpm.activityLog.history.v1',
  'qpm.activityLog.history.backup.v1',
  'qpm.activityLog.history.meta.v1',
  'qpm.activityLog.filter.action.v1',
  'qpm.activityLog.filter.type.v1',
  'qpm.activityLog.filter.order.v1',
  'qpm.activityLog.filter.petSpecies.v1',
  'qpm.activityLog.filter.plantSpecies.v1',
  'qpm.activityLog.migration.v1',
  'qpm.activityLog.ariesImport.v1',
  'qpm.activityLog.enabled.v1',
  'qpm.activityLog.debug.summary.v1',

  // Sell All Pets
  'qpm.petTeams.sellAllPets.v1',

  // Controller
  'qpm.controller.enabled.v1',
  'qpm.controller.bindings.v1',
  'qpm.controller.cursorSpeed.v1',

  // Storage Value
  'qpm.storageValue.v1',
  'qpm.trackers.storageValue.migrated.v1',

  // Texture Manipulator
  'qpm.textureSwaps.v1',

  // Blobling Custom Skins
  'qpm.bloblingCustomSkins.v1',

  // Custom Cards (native card presets)
  'qpm.customCards.presets.v1',
  'qpm.customCards.overridesExpanded.v1',

  // Action Guard (Locker)
  'qpm.locker.config.v1',

  // Garden QOL (insta-harvest, aries hold)
  'qpm.gardenQol.config.v1',

  // Crop Boost / Size Indicator / Tile Value / Tile ETA
  'cropBoostTracker:config',
  'qpm.cropSize.v1',
  'cropSizeIndicator:config',
  'qpm.tileValue.v1',
  'qpm.tileEta.v1',

  // Journal
  'journal:notes',

  // Pet Hutch keybind
  'petHutch:keybind',

  // Public Rooms
  'publicRooms:refreshInterval',
  'player-inspector:journal-expanded',

  // Pet Hub
  'petHub:ariesImportOnce.v1',

  // Pets Window tab
  'qpm.petsWindow.activeTab',

  // Section collapse state
  'qpm.sectionCollapsed',

  // Legacy UI state
  'quinoa-ui-panel-size',
  'quinoa-mutation-reminder-config',

  // Turtle Timer
  'qpm-turtle-manual-overrides',
  'qpm-turtle-completion-log',

  // Garden Filters
  'qpm.gardenFilters.v1',

  // Texture Debug
  'qpm.textureSwaps.debugLogs',

  // Garden Painter presets
  'qpm.gardenPainter.presets.v1',

  // Garden Painter (window state for the texture manipulator)
  'qpm.gardenPainter.gridOpen.v1',
  'qpm.gardenPainter.disableGating.v1',
  'qpm.gardenPainter.gatingDebug.v1',
  'qpm.gardenPainter.slideOutTab.v1',

  // Rive Engine
  'qpm.riveEngine.debug.v1',

  // Rive Control (persistent per-target Rive rules)
  'qpm.riveRules.v1',
  // Note: file overrides are persisted in IndexedDB (qpm-rive-overrides),
  // not via this layer, because they're multi-MB binary blobs that exceed
  // the localStorage quota. See src/rive-engine/fileOverrideStore.ts.

  // Restock cache / tracked
  'qpm.restockCache.v4',
  'qpm.restockCache.v6',
  'qpm.restockCache.v7',
  'qpm.ariedam.gamedata',
  'qpm.restock.tracked',
  'qpm.restock.ui.v1',

  // Shop registry (runtime-discovered shop ids + observed shop→weather)
  'qpm.shopRegistry.discovered.v1',
  'qpm.shopRegistry.weather.v1',

  // Dawn capsule pull history
  'qpm.capsulePulls.v1',

  // Hub visible cards
  'qpm.utilityHub.visibleCards',
  'qpm.toolsHub.visibleCards',
  'qpm.trackersHub.visibleTrackers',

  // Stats Hub
  'qpm.statsHub.filters.v1',

  // Turtle Timer tab
  'qpm.turtleTimer.activeTab',

  // Debug globals opt-in
  'qpm.debug.globals.v1',

  // Version checker
  'qpm.versionCheck.v1',

  // Inventory Capacity
  'qpm.inventoryCapacity.v1',
  'qpm.inventoryCapacity.customSounds.v1',

  // Feed Keybinds
  'qpm.feed-keybinds.v1',

  // Shop Keybinds
  'qpm.shop-keybinds.v1',
  'qpm.panelHotkey.v1',

  // Hub State
  'qpm.hub.state.v1',
  'qpm.hub.migrated.v1',

  // Locale
  'qpm.localeOverride.v1',

  // Diagnostics
  'qpm.diagnostics.errorBuffer.v1',
  'qpm.diagnostics.errorBuffer.migration.v1',

  // Shop Enhancer (Aries co-existence gate)
  'qpm.shopEnhancer.mode',

  // Reactive rollout kill switches (design §5b). Default false; per-tier so
  // regressions can be bisected without a rebuild.
  'qpm.perf.reactive.stateEnabled',
  'qpm.perf.reactive.clientEnabled',
  'qpm.perf.reactive.compositeEnabled',
  'qpm.perf.reactive.dynamicEnabled',

  // Tour system (dynamic keys: qpm.tour.<windowId>)
  // Cleared by storage.clear() via the qpm.* prefix match

  // Tower Defense minigame
  'qpm.td.highScore.v1',
  'qpm.td.settings.v1',
  'qpm.td.saveGame.v1', // legacy single-slot autosave; migrated into qpm.td.saves.v1 on first TD launch
  'qpm.td.saves.v1',
  'qpm.td.debug.perfOverlay.v1',
  'qpm.td.customDesigns.v1',

  // Audio subsystem (per-feature volume overrides)
  'qpm.audio.prefs.v1',

  // WebSocket QuinoaCommand envelope + wire sequencer kill switches
  'qpm.ws.envelope.enabled',
  'qpm.ws.sequencer.enabled',
  'qpm.ws.transport.v1',
];

/** Shop enhancer mode key. Values: 'auto' | 'force-on' | 'force-off'. */
export const SHOP_ENHANCER_MODE_KEY = 'qpm.shopEnhancer.mode';
export type ShopEnhancerMode = 'auto' | 'force-on' | 'force-off';
export const SHOP_ENHANCER_MODES: readonly ShopEnhancerMode[] = ['auto', 'force-on', 'force-off'];

/**
 * Dynamic key prefixes for window position/size/state keys that are generated at runtime.
 * These are NOT in QPM_STORAGE_KEYS because the suffixes are per-window-id.
 */
export const QPM_DYNAMIC_KEY_PREFIXES = [
  'qpm-window-pos-',
  'qpm-window-size-',
  'qpm-window-state-',
] as const;

/** Keys excluded from settings export — runtime logs, caches, legacy data, ephemeral state. */
export const EXPORT_EXCLUDE_KEYS: readonly string[] = [
  // Activity log history (regenerated, ~4 MB)
  'qpm.activityLog.history.v1',
  'qpm.activityLog.history.backup.v1',
  'qpm.activityLog.debug.summary.v1',
  'qpm.activityLogEnhanced.entries.v1',
  'qpm.activityLogEnhanced.entries.v2',
  'qpm.activityLogEnhanced.entries.v3',

  // Pet activity log (regenerated, ~1 MB) + legacy pet teams log
  'qpm.petActivity.v1',
  'qpm.petTeams.logs.v1',

  // Turtle completion log
  'qpm-turtle-completion-log',

  // Caches (regenerated from network/game)
  'qpm.petHatchingTracker.knownPetIds.v1',
  'qpm.petXpObservations.v1',
  'qpm.ariedam.gamedata',

  // Legacy keys (superseded, nothing reads them)
  'qpm-auto-feed-config',
  'qpm-auto-shop-config',
  'quinoa-auto-shop-config',
  'qpm-hatching-helper-config',
  'qpm-hatching-helper-stats-v1',
  'petOptimizer:config.v2',
  'petOptimizer:config.v3',
];

/** Key prefixes excluded from settings export. */
export const EXPORT_EXCLUDE_PREFIXES: readonly string[] = [
  // Restock cache (all versions, regenerated from Supabase)
  'qpm.restockCache',

  // Tour/discovery state (ephemeral)
  'qpm.tour.',
  'qpm.discovered.',
];
