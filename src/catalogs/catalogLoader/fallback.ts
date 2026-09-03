import { getPetAbilitiesCatalogMap } from '../logic/petAbilitiesCatalog';
import { enrichPetAbilityColors } from './enrichment';
import { publishCatalogsHealth } from './diagnostics';
import { notifyPetAbilitiesCaptured } from './readyState';
import { captureSources, capturedCatalogs, catalogLog, publishCatalogs } from './state';

let fallbackInFlight: Promise<boolean> | null = null;

// Seeds petAbilities from bundle text when the Object.* hook never saw the blueprint. Idempotent.
export function ensurePetAbilitiesCatalog(): Promise<boolean> {
  if (capturedCatalogs.petAbilities) return Promise.resolve(true);
  if (fallbackInFlight) return fallbackInFlight;
  fallbackInFlight = (async () => {
    const map = await getPetAbilitiesCatalogMap();
    if (!map || capturedCatalogs.petAbilities) return capturedCatalogs.petAbilities !== null;
    capturedCatalogs.petAbilities = map;
    captureSources.petAbilities = 'bundle-text';
    catalogLog(`petAbilities seeded from bundle text (${Object.keys(map).length} abilities).`);
    publishCatalogs();
    void enrichPetAbilityColors();
    notifyPetAbilitiesCaptured();
    return true;
  })().finally(() => { fallbackInFlight = null; });
  return fallbackInFlight;
}

const MAX_MERGE_ATTEMPTS = 3;
let mergeAttempts = 0;
let mergeInFlight: Promise<boolean> | null = null;

/**
 * Verifies a hook-captured petAbilities catalog against the bundle text (the
 * same blueprint the game executes) and tops up missing entries. The hook can
 * capture a partial dex-shaped object when another mod's enumeration order
 * surfaces it first — see scan.ts capture-or-upgrade. Hook entries win on key
 * collision; the captured object is never mutated (it may be the game's live dex).
 *
 * With `observedIds` (ability ids seen on real pets) the bundle fetch is skipped
 * entirely when all are present. Without them, verification is unconditional.
 * Returns true only when entries were actually added.
 */
export function mergePetAbilitiesIfIncomplete(observedIds?: readonly string[]): Promise<boolean> {
  const current = capturedCatalogs.petAbilities;
  if (!current) return ensurePetAbilitiesCatalog();
  if (observedIds && observedIds.every((id) => id in current)) return Promise.resolve(false);
  if (mergeInFlight) return mergeInFlight;
  if (mergeAttempts >= MAX_MERGE_ATTEMPTS) return Promise.resolve(false);
  mergeAttempts += 1;
  mergeInFlight = (async () => {
    const map = await getPetAbilitiesCatalogMap();
    if (!map) return false;
    const base = capturedCatalogs.petAbilities;
    if (!base) return false;
    const additions = Object.keys(map).filter((k) => !(k in base));
    if (additions.length === 0) return false;
    capturedCatalogs.petAbilities = { ...map, ...base };
    captureSources.petAbilities = 'hook+bundle-text';
    catalogLog(`petAbilities topped up from bundle text (+${additions.length}, now ${Object.keys(capturedCatalogs.petAbilities).length})`);
    publishCatalogs();
    publishCatalogsHealth();
    void enrichPetAbilityColors();
    notifyPetAbilitiesCaptured();
    return true;
  })().finally(() => { mergeInFlight = null; });
  return mergeInFlight;
}
