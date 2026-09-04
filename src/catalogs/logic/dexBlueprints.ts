// Pure text extraction of game dex blueprints (egg/pet/mutation/plant/item/decor)
// from bundle chunk text. Companion to bundleTextParsing.ts (which must stay
// import-free); shares its non-executing JSON-ification pipeline.
//
// Shape-first and rename-tolerant: multiple anchor ids per dex generate the
// chunk markers, but per-entry structural validation + a minimum-entry floor
// are the real gate — a wrong or lookalike literal fails validation, never
// gets guessed at. Literal forms verified against scraped v1019 and v1040
// (all six dexes live in iconTextureResolution-*.js as plain object literals,
// e.g. `var L=40,_s={CommonEgg:{sprite:D.Pet.CommonEgg,...,speciesPityThresholdPulls:{Bee:L},...}`).

import {
  extractBalancedBlock,
  extractBalancedObjectLiteral,
  fixLeadingDotNumbers,
  toStrictJsonCandidate,
} from './bundleTextParsing';

export type DexCatalogName =
  | 'eggCatalog'
  | 'petCatalog'
  | 'mutationCatalog'
  | 'plantCatalog'
  | 'itemCatalog'
  | 'decorCatalog';

export type DexMap = Record<string, Record<string, unknown>>;

interface DexBlueprintConfig {
  anchorIds: readonly string[];
  /** Field that must appear in the anchor entry's flat prefix — chunk-selection
   * discriminator. `Gold:{` alone matches the localization chunk's COLOR map
   * (`Gold:{solid:...}`) and fetchBundleContaining stops at the first matching
   * chunk, so the marker must not fire on lookalike maps. */
  markerField: string;
  validateEntry(value: unknown): boolean;
  minEntries: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

export const DEX_BLUEPRINT_CONFIGS: Readonly<Record<DexCatalogName, DexBlueprintConfig>> = {
  eggCatalog: {
    anchorIds: ['CommonEgg', 'UncommonEgg', 'RareEgg', 'LegendaryEgg', 'MythicalEgg'],
    markerField: 'secondsToHatch',
    validateEntry: (v) => isObj(v) && isObj(v.faunaSpawnWeights) && num(v.secondsToHatch),
    minEntries: 4,
  },
  petCatalog: {
    anchorIds: ['Worm', 'Snail', 'Bee', 'Chicken', 'Bunny'],
    markerField: 'coinsToFullyReplenishHunger',
    validateEntry: (v) => isObj(v) && num(v.coinsToFullyReplenishHunger) && typeof v.name === 'string',
    minEntries: 20,
  },
  mutationCatalog: {
    anchorIds: ['Gold', 'Rainbow', 'Wet', 'Chilled', 'Frozen'],
    markerField: 'baseChance',
    validateEntry: (v) => isObj(v) && num(v.baseChance) && num(v.coinMultiplier),
    minEntries: 8,
  },
  plantCatalog: {
    anchorIds: ['Carrot', 'Strawberry', 'Blueberry', 'Apple', 'Tomato'],
    markerField: 'seed',
    validateEntry: (v) => isObj(v) && isObj(v.seed) && isObj(v.plant) && isObj(v.crop),
    minEntries: 20,
  },
  itemCatalog: {
    anchorIds: ['WateringCan', 'PlanterPot', 'Shovel', 'RainbowPotion'],
    markerField: 'coinPrice',
    validateEntry: (v) => isObj(v) && num(v.coinPrice) && num(v.creditPrice) && typeof v.name === 'string',
    minEntries: 6,
  },
  decorCatalog: {
    anchorIds: ['SmallRock', 'MediumRock', 'LargeRock'],
    markerField: 'coinPrice',
    validateEntry: (v) => isObj(v) && num(v.coinPrice) && num(v.creditPrice) && typeof v.name === 'string',
    minEntries: 3,
  },
};

/** Chunk-selection markers for fetchBundleContaining — one per anchor id, each
 * requiring the dex's discriminating field within the entry's flat prefix. */
export function dexBlueprintMarkers(name: DexCatalogName): RegExp[] {
  const { anchorIds, markerField } = DEX_BLUEPRINT_CONFIGS[name];
  return anchorIds.map((id) => new RegExp(`${id}:\\s*\\{[^{}]{0,240}${markerField}`));
}

/**
 * Hoisted numeric consts in a window before the literal (`var L=40,_s={...
 * speciesPityThresholdPulls:{Bee:L}`). Window-scoped so an unrelated earlier
 * binding of the same short name can't win.
 */
function prescanNumericConsts(text: string, blockStart: number): Record<string, string> {
  const windowText = text.slice(Math.max(0, blockStart - 3000), blockStart);
  const map: Record<string, string> = {};
  const re = /\b([A-Za-z_$][\w$]{0,6})\s*=\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(windowText)) !== null) {
    map[m[1]!] = m[2]!;
  }
  return map;
}

/**
 * Enum sprite refs collapse to bare frame names ("CommonEgg") under
 * last-segment quoting; a truthy non-path string would shadow consumers'
 * `?? 'sprite/pet/...'` fallbacks, so drop them (shallow + one stage level
 * deep for plant seed/plant/crop).
 */
function stripNonPathSpriteFields(entry: Record<string, unknown>, depth = 0): void {
  for (const key of ['sprite', 'art', 'immatureSprite']) {
    const value = entry[key];
    if (typeof value === 'string' && !value.includes('/')) delete entry[key];
  }
  if (depth >= 1) return;
  for (const value of Object.values(entry)) {
    if (isObj(value)) stripNonPathSpriteFields(value, depth + 1);
  }
}

function parseDexBlock(text: string, blockStart: number, block: string, config: DexBlueprintConfig): DexMap | null {
  const constMap = prescanNumericConsts(text, blockStart);
  const candidate = toStrictJsonCandidate(fixLeadingDotNumbers(block), {
    memberExprMode: 'lastSegment',
    resolveIdentifier: (name) => constMap[name] ?? null,
    quoteNumericKeys: true,
    stripFunctionProps: true,
  });
  if (!candidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!isObj(parsed)) return null;

  const entries = Object.entries(parsed).filter(([, v]) => config.validateEntry(v));
  if (entries.length < config.minEntries) return null;

  const map: DexMap = {};
  for (const [key, value] of entries) {
    const entry = value as Record<string, unknown>;
    stripNonPathSpriteFields(entry);
    map[key] = entry;
  }
  return map;
}

/** Nearest '{' within 200 chars before the anchor — for anchors that are the literal's first key. */
function findPrecedingBrace(text: string, anchorPos: number): number {
  for (let i = anchorPos - 1; i >= Math.max(0, anchorPos - 200); i -= 1) {
    if (text[i] === '{') return i;
  }
  return -1;
}

export function extractDexFromText(text: string, name: DexCatalogName): DexMap | null {
  const config = DEX_BLUEPRINT_CONFIGS[name];

  for (const anchorId of config.anchorIds) {
    const anchorRe = new RegExp(`${anchorId}:\\s*\\{`, 'g');
    for (const match of text.matchAll(anchorRe)) {
      if (match.index === undefined) continue;

      const candidates: number[] = [];
      const preceding = findPrecedingBrace(text, match.index);
      if (preceding !== -1) candidates.push(preceding);

      const declLiteral = extractBalancedObjectLiteral(text, match.index);
      if (declLiteral) {
        const declStart = text.lastIndexOf(declLiteral.slice(0, 40), match.index);
        if (declStart !== -1 && !candidates.includes(declStart)) candidates.push(declStart);
      }

      for (const start of candidates) {
        const block = extractBalancedBlock(text, start);
        if (!block) continue;
        if (match.index < start || match.index >= start + block.length) continue;
        const map = parseDexBlock(text, start, block, config);
        if (map) return map;
      }
    }
  }
  return null;
}
