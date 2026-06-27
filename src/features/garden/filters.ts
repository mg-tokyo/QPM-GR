// src/features/gardenFilters.ts
// Filter visible crops and eggs in the garden by dimming non-matching tiles
// Uses PIXI stage traversal + tile data (species key) for filtering

import { storage } from '../../utils/storage';
import { log } from '../../utils/logger';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { getGardenSnapshot, getMapSnapshot } from './bridge';
import { normalizeMutationName } from '../../utils/game/cropMultipliers';
import { getAllPlantSpecies as getCatalogPlantSpecies, getEggCatalog, getPlantSpecies, onCatalogsReady } from '../../catalogs/gameCatalogs';
import { pageWindow, isIsolatedContext, shareGlobal } from '../../core/pageContext';

const STORAGE_KEY = 'qpm.gardenFilters.v1';
const DIM_ALPHA = 0.1; // Barely visible

// ── Per-frame alpha guards (PIXI ticker) ────────────────────────────────────
// The game toggles `visible` on Tile containers when the player walks.  When
// visible goes false→true, PIXI may render with stale worldAlpha (1.0) because
// color-update dirty flags are cleared while the node was invisible.
//
// Fix: hook into the PIXI app's own ticker so our guard runs BEFORE render
// (not after, like rAF would).  Force-dirty alpha by toggling the value past
// PIXI's same-value check — the intermediate value is never rendered because
// render happens after all ticker callbacks complete.

const guardedNodes = new Set<any>();
let guardTickerCleanup: (() => void) | null = null;

function guardTick(): void {
  for (const node of guardedNodes) {
    // Force PIXI to re-process alpha even if localAlpha already matches.
    // Setting to 1 then DIM_ALPHA ensures the setter's change-detection fires
    // and marks the node's color dirty before the renderer reads it.
    node.alpha = 1;
    node.alpha = DIM_ALPHA;
  }
}

/** Start the guard on the PIXI ticker. Called lazily when the first node is guarded. */
function startGuardTicker(): void {
  if (guardTickerCleanup) return;
  const app = getPixiApp();
  if (!app?.ticker) return;
  app.ticker.add(guardTick);
  guardTickerCleanup = () => {
    app.ticker.remove(guardTick);
    guardTickerCleanup = null;
  };
}

function stopGuardTicker(): void {
  if (guardTickerCleanup) {
    guardTickerCleanup();
  }
}

function installVisibleGuard(node: any): void {
  if (guardedNodes.has(node)) return;
  guardedNodes.add(node);
  startGuardTicker();
}

function removeVisibleGuard(node: any): void {
  guardedNodes.delete(node);
  if (guardedNodes.size === 0) stopGuardTicker();
}

function removeAllVisibleGuards(): void {
  guardedNodes.clear();
  stopGuardTicker();
}

// Tile node cache — rebuilt every poll from the live stage tree
interface TileNode {
  node: any;
  x: number;
  y: number;
}
let tileNodeCache: TileNode[] | null = null;

// Species name to PIXI View label mapping (used ONLY by getAllPlantSpecies() as
// a UI fallback when catalogs aren't loaded yet, and by diagnostics).
// NOT used for filter matching — filters use tileData.species directly.
const SPECIES_TO_VIEW: Record<string, string> = {
  'Carrot': 'Carrot Plant View',
  'Cabbage': 'Cabbage Plant View',
  'Strawberry': 'Strawberry Plant View',
  'Aloe': 'Aloe Plant View',
  'Beet': 'Beet Plant View',
  'Rose': 'Rose Plant View',
  'FavaBean': 'Fava Bean Plant View',
  'Delphinium': 'Delphinium Plant View',
  'Blueberry': 'Blueberry Plant View',
  'Apple': 'Apple Tree View',
  'OrangeTulip': 'Tulip Plant View',
  'Tomato': 'Tomato Plant View',
  'Daffodil': 'Daffodil Plant View',
  'Corn': 'Corn Plant View',
  'Watermelon': 'Watermelon Plant View',
  'Pumpkin': 'Pumpkin Plant View',
  'Echeveria': 'Echeveria Plant View',
  'Pear': 'Pear Tree View',
  'Gentian': 'Gentian Plant View',
  'Coconut': 'Coconut Tree View',
  'PineTree': 'Pine Tree View',
  'Banana': 'Banana Plant View',
  'Lily': 'Lily Plant View',
  'Camellia': 'Camellia Hedge View',
  'Squash': 'Squash Plant View',
  'Peach': 'Peach Tree View',
  'BurrosTail': "Burro's Tail Plant View",
  'Mushroom': 'Mushroom Plant View',
  'Cactus': 'Cactus Plant View',
  'Bamboo': 'Bamboo Plant View',
  'Poinsettia': 'Poinsettia Bush View',
  'VioletCort': 'Violet Cort Plant View',
  'Chrysanthemum': 'Chrysanthemum Bush View',
  'Date': 'Date Palm View',
  'Grape': 'Grape Plant View',
  'Pepper': 'Pepper Plant View',
  'Lemon': 'Lemon Tree View',
  'PassionFruit': 'Passion Fruit Plant View',
  'DragonFruit': 'Dragon Fruit Plant View',
  'Cacao': 'Cacao Plant View',
  'Lychee': 'Lychee Plant View',
  'Sunflower': 'Sunflower Plant View',
  'Starweaver': 'Starweaver Plant View',
  'DawnCelestial': 'Dawnbinder View',
  'MoonCelestial': 'Moonbinder View',
  'Saffron': 'Saffron Plant View',
  'Eggplant': 'Eggplant Plant View',
  'Leek': 'Leek Plant View',
  // Dawn content (plant.name from floraSpeciesDex)
  'Lavender': 'Lavender Plant View',
  'Ube': 'Ube Plant View',
  'Dawnbreaker': 'Dawnbreaker Plant View',
  // Special variants — plant.name has no 'Plant' suffix or uses an alternate word,
  // so PIXI label is plant.name + ' View', NOT plant.name + ' Plant View'.
  'Clover': 'Clover Patch View',
  'FourLeafClover': 'Four-Leaf Clover View',
  'Daisy': 'Daisy Patch View',
  'PurpleDaisy': 'Purple Daisy View',
  'Snowdrop': 'Snowdrop Patch View',
  'SnowdropDouble': 'Double Snowdrop View',
};

function normalizeMutationFilterKey(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const canonical = normalizeMutationName(text) ?? text;
  let key = canonical.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return null;

  // Game payloads may use either Amberlit or Ambershine for the same amber lunar mutation.
  if (key === 'ambershine' || key === 'amberlit') {
    key = 'amberlit';
  }

  return key;
}

function collectMutationKeys(value: unknown, out: Set<string>, seen: WeakSet<object> = new WeakSet<object>(), depth = 0): void {
  if (value == null || depth > 4) return;

  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = normalizeMutationFilterKey(value);
    if (normalized) out.add(normalized);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMutationKeys(item, out, seen, depth + 1);
    }
    return;
  }

  if (value instanceof Set || value instanceof Map) {
    const values = value instanceof Set ? Array.from(value.values()) : Array.from(value.values());
    collectMutationKeys(values, out, seen, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  const record = value as Record<string, unknown>;
  collectMutationKeys(record.mutations, out, seen, depth + 1);
  collectMutationKeys(record.mutation, out, seen, depth + 1);

  // Fallback for descriptor-like payloads.
  const descriptorFields = [record.name, record.id, record.label, record.value, record.key];
  for (const field of descriptorFields) {
    if (typeof field === 'string') {
      const normalized = normalizeMutationFilterKey(field);
      if (normalized) out.add(normalized);
    }
  }
}

export interface GardenFiltersConfig {
  enabled: boolean;
  mutations: string[]; // List of mutations to show (Rainbow, Gold, Frozen, etc)
  excludeMutations: boolean; // Invert: show plants WITHOUT the selected mutations
  cropSpecies: string[]; // List of crop species to show (Carrot, Strawberry, etc)
  eggTypes: string[]; // List of egg types to show (CommonEgg, RareEgg, etc)
  growthStates: ('mature' | 'growing')[]; // Growth state filter ([] = show all)
}

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

// Cached filter sets — rebuilt only when config changes, not on every poll
interface CachedFilterSets {
  speciesKeysToShow: Set<string>;
  mutationsToShow: Set<string>;
  eggTypesToShow: Set<string>;
  growthStatesToShow: Set<string>;
}
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

/**
 * Access PIXI app via QPM's own capture system
 */
function getPixiApp(): any {
  try {
    const captured = (pageWindow as Record<string, unknown>).__QPM_PIXI_CAPTURED__ as
      { app?: unknown } | undefined;
    if (captured && captured.app) {
      return captured.app;
    }
    return null;
  } catch (error) {
    log('⚠️ [GARDEN-FILTERS] Error accessing PIXI app', error);
    return null;
  }
}

/**
 * Extract all unique mutations from all slots in a tile
 * Mutations are stored per-slot in the slots array, not at the tile level
 */
function getTileMutations(tileData: any): string[] {
  if (!tileData?.slots || !Array.isArray(tileData.slots)) {
    return [];
  }

  const allMutations = new Set<string>();

  for (const slot of tileData.slots) {
    collectMutationKeys(slot?.mutations, allMutations);
    collectMutationKeys(slot?.mutation, allMutations);
  }

  return Array.from(allMutations);
}

/**
 * Get growth state of a plant tile
 * Returns 'growing' if plant hasn't matured yet, 'mature' if it has
 */
function getGrowthState(tileData: any): 'growing' | 'mature' | null {
  if (!tileData) return null;

  // Check if it's a plant (eggs don't have growth states in the same way)
  if (tileData.objectType !== 'plant') return null;

  const now = Date.now();
  const maturedAt = tileData.maturedAt;

  if (!maturedAt) return null;

  return now < maturedAt ? 'growing' : 'mature';
}

/**
 * Get garden tile data for PIXI coordinates using the map's coordinate system
 *
 * How it works:
 * 1. Convert PIXI coords (x, y) to globalIdx using formula: x + y * cols
 * 2. Use map.globalTileIdxToDirtTile[globalIdx] to get the local dirt tile index
 * 3. Access snapshot.tileObjects[localIdx] to get the actual tile data
 * 4. Same for boardwalk tiles
 */
function getGardenTileData(x: number, y: number): any {
  const snapshot = getGardenSnapshot();
  const map = getMapSnapshot();

  if (!snapshot || !map) return null;

  // Convert PIXI coordinates to global tile index
  // CRITICAL: Formula is x + y * cols, NOT y * cols + x
  const globalIdx = x + y * map.cols;

  // Check dirt tiles (garden tiles)
  const dirtMapping = map.globalTileIdxToDirtTile?.[globalIdx];
  if (dirtMapping) {
    const localIdx = dirtMapping.dirtTileIdx;
    const tileData = snapshot.tileObjects?.[localIdx];
    if (tileData) return tileData;
  }

  // Check boardwalk tiles
  const boardwalkMapping = map.globalTileIdxToBoardwalk?.[globalIdx];
  if (boardwalkMapping) {
    const localIdx = boardwalkMapping.boardwalkTileIdx;
    const tileData = snapshot.boardwalkTileObjects?.[localIdx];
    if (tileData) return tileData;
  }

  return null;
}

/**
 * Recursively collect all Tile nodes from the PIXI stage into a flat array.
 * Rebuilt every poll cycle — the previous stage.children.length check was too coarse
 * (tiles are nested deep in the tree, so top-level count rarely changes when tiles are
 * created/destroyed during viewport scrolling or player movement).
 */
function buildTileNodeCache(node: any, out: TileNode[] = [], depth = 0, maxDepth = 10): TileNode[] {
  if (!node || depth > maxDepth) return out;

  if (node.label && /^Tile \((\d+), (\d+)\)$/.test(node.label)) {
    const match = node.label.match(/^Tile \((\d+), (\d+)\)$/)!;
    out.push({ node, x: parseInt(match[1]!), y: parseInt(match[2]!) });
    // Tiles don't contain other tiles — skip recursing into them
    return out;
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      buildTileNodeCache(child, out, depth + 1, maxDepth);
    }
  }

  return out;
}

/**
 * Rebuild tile node list from the live stage tree.
 * Always rebuilds — the old stage.children.length cache key was broken because tiles
 * sit deep in the tree (Stage → World → TileLayer → Tile) and top-level count doesn't
 * change when tiles are recycled during viewport panning or player movement.
 */
function getOrBuildTileNodeCache(stage: any): TileNode[] {
  tileNodeCache = buildTileNodeCache(stage);
  return tileNodeCache;
}

/**
 * Traverse PIXI stage and apply filters based on child labels and mutations
 *
 * How it works:
 * 1. Find all nodes with label "Tile (x, y)"
 * 2. Check the first child's label (e.g., "Carrot Plant View" or "Egg")
 * 3. Use coordinate math to look up garden data
 * 4. Check species/egg type and mutations
 * 5. Dim tiles that don't match filters
 */
function applyFiltersToStage(
  node: any,
  speciesKeysToShow: Set<string>,
  mutationsToShow: Set<string>,
  eggTypesToShow: Set<string>,
  growthStatesToShow: Set<string>,
  stats: { visible: number; dimmed: number; withData: number; withoutData: number },
  depth: number = 0,
  maxDepth: number = 10
): void {
  if (!node || depth > maxDepth) return;

  // Check if this is a Tile container
  if (node.label && /^Tile \((\d+), (\d+)\)$/.test(node.label)) {
    const match = node.label.match(/^Tile \((\d+), (\d+)\)$/);
    const childLabel = node.children?.[0]?.label;

    // Skip empty tiles and sprite-only tiles
    if (match && childLabel && childLabel !== 'Sprite') {
      const x = parseInt(match[1]!);
      const y = parseInt(match[2]!);
      const isEgg = childLabel === 'Egg';

      // All filter types use tile data — single fetch serves species, egg, mutation, and growth
      const needsTileData =
        speciesKeysToShow.size > 0 ||
        eggTypesToShow.size > 0 ||
        mutationsToShow.size > 0 ||
        growthStatesToShow.size > 0;

      let speciesMatches = true;
      let eggMatches = true;
      let mutationMatches = true;
      let growthStateMatches = true;

      if (needsTileData) {
        const tileData = getGardenTileData(x, y);
        if (tileData) {
          stats.withData++;

          // Species match via tile data species field (handles all variants correctly)
          if (!isEgg && speciesKeysToShow.size > 0) {
            speciesMatches = speciesKeysToShow.has(tileData.species);
          }

          // Egg match
          if (isEgg && eggTypesToShow.size > 0) {
            const eggType = tileData.eggType || tileData.species;
            eggMatches = eggTypesToShow.has(eggType);
          }

          // Check mutations
          if (mutationsToShow.size > 0) {
            const tileMutations = getTileMutations(tileData);
            const shouldExclude = statsHubExcludeMutationsSet !== null || config.excludeMutations;
            if (shouldExclude) {
              if (statsHubExcludeMutationsAllMode) {
                // ALL mode: show tile only if it has NONE of the selected mutations
                const hasMutation = tileMutations.some((m: string) => mutationsToShow.has(m));
                mutationMatches = !hasMutation;
              } else {
                // ANY mode (default): show tile if it's missing AT LEAST ONE selected mutation
                const tileMutSet = new Set<string>(tileMutations);
                const hasAllMutations = Array.from(mutationsToShow).every(m => tileMutSet.has(m));
                mutationMatches = !hasAllMutations;
              }
            } else {
              // Include mode: show tile if it has ANY of the selected mutations
              mutationMatches = tileMutations.some((m: string) => mutationsToShow.has(m));
            }
          }

          // Check growth state
          if (growthStatesToShow.size > 0) {
            const growthState = getGrowthState(tileData);
            growthStateMatches = growthState !== null && growthStatesToShow.has(growthState);
          }
        } else {
          stats.withoutData++;
          // No garden data — can't verify, default to visible for mutations/growth,
          // but species/egg can't match without data
          if (!isEgg && speciesKeysToShow.size > 0) speciesMatches = false;
          if (isEgg && eggTypesToShow.size > 0) eggMatches = true; // don't filter unknown eggs
        }
      }

      const shouldShow = speciesMatches && eggMatches && mutationMatches && growthStateMatches;

      if (shouldShow) {
        removeVisibleGuard(node);
        node.alpha = 1.0;
        stats.visible++;
      } else {
        node.alpha = DIM_ALPHA;
        installVisibleGuard(node);
        stats.dimmed++;
      }
    }
  }

  // Recursively traverse children
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      applyFiltersToStage(child, speciesKeysToShow, mutationsToShow, eggTypesToShow, growthStatesToShow, stats, depth + 1, maxDepth);
    }
  }
}

/**
 * Reset all tile alphas to 1.0
 */
function resetFiltersOnStage(
  node: any,
  depth: number = 0,
  maxDepth: number = 10
): void {
  if (!node || depth > maxDepth) return;

  if (node.label && /^Tile \(\d+, \d+\)$/.test(node.label)) {
    removeVisibleGuard(node);
    node.alpha = 1.0;
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      resetFiltersOnStage(child, depth + 1, maxDepth);
    }
  }
}

/**
 * Apply current filters to all tiles in the garden.
 * When statsHubOverride is active, only species filtering is applied (no mutations/
 * growthStates/eggTypes) using the override list — main config is untouched.
 */
function applyFilters(): void {
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
    tileNodeCache = null;
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
    tileNodeCache = null;
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

/**
 * Get list of all plant species (for UI).
 * Merges the live plant catalog (auto-updated with the game) with the static
 * SPECIES_TO_VIEW map so newly added crops appear automatically.
 */
export function getAllPlantSpecies(): string[] {
  const staticKeys = Object.keys(SPECIES_TO_VIEW);
  try {
    const catalogKeys = getCatalogPlantSpecies();
    if (catalogKeys.length === 0) return staticKeys;
    const merged = new Set([...staticKeys, ...catalogKeys]);
    return Array.from(merged).sort();
  } catch {
    return staticKeys;
  }
}

/**
 * Get list of all egg types from catalog (auto-updates with the game).
 */
export function getAllEggTypes(): string[] {
  try {
    const catalog = getEggCatalog();
    return catalog ? Object.keys(catalog) : [];
  } catch (error) {
    log('⚠️ Failed to load egg types from catalog', error);
    return [];
  }
}

// ============================================================================
// DIAGNOSTICS — call QPM_GARDEN_DIAG() in the browser console
// ============================================================================

/**
 * Check whether a PIXI node is still attached to the live scene graph.
 * Walks up the parent chain — if it reaches stage, the node is live.
 */
function isNodeAttached(node: any, stage: any): boolean {
  let current = node;
  let depth = 0;
  while (current && depth < 50) {
    if (current === stage) return true;
    current = current.parent;
    depth++;
  }
  return false;
}

/**
 * Full diagnostic dump of garden filters pipeline.
 * Reports the state of every dependency so we can see exactly what's broken.
 */
export function diagnoseGardenFilters(): Record<string, unknown> {
  const diag: Record<string, unknown> = {};

  // 1. Environment
  diag.isIsolatedContext = isIsolatedContext;
  diag.pageWindowType = typeof pageWindow;
  diag.pageWindowLocation = (() => {
    try { return (pageWindow as any)?.location?.href ?? 'unknown'; } catch { return 'access-denied'; }
  })();
  diag.sandboxWindowLocation = (() => {
    try { return window.location.href; } catch { return 'access-denied'; }
  })();
  diag.pageWindowSameAsSandbox = pageWindow === window;

  // 2. PIXI capture state
  const captured = (() => {
    try { return (pageWindow as any).__QPM_PIXI_CAPTURED__; } catch { return 'access-error'; }
  })();
  diag.pixiCaptured = captured ? {
    hasApp: !!captured.app,
    hasRenderer: !!captured.renderer,
    version: captured.version,
    appType: captured.app ? typeof captured.app : 'null',
    stageType: captured.app?.stage ? typeof captured.app.stage : 'null',
    stageChildrenCount: captured.app?.stage?.children?.length ?? 'no-stage',
  } : captured === null ? 'null' : captured === undefined ? 'undefined' : String(captured);

  // 3. Sprite bridge
  const bridge = (() => {
    try { return (pageWindow as any).__QPM_SPRITE_BRIDGE__; } catch { return 'access-error'; }
  })();
  diag.spriteBridge = bridge ? {
    exists: true,
    atlasCount: bridge.atlas ? Object.keys(bridge.atlas).length : 0,
    stats: bridge.stats ?? 'missing',
  } : bridge === null ? 'null' : bridge === undefined ? 'undefined' : String(bridge);

  // 4. Hooks injected?
  diag.hooksInjected = (() => {
    try { return !!(pageWindow as any).__QPM_HOOKS_INJECTED__; } catch { return 'access-error'; }
  })();
  diag.pixiHooksActive = (() => {
    try { return !!(pageWindow as any).__QPM_PIXI_HOOKS_ACTIVE__; } catch { return 'access-error'; }
  })();

  // 5. PIXI app from getPixiApp()
  const app = getPixiApp();
  diag.getPixiApp = app ? {
    hasStage: !!app.stage,
    stageChildren: app.stage?.children?.length ?? 'no-stage',
    hasRenderer: !!app.renderer,
  } : 'null';

  // 6. Stage tile traversal + attachment audit
  if (app?.stage) {
    const tileNodes = getOrBuildTileNodeCache(app.stage);
    let attachedCount = 0;
    let detachedCount = 0;
    for (const t of tileNodes) {
      if (isNodeAttached(t.node, app.stage)) { attachedCount++; } else { detachedCount++; }
    }
    diag.tileNodes = {
      count: tileNodes.length,
      attached: attachedCount,
      detached: detachedCount,
      detachedWarning: detachedCount > 0 ? '⚠️ STALE CACHE — detached nodes found' : '✅ all live',
      sample: tileNodes.slice(0, 3).map(t => ({
        label: t.node?.label,
        x: t.x,
        y: t.y,
        childCount: t.node?.children?.length ?? 0,
        firstChildLabel: t.node?.children?.[0]?.label ?? 'none',
        alpha: t.node?.alpha,
        attached: isNodeAttached(t.node, app.stage),
      })),
    };
  } else {
    diag.tileNodes = 'no-app-or-stage';
  }

  // 7. Garden data
  const snapshot = getGardenSnapshot();
  const map = getMapSnapshot();
  diag.gardenSnapshot = snapshot ? {
    tileObjectCount: snapshot.tileObjects ? Object.keys(snapshot.tileObjects).length : 0,
    boardwalkCount: snapshot.boardwalkTileObjects ? Object.keys(snapshot.boardwalkTileObjects).length : 0,
  } : 'null';
  diag.mapSnapshot = map ? {
    cols: map.cols,
    rows: map.rows,
    dirtMappingCount: map.globalTileIdxToDirtTile ? Object.keys(map.globalTileIdxToDirtTile).length : 0,
    boardwalkMappingCount: map.globalTileIdxToBoardwalk ? Object.keys(map.globalTileIdxToBoardwalk).length : 0,
  } : 'null';

  // 8. Config and state
  diag.config = { ...config };
  diag.pollingActive = cleanupInterval !== null;
  diag.statsHubOverride = statsHubOverride;
  diag.cachedFilterSetsReady = cachedFilterSets !== null;

  // 9. Check for PIXI globals on page window (alternative capture sources)
  diag.pixiGlobals = (() => {
    try {
      const pw = pageWindow as any;
      return {
        __PIXI_APP__: pw.__PIXI_APP__ ? 'exists' : 'missing',
        PIXI_APP: pw.PIXI_APP ? 'exists' : 'missing',
        app: pw.app?.stage ? 'exists-with-stage' : pw.app ? 'exists-no-stage' : 'missing',
        PIXI: pw.PIXI ? 'exists' : 'missing',
        __PIXI__: pw.__PIXI__ ? 'exists' : 'missing',
        __PIXI_RENDERER__: pw.__PIXI_RENDERER__ ? 'exists' : 'missing',
      };
    } catch { return 'access-error'; }
  })();

  // 10. Species audit — cross-reference static map, catalog, and live PIXI labels
  const catalogKeys = getCatalogPlantSpecies();
  const allKeys = new Set([...Object.keys(SPECIES_TO_VIEW), ...catalogKeys]);
  const livePixiLabels = new Set<string>();
  // Also collect per-label tile details for target species
  const targetSpecies = new Set(['FourLeafClover', 'PurpleDaisy', 'Clover', 'Daisy', 'Snowdrop', 'SnowdropDouble']);
  const targetTileDetails: Array<Record<string, unknown>> = [];
  if (app?.stage) {
    const walkLabels = (node: any, depth: number) => {
      if (!node || depth > 10) return;
      if (node.label && /^Tile \(\d+, \d+\)$/.test(node.label)) {
        const cl = node.children?.[0]?.label;
        if (cl && cl !== 'Sprite') {
          livePixiLabels.add(cl);
          // Collect detailed info for target species tiles
          const match = node.label.match(/^Tile \((\d+), (\d+)\)$/);
          if (match) {
            const x = parseInt(match[1]!);
            const y = parseInt(match[2]!);
            const tileData = getGardenTileData(x, y);
            const isTarget = tileData?.species && targetSpecies.has(tileData.species);
            // Also check if the label matches any target species' expected label
            const isTargetByLabel = [...targetSpecies].some(s => {
              const expected = SPECIES_TO_VIEW[s];
              return expected && cl === expected;
            });
            if (isTarget || isTargetByLabel) {
              targetTileDetails.push({
                pixiLabel: node.label,
                childLabel: cl,
                tileAlpha: node.alpha,
                childAlpha: node.children?.[0]?.alpha,
                tileDataSpecies: tileData?.species ?? 'no-tile-data',
                tileDataObjectType: tileData?.objectType ?? 'unknown',
                attached: isNodeAttached(node, app.stage),
                hasParent: !!node.parent,
                parentLabel: node.parent?.label ?? 'none',
              });
            }
          }
        }
        return;
      }
      if (node.children) {
        for (const c of node.children) walkLabels(c, depth + 1);
      }
    };
    walkLabels(app.stage, 0);
  }
  const speciesAudit: Array<{
    key: string; staticLabel: string | null; catalogPlantName: string | null;
    catalogLabel: string | null; inLivePixi: boolean | string;
  }> = [];
  for (const key of [...allKeys].sort()) {
    const staticLabel = SPECIES_TO_VIEW[key] ?? null;
    const entry = getPlantSpecies(key);
    const plantName = (entry?.plant as any)?.name as string | undefined ?? null;
    const catalogLabel = plantName ? plantName + ' View' : null;
    const expectedLabel = staticLabel ?? catalogLabel;
    speciesAudit.push({
      key,
      staticLabel,
      catalogPlantName: plantName,
      catalogLabel,
      inLivePixi: expectedLabel ? (livePixiLabels.has(expectedLabel) ? '✅' : 'not planted') : 'no label',
    });
  }
  diag.speciesAudit = speciesAudit;
  diag.livePixiLabels = [...livePixiLabels].sort();
  // 10b. Unmatched labels — live PIXI labels not covered by static map or catalog
  const allExpectedLabels = new Set<string>();
  for (const key of allKeys) {
    const sl = SPECIES_TO_VIEW[key]; if (sl) allExpectedLabels.add(sl);
    const entry = getPlantSpecies(key);
    const pn = (entry?.plant as any)?.name as string | undefined;
    if (pn) { allExpectedLabels.add(pn + ' View'); allExpectedLabels.add(pn + ' Plant View'); }
    allExpectedLabels.add(key + ' Plant View');
  }
  allExpectedLabels.add('Egg');
  const unmatchedLabels = [...livePixiLabels].filter(l => !allExpectedLabels.has(l));
  diag.unmatchedPixiLabels = unmatchedLabels.length > 0
    ? { warning: '⚠️ These live labels are not covered by any species mapping', labels: unmatchedLabels }
    : '✅ all live labels matched';

  // 11. Target species deep dive — FourLeafClover, PurpleDaisy, etc.
  diag.targetSpeciesTiles = targetTileDetails.length > 0
    ? targetTileDetails
    : 'none found in garden (not planted or not in viewport)';

  // Pretty-print
  console.group('[QPM] Garden Filters Diagnostics');
  for (const [key, value] of Object.entries(diag)) {
    if (typeof value === 'object' && value !== null) {
      console.log(`${key}:`, value);
    } else {
      console.log(`${key}: ${value}`);
    }
  }
  console.groupEnd();

  return diag;
}

/**
 * Filter test for a specific species — enables the filter, applies once, then reports
 * exactly which tiles matched and which didn't, with full detail on why.
 *
 * Call QPM_GARDEN_TEST('FourLeafClover') in the console.
 */
export function testSpeciesFilter(species: string): Record<string, unknown> {
  const app = getPixiApp();
  if (!app?.stage) return { error: 'No PIXI app/stage' };

  const result: Record<string, unknown> = {};
  result.species = species;
  result.staticLabel = SPECIES_TO_VIEW[species] ?? 'NOT IN STATIC MAP';

  const catalogEntry = getPlantSpecies(species);
  const plantName = (catalogEntry?.plant as any)?.name as string | undefined;
  result.catalogPlantName = plantName ?? 'NOT IN CATALOG';
  result.catalogLabel = plantName ? plantName + ' View' : 'N/A';

  // Build candidate PIXI labels for diagnostic matching
  const candidates = new Set<string>();
  const staticLabel = SPECIES_TO_VIEW[species];
  if (staticLabel) candidates.add(staticLabel);
  if (plantName) {
    candidates.add(plantName + ' View');
    candidates.add(plantName + ' Plant View');
  }
  candidates.add(species + ' Plant View');
  result.allCandidateLabels = [...candidates];

  // Walk tiles and check matches
  const tiles = buildTileNodeCache(app.stage);
  const matches: Array<Record<string, unknown>> = [];
  const nearMisses: Array<Record<string, unknown>> = [];

  for (const { node, x, y } of tiles) {
    const childLabel = node.children?.[0]?.label;
    if (!childLabel || childLabel === 'Sprite') continue;

    const tileData = getGardenTileData(x, y);

    // Check if this tile matches our species via PIXI label
    const pixiMatch = candidates.has(childLabel);
    // Check if this tile matches via tile data species
    const tileDataMatch = tileData?.species === species;

    if (pixiMatch || tileDataMatch) {
      matches.push({
        tile: `(${x}, ${y})`,
        childLabel,
        tileDataSpecies: tileData?.species ?? 'no-data',
        pixiMatch,
        tileDataMatch,
        currentAlpha: node.alpha,
        childAlpha: node.children?.[0]?.alpha,
        attached: isNodeAttached(node, app.stage),
      });
    }

    // Near-miss: tile data species contains our species name (case-insensitive partial)
    if (!pixiMatch && !tileDataMatch && tileData?.species) {
      const s = String(tileData.species).toLowerCase();
      const target = species.toLowerCase();
      if (s.includes(target) || target.includes(s)) {
        nearMisses.push({
          tile: `(${x}, ${y})`,
          childLabel,
          tileDataSpecies: tileData.species,
          note: 'partial match — possible naming mismatch',
        });
      }
    }
  }

  result.totalTiles = tiles.length;
  result.matchCount = matches.length;
  result.matches = matches;
  result.nearMisses = nearMisses.length > 0 ? nearMisses : 'none';

  // Pretty-print
  console.group(`[QPM] Species Filter Test: ${species}`);
  console.log('Candidate PIXI labels:', [...candidates]);
  console.log(`Found ${matches.length} matching tiles out of ${tiles.length} total`);
  if (matches.length > 0) console.table(matches);
  if (nearMisses.length > 0) { console.warn('Near misses (possible naming mismatch):'); console.table(nearMisses); }
  console.groupEnd();

  return result;
}

/**
 * Node-identity & property monitor — determines exactly what the game changes
 * on tile PIXI nodes when the player walks.
 *
 * IMPORTANT: Disables the rAF alpha guard during monitoring so we see what the
 * game actually does, unmasked.  Re-enables the guard on stop.
 *
 * Call QPM_GARDEN_NODES() in the console with filters active, then walk around.
 * Runs per-frame via rAF — catches single-frame changes.
 * Returns a stop function (also exposed as QPM_GARDEN_NODES_STOP).
 */
export function watchNodeIdentity(): () => void {
  const app = getPixiApp();
  if (!app?.stage) {
    console.warn('[QPM-NODES] No PIXI app/stage');
    return () => {};
  }

  // ── Pause the ticker guard so it doesn't mask changes ──
  const hadGuardTicker = guardTickerCleanup !== null;
  stopGuardTicker();
  console.log('[QPM-NODES] Ticker alpha guard PAUSED for clean observation');

  let stampCounter = 0;
  const STAMP_KEY = '__qpmNodeId';

  interface NodeSnapshot {
    stamp: number;
    node: any;
    alpha: number;
    visible: boolean;
    renderable: boolean;
    parentRef: any;
    worldAlpha: number;
    childCount: number;
    childLabel: string;
    childAlpha: number;
    childVisible: boolean;
  }

  const knownNodes = new Map<string, NodeSnapshot>();
  const eventLog: Array<Record<string, unknown>> = [];
  let frameCount = 0;
  let monitorRafId: number | null = null;
  let stopped = false;

  function snap(node: any, stamp: number): NodeSnapshot {
    const child = node.children?.[0];
    return {
      stamp,
      node,
      alpha: node.alpha ?? 1,
      visible: node.visible ?? true,
      renderable: node.renderable ?? true,
      parentRef: node.parent ?? null,
      worldAlpha: node.worldAlpha ?? node.groupAlpha ?? -1,
      childCount: node.children?.length ?? 0,
      childLabel: child?.label ?? 'none',
      childAlpha: child?.alpha ?? 1,
      childVisible: child?.visible ?? true,
    };
  }

  function stampAll(): void {
    const tiles = buildTileNodeCache(app.stage);
    knownNodes.clear();
    for (const { node, x, y } of tiles) {
      const key = `${x},${y}`;
      const stamp = stampCounter++;
      node[STAMP_KEY] = stamp;
      knownNodes.set(key, snap(node, stamp));
    }
  }

  function logEvent(event: string, key: string, data: Record<string, unknown>): void {
    if (eventLog.length < 100) {
      eventLog.push({ frame: frameCount, event, tile: key, ...data });
    }
    // Also log live for immediate feedback
    console.warn(`[QPM-NODES] ${event} @ frame ${frameCount}: tile ${key}`, data);
  }

  function checkFrame(): void {
    if (stopped) return;
    frameCount++;
    const tiles = buildTileNodeCache(app.stage);

    for (const { node, x, y } of tiles) {
      const key = `${x},${y}`;
      const prev = knownNodes.get(key);

      if (!prev) {
        const stamp = stampCounter++;
        node[STAMP_KEY] = stamp;
        knownNodes.set(key, snap(node, stamp));
        continue;
      }

      // ── Node identity check ──
      if (node !== prev.node || node[STAMP_KEY] !== prev.stamp) {
        logEvent('NODE_REPLACED', key, {
          oldAlpha: prev.alpha,
          newAlpha: node.alpha,
          oldVisible: prev.visible,
          newVisible: node.visible,
          oldChildLabel: prev.childLabel,
          newChildLabel: node.children?.[0]?.label ?? 'none',
          oldAttached: isNodeAttached(prev.node, app.stage),
        });
        const stamp = stampCounter++;
        node[STAMP_KEY] = stamp;
        knownNodes.set(key, snap(node, stamp));
        continue;
      }

      // ── Same node — check every property ──
      const cur = snap(node, prev.stamp);

      // Alpha on tile container
      if (Math.abs(cur.alpha - prev.alpha) > 0.001) {
        logEvent('TILE_ALPHA', key, {
          from: prev.alpha.toFixed(3),
          to: cur.alpha.toFixed(3),
        });
      }

      // Visible on tile container
      if (cur.visible !== prev.visible) {
        logEvent('TILE_VISIBLE', key, {
          from: prev.visible,
          to: cur.visible,
        });
      }

      // Renderable on tile container
      if (cur.renderable !== prev.renderable) {
        logEvent('TILE_RENDERABLE', key, {
          from: prev.renderable,
          to: cur.renderable,
        });
      }

      // Parent changed (reparented)
      if (cur.parentRef !== prev.parentRef) {
        logEvent('TILE_REPARENTED', key, {
          oldParentLabel: prev.parentRef?.label ?? 'null',
          newParentLabel: cur.parentRef?.label ?? 'null',
        });
      }

      // World alpha (computed for rendering)
      if (Math.abs(cur.worldAlpha - prev.worldAlpha) > 0.001 && prev.worldAlpha >= 0) {
        logEvent('WORLD_ALPHA', key, {
          from: prev.worldAlpha.toFixed(3),
          to: cur.worldAlpha.toFixed(3),
        });
      }

      // Child alpha
      if (Math.abs(cur.childAlpha - prev.childAlpha) > 0.001) {
        logEvent('CHILD_ALPHA', key, {
          childLabel: cur.childLabel,
          from: prev.childAlpha.toFixed(3),
          to: cur.childAlpha.toFixed(3),
        });
      }

      // Child visible
      if (cur.childVisible !== prev.childVisible) {
        logEvent('CHILD_VISIBLE', key, {
          childLabel: cur.childLabel,
          from: prev.childVisible,
          to: cur.childVisible,
        });
      }

      // Child count changed (children added/removed)
      if (cur.childCount !== prev.childCount) {
        logEvent('CHILD_COUNT', key, {
          from: prev.childCount,
          to: cur.childCount,
        });
      }

      // First child changed entirely
      if (cur.childLabel !== prev.childLabel) {
        logEvent('CHILD_SWAPPED', key, {
          from: prev.childLabel,
          to: cur.childLabel,
        });
      }

      knownNodes.set(key, cur);
    }

    monitorRafId = requestAnimationFrame(checkFrame);
  }

  // Dim tiles, then snapshot
  applyFilters();
  stampAll();

  // Start per-frame monitoring
  monitorRafId = requestAnimationFrame(checkFrame);

  const dimmedCount = [...knownNodes.values()].filter(s => Math.abs(s.alpha - DIM_ALPHA) < 0.01).length;
  console.log(`[QPM-NODES] Monitoring ${knownNodes.size} tiles (${dimmedCount} dimmed) — walk around, then call QPM_GARDEN_NODES_STOP()`);

  const stop = () => {
    stopped = true;
    if (monitorRafId !== null) {
      cancelAnimationFrame(monitorRafId);
      monitorRafId = null;
    }
    // Re-enable ticker guard
    if (hadGuardTicker && guardedNodes.size > 0) {
      startGuardTicker();
    }
    console.group(`[QPM-NODES] Results after ${frameCount} frames`);
    const counts: Record<string, number> = {};
    for (const e of eventLog) { counts[e.event as string] = (counts[e.event as string] ?? 0) + 1; }
    console.log('Event counts:', counts);
    if (eventLog.length > 0) {
      console.log('Full event log:');
      console.table(eventLog);
    } else {
      console.log('No property changes detected on any tile node.');
    }
    console.groupEnd();
    return { frameCount, counts, eventLog };
  };

  shareGlobal('QPM_GARDEN_NODES_STOP', stop);
  return stop;
}
