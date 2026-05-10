// src/store/petHatchingTracker.ts
// Tracks pet hatching events by monitoring pet collection changes
// Integrates with auto-favorite to favorite rare pets

import { getAtomByLabel, subscribeAtom } from '../core/jotaiBridge';
import { recordPetHatch } from './stats';
import { recordDetailedHatch } from './hatchStatsStore';
import { log } from '../utils/logger';
import { storage } from '../utils/storage';

const PET_INFOS_LABEL = 'myPetInventoryAtom'; // Contains all owned pets
const STORAGE_KEY = 'qpm.petHatchingTracker.knownPetIds.v1';
let started = false;
let unsubscribe: (() => void) | null = null;

interface PetInfo {
  id?: string;
  species?: string;
  petSpecies?: string;
  name?: string;
  displayName?: string;
  targetScale?: number;
  rarity?: string;
  isGold?: boolean;
  isRainbow?: boolean;
  abilities?: unknown;
  mutation?: unknown;
  mutations?: unknown;
  slot?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Extract species from nested pet data — mirrors pets.ts:extractSpecies logic.
 *  Intentionally does NOT fall back to pet.name/displayName — those are user renames. */
function extractSpecies(pet: PetInfo): string | null {
  const slot = pet.slot ?? {};
  const nested = (slot.pet ?? pet.pet) as Record<string, unknown> | undefined;
  const candidates = [
    pet.species,
    slot.species,
    slot.petSpecies,
    nested?.species,
    nested?.petSpecies,
    pet.petSpecies,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

/** Extract string list from nested pet data sources */
function extractStringList(sources: unknown[]): string[] {
  const result: string[] = [];
  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const item of src) {
        if (typeof item === 'string' && !result.includes(item)) {
          result.push(item);
        }
      }
    } else if (typeof src === 'string' && src.length > 0 && !result.includes(src)) {
      result.push(src);
    }
  }
  return result;
}

/** Extract abilities from nested pet data — mirrors pets.ts:extractAbilities logic */
function extractAbilities(pet: PetInfo): string[] {
  const slot = pet.slot ?? {};
  const nested = (slot.pet ?? pet.pet) as Record<string, unknown> | undefined;
  return extractStringList([
    pet.abilities, slot.abilities, slot.ability, nested?.abilities,
  ]);
}

/** Extract mutations from nested pet data — mirrors pets.ts:extractMutations logic */
function extractMutations(pet: PetInfo): string[] {
  const slot = pet.slot ?? {};
  const nested = (slot.pet ?? pet.pet) as Record<string, unknown> | undefined;
  return extractStringList([
    pet.mutation, slot.mutation, nested?.mutation,
    pet.mutations, slot.mutations, nested?.mutations,
  ]);
}

// Track known pet IDs to detect new hatches - PERSISTED to prevent compounding bug
let knownPetIds = new Set<string>();

// Load known pet IDs from storage
function loadKnownPetIds(): void {
  try {
    const stored = storage.get<string[]>(STORAGE_KEY, []);
    knownPetIds = new Set(stored);
    if (knownPetIds.size > 0) {
      log(`✅ Loaded ${knownPetIds.size} known pet IDs from storage`);
    }
  } catch (error) {
    log('⚠️ Failed to load known pet IDs from storage', error);
    knownPetIds = new Set();
  }
}

// Save known pet IDs to storage
function saveKnownPetIds(): void {
  try {
    storage.set(STORAGE_KEY, Array.from(knownPetIds));
  } catch (error) {
    log('⚠️ Failed to save known pet IDs to storage', error);
  }
}

function determinePetRarity(pet: PetInfo): 'normal' | 'gold' | 'rainbow' {
  // Primary: check mutations array — canonical source per petOptimizer/collection.ts
  const mutations = extractMutations(pet);
  if (mutations.some(m => m.toLowerCase() === 'rainbow')) return 'rainbow';
  if (mutations.some(m => m.toLowerCase() === 'gold')) return 'gold';

  // Fallback: check explicit rarity/boolean fields
  const slot = pet.slot ?? {};
  for (const rarity of [pet.rarity, slot.rarity]) {
    if (rarity) {
      const r = String(rarity).toLowerCase();
      if (r.includes('rainbow')) return 'rainbow';
      if (r.includes('gold')) return 'gold';
    }
  }

  if (pet.isRainbow === true || slot.isRainbow === true) return 'rainbow';
  if (pet.isGold === true || slot.isGold === true) return 'gold';

  return 'normal';
}

function extractPetInfos(value: unknown): PetInfo[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  // Handle both array and object formats
  if (Array.isArray(value)) {
    return value.filter(pet => pet && typeof pet === 'object') as PetInfo[];
  }

  // Handle object with pet entries
  const data = value as Record<string, unknown>;
  const pets: PetInfo[] = [];

  for (const entry of Object.values(data)) {
    if (entry && typeof entry === 'object') {
      pets.push(entry as PetInfo);
    }
  }

  return pets;
}

function detectNewPets(pets: PetInfo[]): void {
  const now = Date.now();
  const currentPetIds = new Set<string>();
  let newPetsDetected = false;

  for (const pet of pets) {
    const species = extractSpecies(pet);
    // Stable pet ID — prefer real ID; fallback avoids mutable fields like name
    const petId = pet.id || `${species || 'unknown'}-${pet.targetScale ?? 1}`;
    currentPetIds.add(petId);

    // Check if this is a new pet (not seen before)
    if (!knownPetIds.has(petId)) {
      const rarity = determinePetRarity(pet);
      recordPetHatch(rarity, now);

      const abilities = extractAbilities(pet);
      recordDetailedHatch(species ?? 'Unknown', rarity, abilities, now);

      log(`🥚 Detected new ${rarity} pet hatched: ${species ?? 'Unknown'}`);
      newPetsDetected = true;
    }
  }

  // Grow-only union — never shrink knownPetIds so pets that leave the
  // atom (sold, swapped, hutched) are not re-counted when they return.
  for (const id of currentPetIds) {
    knownPetIds.add(id);
  }

  // Persist after every update so the set survives reloads monotonically
  saveKnownPetIds();
}

function processPetData(value: unknown): void {
  const pets = extractPetInfos(value);

  if (pets.length > 0) {
    detectNewPets(pets);
  }
}

export async function startPetHatchingTracker(): Promise<void> {
  if (started) return;

  // Load known pet IDs from storage first
  loadKnownPetIds();

  const atom = getAtomByLabel(PET_INFOS_LABEL);
  if (!atom) {
    log('⚠️ Pet infos atom not found, pet hatching tracking disabled');
    return;
  }

  let isFirstCall = true;

  try {
    unsubscribe = await subscribeAtom(atom, (value) => {
      try {
        if (isFirstCall) {
          // On first call, initialize known pets without recording hatches
          isFirstCall = false;
          const pets = extractPetInfos(value);
          for (const pet of pets) {
            const species = extractSpecies(pet);
            const petId = pet.id || `${species || 'unknown'}-${pet.targetScale ?? 1}`;
            knownPetIds.add(petId);
          }
          // Save the initial state
          saveKnownPetIds();
          log(`✅ Pet hatching tracker initialized with ${knownPetIds.size} existing pets`);
        } else {
          // On subsequent calls, detect new pets
          processPetData(value);
        }
      } catch (error) {
        log('⚠️ Failed processing pet hatching data', error);
      }
    });

    started = true;
    log('✅ Pet hatching tracker started');
  } catch (error) {
    log('⚠️ Failed to start pet hatching tracker', error);
    throw error;
  }
}

export function stopPetHatchingTracker(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  // Note: We don't clear knownPetIds here to prevent compounding on restart
  log('🛑 Pet hatching tracker stopped');
}

export function resetPetHatchingTracker(): void {
  knownPetIds.clear();
  saveKnownPetIds();
  log('🗑️ Pet hatching tracker reset - all known pet IDs cleared');
}

export function isPetHatchingTrackerStarted(): boolean {
  return started;
}
