// Bundle-text loaders for the six dex catalogs — the ground truth behind
// catalogLoader/fallback.ts merges. Mirrors petAbilitiesCatalog.ts:
// positive cache + single in-flight per dex + bundle-cache consumer bookkeeping.

import { fetchAllBundlesContaining, fetchBundleContaining, markBundleConsumerDone, registerBundleConsumer } from './bundleParser';
import { dexBlueprintMarkers, extractDexFromText, type DexCatalogName, type DexMap } from './dexBlueprints';
import { SPRITE_ENUM_MARKER, extractSpriteEnumFromText, type SpriteEnumTable } from './spriteEnumText';
import { createNamedLogger } from '../../diagnostics/logger';

export type { DexCatalogName, DexMap } from './dexBlueprints';

export interface DexBlueprint {
  map: DexMap;
  /** False when the sprite enum table was not found: sprite fields are then absent, not wrong. */
  spritesResolved: boolean;
}

const log = createNamedLogger('catalogs');

const dexCache = new Map<DexCatalogName, DexBlueprint>();
const dexInFlight = new Map<DexCatalogName, Promise<DexBlueprint | null>>();

let spriteEnumCache: SpriteEnumTable | null = null;
let spriteEnumInFlight: Promise<SpriteEnumTable | null> | null = null;

async function loadSpriteEnumFromBundle(): Promise<SpriteEnumTable | null> {
  const first = await fetchBundleContaining(SPRITE_ENUM_MARKER);
  if (!first) return null;
  const table = extractSpriteEnumFromText(first);
  if (table) return table;
  // The first marker hit can be a lookalike table; try every hit before giving up.
  for (const text of await fetchAllBundlesContaining(SPRITE_ENUM_MARKER)) {
    if (text === first) continue;
    const other = extractSpriteEnumFromText(text);
    if (other) return other;
  }
  return null;
}

export async function getSpriteEnumFromBundle(): Promise<SpriteEnumTable | null> {
  if (spriteEnumCache) return spriteEnumCache;
  if (spriteEnumInFlight) return spriteEnumInFlight;
  const consumer = 'dex:spriteEnum';
  registerBundleConsumer(consumer);
  spriteEnumInFlight = loadSpriteEnumFromBundle()
    .then((table) => {
      if (table) {
        spriteEnumCache = table;
        log.debug('dex: extracted sprite enum', { categories: Object.keys(table).length });
      } else {
        log.debug('dex: no loaded chunk yields the sprite enum');
      }
      return table;
    })
    .finally(() => {
      spriteEnumInFlight = null;
      markBundleConsumerDone(consumer);
    });
  return spriteEnumInFlight;
}

async function loadDexFromBundle(name: DexCatalogName): Promise<DexBlueprint | null> {
  const spriteTable = await getSpriteEnumFromBundle();
  for (const marker of dexBlueprintMarkers(name)) {
    const bundleText = await fetchBundleContaining(marker);
    if (!bundleText) continue;
    const map = extractDexFromText(bundleText, name, spriteTable);
    if (map) return { map, spritesResolved: spriteTable !== null };
    log.debug('dex: marker chunk found but extraction failed', { name, marker: String(marker) });
  }
  log.debug('dex: no loaded chunk yields the blueprint', { name });
  return null;
}

/** Only sprite-resolved blueprints are cached, so a later call can still pick up the enum chunk. */
export async function getDexBlueprint(name: DexCatalogName): Promise<DexBlueprint | null> {
  const cached = dexCache.get(name);
  if (cached) return cached;
  const inFlight = dexInFlight.get(name);
  if (inFlight) return inFlight;

  const consumer = `dex:${name}`;
  registerBundleConsumer(consumer);
  const promise = loadDexFromBundle(name)
    .then((blueprint) => {
      if (blueprint) {
        if (blueprint.spritesResolved) dexCache.set(name, blueprint);
        log.debug('dex: extracted blueprint', {
          name,
          entries: Object.keys(blueprint.map).length,
          spritesResolved: blueprint.spritesResolved,
        });
      }
      return blueprint;
    })
    .finally(() => {
      dexInFlight.delete(name);
      markBundleConsumerDone(consumer);
    });
  dexInFlight.set(name, promise);
  return promise;
}

export async function getDexFromBundle(name: DexCatalogName): Promise<DexMap | null> {
  return (await getDexBlueprint(name))?.map ?? null;
}

/** Keeps the shared bundle-text cache alive across a multi-dex pass (the audit). */
export function holdDexBundleCache(): () => void {
  const consumer = 'dex:audit';
  registerBundleConsumer(consumer);
  return () => markBundleConsumerDone(consumer);
}
