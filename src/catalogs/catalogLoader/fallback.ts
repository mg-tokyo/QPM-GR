import { getPetAbilitiesCatalogMap } from '../logic/petAbilitiesCatalog';
import { enrichPetAbilityColors } from './enrichment';
import { notifyPetAbilitiesCaptured } from './readyState';
import { capturedCatalogs, catalogLog, publishCatalogs } from './state';

let fallbackInFlight: Promise<boolean> | null = null;

// Seeds petAbilities from bundle text when the Object.* hook never saw the blueprint. Idempotent.
export function ensurePetAbilitiesCatalog(): Promise<boolean> {
  if (capturedCatalogs.petAbilities) return Promise.resolve(true);
  if (fallbackInFlight) return fallbackInFlight;
  fallbackInFlight = (async () => {
    const map = await getPetAbilitiesCatalogMap();
    if (!map || capturedCatalogs.petAbilities) return capturedCatalogs.petAbilities !== null;
    capturedCatalogs.petAbilities = map;
    catalogLog(`petAbilities seeded from bundle text (${Object.keys(map).length} abilities).`);
    publishCatalogs();
    void enrichPetAbilityColors();
    notifyPetAbilitiesCaptured();
    return true;
  })().finally(() => { fallbackInFlight = null; });
  return fallbackInFlight;
}
