// src/catalogs/logic/bundleParser.ts
// Shared main-bundle parsing helpers (Gemini-style).

import { pageWindow, readSharedGlobal } from '../../core/pageContext';

// Ordered by priority: try main bundle first (prod), then split entry (v643+),
// then legacy code-split game chunks (beta ≤ PR 2768).
const BUNDLE_PATTERNS = [
  /main-[^/]+\.js(\?|$)/,
  /index-[^/]+\.js(\?|$)/,
  /QuinoaView-[^/]+\.js(\?|$)/,
  /ScrollableView-[^/]+\.js(\?|$)/,
];

const BUNDLE_CONTENT_ANCHOR = 'ProduceScaleBoost';

// Per-URL cache. Multiple callers may need different chunks — main-*.js still
// carries the ability dex and weather config in v643, but index-*.js holds the
// getAbilityColor switch. Keeping both cached lets each caller match the chunk
// that contains its own marker.
const bundleTextCache = new Map<string, string>();
const bundleFetchInFlightByUrl = new Map<string, Promise<void>>();

// Consumers that hold the shared text cache open. Once every declared consumer
// signals its final cache is populated, the multi-MB bundle text is released.
const pendingBundleConsumers = new Set<string>(['weather', 'ability-colors']);

export function markBundleConsumerDone(name: string): void {
  if (!pendingBundleConsumers.delete(name)) return;
  if (pendingBundleConsumers.size === 0) {
    bundleTextCache.clear();
  }
}

export function clearBundleTextCache(): void {
  bundleTextCache.clear();
}

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
 * Fetch one candidate URL if not already cached. Idempotent + safe to call
 * concurrently from multiple markers (dedupes per-URL in-flight promises).
 */
async function fetchOneBundle(url: string): Promise<void> {
  if (bundleTextCache.has(url)) return;
  const existing = bundleFetchInFlightByUrl.get(url);
  if (existing) return existing;

  const fetchFn = typeof pageWindow.fetch === 'function'
    ? pageWindow.fetch.bind(pageWindow)
    : fetch;

  const promise = (async () => {
    try {
      const res = await fetchFn(url, { credentials: 'include' });
      if (!res.ok) {
        if (shouldDebug()) console.log('[QPM Catalog] [Bundle] fetch failed', { status: res.status, url });
        return;
      }
      const text = await res.text();
      if (!text || text.length < 1000) {
        if (shouldDebug()) console.log('[QPM Catalog] [Bundle] text suspiciously small', { length: text?.length ?? 0, url });
        return;
      }
      bundleTextCache.set(url, text);
      if (shouldDebug()) console.log('[QPM Catalog] [Bundle] cached', { url, length: text.length });
    } catch {
      if (shouldDebug()) console.log('[QPM Catalog] [Bundle] fetch threw', { url });
    }
  })().finally(() => {
    bundleFetchInFlightByUrl.delete(url);
  });

  bundleFetchInFlightByUrl.set(url, promise);
  return promise;
}

/**
 * Fetch (or reuse cached) candidate bundles and return the first whose text
 * contains the given marker. Each caller supplies a marker unique to the
 * chunk that carries its data:
 *   - ability colors → '#228B22' (ProduceScaleBoost color, only in the color switch chunk)
 *   - weather        → default BUNDLE_CONTENT_ANCHOR (still in main-*.js)
 *
 * New candidate URLs are picked up on each call, so a chunk that loads lazily
 * after the first attempt is still found.
 */
export async function fetchBundleContaining(marker: string): Promise<string | null> {
  const urls = findBundleCandidateUrls();
  if (!urls.length) {
    if (shouldDebug()) console.log('[QPM Catalog] [Bundle] no bundle candidate URLs found');
    return null;
  }

  for (const url of urls) {
    if (bundleTextCache.has(url)) continue;
    await fetchOneBundle(url);
  }

  for (const url of urls) {
    const text = bundleTextCache.get(url);
    if (text && text.includes(marker)) {
      if (shouldDebug()) console.log('[QPM Catalog] [Bundle] matched marker', { marker, url });
      return text;
    }
  }

  if (shouldDebug()) console.log('[QPM Catalog] [Bundle] no cached bundle contains marker', { marker, tried: urls.length });
  return null;
}

/**
 * Backward-compat wrapper. Returns the first cached bundle containing the
 * default ProduceScaleBoost anchor — used by weather enrichment.
 */
export async function fetchMainBundle(): Promise<string | null> {
  return fetchBundleContaining(BUNDLE_CONTENT_ANCHOR);
}
