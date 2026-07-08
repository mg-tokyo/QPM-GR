// Same-origin hashed-asset discovery for game-vendored chunks
// (ktx2.worker-<hash>.js, libktx-<hash>.wasm, rive-<hash>.wasm, ...).
//
// Strategy A: match perf resource entries by filename.
// Strategy B: fetch a handful of already-loaded JS chunks and regex the text
// for asset paths. Both strategies avoid touching the game's decoder state —
// we only learn URLs.

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
};

const MAX_BUNDLE_SCAN_CHUNKS = 5;
const VERSION_ASSETS_RE = /\/version\/\d+\/assets\//i;
const MAIN_CHUNK_RE = /\/main-[\w.-]+\.js(?:\?|$)/i;

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
    matchFromResourceTimings(pending, hits);
    const stillPending = pending.filter((q) => !hits.has(q.key));
    if (stillPending.length > 0) {
      await matchFromBundleScan(stillPending, hits, opts?.chunkFilter);
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
  const chunkUrls = collectChunkCandidates(chunkFilter);
  let scanned = 0;
  for (const chunkUrl of chunkUrls) {
    if (scanned >= MAX_BUNDLE_SCAN_CHUNKS) break;
    const outstanding = queries.filter((q) => !hits.has(q.key));
    if (outstanding.length === 0) break;

    let text: string;
    try {
      const response = await fetch(chunkUrl, { cache: 'force-cache' });
      if (!response.ok) continue;
      text = await response.text();
    } catch {
      continue;
    }
    scanned++;

    for (const query of outstanding) {
      const found = extractAssetUrl(text, chunkUrl, query.filenamePattern);
      if (found) {
        hits.set(query.key, { key: query.key, url: found, strategy: 'bundle-scan' });
      }
    }
  }
}

function collectChunkCandidates(chunkFilter: RegExp | undefined): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const add = (raw: string | null | undefined): void => {
    if (!raw) return;
    const url = resolveUrl(raw, location.origin);
    if (!url) return;
    if (!VERSION_ASSETS_RE.test(url)) return;
    if (chunkFilter && !chunkFilter.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    ordered.push(url);
  };

  try {
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach((el) => add((el as HTMLScriptElement).src));
    const modulepreloads = document.querySelectorAll('link[rel="modulepreload"]');
    modulepreloads.forEach((el) => add((el as HTMLLinkElement).href));
  } catch {
    // DOM unavailable — resource entries below still work.
  }

  try {
    const entries = performance.getEntriesByType('resource');
    for (const entry of entries) {
      const url = entry.name;
      if (typeof url === 'string' && /\.js(?:\?|$)/i.test(url)) {
        add(url);
      }
    }
  } catch {
    // Ignore — DOM path already contributed.
  }

  ordered.sort((a, b) => {
    const aMain = MAIN_CHUNK_RE.test(a) ? 0 : 1;
    const bMain = MAIN_CHUNK_RE.test(b) ? 0 : 1;
    return aMain - bMain;
  });

  return ordered;
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
