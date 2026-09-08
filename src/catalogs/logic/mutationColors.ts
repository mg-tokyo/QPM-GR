// Mutation color extraction from the game bundle. The game defines
// `mutationColors` in the same source module as getAbilityColor
// (constants/colors.ts), so it always shares the '#228B22' chunk that
// abilityColors.ts already fetches and caches.

import { fetchBundleContaining, getMarkerMissCount, markBundleConsumerDone } from './bundleParser';
import { findMutationColorMap } from './mutationColorParsing';
import { createNamedLogger } from '../../diagnostics/logger';

const log = createNamedLogger('catalogs');

export interface MutationColorLoadResult {
  map: Record<string, string> | null;
  triedNewChunks: boolean;
}

// Primary marker rides the ability-color chunk (already cached); Gold's color
// literal is the fallback if the ability switch ever moves chunks.
const MUTATION_COLOR_MARKERS = ['#228B22', 'rgb(235, 200, 0)'] as const;

let colorMapCache: Record<string, string> | null = null;
let colorMapInFlight: Promise<MutationColorLoadResult> | null = null;

async function loadMutationColorsFromBundle(catalogKeys: string[]): Promise<MutationColorLoadResult> {
  let triedNewChunks = false;

  for (const marker of MUTATION_COLOR_MARKERS) {
    const missesBefore = getMarkerMissCount(marker);
    const bundleText = await fetchBundleContaining(marker);
    if (getMarkerMissCount(marker) > missesBefore) triedNewChunks = true;
    if (!bundleText) continue;

    const map = findMutationColorMap(bundleText, catalogKeys);
    if (map) {
      log.debug('mutationColors: parsed color map', { count: Object.keys(map).length });
      return { map, triedNewChunks };
    }
  }

  log.debug('mutationColors: color table not found in any candidate chunk');
  return { map: null, triedNewChunks };
}

/**
 * Extract the game's mutation color table, validated against the captured
 * mutation catalog's keys. Single in-flight + positive cache.
 * triedNewChunks reports whether any candidate chunk was fetched on this call
 * (see abilityColors.ts for rationale — enrichment polling gates retry budget
 * on this so lazy-loaded chunks don't burn attempts before they load).
 */
export async function getMutationColorMap(catalogKeys: string[]): Promise<MutationColorLoadResult> {
  if (colorMapCache) return { map: colorMapCache, triedNewChunks: false };
  if (colorMapInFlight) return colorMapInFlight;

  colorMapInFlight = (async () => {
    const result = await loadMutationColorsFromBundle(catalogKeys);
    if (result.map) {
      colorMapCache = result.map;
      markBundleConsumerDone('mutation-colors');
    }
    return result;
  })().finally(() => {
    colorMapInFlight = null;
  });

  return colorMapInFlight;
}
