// Cosmetic ownership (single fetch from /me/cosmetics API) + shared room-URL
// helper. Auth mirrors the game's own transport (JWT on Discord, cookies on
// web) via services/authFetch. Verified beta: src/utils/index.ts:29-55.

import { pageWindow } from '../../core/pageContext';
import { getRoomConnection } from '../../websocket/api';
import { fetchAuthed } from '../../services/authFetch';
import { catalogLog, cosmeticOwnership, publishCatalogs } from './state';

let cosmeticOwnershipFetchInFlight: Promise<void> | null = null;

function isDiscordSurface(): boolean {
  try {
    return (pageWindow.location?.hostname ?? '').endsWith('discordsays.com');
  } catch {
    return false;
  }
}

/**
 * The WS connect URL is the game's own `origin + BASE_URL + /api/rooms/<roomId>`
 * (beta src/utils/index.ts:54), already routed through the Discord activity
 * proxy on that surface — the only base proven correct everywhere. The
 * `/version/<v>` prefix it carries is required there; the SDK/pathname
 * fallbacks below build a bare `/api/...` path (verified on web only).
 */
function roomApiBaseFromSocket(): string | null {
  try {
    const rc = getRoomConnection();
    const ws = rc?.ws ?? rc?.socket ?? rc?.currentWebSocket ?? null;
    const rawUrl = ws?.url;
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) return null;
    const parsed = new URL(rawUrl);
    const m = /^(.*\/api\/rooms\/[^/]+)\/connect$/.exec(parsed.pathname);
    if (!m) return null;
    const proto = parsed.protocol === 'ws:' ? 'http:' : 'https:';
    return `${proto}//${parsed.host}${m[1]}`;
  } catch {
    return null;
  }
}

// Socket URL first; on Discord it is the ONLY trusted base (a bare `/api/...`
// path is unproven through the activity proxy, and a failed fetch costs the
// caller a 5-min retry throttle — waiting seconds for the socket is cheaper).
// Web falls back to the page URL (/r/{roomCode}); bare paths are verified there.
export async function getRoomApiBase(): Promise<string | null> {
  try {
    const fromSocket = roomApiBaseFromSocket();
    if (fromSocket) return fromSocket;
    if (isDiscordSurface()) return null;
    const pathname = pageWindow.location?.pathname ?? '';
    const segments = pathname.split('/').filter(Boolean);
    const roomCode = segments[segments.length - 1];
    return roomCode ? `/api/rooms/${roomCode}` : null;
  } catch {
    return null;
  }
}

export async function fetchCosmeticOwnership(): Promise<void> {
  if (cosmeticOwnership.set) return;
  if (cosmeticOwnershipFetchInFlight) return cosmeticOwnershipFetchInFlight;

  cosmeticOwnershipFetchInFlight = (async () => {
    const base = await getRoomApiBase();
    if (!base) return;

    try {
      const res = await fetchAuthed(`${base}/me/cosmetics`);
      if (!res) return;
      if (!res.ok) {
        console.warn(`[QPM] cosmeticOwnership /me/cosmetics → HTTP ${res.status}`);
        return;
      }

      const data: unknown = await res.json();
      if (!Array.isArray(data)) return;

      const filenames = new Set<string>();
      for (const item of data) {
        if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).cosmeticFilename === 'string') {
          filenames.add((item as Record<string, unknown>).cosmeticFilename as string);
        }
      }

      cosmeticOwnership.set = filenames;
      catalogLog(`Fetched cosmetic ownership: ${filenames.size} items acquired.`);
      publishCatalogs();
    } catch (err) {
      console.warn('[QPM] cosmeticOwnership /me/cosmetics failed:', err);
      catalogLog('Failed to fetch cosmetic ownership.');
    }
  })().finally(() => {
    cosmeticOwnershipFetchInFlight = null;
  });

  return cosmeticOwnershipFetchInFlight;
}

export function getCosmeticOwnership(): Set<string> | null {
  return cosmeticOwnership.set;
}

export function isCosmeticOwned(filename: string): boolean | null {
  if (!cosmeticOwnership.set) return null;
  return cosmeticOwnership.set.has(filename);
}

export function isCosmeticAvailable(filename: string, availability: string): boolean | null {
  if (availability === 'default' || availability === 'authenticated') return true;
  return isCosmeticOwned(filename);
}
