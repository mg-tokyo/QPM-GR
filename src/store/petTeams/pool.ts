import { getActivePetInfos } from '../pets';
import { readAtomValue } from '../../core/atomRegistry';
import { getSpeciesXpPerLevel, calculateMaxStrength } from '../xpTracker';
import { getHungerCapForSpecies, DEFAULT_HUNGER_CAP } from '../../features/pets/data/petHungerCaps';
import type { PooledPet } from '../../types/petTeams';
import { store, diag } from './state';

export interface PooledPetsResult {
  pool: PooledPet[];
  /** True only if all atom sources (active, hutch, inventory) were read successfully. */
  complete: boolean;
}

function rawHungerToPct(rawHunger: unknown, species: string): number | null {
  if (typeof rawHunger !== 'number' || !Number.isFinite(rawHunger)) return null;
  const cap = getHungerCapForSpecies(species) ?? DEFAULT_HUNGER_CAP;
  if (cap <= 0) return null;
  return Math.max(0, Math.min(100, (rawHunger / cap) * 100));
}

function toStrArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

/** Resolve strength: direct field, else targetScale+XP, else name-parsed `(maxLevel)`+XP. */
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

export async function getAllPooledPets(): Promise<PooledPet[]> {
  return (await getAllPooledPetsWithStatus()).pool;
}

/** `complete` is false if any atom read failed — pool may be missing pets, do NOT use for purging. */
export async function getAllPooledPetsWithStatus(): Promise<PooledPetsResult> {
  const pool: PooledPet[] = [];
  let complete = true;

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

  try {
    const hutch = await readAtomValue('hutchPets');
    if (hutch == null) {
      complete = false;
    } else if (!Array.isArray(hutch)) {
      complete = false;
    } else if (hutch.length === 0 && pool.length < 3) {
      // Empty hutch + tiny active pool likely means server data hasn't loaded yet — mark incomplete to avoid a premature purge.
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
    diag.warn('QPM-STORE-002', { atom: 'hutchPets', phase: 'getAllPooledPetsWithStatus' }, error);
    complete = false;
  }

  // Uses myInventoryAtom (general bag) .items — myPetInventoryAtom is a different/empty atom.
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
    diag.warn('QPM-STORE-002', { atom: 'inventory', phase: 'getAllPooledPetsWithStatus' }, error);
    complete = false;
  }

  return { pool, complete };
}
