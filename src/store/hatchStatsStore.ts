// Rich per-hatch stats tracking: species + abilities + session/lifetime counts.

import { storage } from '../utils/storage';
import { areCatalogsReady, getAllPetSpecies, onCatalogsReady } from '../catalogs/gameCatalogs';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeHatchStats', 'hatchStats');

const STORAGE_KEY = 'qpm.hatchStats.v1';
const MAX_EVENTS = 100;
const MAX_SEEDED_PET_IDS = 5000;
const CURRENT_VERSION = 1;

export interface HatchEvent {
  species: string;
  rarity: 'normal' | 'gold' | 'rainbow';
  abilities: string[];
  timestamp: number;
}

export interface SpeciesCounts {
  total: number;
  normal: number;
  gold: number;
  rainbow: number;
}

export interface HatchBucket {
  totalHatched: number;
  bySpecies: Record<string, SpeciesCounts>;
  byAbility: Record<string, number>;
}

export interface HatchStatsState {
  lifetime: HatchBucket;
  session: HatchBucket & { start: number };
  recentEvents: HatchEvent[];
  seededPetIds: string[]; // pet IDs already seeded — prevents double-counts on re-seed
  meta: { version: number; updatedAt: number; cleanedAt?: number };
}

export interface PetSeedInput {
  id?: unknown;
  species?: unknown;
  name?: unknown;
  targetScale?: unknown;
  rarity?: unknown;
  isGold?: unknown;
  isRainbow?: unknown;
  abilities?: unknown;
  [key: string]: unknown;
}

function emptyBucket(): HatchBucket {
  return { totalHatched: 0, bySpecies: {}, byAbility: {} };
}

function defaultState(): HatchStatsState {
  return {
    lifetime: emptyBucket(),
    session: { ...emptyBucket(), start: Date.now() },
    recentEvents: [],
    seededPetIds: [],
    meta: { version: CURRENT_VERSION, updatedAt: Date.now() },
  };
}

let state: HatchStatsState = defaultState();
const listeners = new Set<(s: HatchStatsState) => void>();

function notify(): void {
  for (const cb of listeners) {
    try {
      cb(state);
    } catch (error) {
      diag.warn('QPM-STORE-003', { phase: 'notify' }, error);
    }
  }
}

function persist(): void {
  try {
    storage.set(STORAGE_KEY, state);
  } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'stats', key: STORAGE_KEY }, error);
  }
}

// One-time data cleanup — removes inflated/corrupted entries
/** Heuristic: does a species key look like a real species name (not a pet nickname)? */
function looksLikeSpeciesName(key: string): boolean {
  // Real species are short alpha strings like "Turtle", "Butterfly", "Rose"
  // Nicknames contain spaces, special chars, numbers in parens, etc.
  if (key === 'Unknown') return false;
  if (/[()$+#@!&]/.test(key)) return false;
  if (/\d/.test(key)) return false;
  if (key.length > 30) return false;
  return true;
}

function runCleanup(): void {
  if (state.meta.cleanedAt) return;

  const bucket = state.lifetime;
  const originalTotal = bucket.totalHatched;
  const originalSpeciesCount = Object.keys(bucket.bySpecies).length;

  let validSpecies: Set<string> | null = null;
  if (areCatalogsReady()) {
    const all = getAllPetSpecies();
    if (all.length > 0) {
      validSpecies = new Set(all.map(s => s.toLowerCase()));
    }
  }

  const cleanedSpecies: Record<string, SpeciesCounts> = {};
  let cleanedTotal = 0;

  for (const [species, counts] of Object.entries(bucket.bySpecies)) {
    // Always remove "Unknown" entries — they're from extraction failures
    if (species === 'Unknown') continue;

    if (validSpecies) {
      if (!validSpecies.has(species.toLowerCase())) continue;
    } else {
      if (!looksLikeSpeciesName(species)) continue;
    }

    cleanedSpecies[species] = counts;
    cleanedTotal += counts.total;
  }

  bucket.bySpecies = cleanedSpecies;
  bucket.totalHatched = cleanedTotal;

  // Reset byAbility (also inflated proportionally) and recentEvents (contain bad data)
  bucket.byAbility = {};
  state.recentEvents = [];

  state.meta.cleanedAt = Date.now();
  state.meta.updatedAt = Date.now();

  const removed = originalTotal - cleanedTotal;
  const speciesRemoved = originalSpeciesCount - Object.keys(cleanedSpecies).length;

  if (removed > 0 || speciesRemoved > 0) {
    diag.log.debug(`Cleanup: removed ${removed} inflated hatches across ${speciesRemoved} invalid species entries`);
  }

  persist();
}

export function initHatchStatsStore(): void {
  diag.register('Loading hatch stats from storage');
  try {
    const saved = storage.get<HatchStatsState | null>(STORAGE_KEY, null);
    if (saved && saved.meta?.version === CURRENT_VERSION) {
      // Restore lifetime + recentEvents + seededPetIds; always reset session on init
      state = {
        ...saved,
        seededPetIds: Array.isArray(saved.seededPetIds) ? saved.seededPetIds : [],
        session: { ...emptyBucket(), start: Date.now() },
      };
    } else {
      state = defaultState();
    }

    if (!state.meta.cleanedAt) {
      if (areCatalogsReady()) {
        runCleanup();
      } else {
        // Defer cleanup until catalogs are available for species validation
        onCatalogsReady(() => {
          if (!state.meta.cleanedAt) {
            runCleanup();
          }
        });
        // Also run heuristic cleanup immediately as a fallback
        // (in case catalogs never load, we at least remove obvious junk)
        runCleanup();
      }
    }
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'load', key: STORAGE_KEY }, error);
    state = defaultState();
  }

  diag.publishOk('Hatch stats initialised', {
    lifetimeHatched: state.lifetime.totalHatched,
    events: state.recentEvents.length,
    seededIds: state.seededPetIds.length,
  });
}

function incrementBucket(
  bucket: HatchBucket,
  species: string,
  rarity: 'normal' | 'gold' | 'rainbow',
  abilities: string[],
): void {
  bucket.totalHatched++;

  if (!bucket.bySpecies[species]) {
    bucket.bySpecies[species] = { total: 0, normal: 0, gold: 0, rainbow: 0 };
  }
  bucket.bySpecies[species].total++;
  bucket.bySpecies[species][rarity]++;

  for (const ability of abilities) {
    bucket.byAbility[ability] = (bucket.byAbility[ability] ?? 0) + 1;
  }
}

export function recordDetailedHatch(
  species: string,
  rarity: 'normal' | 'gold' | 'rainbow',
  abilities: string[],
  timestamp: number,
): void {
  incrementBucket(state.lifetime, species, rarity, abilities);
  incrementBucket(state.session, species, rarity, abilities);

  const event: HatchEvent = { species, rarity, abilities, timestamp };
  state.recentEvents.unshift(event);
  if (state.recentEvents.length > MAX_EVENTS) {
    state.recentEvents = state.recentEvents.slice(0, MAX_EVENTS);
  }

  state.meta.updatedAt = Date.now();
  persist();
  notify();
}

export function getHatchStatsSnapshot(): HatchStatsState {
  return state;
}

export function subscribeHatchStats(listener: (s: HatchStatsState) => void): () => void {
  listeners.add(listener);
  try {
    listener(state);
  } catch (error) {
    diag.warn('QPM-STORE-003', { phase: 'subscribeInitial' }, error);
  }
  return () => listeners.delete(listener);
}

export function resetHatchStatsSession(): void {
  state.session = { ...emptyBucket(), start: Date.now() };
  state.meta.updatedAt = Date.now();
  persist();
  notify();
}

/** Full reset — clears all lifetime + session + recent events + seeded IDs */
export function resetHatchStats(): void {
  state = defaultState();
  persist();
  notify();
  diag.log.debug('Full reset');
}

function extractSeedMutations(pet: PetSeedInput): string[] {
  const slot = (pet as Record<string, unknown>).slot as Record<string, unknown> | undefined;
  const sources = [pet.mutations, pet.mutation, slot?.mutations, slot?.mutation];
  const result: string[] = [];
  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const item of src) {
        if (typeof item === 'string' && !result.includes(item)) result.push(item);
      }
    } else if (typeof src === 'string' && src.length > 0 && !result.includes(src)) {
      result.push(src);
    }
  }
  return result;
}

function detectSeedRarity(pet: PetSeedInput): 'normal' | 'gold' | 'rainbow' {
  // Primary: check mutations array
  const mutations = extractSeedMutations(pet);
  if (mutations.some(m => m.toLowerCase() === 'rainbow')) return 'rainbow';
  if (mutations.some(m => m.toLowerCase() === 'gold')) return 'gold';

  // Fallback: explicit rarity/boolean fields
  if (pet.rarity) {
    const r = String(pet.rarity).toLowerCase();
    if (r.includes('rainbow')) return 'rainbow';
    if (r.includes('gold')) return 'gold';
  }
  if (pet.isRainbow === true) return 'rainbow';
  if (pet.isGold === true) return 'gold';

  return 'normal';
}

/**
 * Backfill lifetime stats from a list of existing pets (inventory / hutch).
 * Each pet is counted once — duplicate calls with the same pet IDs are ignored.
 * Returns { added } = number of newly added pets.
 */
export function seedLifetimeFromPets(pets: PetSeedInput[]): { added: number } {
  let added = 0;
  const seenIds = new Set(state.seededPetIds);

  for (const pet of pets) {
    const id = typeof pet.id === 'string' && pet.id
      ? pet.id
      : `seed:${pet.species ?? pet.name ?? 'unknown'}:${pet.targetScale ?? 1}:${pets.indexOf(pet)}`;

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const slot = (pet as Record<string, unknown>).slot as Record<string, unknown> | undefined;
    const speciesCandidates = [
      pet.species, slot?.species, slot?.petSpecies,
    ];
    let species = 'Unknown';
    for (const c of speciesCandidates) {
      if (typeof c === 'string' && c.trim().length > 0) {
        species = c.trim();
        break;
      }
    }
    const rarity = detectSeedRarity(pet);
    const abilities = Array.isArray(pet.abilities)
      ? (pet.abilities as unknown[]).filter((a): a is string => typeof a === 'string')
      : [];

    incrementBucket(state.lifetime, species, rarity, abilities);
    added++;
  }

  if (added > 0) {
    let seededList = Array.from(seenIds);
    if (seededList.length > MAX_SEEDED_PET_IDS) {
      seededList = seededList.slice(seededList.length - MAX_SEEDED_PET_IDS);
    }
    state.seededPetIds = seededList;
    state.meta.updatedAt = Date.now();
    persist();
    notify();
  }

  return { added };
}
