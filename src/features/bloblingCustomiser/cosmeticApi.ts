import { pageWindow } from '../../core/pageContext';
import { getCosmeticOwnership } from '../../catalogs/gameCatalogs';
import { getCosmeticItemsSafe } from '../../utils/game/catalogHelpers';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';
import type { SlotType, CosmeticCatalogEntry } from './types';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:bloblingCustomiser';
const FEATURE_NAME = 'bloblingCustomiser';
const cosmeticLog = createNamedLogger(FEATURE_SUBSYSTEM);

function warnBlobling(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  cosmeticLog.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

export interface ClaimResult {
  ok: boolean;
  error?: string;
}

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

export function fetchOwnedCosmetics(): Set<string> {
  const existing = getCosmeticOwnership();
  return existing ? new Set(existing) : new Set();
}

export async function claimCosmetic(filename: string): Promise<ClaimResult> {
  const base = getRoomApiBase();
  if (!base) {
    warnBlobling('QPM-BLOBLING-005', { what: 'claim:no_room', filename });
    return { ok: false, error: 'Room not available' };
  }

  const fetchFn = typeof pageWindow.fetch === 'function'
    ? pageWindow.fetch.bind(pageWindow)
    : fetch;

  try {
    const res = await fetchFn(`${base}/me/cosmetics/claim/${encodeURIComponent(filename)}`, {
      method: 'POST',
      credentials: 'include',
    });

    if (res.ok) {
      cosmeticLog.info(`Claimed cosmetic: ${filename}`);
      return { ok: true };
    }

    const body = await res.text().catch(() => '');
    warnBlobling('QPM-BLOBLING-005', { what: 'claim:response', filename, status: res.status, body: body.slice(0, 200) });
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    warnBlobling('QPM-BLOBLING-005', { what: 'claim:exception', filename }, e);
    return { ok: false, error: 'Network error' };
  }
}

export function getCosmeticsBySlot(
  slotType: SlotType,
  owned: Set<string>,
): CosmeticCatalogEntry[] {
  const all = getCosmeticItemsSafe(slotType);
  const ownedItems: CosmeticCatalogEntry[] = [];
  const unownedItems: CosmeticCatalogEntry[] = [];

  for (const item of all) {
    if (owned.has(item.filename)) {
      ownedItems.push(item);
    } else {
      unownedItems.push(item);
    }
  }

  ownedItems.sort((a, b) => a.displayName.localeCompare(b.displayName));
  unownedItems.sort((a, b) => a.price - b.price || a.displayName.localeCompare(b.displayName));

  return [...ownedItems, ...unownedItems];
}

export function getCosmeticCdnUrl(filename: string): string {
  const scripts = document.querySelectorAll('script[src*="/assets/"]');
  for (const s of scripts) {
    const src = (s as HTMLScriptElement).src;
    const idx = src.indexOf('/assets/');
    if (idx !== -1) {
      return src.substring(0, idx) + '/assets/cosmetic/' + filename;
    }
  }
  return '/assets/cosmetic/' + filename;
}
