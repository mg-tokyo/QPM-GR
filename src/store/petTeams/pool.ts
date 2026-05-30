// src/store/petTeams/pool.ts
// Pet pool collection — active + hutch + inventory.

import { log } from '../../utils/logger';
import { getActivePetInfos } from '../pets';
import { readAtomValue } from '../../core/atomRegistry';
import { getSpeciesXpPerLevel, calculateMaxStrength } from '../xpTracker';
import { getHungerCapForSpecies, DEFAULT_HUNGER_CAP } from '../../features/pets/data/petHungerCaps';
import type { PooledPet } from '../../types/petTeams';
import { store } from './state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PooledPetsResult {
  pool: PooledPet[];
  /** True only if all atom sources (active, hutch, inventory) were read successfully. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert raw hunger value to a percentage using species hunger cap. */
function rawHungerToPct(rawHunger: unknown, species: string): number | null {
  if (typeof rawHunger !== 'number' || !Number.isFinite(rawHunger)) return null;
  const cap = getHungerCapForSpecies(species) ?? DEFAULT_HUNGER_CAP;
  if (cap <= 0) return null;
  return Math.max(0, Math.min(100, (rawHunger / cap) * 100));
}

/** Coerce a raw atom field to string[] */
function toStrArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

/**
 * Resolve strength from a raw item — tries 3 paths in order:
 * 1. Direct `strength` field
 * 2. targetScale + XP  (calculateMaxStrength gives max, XP gives level progress)
 * 3. Name-parse `(maxLevel)` + XP  (for default-named pets like "Turtle (95)")
 */
function resolveStrength(it: Record<string, unknown>): number | null {
  if (typeof it.strength === 'number') return it.strength;
  if (typeof it.xp !== 'number') return null;
  const species = String(it.petSpecies ?? it.species ?? '');
  const xpPerLevel = getSpeciesXpPerLevel(species);
  if (!xpPerLevel) return null;

  // Path 2: targetScale
  if (typeof it.targetScale === 'number') {
    const maxViaScale = calculateMaxStrength(it.targetScale, species);
    if (maxViaScale != null) {
      return (maxViaScale - 30) + Math.min(30, Math.floor(it.xp / xpPerLevel));
    }
  }

  // Path 3: name-parse
  const name = typeof it.name === 'string' ? it.name : '';
  const nameMatch = name.match(/\((\d+)\)/);
  const parsedMax = nameMatch?.[1] ? parseInt(nameMatch[1], 10) : null;
  if (!parsedMax || parsedMax < 70 || parsedMax > 100) return null;
  return (parsedMax - 30) + Math.min(30, Math.floor(it.xp / xpPerLevel));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect all pets the player owns across active slots, hutch, and inventory.
 * Returns only the pool array (discards completeness flag).
 */
export async function getAllPooledPets(): Promise<PooledPet[]> {
  return (await getAllPooledPetsWithStatus()).pool;
}

/**
 * Collect all pets with a completeness flag.
 * `complete` is false if any atom read failed — the pool may be missing pets
 * and should NOT be used for purging.
 */
export async function getAllPooledPetsWithStatus(): Promise<PooledPetsResult> {
  const pool: PooledPet[] = [];
  let complete = true;

  // Active pets
  const active = getActivePetInfos();
  for (const p of active) {
    if (!p.slotId) continue;
    pool.push({
      id: p.slotId,
      petId: p.petId,
      name: p.name ?? p.species ?? '',
      species: p.species ?? '',
      level: p.level,
      strength: p.strength,
      mutations: p.mutations ?? [],
      abilities: p.abilities ?? [],
      xp: p.xp,
      targetScale: p.targetScale,
      hunger: p.hungerPct,
      location: 'active',
      slotIndex: p.slotIndex,
    });
  }

  const activeIds = new Set(pool.map(p => p.id));

  // Hutch pets
  try {
    const hutch = await readAtomValue('hutchPets');
    if (hutch == null) {
      complete = false;
    } else if (!Array.isArray(hutch)) {
      complete = false;
    } else if (hutch.length === 0 && pool.length < 3) {
      // Hutch atom exists but returned empty while active pool is tiny —
      // server data likely hasn't loaded yet.  Mark incomplete to prevent
      // premature purge that would wipe team slots.
      complete = false;
    } else {
      if (hutch.length > 0) store.hutchEverLoaded = true;
      for (const item of hutch) {
        if (!item || typeof item !== 'object') continue;
        const it = item as Record<string, unknown>;
        const id = typeof it.id === 'string' ? it.id : typeof it.itemId === 'string' ? it.itemId : null;
        if (!id || activeIds.has(id)) continue;
        const hutchSpecies = String(it.petSpecies ?? it.species ?? '');
        pool.push({
          id,
          petId: typeof it.petId === 'string' ? it.petId : null,
          name: String(it.name ?? it.species ?? ''),
          species: hutchSpecies,
          level: typeof it.level === 'number' ? it.level : null,
          strength: resolveStrength(it),
          mutations: toStrArr(it.mutations),
          abilities: toStrArr(it.abilities),
          xp: typeof it.xp === 'number' ? it.xp : null,
          targetScale: typeof it.targetScale === 'number' ? it.targetScale : null,
          hunger: rawHungerToPct(it.hunger, hutchSpecies),
          location: 'hutch',
        });
        activeIds.add(id);
      }
    }
  } catch (error) {
    log('[petTeams] failed to read hutch', error);
    complete = false;
  }

  // Inventory pets — use myInventoryAtom (general bag) with .items sub-array,
  // same as xpTrackerWindow. myPetInventoryAtom is a different/empty atom.
  try {
    const invRaw = await readAtomValue('inventory');
    if (invRaw == null) {
      complete = false;
    } else {
      const inv = invRaw as { items?: unknown[] };
      const items = Array.isArray(inv?.items) ? inv.items : Array.isArray(invRaw) ? invRaw : [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const it = item as Record<string, unknown>;
        const itemType = String(it.itemType ?? '').trim().toLowerCase();
        if (itemType !== 'pet') continue;
        const id = typeof it.id === 'string' ? it.id : typeof it.itemId === 'string' ? it.itemId : null;
        if (!id || activeIds.has(id)) continue;
        pool.push({
          id,
          petId: typeof it.petId === 'string' ? it.petId : null,
          name: String(it.name ?? it.species ?? ''),
          species: String(it.petSpecies ?? it.species ?? ''),
          level: typeof it.level === 'number' ? it.level : null,
          strength: resolveStrength(it),
          mutations: toStrArr(it.mutations),
          abilities: toStrArr(it.abilities),
          xp: typeof it.xp === 'number' ? it.xp : null,
          targetScale: typeof it.targetScale === 'number' ? it.targetScale : null,
          hunger: rawHungerToPct(it.hunger, String(it.petSpecies ?? it.species ?? '')),
          location: 'inventory',
        });
        activeIds.add(id);
      }
    }
  } catch (error) {
    log('[petTeams] failed to read inventory', error);
    complete = false;
  }

  return { pool, complete };
}
