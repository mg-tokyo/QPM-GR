import { pageWindow } from '../../../core/pageContext';
import { createNamedLogger } from '../../../diagnostics/logger';
import { getInMemoryState, onStateChange } from './store';
import { findActiveSkin, type CustomSkinsState } from './types';

const log = createNamedLogger('feature:bloblingCustomiser');

const COSMETIC_PATH_RE = /\/assets\/cosmetic\/([^?#]+)/;

let originalFetch: typeof fetch | null = null;
let installed = false;
let unsubscribeStateChange: (() => void) | null = null;

/** filename → dataUrl. Rebuilt from state on every `qpm:blobling-custom-skins-updated`. */
let activeMap = new Map<string, string>();

function buildActiveMap(state: CustomSkinsState): Map<string, string> {
  const m = new Map<string, string>();
  for (const filename of Object.keys(state.active)) {
    const skin = findActiveSkin(state, filename);
    if (skin) m.set(filename, skin.dataUrl);
  }
  return m;
}

export function refreshActiveMap(): void {
  activeMap = buildActiveMap(getInMemoryState());
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

/**
 * One-shot notification gate: a corrupt dataUrl should notify once per
 * (filename, dataUrl) pair, not on every fetch (spec §5, decode-fail row).
 * Cleared when the interceptor is torn down.
 */
const decodeFailureWarned = new Set<string>();

async function dataUrlToResponse(
  filename: string,
  dataUrl: string,
  fallback: () => Promise<Response>,
): Promise<Response> {
  try {
    const r = await fetch(dataUrl);
    const blob = await r.blob();
    return new Response(blob, {
      status: 200,
      headers: { 'Content-Type': blob.type || 'image/png' },
    });
  } catch (e) {
    const key = `${filename}::${dataUrl.slice(0, 32)}`;
    if (!decodeFailureWarned.has(key)) {
      decodeFailureWarned.add(key);
      log.warn('QPM-BLOBLING-004', { feature: 'bloblingCustomiser', what: 'custom_skin:decode', filename }, e);
      try {
        // Dynamic import to avoid any potential init-order cycle with the
        // notifications hub — customSkins installs early in main.ts.
        const { notify } = await import('../../../core/notifications');
        notify({
          feature: 'bloblingCustomSkins',
          level: 'error',
          message: 'Custom skin failed to decode — vanilla cosmetic shown',
        });
      } catch { /* notifications unavailable — already logged */ }
    }
    return fallback();
  }
}

const interceptedFetch: typeof fetch = function (input, init) {
  const url = resolveUrl(input);
  const match = url.match(COSMETIC_PATH_RE);
  if (match && activeMap.size > 0) {
    const filename = match[1]!;
    const dataUrl = activeMap.get(filename);
    if (dataUrl) {
      return dataUrlToResponse(filename, dataUrl, () =>
        originalFetch!.call(pageWindow, input as RequestInfo, init),
      );
    }
  }
  return originalFetch!.call(pageWindow, input as RequestInfo, init);
};

/**
 * Install the cosmetic-URL fetch interceptor. Idempotent. Composes with any
 * other `pageWindow.fetch` wrapper via `originalFetch` chaining; if multiple
 * interceptors install they must tear down in reverse install order (LIFO)
 * or the saved `originalFetch` references go stale.
 */
export function initCustomSkinsInterceptor(): () => void {
  if (installed) return () => {};
  installed = true;

  originalFetch = (pageWindow as Record<string, unknown>).fetch as typeof fetch;
  (pageWindow as Record<string, unknown>).fetch = interceptedFetch;

  refreshActiveMap();
  unsubscribeStateChange = onStateChange(refreshActiveMap);

  log.debug('fetch interceptor installed');

  return () => {
    if (originalFetch) {
      (pageWindow as Record<string, unknown>).fetch = originalFetch;
      originalFetch = null;
    }
    if (unsubscribeStateChange) {
      unsubscribeStateChange();
      unsubscribeStateChange = null;
    }
    activeMap.clear();
    decodeFailureWarned.clear();
    installed = false;
    log.debug('fetch interceptor removed');
  };
}
