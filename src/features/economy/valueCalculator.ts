// src/features/valueCalculator.ts
// Utility helpers for computing garden-related values derived from live tile data.

import type { GardenSnapshot } from '../garden/bridge';
import { computeMutationMultiplier } from '../../utils/cropMultipliers';
import { getCropBaseSellPrice, getPlantSpecies } from '../../catalogs/gameCatalogs';

const SPECIES_VALUES: Record<string, number> = {
  Sunflower: 750000,
  Starweaver: 10000000,
  DawnCelestial: 11000000,
  MoonCelestial: 11000000,
  Lychee: 50000,
  DragonFruit: 24500,
  PassionFruit: 24500,
  Lemon: 10000,
  Pepper: 7220,
  Grape: 7085,
  Bamboo: 500000,
  Cactus: 287000,
  Mushroom: 160000,
  BurrosTail: 6000,
  Lily: 20123,
  Banana: 1750,
  Coconut: 302,
  Echeveria: 5520,
  Pumpkin: 3700,
  Watermelon: 2708,
  Corn: 36,
  Daffodil: 1090,
  Tomato: 27,
  OrangeTulip: 767,
  Apple: 73,
  Blueberry: 23,
  Aloe: 310,
  Strawberry: 14,
  Carrot: 20,
};

export function calculateMutationMultiplier(mutations: string[] | null | undefined): number {
  if (!mutations || mutations.length === 0) {
    return 1;
  }

  return computeMutationMultiplier(mutations).totalMultiplier;
}

export function formatCoins(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

export function formatCoinsAbbreviated(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absValue >= 1e12) {
    return `${sign}${(absValue / 1e12).toFixed(1)}T`;
  } else if (absValue >= 1e9) {
    return `${sign}${(absValue / 1e9).toFixed(1)}B`;
  } else if (absValue >= 1e6) {
    return `${sign}${(absValue / 1e6).toFixed(1)}M`;
  } else if (absValue >= 1e3) {
    return `${sign}${(absValue / 1e3).toFixed(1)}K`;
  } else {
    return `${sign}${Math.round(absValue)}`;
  }
}

export function calculatePlantValue(
  species: string,
  scale = 1,
  mutations: string[] | null | undefined,
  friendBonus = 1,
): number {
  const baseValue = getCropBaseSellPrice(species) ?? SPECIES_VALUES[species];
  if (!baseValue) return 0;
  const multiplier = calculateMutationMultiplier(mutations ?? []);
  const basePrice = Math.round(baseValue * multiplier * scale);
  return Math.round(basePrice * friendBonus);
}

/**
 * Compute total garden value using runtime catalog `baseSellPrice` instead of
 * hardcoded values.  Only counts harvestable slots (endTime <= now).
 * Iterates both `tileObjects` and `boardwalkTileObjects`.
 */
export function computeGardenValueFromCatalog(snapshot: GardenSnapshot | null | undefined, friendBonus = 1): number {
  if (!snapshot) return 0;

  const now = Date.now();
  let total = 0;

  const tileSets = [snapshot.tileObjects, snapshot.boardwalkTileObjects];
  for (const tileMap of tileSets) {
    if (!tileMap) continue;
    for (const tile of Object.values(tileMap)) {
      if (!tile || typeof tile !== 'object') continue;
      const tileRec = tile as Record<string, unknown>;
      if (tileRec.objectType !== 'plant') continue;

      const slots = tileRec.slots;
      if (!Array.isArray(slots)) continue;

      for (const slot of slots) {
        if (!slot || typeof slot !== 'object') continue;
        const slotRec = slot as Record<string, unknown>;

        const species = slotRec.species;
        if (typeof species !== 'string') continue;

        const endTimeRaw = slotRec.endTime;
        const endTime = typeof endTimeRaw === 'number' ? endTimeRaw : Number(endTimeRaw);
        if (!Number.isFinite(endTime) || endTime > now) continue;

        const plantSpec = getPlantSpecies(species) as Record<string, unknown> | null;
        const cropEntry = plantSpec?.crop as Record<string, unknown> | undefined;
        const baseSellPrice = typeof cropEntry?.baseSellPrice === 'number' ? cropEntry.baseSellPrice : 0;
        if (baseSellPrice <= 0) continue;

        const scaleRaw = slotRec.targetScale;
        const scale = typeof scaleRaw === 'number' && Number.isFinite(scaleRaw) ? scaleRaw : 1;

        const mutationsRaw = slotRec.mutations;
        const mutations = Array.isArray(mutationsRaw) ? (mutationsRaw as string[]) : [];
        const { totalMultiplier } = computeMutationMultiplier(mutations);

        const basePrice = Math.round(baseSellPrice * scale * totalMultiplier);
        total += Math.round(basePrice * friendBonus);
      }
    }
  }

  return total;
}
