// The game's sprite enum is a plain string table (game 1686, AsyncEpoch-*.js):
//   pt={Animation:{ActivationTile:`sprite/animation/ActivationTile`,…},Decor:{…},Mutation:{…},…}
// Dex literals reference it as `k.<Category>.<Name>`; resolving those refs turns
// bundle-text dex entries into the same sprite paths the game executes.

import { extractBalancedBlock, toStrictJsonCandidate } from './bundleTextParsing';

export type SpriteEnumTable = Record<string, Record<string, string>>;

/** `Cat:{Name:\`sprite/<folder>/` — the head of any category in the table. */
export const SPRITE_ENUM_MARKER = /[{,][A-Z][A-Za-z]*:\{"?[A-Za-z_$][\w$-]*"?:\s*[`"']sprite\/[a-z][a-z-]*\//;

const MIN_CATEGORIES = 5;
const MAX_WALKBACK = 4000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Brace that encloses `index` at depth 0, walking back across sibling categories. */
function findEnclosingBrace(text: string, index: number): number {
  let depth = 0;
  const floor = Math.max(0, index - MAX_WALKBACK);
  for (let i = index; i >= floor; i -= 1) {
    const ch = text[i];
    if (ch === '}') depth += 1;
    else if (ch === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

function validateTable(parsed: unknown): SpriteEnumTable | null {
  if (!isObj(parsed)) return null;
  const categories = Object.entries(parsed);
  if (categories.length < MIN_CATEGORIES) return null;
  for (const [, names] of categories) {
    if (!isObj(names)) return null;
    for (const value of Object.values(names)) {
      if (typeof value !== 'string' || !value.startsWith('sprite/')) return null;
    }
  }
  return parsed as SpriteEnumTable;
}

export function extractSpriteEnumFromText(text: string): SpriteEnumTable | null {
  const markerRe = new RegExp(SPRITE_ENUM_MARKER.source, 'g');
  for (const match of text.matchAll(markerRe)) {
    if (match.index === undefined) continue;
    // match[0] starts with the `{` or `,` before the category name.
    const start = text[match.index] === '{' ? match.index : findEnclosingBrace(text, match.index);
    if (start === -1) continue;
    const block = extractBalancedBlock(text, start);
    if (!block) continue;
    const candidate = toStrictJsonCandidate(block);
    if (!candidate) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const table = validateTable(parsed);
    if (table) return table;
  }
  return null;
}

/** Replace `: X.Cat.Name` values with their path, only where the table has that entry. */
export function resolveSpriteEnumRefs(block: string, table: SpriteEnumTable): string {
  return block.replace(
    /(:\s*)[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)(?=\s*[,}\]])/g,
    (match, prefix: string, category: string, name: string) => {
      const path = table[category]?.[name];
      return typeof path === 'string' ? `${prefix}${JSON.stringify(path)}` : match;
    },
  );
}
