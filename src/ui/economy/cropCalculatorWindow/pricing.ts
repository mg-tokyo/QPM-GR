import {
  getAllPlantSpecies,
  getPlantSpecies,
  getAllPetSpecies,
  getPetSpecies,
  getPetMaxScale,
  getPetHoursToMature,
  getAllEggTypes,
  getEggSpawnWeights,
  getMutation,
} from '../../../catalogs/gameCatalogs';
import {
  computeMutationMultiplier,
  getAllMutationDefinitions,
  type MutationDefinition,
  type MutationCategory,
} from '../../../utils/game/cropMultipliers';
import { lookupMaxScale } from '../../../utils/game/plantScales';
import { normalizeSpeciesKey } from '../../../utils/helpers';
import {
  MUTATION_DISPLAY_NAMES_FALLBACK,
  DUST_RARITY_MULT,
  DUST_MUTATION_MULT_FALLBACK,
} from './constants';
import type { PlantOption, CropCalcState, PetOption, PetCalcState } from './types';

export function getMutationDisplayName(mutationKey: string): string {
  const catalogEntry = getMutation(mutationKey);
  if (catalogEntry?.name) return catalogEntry.name;
  return MUTATION_DISPLAY_NAMES_FALLBACK[mutationKey] ?? mutationKey;
}

export function buildPlantOptions(): PlantOption[] {
  const keys = getAllPlantSpecies();
  const options: PlantOption[] = [];

  for (const key of keys) {
    const entry = getPlantSpecies(key);
    if (!entry?.crop) continue;

    const baseSellPrice = typeof entry.crop.baseSellPrice === 'number' ? entry.crop.baseSellPrice : 0;
    if (baseSellPrice <= 0) continue;

    const baseWeight = typeof entry.crop.baseWeight === 'number' ? entry.crop.baseWeight : 1.0;
    let maxScale = typeof entry.crop.maxScale === 'number' ? entry.crop.maxScale : 0;
    if (maxScale <= 1) {
      maxScale = lookupMaxScale(normalizeSpeciesKey(key)) ?? 2.0;
    }

    const name = typeof entry.crop.name === 'string' && entry.crop.name ? entry.crop.name : key;

    options.push({ key, name, baseSellPrice, baseWeight, maxScale });
  }

  options.sort((a, b) => b.baseSellPrice - a.baseSellPrice);
  return options;
}

export function buildPetOptions(): PetOption[] {
  const keys = getAllPetSpecies();
  const options: PetOption[] = [];

  for (const key of keys) {
    const entry = getPetSpecies(key);
    if (!entry) continue;

    const msp = entry.maturitySellPrice;
    const maturitySellPrice = typeof msp === 'number' ? msp : 0;
    if (maturitySellPrice <= 0) continue;

    const maxScale = getPetMaxScale(key) ?? 2;
    const hoursToMature = getPetHoursToMature(key) ?? 12;
    const name = entry.name ?? key;
    const rarity = entry.rarity ?? 'Common';

    options.push({ key, name, maturitySellPrice, maxScale, hoursToMature, rarity });
  }

  options.sort((a, b) => b.maturitySellPrice - a.maturitySellPrice);
  return options;
}

export function groupMutations(): Record<MutationCategory, MutationDefinition[]> {
  const all = getAllMutationDefinitions();
  const grouped: Record<MutationCategory, MutationDefinition[]> = { color: [], weather: [], time: [] };
  for (const def of all) {
    grouped[def.category].push(def);
  }
  return grouped;
}

export function percentToScale(percent: number, maxScale: number): number {
  return 1 + ((percent - 50) / 50) * (maxScale - 1);
}

export function computeCropPrice(state: CropCalcState): { sellPrice: number; scale: number; mutMult: number; friendBonus: number } {
  if (!state.plant) return { sellPrice: 0, scale: 1, mutMult: 1, friendBonus: 1 };

  const mutations = [state.colorMutation, state.weatherMutation, state.timeMutation].filter(
    (m): m is string => m !== null,
  );
  const scale = percentToScale(state.sizePercent, state.plant.maxScale);
  const { totalMultiplier } = computeMutationMultiplier(mutations);
  const friendBonus = 1 + (state.playerCount - 1) * 0.1;
  const sellPrice = Math.round(state.plant.baseSellPrice * scale * totalMultiplier * friendBonus);
  return { sellPrice, scale, mutMult: totalMultiplier, friendBonus };
}

export function strengthToTargetScale(maxStrength: number, maxSpeciesScale: number): number {
  return 1 + ((maxStrength - 80) / 20) * (maxSpeciesScale - 1);
}

export function computePetCalcPrice(state: PetCalcState): { sellPrice: number; scale: number; mutMult: number; friendBonus: number; targetScale: number } {
  if (!state.pet) return { sellPrice: 0, scale: 1, mutMult: 1, friendBonus: 1, targetScale: 1 };

  const targetScale = strengthToTargetScale(state.maxStrength, state.pet.maxScale);
  const scale = state.maxStrength > 0 ? (state.currentStrength / state.maxStrength) * targetScale : 1;
  const mutations = state.colorMutation ? [state.colorMutation] : [];
  const { totalMultiplier } = computeMutationMultiplier(mutations);
  const friendBonus = 1 + (state.playerCount - 1) * 0.1;
  // Two-step rounding matching game formula (sell.ts)
  const basePrice = Math.round(state.pet.maturitySellPrice * scale * totalMultiplier);
  const sellPrice = Math.round(basePrice * friendBonus);

  return { sellPrice, scale, mutMult: totalMultiplier, friendBonus, targetScale };
}

function getDustMutationMult(mutationName: string): number {
  const catalogEntry = getMutation(mutationName);
  if (catalogEntry) return catalogEntry.coinMultiplier;
  return DUST_MUTATION_MULT_FALLBACK[mutationName] ?? 1;
}

function getPullRateMult(spawnWeightPct: number): number {
  if (spawnWeightPct >= 51) return 1;
  if (spawnWeightPct >= 11) return 2;
  return 5;
}

/** Find which egg contains a species and compute its spawn weight percentage. */
function getSourceEggForSpecies(speciesKey: string): { eggId: string; spawnWeightPct: number } | null {
  const eggIds = getAllEggTypes();
  for (const eggId of eggIds) {
    const weights = getEggSpawnWeights(eggId);
    if (!(speciesKey in weights)) continue;
    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (total <= 0) continue;
    return { eggId, spawnWeightPct: ((weights[speciesKey] ?? 0) / total) * 100 };
  }
  return null;
}

export function computePetDustValue(state: PetCalcState): { dustValue: number; rarityMult: number; pullRateMult: number; dustMutMult: number; scale: number } {
  if (!state.pet) return { dustValue: 0, rarityMult: 1, pullRateMult: 1, dustMutMult: 1, scale: 1 };

  const targetScale = strengthToTargetScale(state.maxStrength, state.pet.maxScale);
  const scale = state.maxStrength > 0 ? (state.currentStrength / state.maxStrength) * targetScale : 1;
  const rarityMult = DUST_RARITY_MULT[state.pet.rarity] ?? 1;

  const eggInfo = getSourceEggForSpecies(state.pet.key);
  const pullRateMult = eggInfo ? getPullRateMult(eggInfo.spawnWeightPct) : 1;

  const dustMutMult = state.colorMutation ? getDustMutationMult(state.colorMutation) : 1;
  const dustValue = Math.floor(100 * rarityMult * pullRateMult * dustMutMult * scale);

  return { dustValue, rarityMult, pullRateMult, dustMutMult, scale };
}
