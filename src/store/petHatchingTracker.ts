// Tracks pet hatching events by monitoring pet collection changes.
// Integrates with auto-favorite to favorite rare pets.

import { subscribeAtomValue } from '../core/atomRegistry';
import { recordPetHatch } from './stats';
import { recordDetailedHatch } from './hatchStatsStore';
import { storage } from '../utils/storage';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storePetHatching', 'petHatching');

const STORAGE_KEY = 'qpm.petHatchingTracker.knownPetIds.v1';
const MAX_KNOWN_PET_IDS = 5000;
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

function loadKnownPetIds(): void {
  try {
    const stored = storage.get<string[]>(STORAGE_KEY, []);
    knownPetIds = new Set(stored);
    if (knownPetIds.size > 0) {
      diag.log.debug(`Loaded ${knownPetIds.size} known pet IDs from storage`);
    }
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'load', key: STORAGE_KEY }, error);
    knownPetIds = new Set();
  }
}

function saveKnownPetIds(): void {
  try {
    storage.set(STORAGE_KEY, Array.from(knownPetIds));
  } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'knownPetIds', key: STORAGE_KEY }, error);
  }
}

// FIFO trim to bound the persisted set. Sets preserve insertion order,
// so the oldest IDs (least recently observed as new) are evicted first.
function pruneKnownPetIds(): void {
  if (knownPetIds.size <= MAX_KNOWN_PET_IDS) return;
  const excess = knownPetIds.size - MAX_KNOWN_PET_IDS;
  const iter = knownPetIds.values();
  for (let i = 0; i < excess; i++) {
    const val = iter.next().value;
    if (val !== undefined) knownPetIds.delete(val);
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

  if (Array.isArray(value)) {
    return value.filter(pet => pet && typeof pet === 'object') as PetInfo[];
  }

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
  let addedCount = 0;

  for (const pet of pets) {
    const species = extractSpecies(pet);
    // Stable pet ID — prefer real ID; fallback avoids mutable fields like name
    const petId = pet.id || `${species || 'unknown'}-${pet.targetScale ?? 1}`;

    if (!knownPetIds.has(petId)) {
      const rarity = determinePetRarity(pet);
      recordPetHatch(rarity, now);

      const abilities = extractAbilities(pet);
      recordDetailedHatch(species ?? 'Unknown', rarity, abilities, now);

      diag.log.debug(`Detected new ${rarity} pet hatched: ${species ?? 'Unknown'}`);
      knownPetIds.add(petId);
      addedCount++;
    }
  }

  // Persist only when the set actually grew — idle pushes hit this path
  // multiple times per second and previously rewrote the full array every call.
  if (addedCount > 0) {
    pruneKnownPetIds();
    saveKnownPetIds();
  }
}

function processPetData(value: unknown): void {
  const pets = extractPetInfos(value);

  if (pets.length > 0) {
    detectNewPets(pets);
  }
}

export async function startPetHatchingTracker(): Promise<void> {
  if (started) return;

  diag.register('Loading known pet IDs and subscribing to petInventory');
  loadKnownPetIds();

  let isFirstCall = true;

  try {
    const unsub = await subscribeAtomValue('petInventory', (value) => {
      try {
        if (isFirstCall) {
          isFirstCall = false;
          const pets = extractPetInfos(value);
          for (const pet of pets) {
            const species = extractSpecies(pet);
            const petId = pet.id || `${species || 'unknown'}-${pet.targetScale ?? 1}`;
            knownPetIds.add(petId);
          }
          saveKnownPetIds();
          diag.log.debug(`Pet hatching tracker initialized with ${knownPetIds.size} existing pets`);
        } else {
          processPetData(value);
        }
      } catch (error) {
        diag.warn('QPM-STORE-003', { phase: 'processPetData' }, error);
      }
    });

    if (!unsub) {
      diag.warn('QPM-STORE-002', { atom: 'petInventory' });
      return;
    }
    unsubscribe = unsub;

    started = true;
    diag.publishOk('Pet hatching tracker started', {
      knownPetIds: knownPetIds.size,
    });
  } catch (error) {
    diag.error('QPM-STORE-001', { phase: 'subscribe' }, error);
    throw error;
  }
}

export function stopPetHatchingTracker(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  // Don't clear knownPetIds — prevents compounding on restart.
  diag.log.debug('Pet hatching tracker stopped');
}

export function resetPetHatchingTracker(): void {
  knownPetIds.clear();
  saveKnownPetIds();
  diag.log.debug('Pet hatching tracker reset — all known pet IDs cleared');
}

export function isPetHatchingTrackerStarted(): boolean {
  return started;
}
