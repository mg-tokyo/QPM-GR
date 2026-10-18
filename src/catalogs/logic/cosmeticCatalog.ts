// src/catalogs/logic/cosmeticCatalog.ts
// Cosmetic catalog extraction from a code-split bundle chunk.
// Cosmetics live in index-*.js, NOT the main bundle — so we fetch separately.

import {
  convertBacktickStrings, extractBalancedArray, fetchBundleContaining, findAllIndices, markBundleConsumerDone, registerBundleConsumer,
} from './bundleParser';
import { pageWindow } from '../../core/pageContext';
import { createNamedLogger } from '../../diagnostics/logger';

const log = createNamedLogger('catalogs');

export interface RuntimeCosmeticEntry {
  id: string;
  type: string;
  filename: string;
  displayName: string;
  availability: string;
  price: number;
  /** Game ≥1361 prices cosmetics per tier in a named currency, e.g. 'coins', 'magicDust', 'credits'. */
  currency?: string;
}

export type RuntimeCosmeticCatalog = RuntimeCosmeticEntry[];

export interface CosmeticCatalogLoadResult {
  catalog: RuntimeCosmeticCatalog | null;
  /** Whether this call fetched at least one previously untried chunk — used to
   * gate retry budgets so lazy chunks that haven't loaded yet don't burn attempts. */
  triedNewChunks: boolean;
}

let cosmeticCatalogCache: RuntimeCosmeticCatalog | null = null;
let cosmeticCatalogInFlight: Promise<CosmeticCatalogLoadResult> | null = null;
let cosmeticBundleCache: string | null = null;
// Chunk URLs are content-hashed, so a fetched-and-rejected URL never needs a retry.
const triedCosmeticUrls = new Set<string>();
const CURRENCY_CONSUMER = 'cosmetic-currency';

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

// Default (free) cosmetics carry no price/cost field; they normalize to price 0.
function toValidEntry(entry: unknown): RuntimeCosmeticEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  if (
    typeof e.id !== 'string' ||
    typeof e.type !== 'string' ||
    typeof e.filename !== 'string' ||
    typeof e.displayName !== 'string' ||
    typeof e.availability !== 'string'
  ) {
    return null;
  }
  const out: RuntimeCosmeticEntry = {
    id: e.id,
    type: e.type,
    filename: e.filename,
    displayName: e.displayName,
    availability: e.availability,
    price: typeof e.price === 'number' && Number.isFinite(e.price) ? e.price : 0,
  };
  if (typeof e.currency === 'string') out.currency = e.currency;
  return out;
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

async function fetchCosmeticBundle(): Promise<{ text: string | null; triedNewChunks: boolean }> {
  if (cosmeticBundleCache) return { text: cosmeticBundleCache, triedNewChunks: false };

  const urls = findCosmeticBundleUrls();
  let triedNewChunks = false;
  if (!urls.length) return { text: null, triedNewChunks };

  const fetchFn = typeof pageWindow.fetch === 'function'
    ? pageWindow.fetch.bind(pageWindow)
    : fetch;

  for (const url of urls) {
    if (triedCosmeticUrls.has(url)) continue;
    triedCosmeticUrls.add(url);
    triedNewChunks = true;
    try {
      const res = await fetchFn(url, { credentials: 'include' });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes('HazmatSuit')) {
        cosmeticBundleCache = text;
        log.debug('cosmeticCatalog: found cosmetic bundle', { url });
        return { text, triedNewChunks };
      }
    } catch { /* skip */ }
  }

  return { text: null, triedNewChunks };
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

interface CostTier {
  amount: number;
  currency: string | null;
}

/**
 * Game ≥1361 entries use `cost:<var>.<Tier>` against a tier table declared before
 * the array, e.g. `y={CoinsD:{currency:v.Coins,amount:1e3},…}`, where `v` is a string
 * enum (`e.Coins=\`coins\``). Returns null for refs the table doesn't define.
 */
function buildCostResolver(
  bundleText: string,
  arrayStart: number,
  foreign: ReadonlyMap<string, string>,
): (ref: string) => CostTier | null {
  const searchArea = bundleText.substring(Math.max(0, arrayStart - 4000), arrayStart);
  const tableRe = /([A-Za-z_$][\w$]*)=\{((?:[A-Za-z_$][\w$]*:\{[^{}]*\bamount:[^{}]*\},?)+)\}/g;
  let table: RegExpExecArray | null = null;
  for (let m = tableRe.exec(searchArea); m; m = tableRe.exec(searchArea)) table = m;

  const tiers = new Map<string, CostTier>();
  if (table) {
    const varName = table[1] ?? '';
    for (const tier of (table[2] ?? '').matchAll(/([A-Za-z_$][\w$]*):\{([^{}]*)\}/g)) {
      const body = tier[2] ?? '';
      const amount = Number(body.match(/\bamount:([^,}]+)/)?.[1]?.trim());
      if (!Number.isFinite(amount)) continue;
      const currencyRef = body.match(/\bcurrency:([^,}]+)/)?.[1]?.trim() ?? null;
      tiers.set(`${varName}.${tier[1]}`, { amount, currency: resolveCurrency(searchArea, currencyRef, foreign) });
    }
  }
  return (ref: string): CostTier | null => tiers.get(ref) ?? null;
}

const escapeRe = (s: string): string => s.replace(/\$/g, '\\$');
const enumMemberRe = (member: string): RegExp => new RegExp(`\\.${escapeRe(member)}=[\`'"]([^\`'"]*)[\`'"]`);

function resolveCurrency(searchArea: string, ref: string | null, foreign: ReadonlyMap<string, string>): string | null {
  if (!ref) return null;
  const literal = ref.match(/^[`'"]([^`'"]*)[`'"]$/);
  if (literal) return literal[1] ?? null;
  const member = ref.split('.').pop() ?? '';
  if (!/^[A-Za-z_$][\w$]*$/.test(member)) return null;
  return searchArea.match(enumMemberRe(member))?.[1] ?? foreign.get(member) ?? member;
}

/**
 * By game 1468 the currency enum (`e.MagicDust=\`magicDust\``) is imported from another chunk; read the
 * members the cosmetic chunk can't resolve from whichever loaded chunk declares them.
 */
async function resolveForeignCurrencies(bundleText: string, arrayStart: number): Promise<Map<string, string>> {
  const searchArea = bundleText.substring(Math.max(0, arrayStart - 4000), arrayStart);
  const missing = new Set<string>();
  for (const m of searchArea.matchAll(/\bcurrency:[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)/g)) {
    if (m[1] && !enumMemberRe(m[1]).test(searchArea)) missing.add(m[1]);
  }
  const out = new Map<string, string>();
  if (missing.size === 0) return out;
  const marker = new RegExp(`\\.(?:${[...missing].map(escapeRe).join('|')})=[\`'"]`);
  registerBundleConsumer(CURRENCY_CONSUMER);
  try {
    const text = await fetchBundleContaining(marker);
    for (const member of missing) {
      const value = text?.match(enumMemberRe(member))?.[1];
      if (value !== undefined) out.set(member, value);
    }
  } finally {
    markBundleConsumerDone(CURRENCY_CONSUMER);
  }
  return out;
}

function normalizeCostRefs(source: string, resolver: (ref: string) => CostTier | null): string {
  return source.replace(
    /"cost"\s*:\s*([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)/g,
    (_m, ref: string) => {
      const tier = resolver(ref);
      if (!tier) return '"price":0';
      return tier.currency
        ? `"price":${tier.amount},"currency":${JSON.stringify(tier.currency)}`
        : `"price":${tier.amount}`;
    },
  );
}

/**
 * By game 1468 some entries reference a string hoisted into the same declaration, e.g.
 * `kt=\`Bottom_ToastShirt.png\`,…,T=[…{id:kt,filename:kt,…}]`. Nearest declaration before the array wins.
 */
function buildIdentResolver(bundleText: string, arrayStart: number): Map<string, string> {
  const searchArea = bundleText.substring(Math.max(0, arrayStart - 4000), arrayStart);
  const idents = new Map<string, string>();
  for (const m of searchArea.matchAll(/[,;{(\s]([A-Za-z_$][\w$]*)=(`[^`$\\]*`|'[^'\\]*'|"[^"\\]*")/g)) {
    if (m[1] && m[2]) idents.set(m[1], m[2].slice(1, -1));
  }
  return idents;
}

// An unresolved reference becomes null so only its entry fails toValidEntry, not the whole JSON.parse.
function normalizeIdentRefs(source: string, idents: Map<string, string>): string {
  return source.replace(
    /("[A-Za-z_$][\w$]*"\s*:\s*)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?=\s*[,}\]])/g,
    (m, prefix: string, ref: string) => {
      if (ref === 'true' || ref === 'false' || ref === 'null') return m;
      const value = idents.get(ref);
      return `${prefix}${value === undefined ? 'null' : JSON.stringify(value)}`;
    },
  );
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
  costResolver: (ref: string) => CostTier | null,
  idents: Map<string, string>,
): string | null {
  let s = literal.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;

  s = convertBacktickStrings(s);
  s = quoteUnquotedKeys(s);
  s = normalizePriceRefs(s, resolver);
  s = normalizeCostRefs(s, costResolver);
  s = normalizeJsLiterals(s);
  s = normalizeIdentRefs(s, idents);

  return s;
}

async function loadFromBundle(): Promise<CosmeticCatalogLoadResult> {
  const { text, triedNewChunks } = await fetchCosmeticBundle();
  if (!text) return { catalog: null, triedNewChunks };

  // Every anchor usually lands in the same array; resolve its foreign currencies once.
  const foreignByStart = new Map<number, Map<string, string>>();
  for (const anchor of COSMETIC_ANCHORS) {
    const indices = findAllIndices(text, anchor);
    for (const idx of indices) {
      const arrayLiteral = findContainingArray(text, idx);
      if (!arrayLiteral) continue;

      const arrayStartInBundle = text.indexOf(arrayLiteral);
      const arrayStart = arrayStartInBundle >= 0 ? arrayStartInBundle : idx;
      let foreign = foreignByStart.get(arrayStart);
      if (!foreign) {
        foreign = await resolveForeignCurrencies(text, arrayStart);
        foreignByStart.set(arrayStart, foreign);
      }
      const json = toStrictJson(
        arrayLiteral, buildPriceResolver(text, arrayStart), buildCostResolver(text, arrayStart, foreign), buildIdentResolver(text, arrayStart),
      );
      if (!json) continue;

      try {
        const parsed: unknown = JSON.parse(json);
        if (!Array.isArray(parsed) || parsed.length < 10) continue;

        const entries = parsed.map(toValidEntry).filter((e): e is RuntimeCosmeticEntry => e !== null);
        if (entries.length >= 10) {
          log.debug('cosmeticCatalog: extracted cosmetics from bundle', { count: entries.length });
          return { catalog: entries, triedNewChunks };
        }
      } catch (e) {
        log.debug('cosmeticCatalog: JSON parse failed', { cause: String(e) });
        continue;
      }
    }
  }

  log.debug('cosmeticCatalog: failed to extract from bundle');
  return { catalog: null, triedNewChunks };
}

export async function getCosmeticCatalogFromBundle(): Promise<CosmeticCatalogLoadResult> {
  if (cosmeticCatalogCache) return { catalog: cosmeticCatalogCache, triedNewChunks: false };
  if (cosmeticCatalogInFlight) return cosmeticCatalogInFlight;

  cosmeticCatalogInFlight = (async () => {
    const result = await loadFromBundle();
    if (!result.catalog) return result;
    cosmeticCatalogCache = result.catalog;
    cosmeticBundleCache = null;
    return result;
  })().finally(() => {
    cosmeticCatalogInFlight = null;
  });

  return cosmeticCatalogInFlight;
}
