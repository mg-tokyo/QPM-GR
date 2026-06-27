// src/diagnostics/gameVersionCapture.ts — capture the live game's build identifier
// for the Copy-for-Discord payload (§8.3).
//
// Strategy: parse the build identifier from any asset URL served under
// `/version/{build}/...`, because the game logs no console line that carries
// the build directly. (An earlier console.log("Magic Circle: Version: NNN")
// hook is what the design originally proposed; the game never emits that
// string, which is why the previous capture always returned null.)
//
// Fallback chain (most → least reliable):
//
//   1. Performance API resource entries — what the browser actually loaded.
//   2. DOM <script src> / <link href> scan — works if the Performance API
//      buffer was cleared or the runtime never populated it.
//   3. Raw path segment after `/version/` — when our regex would have matched
//      but the build segment contains odd characters, return whatever is there
//      anyway. Wrapped as `(unparsed: …)` so the maintainer can spot it.
//   4. First asset URL we can see — last resort so the Copy payload never
//      reports "(not captured)" when ANY asset has loaded. Also `(unparsed:)`.
//
// Cached only after a clean (step 1–3) hit. The raw step-4 fallback is
// recomputed on every call so a later page-load can be picked up.

let captured: string | null = null;

const VERSION_PATH_RE = /\/version\/([^/?#]+)/;

function findCleanBuild(urls: readonly string[]): string | null {
  for (const url of urls) {
    const m = url.match(VERSION_PATH_RE);
    if (m && m[1]) return m[1];
  }
  return null;
}

function collectResourceUrls(): string[] {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return [];
  try {
    const entries = performance.getEntriesByType('resource');
    const urls: string[] = [];
    for (const entry of entries) {
      if (entry.name) urls.push(entry.name);
    }
    return urls;
  } catch {
    return [];
  }
}

function collectDomUrls(): string[] {
  if (typeof document === 'undefined') return [];
  const urls: string[] = [];
  try {
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach((el) => {
      const src = (el as HTMLScriptElement).src;
      if (src) urls.push(src);
    });
    const links = document.querySelectorAll('link[href]');
    links.forEach((el) => {
      const href = (el as HTMLLinkElement).href;
      if (href) urls.push(href);
    });
  } catch {
    // querySelectorAll can throw under exotic CSP / sandbox conditions; swallow.
  }
  return urls;
}

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Try steps 1–3 of the fallback chain. Returns a string if anything under
 * `/version/...` could be identified (clean OR raw), null otherwise.
 */
function attemptCleanCapture(): string | null {
  const resourceUrls = collectResourceUrls();
  const domUrls = collectDomUrls();

  // 1 + 2: extract clean build from any URL matching /version/(...)
  const build = findCleanBuild(resourceUrls) ?? findCleanBuild(domUrls);
  if (build) return build;

  // 3: raw fallback — there's a /version/ URL but our regex didn't extract a
  // clean segment (very unlikely given how permissive it is). Surface whatever
  // sits after `/version/` so the maintainer can decode it manually.
  const versionUrl = resourceUrls.find((u) => u.includes('/version/')) ?? domUrls.find((u) => u.includes('/version/'));
  if (versionUrl) {
    const idx = versionUrl.indexOf('/version/');
    const tail = versionUrl.slice(idx + '/version/'.length);
    if (tail) return `(unparsed: ${truncate(tail)})`;
  }

  return null;
}

/**
 * Step 4 — last-resort fallback: any asset URL we can see. Never cached so a
 * later page-load can still be picked up.
 */
function lastResortCapture(): string | null {
  const first = collectResourceUrls()[0] ?? collectDomUrls()[0];
  return first ? `(unparsed: ${truncate(first)})` : null;
}

/**
 * Eager capture attempt called from init.ts. Best-effort — if assets haven't
 * loaded yet, getCapturedGameVersion() will retry lazily on first call.
 */
export function startGameVersionCapture(): void {
  if (captured !== null) return;
  captured = attemptCleanCapture();
}

/**
 * Returns the captured build identifier, or null if nothing at all could be
 * identified (extremely unlikely once any asset has loaded). The Copy payload
 * formats null as "(not captured)".
 */
export function getCapturedGameVersion(): string | null {
  if (captured === null) captured = attemptCleanCapture();
  return captured ?? lastResortCapture();
}
