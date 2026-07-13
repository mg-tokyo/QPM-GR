// Cosmetic ownership (single fetch from /me/cosmetics API)

import { pageWindow } from '../../core/pageContext';
import { catalogLog, cosmeticOwnership, publishCatalogs } from './state';

let cosmeticOwnershipFetchInFlight: Promise<void> | null = null;

function getRoomApiBase(): string | null {
  try {
    const pathname = pageWindow.location?.pathname ?? '';
    const segments = pathname.split('/').filter(Boolean);
    const roomCode = segments[segments.length - 1];
    if (!roomCode) return null;
    return `/api/rooms/${roomCode}`;
  } catch {
    return null;
  }
}

export async function fetchCosmeticOwnership(): Promise<void> {
  if (cosmeticOwnership.set) return;
  if (cosmeticOwnershipFetchInFlight) return cosmeticOwnershipFetchInFlight;

  cosmeticOwnershipFetchInFlight = (async () => {
    const base = getRoomApiBase();
    if (!base) return;

    const fetchFn = typeof pageWindow.fetch === 'function'
      ? pageWindow.fetch.bind(pageWindow)
      : fetch;

    try {
      const res = await fetchFn(`${base}/me/cosmetics`, { credentials: 'include' });
      if (!res.ok) return;

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
    } catch {
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
