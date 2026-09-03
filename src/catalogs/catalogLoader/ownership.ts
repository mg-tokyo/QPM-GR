// Cosmetic ownership (single fetch from /me/cosmetics API) + shared room-URL
// helper. Auth mirrors the game's own transport (JWT on Discord, cookies on
// web) via services/authFetch. Verified beta: src/utils/index.ts:29-55.

import { pageWindow } from '../../core/pageContext';
import { getDiscordSdk } from '../../core/discordSdk';
import { buildAuthHeaders, buildTimeoutSignal } from '../../services/authFetch';
import { catalogLog, cosmeticOwnership, publishCatalogs } from './state';

let cosmeticOwnershipFetchInFlight: Promise<void> | null = null;
let cachedDiscordInstanceId: string | null | undefined = undefined;

async function resolveDiscordInstanceId(): Promise<string | null> {
  if (cachedDiscordInstanceId !== undefined) return cachedDiscordInstanceId;
  try {
    const sdk = await getDiscordSdk();
    cachedDiscordInstanceId = sdk?.instanceId ?? null;
  } catch {
    cachedDiscordInstanceId = null;
  }
  return cachedDiscordInstanceId;
}

// SDK-first on Discord (matches game's getCurrentRoomId in src/utils/index.ts:29),
// URL fallback on web (/r/{roomCode}). Async because the SDK atom lookup is async.
export async function getRoomApiBase(): Promise<string | null> {
  try {
    const instanceId = await resolveDiscordInstanceId();
    if (instanceId) return `/api/rooms/${instanceId}`;
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

    if (typeof pageWindow.fetch !== 'function') return;
    const fetchFn = pageWindow.fetch.bind(pageWindow);
    const signal = buildTimeoutSignal(15_000);

    try {
      const res = await fetchFn(`${base}/me/cosmetics`, {
        credentials: 'include',
        headers: buildAuthHeaders(),
        ...(signal ? { signal } : {}),
      });
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
