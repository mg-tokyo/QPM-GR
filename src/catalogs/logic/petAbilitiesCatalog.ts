import { fetchBundleContaining, markBundleConsumerDone } from './bundleParser';
import { PET_ABILITIES_BLUEPRINT_MARKER, extractPetAbilitiesCatalogFromText } from './bundleTextParsing';
import { createNamedLogger } from '../../diagnostics/logger';
import type { PetAbilities } from '../types';

const log = createNamedLogger('catalogs');

let petAbilitiesCache: PetAbilities | null = null;
let petAbilitiesInFlight: Promise<PetAbilities | null> | null = null;

async function loadFromBundle(): Promise<PetAbilities | null> {
  const bundleText = await fetchBundleContaining(PET_ABILITIES_BLUEPRINT_MARKER);
  if (!bundleText) {
    log.debug('petAbilities: no loaded chunk contains the ability blueprint marker');
    return null;
  }
  const catalog = extractPetAbilitiesCatalogFromText(bundleText);
  if (!catalog) {
    log.debug('petAbilities: blueprint chunk found but parse failed');
  }
  return catalog as PetAbilities | null;
}

export async function getPetAbilitiesCatalogMap(): Promise<PetAbilities | null> {
  if (petAbilitiesCache) return petAbilitiesCache;
  if (petAbilitiesInFlight) return petAbilitiesInFlight;
  petAbilitiesInFlight = (async () => {
    const map = await loadFromBundle();
    if (!map) return null;
    petAbilitiesCache = map;
    markBundleConsumerDone('petAbilities');
    return map;
  })().finally(() => { petAbilitiesInFlight = null; });
  return petAbilitiesInFlight;
}
