// The game's patch → rare crop table as a catalog part (ALR-16.2). Null until parsed; consumers
// treat null as "no rare pairs known" (ALR-16 spec §3), never fall back to a literal.

import { createBundlePartSource } from './bundlePartSource';
import type { BundlePartStatus } from './bundlePartSource';
import { RARE_PATCH_PAIRS_MARKER, parseRarePatchPairs } from './rarePatchPairsParsing';
import type { RarePatchPair } from './rarePatchPairsParsing';

export type { RarePatchPair } from './rarePatchPairsParsing';

export interface RarePatchPairsDrift extends BundlePartStatus {
  pairs: RarePatchPair[];
  count: number;
  /** Bundle pairs the reference table lacks or maps differently. */
  notInReference: string[];
  /** Reference pairs the bundle does not have. */
  referenceNotInBundle: string[];
}

const source = createBundlePartSource('rare-patch-pairs', RARE_PATCH_PAIRS_MARKER, parseRarePatchPairs);

export function startRarePatchPairsSource(): void {
  source.start();
}

export function stopRarePatchPairsSource(): void {
  source.stop();
}

export function getRarePatchPairs(): readonly RarePatchPair[] | null {
  return source.get();
}

export function onRarePatchPairsChange(cb: () => void): () => void {
  return source.onChange(cb);
}

/** Parsed pairs against a reference table (passed in: catalogs/logic does not read the pity literal). */
export function getRarePatchPairsDrift(reference: Readonly<Record<string, string>>): RarePatchPairsDrift {
  const pairs = source.get() ?? [];
  const bundle = new Map(pairs.map((p) => [p.patch, p.rare]));
  return {
    ...source.status(),
    pairs: [...pairs],
    count: pairs.length,
    notInReference: pairs.filter((p) => reference[p.patch] !== p.rare).map((p) => `${p.patch}→${p.rare}`),
    referenceNotInBundle: source.get()
      ? Object.entries(reference).filter(([patch, rare]) => bundle.get(patch) !== rare).map(([patch, rare]) => `${patch}→${rare}`)
      : [],
  };
}
