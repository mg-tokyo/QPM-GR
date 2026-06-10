// src/features/gardenFilters.ts
// Filter visible crops and eggs in the garden by dimming non-matching tiles
// Uses PIXI stage traversal and child labels for filtering

import { storage } from '../../utils/storage';
import { log } from '../../utils/logger';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { getGardenSnapshot, getMapSnapshot } from './bridge';
import { normalizeMutationName } from '../../utils/game/cropMultipliers';
import { getAllPlantSpecies as getCatalogPlantSpecies, getEggCatalog, getPlantSpecies, onCatalogsReady } from '../../catalogs/gameCatalogs';
import { pageWindow, isIsolatedContext, shareGlobal } from '../../core/pageContext';

const STORAGE_KEY = 'qpm.gardenFilters.v1';
const DIM_ALPHA = 0.1; // Barely visible

// Tile node cache — rebuilt only when stage children count changes
interface TileNode {
  node: any;
  x: number;
  y: number;
}
let tileNodeCache: TileNode[] | null = null;
let tileNodeCacheStageLength = -1;

// Species name to PIXI View label mapping
// Derived from floraSpeciesDex: PIXI label = plant.name + ' View'
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

// Cached filter label sets — rebuilt only when config changes, not on every 2s poll
interface CachedFilterSets {
  speciesToShow: Set<string>;
  unknownSpeciesToShow: Set<string>;
  mutationsToShow: Set<string>;
  eggTypesToShow: Set<string>;
  growthStatesToShow: Set<string>;
}
let cachedFilterSets: CachedFilterSets | null = null;

function getOrBuildFilterSets(): CachedFilterSets {
  if (cachedFilterSets !== null) return cachedFilterSets;
  const { speciesToShow, unknownSpeciesToShow } = buildSpeciesLabelSets(config.cropSpecies);
  const mutationsToShow = new Set<string>();
  for (const mutation of config.mutations) {
    const normalized = normalizeMutationFilterKey(mutation);
    if (normalized) mutationsToShow.add(normalized);
  }
  cachedFilterSets = {
    speciesToShow,
    unknownSpeciesToShow,
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
 * Called only when the stage children count changes.
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
 * Return cached tile nodes, rebuilding only when stage children count changes.
 */
function getOrBuildTileNodeCache(stage: any): TileNode[] {
  const currentLength: number = stage?.children?.length ?? -1;
  if (tileNodeCache !== null && tileNodeCacheStageLength === currentLength) {
    return tileNodeCache;
  }
  tileNodeCache = buildTileNodeCache(stage);
  tileNodeCacheStageLength = currentLength;
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
  speciesToShow: Set<string>,
  unknownSpeciesToShow: Set<string>,
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

      // Species/Egg filtering can work from PIXI labels alone (no garden data needed)
      let speciesMatches = true;
      let eggMatches = true;

      const isEgg = childLabel === 'Egg';

      if (isEgg) {
        // Egg filtering - for now, we can't filter eggs without garden data
        // TODO: Add egg type to PIXI label or use different approach
        if (eggTypesToShow.size > 0) {
          // For eggs, we need garden data to get egg type
          const tileData = getGardenTileData(x, y);
          if (tileData) {
            const eggType = tileData.eggType || tileData.species;
            eggMatches = eggTypesToShow.has(eggType);
          } else {
            // No data for egg, show it (don't filter unknown eggs)
            eggMatches = true;
          }
        }
      } else {
        // Plant/Decor filtering.
        // Known species (in SPECIES_TO_VIEW): fast path via PIXI child label.
        // Unknown species (new crops not yet in SPECIES_TO_VIEW): deferred to tile data.
        if (speciesToShow.size > 0 || unknownSpeciesToShow.size > 0) {
          if (speciesToShow.has(childLabel)) {
            speciesMatches = true; // fast path — no tile data needed
          } else if (unknownSpeciesToShow.size > 0) {
            speciesMatches = false; // may be resolved after tile data fetch below
          } else {
            speciesMatches = false;
          }
        }
      }

      // Mutation and growth state filtering REQUIRE garden data.
      // Unknown-species tiles that didn't match via PIXI label also need tile data.
      let mutationMatches = true;
      let growthStateMatches = true;
      const needsGardenData =
        mutationsToShow.size > 0 ||
        growthStatesToShow.size > 0 ||
        (!isEgg && !speciesMatches && unknownSpeciesToShow.size > 0);

      if (needsGardenData) {
        const tileData = getGardenTileData(x, y);
        if (tileData) {
          stats.withData++;

          // Resolve unknown-species match via tile data species field
          if (!isEgg && !speciesMatches && unknownSpeciesToShow.size > 0) {
            speciesMatches = unknownSpeciesToShow.has(tileData.species);
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
                // (hide only when the tile already has ALL selected mutations = fully complete)
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
          // No garden data — can't verify mutations or growth state, so default to visible
          if (!isEgg && unknownSpeciesToShow.size > 0) speciesMatches = false;
          // mutationMatches and growthStateMatches stay true — can't verify, show by default
        }
      } else {
        // Not filtering by mutations, growth state, or unknown species — no tile data needed
        stats.withoutData++;
      }

      const shouldShow = speciesMatches && eggMatches && mutationMatches && growthStateMatches;

      if (shouldShow) {
        node.alpha = 1.0;
        stats.visible++;
      } else {
        node.alpha = DIM_ALPHA;
        stats.dimmed++;
      }
    }
  }

  // Recursively traverse children
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      applyFiltersToStage(child, speciesToShow, unknownSpeciesToShow, mutationsToShow, eggTypesToShow, growthStatesToShow, stats, depth + 1, maxDepth);
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
    node.alpha = 1.0;
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      resetFiltersOnStage(child, depth + 1, maxDepth);
    }
  }
}

/**
 * Build the two label sets used for PIXI matching from a list of species keys.
 * speciesToShow — PIXI child labels to match (best-effort candidates per species).
 * unknownSpeciesToShow — species keys to verify via tile data when the PIXI fast path misses.
 *
 * Every species is added to BOTH sets. The PIXI fast path fires first (no tile data needed).
 * If the PIXI label is wrong — e.g. rare variants like FourLeafClover that may share the base
 * plant's View label ('Clover Patch View') — the tile data fallback catches it via tileData.species.
 */
function buildSpeciesLabelSets(
  species: string[]
): { speciesToShow: Set<string>; unknownSpeciesToShow: Set<string> } {
  const speciesToShow = new Set<string>();
  const unknownSpeciesToShow = new Set<string>();
  for (const s of species) {
    const staticLabel = SPECIES_TO_VIEW[s];
    if (staticLabel) { speciesToShow.add(staticLabel); }
    const catalogEntry = getPlantSpecies(s);
    const plantDisplayName = (catalogEntry?.plant as any)?.name as string | undefined;
    if (plantDisplayName) {
      speciesToShow.add(plantDisplayName + ' View');
      speciesToShow.add(plantDisplayName + ' Plant View');
    }
    speciesToShow.add(s + ' Plant View');
    // Always add as tile-data fallback — if the PIXI fast path matches, tile data is skipped.
    unknownSpeciesToShow.add(s);
  }
  return { speciesToShow, unknownSpeciesToShow };
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
        applyFiltersToStage(node, emptySet, emptySet, statsHubExcludeMutationsSet, emptySet, emptySet, stats, 0, 0);
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
          node.alpha = 1.0;
          visible++;
        } else {
          node.alpha = DIM_ALPHA;
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
      const { speciesToShow, unknownSpeciesToShow } = buildSpeciesLabelSets(statsHubOverride);
      const emptySet = new Set<string>();
      const stats = { visible: 0, dimmed: 0, withData: 0, withoutData: 0 };
      const tileNodes = getOrBuildTileNodeCache(app.stage);
      for (const { node } of tileNodes) {
        applyFiltersToStage(node, speciesToShow, unknownSpeciesToShow, emptySet, emptySet, emptySet, stats, 0, 0);
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

    const { speciesToShow, unknownSpeciesToShow, mutationsToShow, eggTypesToShow, growthStatesToShow } = getOrBuildFilterSets();

    const stats = { visible: 0, dimmed: 0, withData: 0, withoutData: 0 };
    const tileNodes = getOrBuildTileNodeCache(app.stage);
    for (const { node } of tileNodes) {
      applyFiltersToStage(node, speciesToShow, unknownSpeciesToShow, mutationsToShow, eggTypesToShow, growthStatesToShow, stats, 0, 0);
    }

    if (stats.visible + stats.dimmed > 0) {
      const filterInfo = [];
      const totalSpecies = speciesToShow.size + unknownSpeciesToShow.size;
      if (totalSpecies > 0) filterInfo.push(`${totalSpecies} species`);
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

    tileNodeCache = null;
    tileNodeCacheStageLength = -1;
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
    2000 // Every 2 seconds
  );

  log('✅ [GARDEN-FILTERS] Polling started (2s interval, visibility-aware)');
}

/**
 * Stop polling interval
 */
function stopFilteringPolling(): void {
  if (cleanupInterval !== null) {
    cleanupInterval();
    cleanupInterval = null;
    statsHubOverride = null;
    statsHubExcludeMutationsSet = null;
    statsHubExcludeMutationsAllMode = false;
    statsHubTileKeySet = null;
    tileNodeCache = null;
    tileNodeCacheStageLength = -1;
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

  // When catalogs arrive (possibly after filters are already cached), invalidate
  // the cached label sets so the dynamic plant.name lookup gets a second chance.
  // Also log any catalog species missing from the static SPECIES_TO_VIEW map.
  onCatalogsReady(() => {
    cachedFilterSets = null;
    const catalogKeys = getCatalogPlantSpecies();
    const missing = catalogKeys.filter(k => !SPECIES_TO_VIEW[k]);
    if (missing.length > 0) {
      log(`⚠️ [GARDEN-FILTERS] ${missing.length} catalog species not in static SPECIES_TO_VIEW:`, missing.join(', '));
    }
  });

  // Expose diagnostic command — always available, not gated by debug globals
  shareGlobal('QPM_GARDEN_DIAG', diagnoseGardenFilters);
  log('✅ [GARDEN-FILTERS] System initialized (run QPM_GARDEN_DIAG() in console for diagnostics)', config);
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
 * Manually reset all filters (for "Reset All" button)
 */
export function resetGardenFiltersNow(): void {
  resetFilters();
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

  // 6. Stage tile traversal
  if (app?.stage) {
    const tileNodes = getOrBuildTileNodeCache(app.stage);
    diag.tileNodes = {
      count: tileNodes.length,
      sample: tileNodes.slice(0, 3).map(t => ({
        label: t.node?.label,
        x: t.x,
        y: t.y,
        childCount: t.node?.children?.length ?? 0,
        firstChildLabel: t.node?.children?.[0]?.label ?? 'none',
        alpha: t.node?.alpha,
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
  if (app?.stage) {
    const walkLabels = (node: any, depth: number) => {
      if (!node || depth > 10) return;
      if (node.label && /^Tile \(\d+, \d+\)$/.test(node.label)) {
        const cl = node.children?.[0]?.label;
        if (cl && cl !== 'Sprite') livePixiLabels.add(cl);
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
