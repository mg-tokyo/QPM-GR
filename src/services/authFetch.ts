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
