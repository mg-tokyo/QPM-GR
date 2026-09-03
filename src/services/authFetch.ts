// Auth helpers for the game's room-scoped `/me/*` endpoints.
// Discord surface auths via JWT header (localStorage 'jwt'); web via cookies.
// Attaching both lets one code path cover every browser + surface without
// detecting which. Verified beta: common/authStorage.ts:11 (literal 'jwt'),
// common/Environment.ts:22 (EXPLICIT_JWT_AUTH_SURFACES = ['discord','jest']).

import { pageWindow } from '../core/pageContext';

export function buildAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const jwt = pageWindow.localStorage?.getItem('jwt');
    if (typeof jwt === 'string' && jwt.length > 0) {
      headers['Authorization'] = `Bearer ${jwt}`;
    }
  } catch {
    // Sandboxed contexts can throw on localStorage access.
  }
  return headers;
}

/**
 * Same-origin authed GET: cookies + JWT header. A 401/403 with the JWT attached
 * retries once cookie-only — a stale localStorage 'jwt' on the web surface must
 * not mask valid cookie auth. Returns null when the page realm has no fetch.
 */
export async function fetchAuthed(url: string, timeoutMs = 15_000): Promise<Response | null> {
  if (typeof pageWindow.fetch !== 'function') return null;
  const fetchFn = pageWindow.fetch.bind(pageWindow);
  const headers = buildAuthHeaders();
  const signal = buildTimeoutSignal(timeoutMs);
  const res = await fetchFn(url, { credentials: 'include', headers, ...(signal ? { signal } : {}) });
  if ((res.status === 401 || res.status === 403) && headers['Authorization']) {
    const retrySignal = buildTimeoutSignal(timeoutMs);
    return fetchFn(url, { credentials: 'include', ...(retrySignal ? { signal: retrySignal } : {}) });
  }
  return res;
}

export function buildTimeoutSignal(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      setTimeout(() => { try { controller.abort(); } catch { /* ignore */ } }, ms);
      return controller.signal;
    }
  } catch {
    // Older engines without either — proceed unbounded.
  }
  return undefined;
}
