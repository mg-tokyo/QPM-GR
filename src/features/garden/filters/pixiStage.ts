import { getPixiCapture, getPixiRefs } from '../../../core/pixiCapture';
import { warnFeature } from './_diagnostics';
import { DIM_ALPHA, TILE_LABEL_CAPTURE_RE, TILE_LABEL_TEST_RE } from './constants';
import type { CachedFilterSets, TileNode } from './types';
import { installVisibleGuard, removeVisibleGuard, pruneStaleGuards } from './alphaGuard';
import { getGardenTileData, getTileMutations, getGrowthState, tileMatchesSpecies } from './tileData';
import { getExcludeMutationsState } from './controller';

/**
 * Access PIXI app via QPM's own capture system. Retained for the alphaGuard
 * ticker attach — every other caller in this feature now uses getPixiStage.
 */
export function getPixiApp(): any {
  try {
    return getPixiCapture()?.app ?? null;
  } catch (error) {
    warnFeature('QPM-FEATURE-004', { what: 'getPixiApp' }, error);
    return null;
  }
}

/** Liveness-checked stage (structural recovery included) — the only root for stage walks. */
export function getPixiStage(): any {
  try {
    return getPixiRefs()?.stage ?? null;
  } catch (error) {
    warnFeature('QPM-FEATURE-004', { what: 'getPixiStage' }, error);
    return null;
  }
}

// Tile node cache — rebuilt every poll from the live stage tree
export const tileCache: { nodes: TileNode[] | null } = { nodes: null };

/**
 * Recursively collect all Tile nodes from the PIXI stage into a flat array.
 * Rebuilt every poll cycle — the previous stage.children.length check was too coarse
 * (tiles are nested deep in the tree, so top-level count rarely changes when tiles are
 * created/destroyed during viewport scrolling or player movement).
 */
export function buildTileNodeCache(node: any, out: TileNode[] = [], depth = 0, maxDepth = 10): TileNode[] {
  if (!node || depth > maxDepth) return out;

  if (typeof node.label === 'string') {
    const match = TILE_LABEL_CAPTURE_RE.exec(node.label);
    if (match) {
      out.push({ node, x: parseInt(match[1]!), y: parseInt(match[2]!) });
      // Tiles don't contain other tiles — skip recursing into them
      return out;
    }
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
export function getOrBuildTileNodeCache(stage: any): TileNode[] {
  const nodes = buildTileNodeCache(stage);
  tileCache.nodes = nodes;
  return nodes;
}

/**
 * The single write path for filter dimming. Dims the tile's CONTENT CHILDREN,
 * never the Tile container: the game's occlusion mask renders the child view
 * with its root alpha saved/forced/restored through the PIXI setter every
 * ≤250 ms while an avatar stands on the tile, so a dim on that node is
 * re-dirtied and survives — a dim on the Tile container is permanently
 * bypassed after render-group demotion (see the 2026-09-11 occlusion spec).
 * Always heals tile.alpha to 1 (repairs container dims from older builds).
 */
export function setTileDim(node: any, dimmed: boolean): void {
  if (node.alpha !== 1) node.alpha = 1;
  const children = node.children;
  if (!Array.isArray(children)) return;
  const target = dimmed ? DIM_ALPHA : 1;
  for (const child of children) {
    if (child && child.alpha !== target) child.alpha = target;
  }
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
export function applyFiltersToStage(
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
  const match = typeof node.label === 'string' ? TILE_LABEL_CAPTURE_RE.exec(node.label) : null;
  if (match) {
    const childLabel = node.children?.[0]?.label;

    // Skip empty tiles and sprite-only tiles
    if (childLabel && childLabel !== 'Sprite') {
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

          // Species match: tile-level species OR any slot's species (rare variants
          // like FourLeafClover/PurpleDaisy live only in slot.species)
          if (!isEgg && speciesKeysToShow.size > 0) {
            speciesMatches = tileMatchesSpecies(tileData, speciesKeysToShow);
          }

          // Egg match
          if (isEgg && eggTypesToShow.size > 0) {
            const eggType = tileData.eggType || tileData.species;
            eggMatches = eggTypesToShow.has(eggType);
          }

          // Check mutations
          if (mutationsToShow.size > 0) {
            const tileMutations = getTileMutations(tileData);
            const { shouldExclude, allMode } = getExcludeMutationsState();
            if (shouldExclude) {
              if (allMode) {
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
        setTileDim(node, false);
        stats.visible++;
      } else {
        setTileDim(node, true);
        installVisibleGuard(node);
        stats.dimmed++;
      }
    } else {
      // A dimmed tile that lost its child view has nothing to dim and no
      // guard to keep (the guard would dim whatever child appears next).
      removeVisibleGuard(node);
    }
  }

  // Recursively traverse children
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      applyFiltersToStage(child, speciesKeysToShow, mutationsToShow, eggTypesToShow, growthStatesToShow, stats, depth + 1, maxDepth);
    }
  }
}

/** One full filter pass over the cached tile list, then guard hygiene. */
export function applyFiltersToTiles(
  tileNodes: readonly TileNode[],
  sets: CachedFilterSets,
  stats: { visible: number; dimmed: number; withData: number; withoutData: number },
): void {
  for (const { node } of tileNodes) {
    applyFiltersToStage(node, sets.speciesKeysToShow, sets.mutationsToShow, sets.eggTypesToShow, sets.growthStatesToShow, stats, 0, 0);
  }
  pruneStaleGuards(tileNodes);
}

/**
 * Reset all tile alphas to 1.0
 */
export function resetFiltersOnStage(
  node: any,
  depth: number = 0,
  maxDepth: number = 10
): void {
  if (!node || depth > maxDepth) return;

  if (typeof node.label === 'string' && TILE_LABEL_TEST_RE.test(node.label)) {
    removeVisibleGuard(node);
    setTileDim(node, false);
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      resetFiltersOnStage(child, depth + 1, maxDepth);
    }
  }
}
