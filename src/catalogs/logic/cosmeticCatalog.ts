// src/catalogs/logic/cosmeticCatalog.ts
// Cosmetic catalog extraction from a code-split bundle chunk.
// Cosmetics live in index-*.js, NOT the main bundle — so we fetch separately.

import { findAllIndices, extractBalancedArray, convertBacktickStrings } from './bundleParser';
import { pageWindow, readSharedGlobal } from '../../core/pageContext';

export interface RuntimeCosmeticEntry {
  id: string;
  type: string;
  filename: string;
  displayName: string;
  availability: string;
  price: number;
}

export type RuntimeCosmeticCatalog = RuntimeCosmeticEntry[];

let cosmeticCatalogCache: RuntimeCosmeticCatalog | null = null;
let cosmeticCatalogInFlight: Promise<RuntimeCosmeticCatalog | null> | null = null;
let cosmeticBundleCache: string | null = null;

function shouldDebug(): boolean {
  try {
    return (
      readSharedGlobal('__QPM_DEBUG_CATALOGS') === true ||
      readSharedGlobal('__QPM_VERBOSE_LOGS') === true
    );
  } catch {
    return false;
  }
}

const COSMETIC_ANCHORS = [
  'Bottom_HazmatSuit.png',
  'Expression_Alarmed.png',
  'Mid_Ladybug.png',
  'Top_Brain.png',
];

// Known price tier values from game source
const PRICE_TIERS: Record<string, number> = {
  D: 25, C: 65, B: 330, A: 1170, AA: 10000,
};

function isValidEntry(entry: unknown): entry is RuntimeCosmeticEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.type === 'string' &&
    typeof e.filename === 'string' &&
    typeof e.displayName === 'string' &&
    typeof e.availability === 'string' &&
    typeof e.price === 'number'
  );
}

// ---------------------------------------------------------------------------
// Bundle fetching — scan all JS resources for the one with cosmetic data
// ---------------------------------------------------------------------------

function findCosmeticBundleUrls(): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  try {
    const entries = pageWindow.performance?.getEntriesByType?.('resource') || [];
    for (const entry of entries) {
      const name = (entry as PerformanceResourceTiming)?.name
        ? String((entry as PerformanceResourceTiming).name)
        : '';
      if (/\.js(\?|$)/.test(name) && !seen.has(name)) {
        seen.add(name);
        urls.push(name);
      }
    }
  } catch { /* ignore */ }
  return urls;
}

async function fetchCosmeticBundle(): Promise<string | null> {
  if (cosmeticBundleCache) return cosmeticBundleCache;

  const urls = findCosmeticBundleUrls();
  if (!urls.length) return null;

  const fetchFn = typeof pageWindow.fetch === 'function'
    ? pageWindow.fetch.bind(pageWindow)
    : fetch;

  for (const url of urls) {
    try {
      const res = await fetchFn(url, { credentials: 'include' });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes('HazmatSuit')) {
        cosmeticBundleCache = text;
        if (shouldDebug()) {
          console.log('[QPM Catalog] [CosmeticCatalog] Found cosmetic bundle:', url);
        }
        return text;
      }
    } catch { /* skip */ }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function findContainingArray(text: string, anchorPos: number): string | null {
  for (let i = anchorPos; i >= Math.max(0, anchorPos - 10000); i--) {
    if (text[i] === '[') {
      const arr = extractBalancedArray(text, i);
      if (arr && arr.length > 500) return arr;
    }
  }
  return null;
}

/**
 * Resolve a minified price enum reference like `G.A` → 1170.
 * Scans the bundle text near the cosmetic array to find the price tier object.
 */
function buildPriceResolver(bundleText: string, arrayStart: number): (ref: string) => number {
  // Search backward from the array for the price tier object.
  // It looks like: {D:25,C:65,B:330,A:1170,AA:1e4} or similar.
  const searchStart = Math.max(0, arrayStart - 2000);
  const searchArea = bundleText.substring(searchStart, arrayStart);

  // Find the variable name used for price tiers by looking at known tier values
  const tierPattern = /([A-Za-z_$][\w$]*)=\{[^}]*\bA:1170\b[^}]*\}/;
  const tierMatch = searchArea.match(tierPattern);

  const resolvedTiers = new Map<string, number>();

  if (tierMatch) {
    const varName = tierMatch[0].split('=')[0] ?? '';
    const objLiteral = tierMatch[0].substring(tierMatch[0].indexOf('{'));
    // Parse {D:25,C:65,B:330,A:1170,AA:1e4}
    const pairs = objLiteral.slice(1, -1).split(',');
    for (const pair of pairs) {
      const [key, val] = pair.split(':');
      if (key && val) {
        const numVal = Number(val.trim());
        if (!isNaN(numVal)) {
          resolvedTiers.set(`${varName.trim()}.${key.trim()}`, numVal);
        }
      }
    }
  }

  return (ref: string): number => {
    if (resolvedTiers.has(ref)) return resolvedTiers.get(ref)!;
    // Fallback: try matching just the suffix against known tiers
    const suffix = ref.split('.').pop() ?? '';
    return PRICE_TIERS[suffix] ?? 0;
  };
}

function quoteUnquotedKeys(source: string): string {
  return source.replace(/([,{\[]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
}

function normalizePriceRefs(
  source: string,
  resolver: (ref: string) => number,
): string {
  // Replace price:<enumRef> with price:<number>
  return source.replace(
    /"price"\s*:\s*([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)/g,
    (_m, ref: string) => `"price":${resolver(ref)}`,
  );
}

function normalizeJsLiterals(source: string): string {
  return source
    .replace(/\bundefined\b/g, 'null')
    .replace(/\bvoid\s+0\b/g, 'null')
    .replace(/!0/g, 'true')
    .replace(/!1/g, 'false')
    .replace(/,\s*([}\]])/g, '$1');
}

function toStrictJson(
  literal: string,
  resolver: (ref: string) => number,
): string | null {
  let s = literal.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;

  s = convertBacktickStrings(s);
  s = quoteUnquotedKeys(s);
  s = normalizePriceRefs(s, resolver);
  s = normalizeJsLiterals(s);

  return s;
}

async function loadFromBundle(): Promise<RuntimeCosmeticCatalog | null> {
  const text = await fetchCosmeticBundle();
  if (!text) return null;

  for (const anchor of COSMETIC_ANCHORS) {
    const indices = findAllIndices(text, anchor);
    for (const idx of indices) {
      const arrayLiteral = findContainingArray(text, idx);
      if (!arrayLiteral) continue;

      const arrayStartInBundle = text.indexOf(arrayLiteral);
      const resolver = buildPriceResolver(text, arrayStartInBundle >= 0 ? arrayStartInBundle : idx);
      const json = toStrictJson(arrayLiteral, resolver);
      if (!json) continue;

      try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed) || parsed.length < 10) continue;

        const entries = parsed.filter(isValidEntry);
        if (entries.length >= 10) {
          if (shouldDebug()) {
            console.log(`[QPM Catalog] [CosmeticCatalog] Extracted ${entries.length} cosmetics from bundle`);
          }
          return entries;
        }
      } catch (e) {
        if (shouldDebug()) {
          console.log('[QPM Catalog] [CosmeticCatalog] JSON parse failed:', e);
        }
        continue;
      }
    }
  }

  if (shouldDebug()) {
    console.log('[QPM Catalog] [CosmeticCatalog] Failed to extract from bundle');
  }
  return null;
}

export async function getCosmeticCatalogFromBundle(): Promise<RuntimeCosmeticCatalog | null> {
  if (cosmeticCatalogCache) return cosmeticCatalogCache;
  if (cosmeticCatalogInFlight) return cosmeticCatalogInFlight;

  cosmeticCatalogInFlight = (async () => {
    const catalog = await loadFromBundle();
    if (!catalog) return null;
    cosmeticCatalogCache = catalog;
    cosmeticBundleCache = null;
    return catalog;
  })().finally(() => {
    cosmeticCatalogInFlight = null;
  });

  return cosmeticCatalogInFlight;
}
