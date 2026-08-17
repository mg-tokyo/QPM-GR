// Mutation color extraction from the game bundle. The game defines
// `mutationColors` in the same source module as getAbilityColor
// (constants/colors.ts), so it always shares the '#228B22' chunk that
// abilityColors.ts already fetches and caches.

import { fetchBundleContaining, findAllIndices, extractBalancedBlock, getMarkerMissCount, markBundleConsumerDone } from './bundleParser';
import { createNamedLogger } from '../../diagnostics/logger';

const log = createNamedLogger('catalogs');

export interface MutationColorLoadResult {
  map: Record<string, string> | null;
  triedNewChunks: boolean;
}

// Primary marker rides the ability-color chunk (already cached); Gold's color
// literal is the fallback if the ability switch ever moves chunks.
const MUTATION_COLOR_MARKERS = ['#228B22', 'rgb(235, 200, 0)'] as const;

// Anchors for locating the table inside the chunk. Gold's literal sits in the
// table's first entry; 'Thunderstruck:' also appears in the mutations dex, but
// wrong blocks are rejected by the catalog-key overlap check below.
const BLOCK_ANCHORS = ['rgb(235, 200, 0)', 'Thunderstruck:'] as const;

const MIN_KEY_OVERLAP = 3;
const MAX_BLOCK_LENGTH = 20_000;

let colorMapCache: Record<string, string> | null = null;
let colorMapInFlight: Promise<MutationColorLoadResult> | null = null;

function parseColorBlock(block: string): Record<string, string> {
  const pairRe = /([A-Za-z_$][\w$]*)\s*:\s*([`'"])((?:#|rgba?\(|hsl\(|linear-gradient\()[^`'"]*)\2/g;
  const map: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(block)) !== null) {
    const key = match[1];
    const value = match[3];
    if (key && value && !(key in map)) map[key] = value;
  }
  return map;
}

function findMutationColorMap(bundleText: string, catalogKeys: string[]): Record<string, string> | null {
  for (const anchor of BLOCK_ANCHORS) {
    for (const pos of findAllIndices(bundleText, anchor)) {
      let braceStart = -1;
      for (let i = pos; i >= Math.max(0, pos - 200); i -= 1) {
        if (bundleText[i] === '{') {
          braceStart = i;
          break;
        }
      }
      if (braceStart < 0) continue;

      const block = extractBalancedBlock(bundleText, braceStart);
      if (!block || block.length > MAX_BLOCK_LENGTH) continue;

      const map = parseColorBlock(block);
      const overlap = catalogKeys.filter((key) => key in map).length;
      if (overlap >= MIN_KEY_OVERLAP) return map;
    }
  }
  return null;
}

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
