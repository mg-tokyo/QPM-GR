import { getAtomByLabel, readAtomValue } from '../../../core/jotaiBridge';
import { getAbilityDefinition } from '../data/petAbilities';
import { getActivePetInfos, type ActivePetInfo } from '../../../store/pets';
import { calculateMaxStrength, getSpeciesXpPerLevel } from '../../../store/xpTracker';
import { log } from '../../../utils/logger';
import { PET_LOCATION_PRIORITY } from './constants';
import type { CollectedPet, PetLocation } from './types';

function parseMaxLevelFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const match = name.match(/[\(\[](\d+)[\)\]]/);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function activePetToCollected(pet: ActivePetInfo): CollectedPet | null {
  if (!pet.species) return null;

  const abilityIds = pet.abilities.map((name) => {
    const def = getAbilityDefinition(name);
    return def?.id || name;
  });

  const maxStr = pet.species && pet.targetScale
    ? calculateMaxStrength(pet.targetScale, pet.species)
    : null;

  return {
    id: pet.petId || `active-${pet.slotIndex}`,
    itemId: pet.slotId || pet.petId || `active-${pet.slotIndex}`,
    name: pet.name,
    species: pet.species,
    location: 'active',
    slotIndex: pet.slotIndex,
    strength: pet.strength || 0,
    maxStrength: maxStr,
    targetScale: pet.targetScale,
    xp: pet.xp,
    level: pet.level,
    abilities: pet.abilities,
    abilityIds,
    mutations: pet.mutations,
    hasGold: pet.mutations.some((mutation) => mutation.toLowerCase().includes('gold')),
    hasRainbow: pet.mutations.some((mutation) => mutation.toLowerCase().includes('rainbow')),
    raw: pet.raw,
  };
}

function inventoryItemToCollected(item: Record<string, unknown>, location: PetLocation): CollectedPet | null {
  const species = (item.petSpecies as string) || (item.species as string) || null;
  if (!species) return null;

  const name = (item.name as string) || null;
  const id = (item.id as string) || `${location}-${Math.random()}`;

  const abilitiesRaw = item.abilities || item.ability || [];
  const abilities = Array.isArray(abilitiesRaw)
    ? abilitiesRaw.filter((ability): ability is string => typeof ability === 'string')
    : [];

  const abilityIds = abilities.map((abilityName) => {
    const def = getAbilityDefinition(abilityName);
    return def?.id || abilityName;
  });

  const targetScale = typeof item.targetScale === 'number' ? item.targetScale : null;
  const xp = typeof item.xp === 'number' ? item.xp : null;
  const level = typeof item.level === 'number' ? item.level : null;

  const rawStrength = typeof item.strength === 'number' && item.strength > 0 ? item.strength : null;
  const xpPerLevel = getSpeciesXpPerLevel(species);

  const scaleMax = targetScale != null ? calculateMaxStrength(targetScale, species) : null;
  const parsedMaxLevel = parseMaxLevelFromName(name);
  const parsedMax = parsedMaxLevel && parsedMaxLevel >= 70 && parsedMaxLevel <= 100 ? parsedMaxLevel : null;
  const maxStr = scaleMax ?? parsedMax ?? rawStrength ?? null;

  const clampNumber = (value: number, min: number, max: number): number => {
    return Math.min(max, Math.max(min, value));
  };

  let currentStrength = rawStrength ?? 0;
  if (maxStr != null) {
    const hatchStrength = maxStr - 30;
    const canDeriveFromXp = xp != null && xpPerLevel != null && xpPerLevel > 0;

    if (canDeriveFromXp) {
      const levelsGained = Math.min(30, Math.max(0, Math.floor(xp / xpPerLevel)));
      const derivedCurrent = clampNumber(hatchStrength + levelsGained, hatchStrength, maxStr);

      if (rawStrength == null) {
        currentStrength = derivedCurrent;
      } else {
        const rawNearMax = rawStrength >= maxStr - 1;
        currentStrength = rawNearMax && derivedCurrent < rawStrength
          ? derivedCurrent
          : clampNumber(rawStrength, hatchStrength, maxStr);
      }
    } else if (rawStrength != null) {
      currentStrength = clampNumber(rawStrength, hatchStrength, maxStr);
    } else {
      currentStrength = maxStr;
    }
  }

  const mutationsRaw = item.mutations || [];
  const mutations = Array.isArray(mutationsRaw)
    ? mutationsRaw.filter((mutation): mutation is string => typeof mutation === 'string')
    : [];

  return {
    id,
    itemId: id,
    name,
    species,
    location,
    slotIndex: -1,
    strength: currentStrength,
    maxStrength: maxStr,
    targetScale,
    xp,
    level,
    abilities,
    abilityIds,
    mutations,
    hasGold: mutations.some((mutation) => mutation.toLowerCase().includes('gold')),
    hasRainbow: mutations.some((mutation) => mutation.toLowerCase().includes('rainbow')),
    raw: item,
  };
}

async function getInventoryPets(): Promise<CollectedPet[]> {
  try {
    const atom = getAtomByLabel('myInventoryAtom');
    if (!atom) {
      log('Pet Optimizer: myInventoryAtom not found');
      return [];
    }

    const inventory = await readAtomValue(atom) as { items?: unknown[] } | null;
    if (!inventory || !Array.isArray(inventory.items)) {
      return [];
    }

    const pets: CollectedPet[] = [];
    for (const item of inventory.items) {
      if (typeof item !== 'object' || item == null) continue;
      const itemObj = item as Record<string, unknown>;
      if (itemObj.itemType === 'Pet' || 'petSpecies' in itemObj) {
        const collected = inventoryItemToCollected(itemObj, 'inventory');
        if (collected) pets.push(collected);
      }
    }

    return pets;
  } catch (error) {
    log('Pet Optimizer: Failed to get inventory pets:', error);
    return [];
  }
}

async function getHutchPets(): Promise<CollectedPet[]> {
  try {
    const atom = getAtomByLabel('myPetHutchPetItemsAtom');
    if (!atom) {
      log('Pet Optimizer: myPetHutchPetItemsAtom not found');
      return [];
    }

    const hutchItems = await readAtomValue(atom);
    if (!hutchItems || !Array.isArray(hutchItems)) {
      return [];
    }

    const pets: CollectedPet[] = [];
    for (const item of hutchItems) {
      if (typeof item !== 'object' || item == null) continue;
      const collected = inventoryItemToCollected(item as Record<string, unknown>, 'hutch');
      if (collected) pets.push(collected);
    }

    return pets;
  } catch (error) {
    log('Pet Optimizer: Failed to get hutch pets:', error);
    return [];
  }
}

export async function collectAllPets(): Promise<CollectedPet[]> {
  const pets: CollectedPet[] = [];

  try {
    const activePets = getActivePetInfos();
    for (const pet of activePets) {
      const collected = activePetToCollected(pet);
      if (collected) pets.push(collected);
    }

    const inventoryPets = await getInventoryPets();
    pets.push(...inventoryPets);

    const hutchPets = await getHutchPets();
    pets.push(...hutchPets);
  } catch (error) {
    log('Pet Optimizer: Error during collection:', error);
    throw error;
  }

  return pets;
}

export function isSyntheticCollectedId(value: string | null | undefined): boolean {
  if (!value) return true;
  return value.startsWith('active-') || value.startsWith('inventory-') || value.startsWith('hutch-');
}

export function getCollectedPetIdentityKey(pet: CollectedPet): string {
  if (pet.itemId && !isSyntheticCollectedId(pet.itemId)) {
    return `item:${pet.itemId}`;
  }
  if (pet.id && !isSyntheticCollectedId(pet.id)) {
    return `pet:${pet.id}`;
  }
  return `fallback:${pet.location}:${pet.slotIndex}:${pet.species ?? ''}:${pet.name ?? ''}:${pet.strength}:${pet.maxStrength ?? ''}:${pet.abilityIds.join('|')}:${pet.mutations.join('|')}`;
}

function getCollectedPetPreferenceScore(pet: CollectedPet): number {
  let score = PET_LOCATION_PRIORITY[pet.location] * 1000;
  score += pet.abilityIds.length * 100;
  score += pet.maxStrength != null ? 40 : 0;
  score += pet.targetScale != null ? 20 : 0;
  score += pet.level != null ? 10 : 0;
  score += pet.xp != null ? 10 : 0;
  score += pet.strength;
  return score;
}

export function dedupeCollectedPets(pets: CollectedPet[]): CollectedPet[] {
  const byIdentityKey = new Map<string, CollectedPet>();

  for (const pet of pets) {
    const identityKey = getCollectedPetIdentityKey(pet);
    const existing = byIdentityKey.get(identityKey);
    if (!existing) {
      byIdentityKey.set(identityKey, pet);
      continue;
    }

    const existingScore = getCollectedPetPreferenceScore(existing);
    const candidateScore = getCollectedPetPreferenceScore(pet);
    if (candidateScore > existingScore) {
      byIdentityKey.set(identityKey, pet);
    }
  }

  const deduped = [...byIdentityKey.values()];
  if (deduped.length !== pets.length) {
    const removed = pets.length - deduped.length;
    log(`[Pet Optimizer] Removed ${removed} duplicate pet entr${removed === 1 ? 'y' : 'ies'} by identity key`);
  }
  return deduped;
}
