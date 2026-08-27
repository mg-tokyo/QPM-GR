// Account info from the room-scoped `/me` endpoint (same-origin cookie auth, like /me/cosmetics).
// Only `createdAt` and `creationSurface` are kept — the account id is never retained.

import { pageWindow } from '../core/pageContext';
import { getRoomApiBase } from '../catalogs/catalogLoader/ownership';

export interface GameAccountInfo {
  /** ms epoch; null when the API omits or cannot parse it */
  createdAt: number | null;
  creationSurface: string | null;
}

let cached: GameAccountInfo | null = null;
let inFlight: Promise<GameAccountInfo | null> | null = null;

export function getGameAccountInfo(): GameAccountInfo | null {
  return cached;
}

export async function fetchGameAccountInfo(): Promise<GameAccountInfo | null> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const base = getRoomApiBase();
    if (!base) return null;
    // Same-origin cookie auth needs the page realm's fetch (as /me/cosmetics does); no bare-global fallback.
    if (typeof pageWindow.fetch !== 'function') return null;
    const fetchFn = pageWindow.fetch.bind(pageWindow);
    try {
      const res = await fetchFn(`${base}/me`, { credentials: 'include' });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      if (!data || typeof data !== 'object') return null;
      const rec = data as Record<string, unknown>;
      const createdAt = typeof rec.createdAt === 'string' ? Date.parse(rec.createdAt) : Number.NaN;
      cached = {
        createdAt: Number.isFinite(createdAt) ? createdAt : null,
        creationSurface: typeof rec.creationSurface === 'string' ? rec.creationSurface : null,
      };
      return cached;
    } catch {
      return null;
    }
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function resetGameAccountInfo(): void {
  cached = null;
}
