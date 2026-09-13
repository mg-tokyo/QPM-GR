// Same-origin hashed-asset discovery for game-vendored chunks
// (ktx2.worker-<hash>.js, libktx-<hash>.wasm, rive-<hash>.wasm, ...).
//
// Strategy A: match perf resource entries by filename.
// Strategy B: delegate chunk enumeration + text fetch to bundleParser
// (every /version/N/assets/*.js in DOM + resource timing, text cache, per-
// marker miss cache, raised resource-timing buffer) and regex the chunk text
// for the asset URL. Both strategies avoid touching the game's decoder state —
// we only learn URLs.

import { ensureResourceTimingBuffer, fetchBundleHitContaining, onNewBundleChunk } from '../catalogs/logic/bundleParser';

export type GameAssetQuery = {
  key: string;
  filenamePattern: RegExp;
};

export type GameAssetHit = {
  key: string;
  url: string;
  strategy: 'resource-timing' | 'bundle-scan';
};

export type DiscoverOptions = {
  chunkFilter?: RegExp;
  // Upper bound for one wait on a not-yet-loaded chunk (0 disables). Game 1152
  // keeps the KTX2 loader in a lazy chunk.
  lateChunkWaitMs?: number;
};

const DEFAULT_LATE_CHUNK_WAIT_MS = 8000;

const sessionCache = new Map<string, GameAssetHit>();

export async function discoverGameAssets(
  queries: readonly GameAssetQuery[],
  opts?: DiscoverOptions,
): Promise<{ hits: Map<string, GameAssetHit>; ms: number }> {
  const start = performance.now();
  const hits = new Map<string, GameAssetHit>();

  const pending: GameAssetQuery[] = [];
  for (const query of queries) {
    const cached = sessionCache.get(query.key);
    if (cached) {
      hits.set(query.key, cached);
    } else {
      pending.push(query);
    }
  }

  if (pending.length > 0) {
    ensureResourceTimingBuffer();
    matchFromResourceTimings(pending, hits);
    let missing = pending.filter((q) => !hits.has(q.key));
    if (missing.length > 0) await matchFromBundleScan(missing, hits, opts?.chunkFilter);
    missing = missing.filter((q) => !hits.has(q.key));
    const waitMs = opts?.lateChunkWaitMs ?? DEFAULT_LATE_CHUNK_WAIT_MS;
    if (missing.length > 0 && waitMs > 0 && (await waitForNewChunk(waitMs))) {
      matchFromResourceTimings(missing, hits);
      await matchFromBundleScan(missing.filter((q) => !hits.has(q.key)), hits, opts?.chunkFilter);
    }
  }

  for (const [key, hit] of hits) {
    sessionCache.set(key, hit);
  }

  return { hits, ms: performance.now() - start };
}

function matchFromResourceTimings(
  queries: readonly GameAssetQuery[],
  hits: Map<string, GameAssetHit>,
): void {
  let entries: PerformanceEntry[];
  try {
    entries = performance.getEntriesByType('resource');
  } catch {
    return;
  }
  for (const entry of entries) {
    const url = entry.name;
    if (typeof url !== 'string') continue;
    for (const query of queries) {
      if (hits.has(query.key)) continue;
      if (query.filenamePattern.test(url)) {
        hits.set(query.key, { key: query.key, url, strategy: 'resource-timing' });
      }
    }
  }
}

async function matchFromBundleScan(
  queries: readonly GameAssetQuery[],
  hits: Map<string, GameAssetHit>,
  chunkFilter: RegExp | undefined,
): Promise<void> {
  for (const query of queries) {
    if (hits.has(query.key)) continue;
    const hit = await fetchBundleHitContaining(query.filenamePattern);
    if (!hit) continue;
    if (chunkFilter && !chunkFilter.test(hit.url)) continue;
    const found = extractAssetUrl(hit.text, hit.url, query.filenamePattern);
    if (found) hits.set(query.key, { key: query.key, url: found, strategy: 'bundle-scan' });
  }
}

// Resolves true when a new same-origin script chunk lands before `ms` elapses.
function waitForNewChunk(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let off: (() => void) | null = null;
    const finish = (value: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off?.();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), ms);
    off = onNewBundleChunk(() => finish(true));
  });
}

function resolveUrl(raw: string, base: string): string | null {
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function extractAssetUrl(text: string, chunkUrl: string, filenamePattern: RegExp): string | null {
  const filenameSource = stripAnchors(filenamePattern.source);
  const filenameFlags = filenamePattern.flags.includes('i') ? 'gi' : 'g';
  const absoluteRe = new RegExp(`\\/version\\/\\d+\\/assets\\/${filenameSource}`, filenameFlags);
  const absoluteMatch = absoluteRe.exec(text);
  if (absoluteMatch) {
    const resolved = resolveUrl(absoluteMatch[0], location.origin);
    if (resolved) return resolved;
  }

  const bareRe = new RegExp(filenameSource, filenameFlags);
  const bareMatch = bareRe.exec(text);
  if (bareMatch) {
    const resolved = resolveUrl(bareMatch[0], chunkUrl);
    if (resolved) return resolved;
  }

  return null;
}

function stripAnchors(source: string): string {
  return source.replace(/^\\b/, '').replace(/\\b$/, '');
}
