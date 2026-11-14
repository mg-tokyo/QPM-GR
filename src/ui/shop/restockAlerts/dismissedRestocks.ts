// Dismissals keyed by the shop's restockId outlive a reload; counter-based cycle ids do not
// (they restart at 0 on every load, which is why v1 suppressed the wrong cycles).

import { storage } from '../../../utils/storage';
import { DISMISSED_RESTOCKS_KEY } from './types';

const RESTOCK_CYCLE_PREFIX = 'rid:';

export interface DismissedRestock {
  restockId: string;
  shop: string;
}

export function restockCycleId(restockId: string): string {
  return `${RESTOCK_CYCLE_PREFIX}${restockId}`;
}

export function restockIdFromCycle(cycleId: string): string | null {
  if (!cycleId.startsWith(RESTOCK_CYCLE_PREFIX)) return null;
  return cycleId.slice(RESTOCK_CYCLE_PREFIX.length) || null;
}

export function readDismissedRestocks(): Map<string, DismissedRestock> {
  const out = new Map<string, DismissedRestock>();
  const raw = storage.get<unknown>(DISMISSED_RESTOCKS_KEY, null);
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const { restockId, shop } = value as Record<string, unknown>;
    if (typeof restockId === 'string' && restockId && typeof shop === 'string' && shop) {
      out.set(key, { restockId, shop });
    }
  }
  return out;
}

export function writeDismissedRestocks(entries: ReadonlyMap<string, DismissedRestock>): void {
  if (entries.size === 0) {
    storage.remove(DISMISSED_RESTOCKS_KEY);
    return;
  }
  storage.set(DISMISSED_RESTOCKS_KEY, Object.fromEntries(entries));
}

/** Keys whose shop now sells another cycle. A shop with no current id (weather shop between events) keeps its entries. */
export function findStaleDismissals(
  entries: ReadonlyMap<string, DismissedRestock>,
  currentRestockByShop: ReadonlyMap<string, string | null>,
): string[] {
  const stale: string[] = [];
  for (const [key, entry] of entries) {
    const current = currentRestockByShop.get(entry.shop);
    if (typeof current === 'string' && current !== entry.restockId) stale.push(key);
  }
  return stale;
}
