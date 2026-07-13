import { storage } from '../../../utils/storage';
import { log } from '../../../utils/logger';
import { visibleInterval } from '../../../utils/scheduling/timerManager';
import { getMapSnapshot } from '../bridge';
import { onCatalogsReady } from '../../../catalogs/gameCatalogs';
import { shareGlobal } from '../../../core/pageContext';
import { STORAGE_KEY, DIM_ALPHA } from './constants';
import type { GardenFiltersConfig, CachedFilterSets } from './types';
import { normalizeMutationFilterKey } from './mutationKeys';
import { installVisibleGuard, removeVisibleGuard, removeAllVisibleGuards } from './alphaGuard';
import { getPixiApp, getOrBuildTileNodeCache, applyFiltersToStage, resetFiltersOnStage, tileCache } from './pixiStage';
import { diagnoseGardenFilters, testSpeciesFilter } from './diagnostics';
import { watchNodeIdentity } from './nodeWatch';

let config: GardenFiltersConfig = {
  enabled: false,
  mutations: [],
  excludeMutations: false,
  cropSpecies: [],
  eggTypes: [],
  growthStates: [],
};

const listeners = new Set<(config: GardenFiltersConfig) => void>();
let cleanupInterval: (() => void) | null = null;

let cachedFilterSets: CachedFilterSets | null = null;

function getOrBuildFilterSets(): CachedFilterSets {
  if (cachedFilterSets !== null) return cachedFilterSets;
  const mutationsToShow = new Set<string>();
  for (const mutation of config.mutations) {
    const normalized = normalizeMutationFilterKey(mutation);
    if (normalized) mutationsToShow.add(normalized);
  }
  cachedFilterSets = {
    speciesKeysToShow: new Set<string>(config.cropSpecies),
    mutationsToShow,
    eggTypesToShow: new Set<string>(config.eggTypes),
    growthStatesToShow: new Set<string>(config.growthStates),
  };
  return cachedFilterSets;
}

/**
 * Stats hub species override — when non-null, bypasses main config entirely.
 * Only a species-allow-list is applied; mutations/growthStates/eggTypes are ignored.
 * Never touches config or storage.
 */
let statsHubOverride: string[] | null = null;

/**
 * Stats hub exclude mutations override — when non-null, shows tiles WITHOUT the given mutations.
 * Takes priority over the tile index override. Never touches config or storage.
 */
let statsHubExcludeMutationsSet: Set<string> | null = null;

/**
 * Stats hub tile key override — when non-null, shows only tiles whose tileKey
 * ("g:<dirtTileIdx>" or "b:<boardwalkTileIdx>") is in this set.
 * Takes priority over the species override. Never touches config or storage.
 */
let statsHubTileKeySet: Set<string> | null = null;

/**
 * Exclude mutations matching mode for the stats hub "Filter Remaining" overlay.
 * false (default/ANY): show tile if it's missing AT LEAST ONE selected mutation.
 * true  (ALL):         show tile only if it has NONE of the selected mutations.
 * Only used when statsHubExcludeMutationsSet is non-null.
 */
let statsHubExcludeMutationsAllMode = false;

/** Exclude-mode flags read by applyFiltersToStage (pixiStage.ts) during traversal. */
export function getExcludeMutationsState(): { shouldExclude: boolean; allMode: boolean } {
  return {
    shouldExclude: statsHubExcludeMutationsSet !== null || config.excludeMutations,
    allMode: statsHubExcludeMutationsAllMode,
  };
}

/** Internal state snapshot for diagnoseGardenFilters (diagnostics.ts). */
export function getControllerDiagnostics(): {
  config: GardenFiltersConfig;
  pollingActive: boolean;
  statsHubOverride: string[] | null;
  cachedFilterSetsReady: boolean;
} {
  return {
    config: { ...config },
    pollingActive: cleanupInterval !== null,
    statsHubOverride,
    cachedFilterSetsReady: cachedFilterSets !== null,
  };
}

/**
 * Apply current filters to all tiles in the garden.
 * When statsHubOverride is active, only species filtering is applied (no mutations/
 * growthStates/eggTypes) using the override list — main config is untouched.
 */
export function applyFilters(): void {
  // ── Stats hub exclude mutations override ─────────────────────────────────
  // Shows tiles WITHOUT the given mutations. Takes priority over species override.
  if (statsHubExcludeMutationsSet !== null) {
    try {
      const app = getPixiApp();
      if (!app || !app.stage) return;
      const emptySet = new Set<string>();
      const stats = { visible: 0, dimmed: 0, withData: 0, withoutData: 0 };
      const tileNodes = getOrBuildTileNodeCache(app.stage);
      for (const { node } of tileNodes) {
        applyFiltersToStage(node, emptySet, statsHubExcludeMutationsSet, emptySet, emptySet, stats, 0, 0);
      }
      log(`🔍 [GARDEN-FILTERS] Exclude override: ${stats.visible} visible, ${stats.dimmed} dimmed`);
    } catch (error) {
      log('⚠️ [GARDEN-FILTERS] Error applying exclude override', error);
    }
    return;
  }

  // ── Stats hub tile key override ───────────────────────────────────────────
  // Shows only specific individual tiles by tileKey ("g:<dirtTileIdx>" or "b:<boardwalkTileIdx>").
  // Uses the forward map (globalIdx → dirtTileIdx) to match PIXI nodes — avoids reverse-map issues.
  if (statsHubTileKeySet !== null) {
    try {
      const app = getPixiApp();
      if (!app || !app.stage) return;
      const map = getMapSnapshot();
      if (!map) return;
      const tileNodes = getOrBuildTileNodeCache(app.stage);
      let visible = 0; let dimmed = 0;
      for (const { node, x, y } of tileNodes) {
        const childLabel = node.children?.[0]?.label;
        if (!childLabel || childLabel === 'Sprite') continue;
        const globalIdx = x + y * map.cols;
        // Forward lookup: globalIdx → local tile index (same path used in getGardenTileData)
        let tileKey: string | null = null;
        const dirtMapping = map.globalTileIdxToDirtTile?.[globalIdx];
        if (dirtMapping) {
          tileKey = `g:${Number(dirtMapping.dirtTileIdx)}`;
        } else {
          const boardwalkMapping = map.globalTileIdxToBoardwalk?.[globalIdx];
          if (boardwalkMapping) {
            tileKey = `b:${Number(boardwalkMapping.boardwalkTileIdx)}`;
          }
        }
        if (tileKey !== null && statsHubTileKeySet.has(tileKey)) {
          removeVisibleGuard(node);
          node.alpha = 1.0;
          visible++;
        } else {
          node.alpha = DIM_ALPHA;
          installVisibleGuard(node);
          dimmed++;
        }
      }
      log(`🔍 [GARDEN-FILTERS] Tile key override: ${visible} visible, ${dimmed} dimmed`);
    } catch (error) {
      log('⚠️ [GARDEN-FILTERS] Error applying tile key override', error);
    }
    return;
  }

  // ── Stats hub override path ───────────────────────────────────────────────
  // Takes full priority; main config (including enabled, mutations, etc.) is ignored.
  if (statsHubOverride !== null) {
    try {
      const app = getPixiApp();
      if (!app || !app.stage) return;
      const speciesKeysToShow = new Set<string>(statsHubOverride);
      const emptySet = new Set<string>();
      const stats = { visible: 0, dimmed: 0, withData: 0, withoutData: 0 };
      const tileNodes = getOrBuildTileNodeCache(app.stage);
      for (const { node } of tileNodes) {
        applyFiltersToStage(node, speciesKeysToShow, emptySet, emptySet, emptySet, stats, 0, 0);
      }
      log(`🔍 [GARDEN-FILTERS] Override: ${stats.visible} visible, ${stats.dimmed} dimmed`);
    } catch (error) {
      log('⚠️ [GARDEN-FILTERS] Error applying stats hub override', error);
    }
    return;
  }

  // ── Normal config path ────────────────────────────────────────────────────
  if (!config.enabled) {
    resetFilters();
    return;
  }

  try {
    const app = getPixiApp();
    if (!app || !app.stage) {
      log('⚠️ [GARDEN-FILTERS] PIXI app/stage not available');
      return;
    }

    const { speciesKeysToShow, mutationsToShow, eggTypesToShow, growthStatesToShow } = getOrBuildFilterSets();

    const stats = { visible: 0, dimmed: 0, withData: 0, withoutData: 0 };
    const tileNodes = getOrBuildTileNodeCache(app.stage);
    for (const { node } of tileNodes) {
      applyFiltersToStage(node, speciesKeysToShow, mutationsToShow, eggTypesToShow, growthStatesToShow, stats, 0, 0);
    }

    if (stats.visible + stats.dimmed > 0) {
      const filterInfo = [];
      if (speciesKeysToShow.size > 0) filterInfo.push(`${speciesKeysToShow.size} species`);
      if (mutationsToShow.size > 0) {
        filterInfo.push(`${mutationsToShow.size} mutations`);
        filterInfo.push(`${stats.withData} mapped, ${stats.withoutData} unmapped`);
      }
      if (growthStatesToShow.size > 0) {
        filterInfo.push(`${growthStatesToShow.size} growth states`);
      }
      const filterDesc = filterInfo.length > 0 ? ` (${filterInfo.join(', ')})` : '';
      log(`🔍 [GARDEN-FILTERS] Applied${filterDesc}: ${stats.visible} visible, ${stats.dimmed} dimmed`);
    } else {
      log('🔍 [GARDEN-FILTERS] No tiles found');
    }
  } catch (error) {
    log('⚠️ [GARDEN-FILTERS] Error applying filters', error);
  }
}

/**
 * Reset all tiles to fully visible (alpha 1.0)
 */
function resetFilters(): void {
  try {
    const app = getPixiApp();
    if (!app || !app.stage) {
      return;
    }

    removeAllVisibleGuards();
    tileCache.nodes = null;
    resetFiltersOnStage(app.stage);
    log('🔍 [GARDEN-FILTERS] All tiles visible');
  } catch (error) {
    log('⚠️ [GARDEN-FILTERS] Error resetting filters', error);
  }
}

/**
 * Load config from storage
 */
function loadConfig(): void {
  try {
    const stored = storage.get<Partial<GardenFiltersConfig> | null>(STORAGE_KEY, null);
    if (stored && typeof stored === 'object') {
      config = {
        enabled: stored.enabled ?? config.enabled,
        mutations: stored.mutations ?? config.mutations,
        excludeMutations: stored.excludeMutations ?? config.excludeMutations,
        cropSpecies: stored.cropSpecies ?? config.cropSpecies,
        eggTypes: stored.eggTypes ?? config.eggTypes,
        growthStates: stored.growthStates ?? config.growthStates,
      };
      cachedFilterSets = null; // Invalidate cached sets after loading new config
    }
  } catch (error) {
    log('⚠️ Failed to load garden filters config', error);
  }
}

/**
 * Save config to storage and notify listeners
 */
function saveConfig(): void {
  try {
    storage.set(STORAGE_KEY, config);
    notifyListeners();
  } catch (error) {
    log('⚠️ Failed to save garden filters config', error);
  }
}

/**
 * Notify all config listeners
 */
function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener({ ...config });
    } catch (error) {
      log('⚠️ Garden filters listener error', error);
    }
  }
}

/**
 * Start polling interval to apply filters
 * Uses visibleInterval which pauses when tab is hidden (purely visual update)
 */
function startFilteringPolling(): void {
  if (cleanupInterval !== null) return;

  cleanupInterval = visibleInterval(
    'garden-filters-poll',
    () => {
      // Any override wins — keep it fresh as garden state changes
      if (statsHubOverride !== null || statsHubTileKeySet !== null || statsHubExcludeMutationsSet !== null) {
        applyFilters();
        return;
      }
      if (!config.enabled) return;
      applyFilters();
    },
    500 // Every 500ms — fast enough to catch tiles created during viewport scrolling
  );

  log('✅ [GARDEN-FILTERS] Polling started (500ms interval, visibility-aware)');
}

/**
 * Stop polling interval
 */
function stopFilteringPolling(): void {
  if (cleanupInterval !== null) {
    cleanupInterval();
    cleanupInterval = null;
    removeAllVisibleGuards();
    statsHubOverride = null;
    statsHubExcludeMutationsSet = null;
    statsHubExcludeMutationsAllMode = false;
    statsHubTileKeySet = null;
    tileCache.nodes = null;
    log('⏹️ [GARDEN-FILTERS] Polling stopped');
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initialize the garden filters system
 * Called once during app startup
 */
export function initializeGardenFilters(): void {
  loadConfig();
  startFilteringPolling();

  // When catalogs arrive, invalidate cached filter sets so getAllPlantSpecies()
  // picks up new species for the UI.
  onCatalogsReady(() => {
    cachedFilterSets = null;
  });

  // Expose diagnostic commands — always available, not gated by debug globals
  shareGlobal('QPM_GARDEN_DIAG', diagnoseGardenFilters);
  shareGlobal('QPM_GARDEN_TEST', testSpeciesFilter);
  shareGlobal('QPM_GARDEN_NODES', watchNodeIdentity);
  log('✅ [GARDEN-FILTERS] System initialized — console commands: QPM_GARDEN_DIAG() QPM_GARDEN_TEST("species") QPM_GARDEN_NODES()', config);
}

/**
 * Get current config (immutable copy)
 */
export function getGardenFiltersConfig(): GardenFiltersConfig {
  return { ...config };
}

/**
 * Update config and save to storage
 * Immediately applies or resets filters based on enabled state
 */
export function updateGardenFiltersConfig(updates: Partial<GardenFiltersConfig>): void {
  config = { ...config, ...updates };
  cachedFilterSets = null; // Invalidate cached sets whenever config changes
  saveConfig();

  if (config.enabled) {
    applyFilters(); // Apply immediately
  } else {
    resetFilters(); // Reset immediately
  }
}

/**
 * Subscribe to config changes
 * @returns Unsubscribe function
 */
export function subscribeToGardenFiltersConfig(
  listener: (config: GardenFiltersConfig) => void
): () => void {
  listeners.add(listener);
  listener({ ...config }); // Call immediately with current config
  return () => listeners.delete(listener);
}

/**
 * Manually trigger filter application (for "Apply Filters" button)
 */
export function applyGardenFiltersNow(): void {
  applyFilters();
}

/**
 * Manually reset all filters (for "Reset All" button).
 * Disables filtering, clears all selections, saves to storage, and resets tile alphas.
 */
export function resetGardenFiltersNow(): void {
  updateGardenFiltersConfig({
    enabled: false,
    mutations: [],
    excludeMutations: false,
    cropSpecies: [],
    eggTypes: [],
    growthStates: [],
  });
}

/**
 * Stats hub exclude mutations override — shows tiles that do NOT have any of the given mutations.
 * Takes priority over the species override. Pass null to release.
 * Does NOT write to storage and does NOT modify config.
 */
export function setStatsHubExcludeMutationsOverride(mutations: string[] | null): void {
  if (mutations === null) {
    statsHubExcludeMutationsSet = null;
    statsHubExcludeMutationsAllMode = false;
    // Restore: tile key or species override if active, else main config
    if (statsHubTileKeySet !== null || statsHubOverride !== null) {
      applyFilters();
    } else if (config.enabled) {
      applyFilters();
    } else {
      resetFilters();
    }
  } else {
    const normalized = new Set<string>();
    for (const m of mutations) {
      const key = normalizeMutationFilterKey(m);
      if (key) normalized.add(key);
    }
    statsHubExcludeMutationsSet = normalized;
    applyFilters();
  }
}

/**
 * Stats hub tile key override — show only tiles whose tileKey ("g:<dirtTileIdx>" or
 * "b:<boardwalkTileIdx>") is in the given list. Pass null to release.
 * Does NOT write to storage and does NOT modify config.
 */
export function setStatsHubTileOverride(tileKeys: string[] | null): void {
  if (tileKeys === null) {
    statsHubTileKeySet = null;
    if (statsHubExcludeMutationsSet !== null || statsHubOverride !== null) {
      applyFilters();
    } else if (config.enabled) {
      applyFilters();
    } else {
      resetFilters();
    }
  } else {
    statsHubTileKeySet = new Set(tileKeys);
    applyFilters();
  }
}

/**
 * Set the matching mode for the stats hub exclude mutations overlay.
 * false (default/ANY): show tile if it's missing AT LEAST ONE selected mutation.
 * true  (ALL):         show tile only if it has NONE of the selected mutations.
 * Only takes effect when statsHubExcludeMutationsSet is active.
 */
export function setStatsHubExcludeMutationsAllMode(allMode: boolean): void {
  statsHubExcludeMutationsAllMode = allMode;
  if (statsHubExcludeMutationsSet !== null) {
    applyFilters();
  }
}

/**
 * Stats hub species override — completely isolated from the Garden Filters feature.
 *
 * Pass a non-empty array to show ONLY those species (no mutations, no growth states, no
 * egg type filters — purely a species allow-list). Pass null to release the override and
 * restore the main Garden Filters config without touching it.
 *
 * Does NOT write to storage and does NOT modify config.
 */
export function setStatsHubSpeciesOverride(species: string[] | null): void {
  statsHubOverride = species;
  if (species !== null) {
    applyFilters(); // Apply override immediately
  } else {
    // Release override — restore main config behaviour
    if (config.enabled) {
      applyFilters();
    } else {
      resetFilters();
    }
  }
}
