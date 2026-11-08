import { getPurchaseBucket, getShopStockState, isCategoryGated } from '../../../store/shopStock';
import { getKnownShopIds } from '../../../store/shopRegistry';
import { getAtomKeyForCategory } from '../../../store/shopStockParsers';
import { describeBucketCycle, getShopCycle, type BucketCycleClass } from '../../../store/shopPurchaseCycle';
import { getServerNowMs } from '../../../store/serverClock';
import type { ShopCategorySnapshot, ShopPurchaseBucket } from '../../../types/gameAtoms';

export interface CycleViewEntry {
  restockId: string | null;
  startedAtMs: number | null;
  deadlineMs: number | null;
  serverNowMs: number | null;
  gated: boolean;
  bucketRestockId: string | null;
  classification: BucketCycleClass;
  available: number;
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function buildCycleEntry(
  snapshot: ShopCategorySnapshot | null,
  bucket: ShopPurchaseBucket | null,
  gated: boolean,
  available: number,
  serverNowMs: number | null,
): CycleViewEntry {
  const cycle = getShopCycle(snapshot);
  return {
    restockId: cycle?.restockId ?? null,
    startedAtMs: finite(snapshot?.startedAtMs),
    deadlineMs: finite(snapshot?.deadlineMs),
    serverNowMs,
    gated,
    bucketRestockId: typeof bucket?.restockId === 'string' ? bucket.restockId : null,
    classification: describeBucketCycle(bucket, cycle),
    available,
  };
}

// Keyed by the game's shop id (`egg`), the same id the `shops` snapshot, the purchase buckets and
// alert `shopType` use. `gated` is the gate the store applied at its last rebuild.
export function readCycleView(): Record<string, CycleViewEntry> {
  const { categories } = getShopStockState();
  const serverNowMs = getServerNowMs();
  const view: Record<string, CycleViewEntry> = {};
  for (const category of getKnownShopIds()) {
    const cat = categories[category];
    view[getAtomKeyForCategory(category)] = buildCycleEntry(
      cat?.raw ?? null,
      getPurchaseBucket(category),
      isCategoryGated(category),
      cat?.availableCount ?? 0,
      serverNowMs,
    );
  }
  return view;
}

export function summarizeCycles(view: Record<string, CycleViewEntry>, shopKeys: Iterable<string>): string[] {
  const out: string[] = [];
  for (const key of new Set(shopKeys)) {
    const entry = view[key];
    if (entry) out.push(`${key}:${entry.classification}${entry.gated ? ':gated' : ''}`);
  }
  return out.sort();
}
