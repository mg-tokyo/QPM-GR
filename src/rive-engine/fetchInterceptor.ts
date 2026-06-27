// src/rive-engine/fetchInterceptor.ts
//
// Wraps pageWindow.fetch to:
//   1. Apply getFileOverride() — replace .riv bytes with override when a
//      setFileOverride() match exists for the request URL.
//   2. Fingerprint the bytes Rive ends up loading so the load wrapper can
//      reverse-lookup the URL when rive.load(bytes) is called later.
//
// The fingerprint approach is necessary because Response.arrayBuffer() does
// not preserve ArrayBuffer reference identity through a fresh `new Response()`
// — so we can't use the buffer as a Map key. The fingerprint
// (length + first 16 bytes + last 16 bytes hex) is good enough to distinguish
// real-world .riv bundles, which are large and structurally distinct.
//
// Chaining: this wrapper records the fetch reference at install time, so it
// composes with other fetch hooks (e.g. textureSwapper) as long as one isn't
// torndown out of order. Both interceptors filter on URL pattern and don't
// overlap (.riv vs /assets/cosmetic/).
//
// Co-existing with textureSwapper: textureSwapper's hook lives in
// src/features/standalone/textureSwapper/rive.ts and intercepts cosmetic
// image URLs only. The two hooks chain through originalFetch; install order
// doesn't matter for correctness.

import { pageWindow } from '../core/pageContext';
import { riveLog } from './helpers';
import { getFileOverride } from './fileOverrides';

let originalFetch: typeof fetch | null = null;
let installed = false;

const fingerprintToUrl = new Map<string, string>();
// Diagnostic: capture the JS stack at fetch time for each .riv URL so we can
// see WHICH game module is requesting the bundle. The actual rive.load call
// happens elsewhere, but the fetch is initiated from the loader code path.
const fetchStacksByUrl = new Map<string, string>();
let captureFetchStacks = false;

export function setCaptureFetchStacks(enabled: boolean): void {
  captureFetchStacks = enabled;
}

export function getFetchStacks(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [url, stack] of fetchStacksByUrl) out[url] = stack;
  return out;
}

const RIV_URL_RE = /\.riv(?:\?|#|$)/i;

function isRivUrl(url: string): boolean {
  return RIV_URL_RE.test(url);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

function fingerprint(bytes: Uint8Array): string {
  const len = bytes.byteLength;
  if (len === 0) return '0::';
  const headEnd = Math.min(16, len);
  const tailStart = Math.max(headEnd, len - 16);
  const head = toHex(bytes.subarray(0, headEnd));
  const tail = toHex(bytes.subarray(tailStart, len));
  return `${len}:${head}:${tail}`;
}

function recordBytes(bytes: Uint8Array, url: string): void {
  fingerprintToUrl.set(fingerprint(bytes), url);
}

/**
 * Reverse-lookup the .riv URL that produced the given bytes.
 * Returns null when the bytes were never seen by the fetch interceptor
 * (e.g. the .riv was fetched before the engine initialized, or the game
 * synthesized the bytes locally).
 */
export function findUrlForBytes(bytes: Uint8Array): string | null {
  return fingerprintToUrl.get(fingerprint(bytes)) ?? null;
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

const interceptedFetch: typeof fetch = function (input, init) {
  const url = resolveUrl(input);
  if (!isRivUrl(url)) {
    return originalFetch!.call(pageWindow, input as RequestInfo, init);
  }

  if (captureFetchStacks && !fetchStacksByUrl.has(url)) {
    try {
      fetchStacksByUrl.set(url, new Error('.riv fetch').stack ?? '<no stack>');
    } catch { /* stack capture is best-effort */ }
  }

  const override = getFileOverride(url);
  if (override) {
    recordBytes(override, url);
    riveLog(`File override served: ${url} (${override.byteLength} bytes)`);
    // Cast: Uint8Array<ArrayBufferLike> isn't directly assignable to BodyInit
    // in newer lib.dom types — Response accepts it at runtime.
    return Promise.resolve(new Response(override as unknown as BodyInit, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    }));
  }

  // Pass-through; tap the cloned response to fingerprint bytes for later
  // URL lookup in the load wrapper. Failure to fingerprint is non-fatal —
  // override lookups for this URL would just no-op.
  return originalFetch!.call(pageWindow, input as RequestInfo, init).then(async (response) => {
    try {
      const cloned = response.clone();
      const buf = await cloned.arrayBuffer();
      recordBytes(new Uint8Array(buf), url);
    } catch (e) {
      riveLog('Failed to fingerprint .riv response', e);
    }
    return response;
  });
};

/**
 * Install the fetch hook. Idempotent: calling twice returns a no-op cleanup
 * for the second call. The returned cleanup restores the previous fetch
 * reference.
 */
export function initRivFetchInterceptor(): () => void {
  if (installed) return () => {};
  installed = true;

  originalFetch = (pageWindow as Record<string, unknown>).fetch as typeof fetch;
  (pageWindow as Record<string, unknown>).fetch = interceptedFetch;
  riveLog('.riv fetch interceptor installed');

  return () => {
    if (originalFetch) {
      (pageWindow as Record<string, unknown>).fetch = originalFetch;
      originalFetch = null;
    }
    fingerprintToUrl.clear();
    installed = false;
    riveLog('.riv fetch interceptor removed');
  };
}

/**
 * Diagnostic: list every URL → fingerprint pair the interceptor has seen.
 * Used by debug tooling so a developer can confirm a particular .riv has
 * been observed (and therefore is eligible for asset interception).
 */
export function listSeenRivUrls(): string[] {
  return Array.from(fingerprintToUrl.values());
}
