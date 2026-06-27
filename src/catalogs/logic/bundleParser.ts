// src/catalogs/logic/bundleParser.ts
// Shared main-bundle parsing helpers (Gemini-style).

import { pageWindow, readSharedGlobal } from '../../core/pageContext';

// Ordered by priority: try main bundle first (prod), then code-split game chunks (beta).
const BUNDLE_PATTERNS = [
  /main-[^/]+\.js(\?|$)/,
  /QuinoaView-[^/]+\.js(\?|$)/,
  /ScrollableView-[^/]+\.js(\?|$)/,
];

const BUNDLE_CONTENT_ANCHOR = 'ProduceScaleBoost';

let bundleCache: string | null = null;
let bundleFetchInFlight: Promise<string | null> | null = null;

function shouldDebug(): boolean {
  try {
    return readSharedGlobal('__QPM_DEBUG_ABILITY_COLORS') === true;
  } catch {
    return false;
  }
}

/**
 * Find candidate bundle URLs from scripts and performance entries.
 * Returns URLs in priority order: main-*.js first, then game-specific chunks.
 */
function findBundleCandidateUrls(): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const addUrl = (src: string): void => {
    if (src && !seen.has(src)) {
      seen.add(src);
      urls.push(src);
    }
  };

  for (const pattern of BUNDLE_PATTERNS) {
    try {
      for (const script of pageWindow.document?.scripts || []) {
        const src = script?.src ? String(script.src) : '';
        if (pattern.test(src)) addUrl(src);
      }
    } catch {
      // Ignore.
    }

    try {
      const entries = pageWindow.performance?.getEntriesByType?.('resource') || [];
      for (const entry of entries) {
        const name = (entry as PerformanceResourceTiming)?.name
          ? String((entry as PerformanceResourceTiming).name)
          : '';
        if (pattern.test(name)) addUrl(name);
      }
    } catch {
      // Ignore.
    }
  }

  return urls;
}

/**
 * Find main bundle URL from scripts or performance entries.
 */
export function findMainBundleUrl(): string | null {
  return findBundleCandidateUrls()[0] ?? null;
}

/**
 * Find all indices of a substring in text.
 */
export function findAllIndices(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    out.push(idx);
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return out;
}

/**
 * Extract balanced block from text starting at open brace index.
 * Handles nested braces and string literals.
 */
export function extractBalancedBlock(text: string, openBraceIndex: number): string | null {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let i = openBraceIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(openBraceIndex, i + 1);
  }

  return null;
}

/**
 * Extract balanced array literal from text starting at open bracket index.
 */
export function extractBalancedArray(text: string, openBracketIndex: number): string | null {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let i = openBracketIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']' && --depth === 0) return text.slice(openBracketIndex, i + 1);
  }

  return null;
}

/**
 * Extract balanced object literal from text starting near an anchor index.
 * Looks backward for const/let/var assignment and returns the object block.
 */
export function extractBalancedObjectLiteral(text: string, anchorIndex: number): string | null {
  const declStart = Math.max(
    text.lastIndexOf('const ', anchorIndex),
    text.lastIndexOf('let ', anchorIndex),
    text.lastIndexOf('var ', anchorIndex),
  );
  if (declStart < 0) return null;

  const eq = text.indexOf('=', declStart);
  if (eq < 0 || eq > anchorIndex) return null;

  const braceStart = text.indexOf('{', eq);
  if (braceStart < 0 || braceStart > anchorIndex) return null;

  return extractBalancedBlock(text, braceStart);
}

/**
 * Fetch bundle text containing ability color data.
 * Tries candidate URLs in priority order; caches the first that contains the anchor.
 */
export async function fetchMainBundle(): Promise<string | null> {
  if (bundleCache) return bundleCache;
  if (bundleFetchInFlight) return bundleFetchInFlight;

  bundleFetchInFlight = (async () => {
    const urls = findBundleCandidateUrls();
    if (!urls.length) {
      if (shouldDebug()) console.log('[QPM Catalog] [AbilityColors] no bundle candidate URLs found');
      return null;
    }

    const fetchFn = typeof pageWindow.fetch === 'function'
      ? pageWindow.fetch.bind(pageWindow)
      : fetch;

    for (const url of urls) {
      try {
        const res = await fetchFn(url, { credentials: 'include' });
        if (!res.ok) {
          if (shouldDebug()) console.log('[QPM Catalog] [AbilityColors] bundle fetch failed', { status: res.status, url });
          continue;
        }
        const text = await res.text();
        if (!text || text.length < 1000) {
          if (shouldDebug()) console.log('[QPM Catalog] [AbilityColors] bundle text suspiciously small', { length: text?.length ?? 0, url });
          continue;
        }
        if (!text.includes(BUNDLE_CONTENT_ANCHOR)) {
          if (shouldDebug()) console.log('[QPM Catalog] [AbilityColors] bundle lacks anchor', { url, length: text.length });
          continue;
        }
        bundleCache = text;
        if (shouldDebug()) console.log('[QPM Catalog] [AbilityColors] bundle fetched', { url, length: text.length });
        return text;
      } catch {
        if (shouldDebug()) console.log('[QPM Catalog] [AbilityColors] bundle fetch threw', { url });
      }
    }

    return null;
  })().finally(() => {
    bundleFetchInFlight = null;
  });

  return bundleFetchInFlight;
}
