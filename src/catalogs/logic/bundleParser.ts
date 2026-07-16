// src/catalogs/logic/bundleParser.ts
// Shared main-bundle parsing helpers (Gemini-style).

import { pageWindow } from '../../core/pageContext';
import { createNamedLogger } from '../../diagnostics/logger';

const log = createNamedLogger('catalogs');

export {
  findAllIndices,
  extractBalancedBlock,
  extractBalancedArray,
  extractBalancedObjectLiteral,
  convertBacktickStrings,
} from './bundleTextParsing';

// Ordered by priority: try main bundle first (prod), then split entry (v643+),
// then legacy code-split game chunks (beta ≤ PR 2768).
const BUNDLE_PATTERNS = [
  /main-[^/]+\.js(\?|$)/,
  /index-[^/]+\.js(\?|$)/,
  /QuinoaView-[^/]+\.js(\?|$)/,
  /ScrollableView-[^/]+\.js(\?|$)/,
];

const BUNDLE_CONTENT_ANCHOR = 'ProduceScaleBoost';

// Only chunks whose text matched a marker are cached (markBundleConsumerDone
// releases them once every consumer finishes). Non-matching chunk texts are
// dropped immediately; the per-marker miss memo prevents refetch loops during
// the enrichment retry polling.
const bundleTextCache = new Map<string, string>();
const bundleFetchInFlightByUrl = new Map<string, Promise<string | null>>();
const bundleMarkerMisses = new Map<string, Set<string>>();

type BundleMarker = string | RegExp;

function markerKey(marker: BundleMarker): string {
  return typeof marker === 'string' ? `s:${marker}` : `r:${marker.source}`;
}

// Pass non-global RegExp markers only — a global regex carries lastIndex state.
function markerHits(text: string, marker: BundleMarker): boolean {
  return typeof marker === 'string' ? text.includes(marker) : marker.test(text);
}

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

// Any same-origin versioned asset chunk. The game (Rolldown, v679+) renames
// the chunk carrying a given data blueprint on nearly every build, so name
// patterns alone cannot find it — BUNDLE_PATTERNS now only provides fetch
// PRIORITY (main/index first), with every other loaded chunk as fallback.
const GENERIC_ASSET_CHUNK_RE = /\/version\/[^/]+\/assets\/[^/]+\.js(\?|$)/;

function findBundleCandidateUrls(): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const addUrl = (src: string): void => {
    if (src && !seen.has(src)) {
      seen.add(src);
      urls.push(src);
    }
  };

  const collectMatching = (pattern: RegExp): void => {
    try {
      for (const script of pageWindow.document?.scripts || []) {
        const src = script?.src ? String(script.src) : '';
        if (pattern.test(src)) addUrl(src);
      }
    } catch {
      // Ignore.
    }

    try {
      const links = pageWindow.document?.querySelectorAll?.('link[rel="modulepreload"]');
      if (links) {
        for (const link of Array.from(links)) {
          const href = (link as HTMLLinkElement).href || '';
          if (pattern.test(href)) addUrl(href);
        }
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
  };

  for (const pattern of BUNDLE_PATTERNS) {
    collectMatching(pattern);
  }
  collectMatching(GENERIC_ASSET_CHUNK_RE);

  return urls;
}

/**
 * Find main bundle URL from scripts or performance entries.
 */
export function findMainBundleUrl(): string | null {
  return findBundleCandidateUrls()[0] ?? null;
}

async function fetchBundleTextOnce(url: string): Promise<string | null> {
  const existing = bundleFetchInFlightByUrl.get(url);
  if (existing) return existing;

  const fetchFn = typeof pageWindow.fetch === 'function'
    ? pageWindow.fetch.bind(pageWindow)
    : fetch;

  const promise = (async (): Promise<string | null> => {
    try {
      const res = await fetchFn(url, { credentials: 'include' });
      if (!res.ok) {
        log.debug('bundle: fetch failed', { status: res.status, url });
        return null;
      }
      const text = await res.text();
      if (!text || text.length < 1000) {
        log.debug('bundle: text suspiciously small', { length: text?.length ?? 0, url });
        return null;
      }
      return text;
    } catch {
      log.debug('bundle: fetch threw', { url });
      return null;
    }
  })().finally(() => {
    bundleFetchInFlightByUrl.delete(url);
  });

  bundleFetchInFlightByUrl.set(url, promise);
  return promise;
}

/**
 * Fetch (or reuse cached) candidate chunks and return the first whose text
 * contains the given marker. Candidates are re-collected on every call, so a
 * chunk that loads lazily after the first attempt is still found.
 */
export async function fetchBundleContaining(marker: BundleMarker): Promise<string | null> {
  const urls = findBundleCandidateUrls();
  if (!urls.length) {
    log.debug('bundle: no candidate URLs found');
    return null;
  }

  for (const url of urls) {
    const cached = bundleTextCache.get(url);
    if (cached && markerHits(cached, marker)) {
      log.debug('bundle: matched marker (cached)', { marker: String(marker), url });
      return cached;
    }
  }

  const key = markerKey(marker);
  let missed = bundleMarkerMisses.get(key);
  if (!missed) {
    missed = new Set<string>();
    bundleMarkerMisses.set(key, missed);
  }

  for (const url of urls) {
    if (bundleTextCache.has(url) || missed.has(url)) continue;
    const text = await fetchBundleTextOnce(url);
    if (!text) {
      missed.add(url);
      continue;
    }
    if (markerHits(text, marker)) {
      bundleTextCache.set(url, text);
      log.debug('bundle: matched marker', { marker: String(marker), url });
      return text;
    }
    missed.add(url);
  }

  log.debug('bundle: no chunk contains marker', { marker: String(marker), tried: urls.length });
  return null;
}

/**
 * Backward-compat wrapper. Returns the first cached bundle containing the
 * default ProduceScaleBoost anchor — used by weather enrichment.
 */
export async function fetchMainBundle(): Promise<string | null> {
  return fetchBundleContaining(BUNDLE_CONTENT_ANCHOR);
}
