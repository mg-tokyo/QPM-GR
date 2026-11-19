// The game's bag slot limit as a catalog part (ALR-7.3b). Null until parsed; consumers skip the
// bag check on null and never fall back to a literal (ALR-7 D2, PD2).

import { createBundlePartSource } from './bundlePartSource';
import type { BundlePartStatus } from './bundlePartSource';
import { BAG_LIMIT_MARKER, parseBagLimit } from './bagLimitParsing';

export interface BagLimitStatus extends BundlePartStatus {
  limit: number | null;
}

const source = createBundlePartSource('bag-limit', BAG_LIMIT_MARKER, parseBagLimit);

export function startBagLimitSource(): void {
  source.start();
}

export function stopBagLimitSource(): void {
  source.stop();
}

export function getBagLimit(): number | null {
  return source.get();
}

export function getBagLimitStatus(): BagLimitStatus {
  return { ...source.status(), limit: source.get() };
}
