// Bundle-text loaders for the six dex catalogs — the completeness ground truth
// behind catalogLoader/fallback.ts merges. Mirrors petAbilitiesCatalog.ts:
// positive cache + single in-flight per dex + bundle-cache consumer bookkeeping.

import { fetchBundleContaining, markBundleConsumerDone, registerBundleConsumer } from './bundleParser';
import { dexBlueprintMarkers, extractDexFromText, type DexCatalogName, type DexMap } from './dexBlueprints';
import { createNamedLogger } from '../../diagnostics/logger';

export type { DexCatalogName, DexMap } from './dexBlueprints';

const log = createNamedLogger('catalogs');

const dexCache = new Map<DexCatalogName, DexMap>();
const dexInFlight = new Map<DexCatalogName, Promise<DexMap | null>>();

async function loadDexFromBundle(name: DexCatalogName): Promise<DexMap | null> {
  for (const marker of dexBlueprintMarkers(name)) {
    const bundleText = await fetchBundleContaining(marker);
    if (!bundleText) continue;
    const map = extractDexFromText(bundleText, name);
    if (map) return map;
    log.debug('dex: marker chunk found but extraction failed', { name, marker: String(marker) });
  }
  log.debug('dex: no loaded chunk yields the blueprint', { name });
  return null;
}

export async function getDexFromBundle(name: DexCatalogName): Promise<DexMap | null> {
  const cached = dexCache.get(name);
  if (cached) return cached;
  const inFlight = dexInFlight.get(name);
  if (inFlight) return inFlight;

  const consumer = `dex:${name}`;
  registerBundleConsumer(consumer);
  const promise = loadDexFromBundle(name)
    .then((map) => {
      if (map) {
        dexCache.set(name, map);
        log.debug('dex: extracted blueprint', { name, entries: Object.keys(map).length });
      }
      return map;
    })
    .finally(() => {
      dexInFlight.delete(name);
      markBundleConsumerDone(consumer);
    });
  dexInFlight.set(name, promise);
  return promise;
}

/** Keeps the shared bundle-text cache alive across a multi-dex pass (the audit). */
export function holdDexBundleCache(): () => void {
  const consumer = 'dex:audit';
  registerBundleConsumer(consumer);
  return () => markBundleConsumerDone(consumer);
}
