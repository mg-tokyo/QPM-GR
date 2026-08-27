import { calculateMaxStrength } from '../xpTracker';
import { calculatePetLevel, calculatePetStrength } from '../../utils/rendering/petCardRenderer';
import { getCropBaseSellPrice, getItem } from '../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../utils/game/cropMultipliers';
import { getHungerCapForSpecies } from '../../features/pets/data/petHungerCaps';
import { getGardenSnapshot } from '../../features/garden/bridge';
import { enrichPure, type EnrichDeps } from './enrich';
import type { NormalizedServerEntry } from './normalize';
import type { PetActivityEvent, TargetSnap } from './types';

function readGardenSlots(): TargetSnap[] {
  const garden = getGardenSnapshot();
  const out: TargetSnap[] = [];
  const tiles = [garden?.tileObjects, garden?.boardwalkTileObjects];
  for (const bag of tiles) {
    if (!bag) continue;
    for (const tile of Object.values(bag)) {
      if (!tile || typeof tile !== 'object' || (tile as Record<string, unknown>).objectType !== 'plant') continue;
      const slots = (tile as Record<string, unknown>).slots;
      if (!Array.isArray(slots)) continue;
      for (const s of slots) {
        if (!s || typeof s !== 'object') continue;
        const r = s as Record<string, unknown>;
        if (typeof r.species !== 'string') continue;
        out.push({ kind: 'growSlot', species: r.species,
          mutations: Array.isArray(r.mutations) ? r.mutations.filter((m): m is string => typeof m === 'string') : [],
          targetScale: typeof r.targetScale === 'number' ? r.targetScale : 1,
          startTime: typeof r.startTime === 'number' ? r.startTime : 0,
          endTime: typeof r.endTime === 'number' ? r.endTime : 0 });
      }
    }
  }
  return out;
}

export const liveEnrichDeps: EnrichDeps = {
  strOf: (pet) => ({
    str: calculatePetStrength(pet.species, pet.xp, pet.targetScale) || null,
    maxStr: calculateMaxStrength(pet.targetScale, pet.species),
    level: calculatePetLevel(pet.species, pet.xp),
  }),
  cropCoinValue: (species, scale, mutations) => {
    const base = getCropBaseSellPrice(species);
    if (base == null || base <= 0) return 0;
    return Math.round(base * scale * computeMutationMultiplier(mutations).totalMultiplier);
  },
  hungerMax: (species) => getHungerCapForSpecies(species),
  potionXp: (toolId) => { const v = getItem(toolId)?.xpAmount; return typeof v === 'number' ? v : 0; },
  levelAt: (species, xp) => calculatePetLevel(species, xp),
  gardenSlots: readGardenSlots,
};

export function enrichEvent(entry: NormalizedServerEntry): PetActivityEvent {
  return enrichPure(entry, liveEnrichDeps);
}
