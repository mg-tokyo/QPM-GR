// Shared game-bundle fetch + text cache; consumers register/release holds so
// the multi-MB chunk texts are dropped once every consumer is done.

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
// A failed fetch is NOT a marker miss: a transient proxy/network error must not
// hide a chunk from every consumer for the session (2026-09-08 Firefox/Discord
// report: weather chunk never parsed while every other chunk fetched fine).
const bundleFetchFailures = new Map<string, number>();
const MAX_FETCH_FAILURES_PER_URL = 3;
const fetchStats = { attempted: 0, failed: 0, tooSmall: 0 };

export type BundleMarker = string | RegExp;

function markerKey(marker: BundleMarker): string {
  return typeof marker === 'string' ? `s:${marker}` : `r:${marker.source}`;
}

/**
 * How many candidate chunks have been fetched-and-rejected for a given marker.
 * Callers snapshot this before + after a fetchBundleContaining call to detect
 * whether real network work happened this attempt — used to gate retry budgets
 * so lazy-loaded chunks (that arrive only when their owning UI mounts) don't
 * burn attempts while nothing new is discoverable.
 */
export function getMarkerMissCount(marker: BundleMarker): number {
  return bundleMarkerMisses.get(markerKey(marker))?.size ?? 0;
}

/** Triage counters for QPM-CATALOG-003 context and supportReport. */
export function getBundleFetchStats(): {
  candidates: number; cached: number; attempted: number; failed: number; tooSmall: number; failedUrls: string[];
} {
  return {
    candidates: findBundleCandidateUrls().length,
    cached: bundleTextCache.size,
    attempted: fetchStats.attempted,
    failed: fetchStats.failed,
    tooSmall: fetchStats.tooSmall,
    failedUrls: Array.from(bundleFetchFailures.keys()).map((u) => u.split('/').pop() ?? u),
  };
}

// Pass non-global RegExp markers only — a global regex carries lastIndex state.
function markerHits(text: string, marker: BundleMarker): boolean {
  return typeof marker === 'string' ? text.includes(marker) : marker.test(text);
}

// Consumers that hold the shared text cache open. Once every declared consumer
// signals its final cache is populated, the multi-MB bundle text is released.
const pendingBundleConsumers = new Set<string>(['weather', 'ability-colors', 'mutation-colors']);

/** Late consumers (dex completeness merges) must register BEFORE fetching, or a
 * chunk they cache after the initial consumers finish is never released. */
export function registerBundleConsumer(name: string): void {
  pendingBundleConsumers.add(name);
}

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

// Default buffer is 250 entries; the game loads hundreds of sprites/audio, so a
// chunk that loads late drops out of getEntriesByType and is never a candidate.
let resourceBufferRaised = false;
export function ensureResourceTimingBuffer(): void {
  if (resourceBufferRaised) return;
  resourceBufferRaised = true;
  try { pageWindow.performance?.setResourceTimingBufferSize?.(2000); } catch { /* ignore */ }
}

function findBundleCandidateUrls(): string[] {
  ensureResourceTimingBuffer();
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
    fetchStats.attempted += 1;
    try {
      const res = await fetchFn(url, { credentials: 'include' });
      if (!res.ok) {
        fetchStats.failed += 1;
        log.debug('bundle: fetch failed', { status: res.status, url });
        return null;
      }
      const text = await res.text();
      if (!text || text.length < 1000) {
        fetchStats.tooSmall += 1;
        log.debug('bundle: text suspiciously small', { length: text?.length ?? 0, url });
        return null;
      }
      return text;
    } catch {
      fetchStats.failed += 1;
      log.debug('bundle: fetch threw', { url });
      return null;
    }
  })().finally(() => {
    bundleFetchInFlightByUrl.delete(url);
  });

  bundleFetchInFlightByUrl.set(url, promise);
  return promise;
}

async function iterateBundlesContaining(
  marker: BundleMarker,
  stopAtFirst: boolean,
): Promise<string[]> {
  const urls = findBundleCandidateUrls();
  if (!urls.length) return [];

  const key = markerKey(marker);
  let missed = bundleMarkerMisses.get(key);
  if (!missed) { missed = new Set<string>(); bundleMarkerMisses.set(key, missed); }

  const hits: string[] = [];
  for (const url of urls) {
    if (missed.has(url)) continue;
    const cached = bundleTextCache.get(url);
    if (!cached) continue;
    if (markerHits(cached, marker)) {
      hits.push(cached);
      if (stopAtFirst) return hits;
    } else {
      // A chunk another consumer cached and this marker already missed must
      // not be re-scanned (2.2 MB `includes` per poll tick, spec F4).
      missed.add(url);
    }
  }

  for (const url of urls) {
    if (bundleTextCache.has(url) || missed.has(url)) continue;
    if ((bundleFetchFailures.get(url) ?? 0) >= MAX_FETCH_FAILURES_PER_URL) continue;
    const text = await fetchBundleTextOnce(url);
    if (!text) {
      const failures = (bundleFetchFailures.get(url) ?? 0) + 1;
      bundleFetchFailures.set(url, failures);
      // Give-up on this URL still counts as fetch work for retry budgets.
      if (failures >= MAX_FETCH_FAILURES_PER_URL) missed.add(url);
      continue;
    }
    if (markerHits(text, marker)) {
      bundleTextCache.set(url, text);
      hits.push(text);
      if (stopAtFirst) return hits;
    } else {
      missed.add(url);
    }
  }
  return hits;
}

/**
 * Fetch (or reuse cached) candidate chunks and return the first whose text
 * contains the given marker. Candidates are re-collected on every call, so a
 * chunk that loads lazily after the first attempt is still found.
 */
export async function fetchBundleContaining(marker: BundleMarker): Promise<string | null> {
  const hits = await iterateBundlesContaining(marker, true);
  return hits[0] ?? null;
}

export async function fetchMainBundle(): Promise<string | null> {
  return fetchBundleContaining(BUNDLE_CONTENT_ANCHOR);
}

/**
 * Return every candidate chunk whose text contains the marker. Needed when
 * tokens of interest straddle chunks (e.g. action-type strings quoted in
 * main-*.js and appearing as bare property keys in a lazy styles chunk).
 */
export async function fetchAllBundlesContaining(marker: BundleMarker): Promise<string[]> {
  return iterateBundlesContaining(marker, false);
}

// Lazy chunks can appear minutes after boot; a bounded poll cannot wait for
// them without spinning (spec F4). Consumers that gave up subscribe here and
// get ONE retry per newly loaded script chunk, from resource timing — the
// same source findBundleCandidateUrls() already reads — with no interval.
const chunkListeners = new Set<() => void>();
const knownChunkUrls = new Set<string>();
let chunkObserver: PerformanceObserver | null = null;

export function onNewBundleChunk(cb: () => void): () => void {
  chunkListeners.add(cb);
  if (!chunkObserver) {
    for (const u of findBundleCandidateUrls()) knownChunkUrls.add(u);
    try {
      chunkObserver = new PerformanceObserver((list) => {
        let fresh = false;
        for (const e of list.getEntries()) {
          const name = e.name;
          // Only the game's own asset chunks — analytics, Discord SDK and
          // extension scripts are `.js` resources too and never carry a catalog.
          if (!GENERIC_ASSET_CHUNK_RE.test(name) || knownChunkUrls.has(name)) continue;
          knownChunkUrls.add(name);
          fresh = true;
        }
        if (!fresh) return;
        for (const l of Array.from(chunkListeners)) {
          try { l(); } catch { /* isolate */ }
        }
      });
      chunkObserver.observe({ entryTypes: ['resource'] });
    } catch { chunkObserver = null; }
  }
  return () => {
    chunkListeners.delete(cb);
    if (chunkListeners.size === 0 && chunkObserver) {
      try { chunkObserver.disconnect(); } catch { /* ignore */ }
      chunkObserver = null;
    }
  };
}
