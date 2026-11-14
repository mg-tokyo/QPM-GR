// Patch species → rare crop pairs from game bundle text (ALR-16 spec F4, PD-B). The game keeps one
// table, `patchCropVariants` (beta common/games/Quinoa/utils/patchBackfill.ts:20-32); live 2036
// ships it as `[{patchSpeciesId:`Daisy`,rareCropSpeciesId:`PurpleDaisy`},…]`.

export interface RarePatchPair {
  patch: string;
  rare: string;
}

// Fixed tokens only, so the scan is linear (memory: bundle marker regexes can hang the tab).
export const RARE_PATCH_PAIRS_MARKER = /\[\s*\{\s*(?:patchSpeciesId|rareCropSpeciesId)\s*:/;

const FIELD = '(patchSpeciesId|rareCropSpeciesId)';
const VALUE = '[`\'"]([A-Za-z_$][\\w$]*)[`\'"]';
const ENTRY_SOURCE = `\\s*\\{\\s*${FIELD}\\s*:\\s*${VALUE}\\s*,\\s*${FIELD}\\s*:\\s*${VALUE}\\s*,?\\s*\\}\\s*(,\\s*\\]|,|\\])\\s*`;
const MAX_PAIRS = 64;

/** The table in order, or null when the anchor is absent or any entry has another shape. */
export function parseRarePatchPairs(text: string): RarePatchPair[] | null {
  const anchor = RARE_PATCH_PAIRS_MARKER.exec(text);
  if (!anchor) return null;
  const entry = new RegExp(ENTRY_SOURCE, 'y');
  entry.lastIndex = anchor.index + 1;
  const pairs: RarePatchPair[] = [];
  for (let i = 0; i < MAX_PAIRS; i += 1) {
    const m = entry.exec(text);
    if (!m) return null;
    const [, firstKey, firstValue, secondKey, secondValue, end] = m;
    if (!firstKey || !firstValue || !secondKey || !secondValue || firstKey === secondKey) return null;
    const patchFirst = firstKey === 'patchSpeciesId';
    pairs.push({ patch: patchFirst ? firstValue : secondValue, rare: patchFirst ? secondValue : firstValue });
    if (end?.endsWith(']')) return pairs;
  }
  return null;
}
