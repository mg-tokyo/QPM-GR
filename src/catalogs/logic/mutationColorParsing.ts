// Pure text parsing for the game's mutation colour table; kept import-light so
// it is unit-testable against bundle fixtures without the loader's runtime.
import { extractBalancedBlock, findAllIndices } from './bundleTextParsing';

// Anchors for locating the table inside the chunk. Gold's literal sits in the
// table's first entry; 'Thunderstruck:' also appears in the mutations dex, but
// wrong blocks are rejected by the catalog-key overlap check below.
const BLOCK_ANCHORS = ['rgb(235, 200, 0)', 'Thunderstruck:'] as const;

const MIN_KEY_OVERLAP = 3;
const MAX_BLOCK_LENGTH = 20_000;
// Since Game ~v1040 each entry is `Gold:{solid:\`…\`,gradient:{…}}`, so the `{`
// nearest the anchor is the entry's own object; walk outward this many
// enclosing blocks to reach the table (2 levels today; headroom for one more).
const MAX_ENCLOSING_BLOCKS = 4;
const ENCLOSING_SEARCH_CHARS = 4000;

// Accepts both table shapes: legacy flat `Gold:\`rgb(…)\`` and the current
// `Gold:{solid:\`rgb(…)\`,gradient:{…}}` (the solid colour is what UI uses).
function parseColorBlock(block: string): Record<string, string> {
  const pairRe = /([A-Za-z_$][\w$]*)\s*:\s*(?:\{\s*solid\s*:\s*)?([`'"])((?:#|rgba?\(|hsl\(|linear-gradient\()[^`'"]*)\2/g;
  const map: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(block)) !== null) {
    const key = match[1];
    const value = match[3];
    if (key && value && !(key in map)) map[key] = value;
  }
  return map;
}

// Object literals that contain `pos`, innermost first. A backward depth count
// picks the enclosing `{`s so only those (≤ MAX_ENCLOSING_BLOCKS) are extracted.
function enclosingBlocks(text: string, pos: number): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = pos; i >= Math.max(0, pos - ENCLOSING_SEARCH_CHARS) && out.length < MAX_ENCLOSING_BLOCKS; i -= 1) {
    const ch = text[i];
    if (ch === '}') { depth += 1; continue; }
    if (ch !== '{') continue;
    if (depth > 0) { depth -= 1; continue; }
    const block = extractBalancedBlock(text, i);
    if (!block || block.length > MAX_BLOCK_LENGTH) return out;
    out.push(block);
  }
  return out;
}

export function findMutationColorMap(bundleText: string, catalogKeys: readonly string[]): Record<string, string> | null {
  for (const anchor of BLOCK_ANCHORS) {
    for (const pos of findAllIndices(bundleText, anchor)) {
      for (const block of enclosingBlocks(bundleText, pos)) {
        const map = parseColorBlock(block);
        const overlap = catalogKeys.filter((key) => key in map).length;
        if (overlap >= MIN_KEY_OVERLAP) return map;
      }
    }
  }
  return null;
}
