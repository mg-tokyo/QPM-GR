// Account info from the room-scoped `/me` endpoint.
// Auth via services/authFetch (JWT header + cookies). Verified beta:
// src/utils/index.ts:82, common/Environment.ts:22.

import { pageWindow } from '../core/pageContext';
import { getRoomApiBase } from '../catalogs/catalogLoader/ownership';
import { buildAuthHeaders, buildTimeoutSignal } from './authFetch';

export interface GameAccountInfo {
  /** ms epoch; null when the API omits or cannot parse it */
  createdAt: number | null;
  creationSurface: string | null;
}

let cached: GameAccountInfo | null = null;
let inFlight: Promise<GameAccountInfo | null> | null = null;
let lastError: string | null = null;

export function getGameAccountInfo(): GameAccountInfo | null {
  return cached;
}

/** Last fetch failure reason (for tracker banner + console diagnostics). */
export function getGameAccountLastError(): string | null {
  return lastError;
}

// The server may send createdAt as an ISO string OR a ms number.
function parseCreatedAt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function fetchGameAccountInfo(): Promise<GameAccountInfo | null> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const base = await getRoomApiBase();
    if (!base) {
      lastError = 'no room base';
      return null;
    }
    if (typeof pageWindow.fetch !== 'function') {
      lastError = 'no page fetch';
      return null;
    }
    const fetchFn = pageWindow.fetch.bind(pageWindow);
    const signal = buildTimeoutSignal(15_000);
    try {
      const res = await fetchFn(`${base}/me`, {
        credentials: 'include',
        headers: buildAuthHeaders(),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        console.warn(`[QPM] gameAccount /me → HTTP ${res.status}`);
        return null;
      }
      const data: unknown = await res.json();
      if (!data || typeof data !== 'object') {
        lastError = 'non-object body';
        return null;
      }
      const rec = data as Record<string, unknown>;
      cached = {
        createdAt: parseCreatedAt(rec.createdAt),
        creationSurface: typeof rec.creationSurface === 'string' ? rec.creationSurface : null,
      };
      lastError = null;
      return cached;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn('[QPM] gameAccount /me failed:', lastError);
      return null;
    }
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function resetGameAccountInfo(): void {
  cached = null;
  lastError = null;
}
