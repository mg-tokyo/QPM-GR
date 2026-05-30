// src/data/petHungerCaps.ts
// Hunger capacity lookups for pets - now catalog-first with hardcoded fallback
// The catalog's coinsToFullyReplenishHunger field has a 1:1 ratio with hunger capacity

import { getPetSpecies } from '../../../catalogs/gameCatalogs';

/**
 * Hardcoded hunger capacities as fallback when catalog is unavailable
 * NOTE: Catalog-first approach below will auto-discover new species
 */
const RAW_CAPS: Record<string, number> = {
  worm: 500,
  snail: 1000,
  bee: 1500,
  chicken: 3000,
  bunny: 750,
  dragonfly: 250,
  pig: 50000,
  cow: 25000,
  turkey: 500,              // NEW: Added missing species
  squirrel: 15000,
  turtle: 100000,
  goat: 20000,
  snowfox: 14000,           // NEW: Added missing species
  stoat: 10000,             // NEW: Added missing species
  whitecaribou: 30000,      // NEW: Added missing species (Caribou)
  caribou: 30000,           // Alias for WhiteCaribou
  butterfly: 25000,
  capybara: 150000,
  peacock: 100000,
  sheep: 250,
  horse: 25000,
  hedgehog: 40000,
  pony: 4000,
  firehorse: 200000,
};

export const DEFAULT_HUNGER_CAP = 3000;

function normalizeKey(species: string): string {
  return species.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Get hunger capacity for a pet species
 * Uses catalog-first approach for futureproofing
 *
 * Priority:
 * 1. Catalog coinsToFullyReplenishHunger (1:1 ratio with hunger capacity)
 * 2. Hardcoded fallback values
 * 3. null if unknown
 */
export function getHungerCapForSpecies(species: string | null | undefined): number | null {
  if (!species) {
    return null;
  }

  // Priority 1: Try catalog first (futureproof - auto-updates with new pets)
  try {
    const petEntry = getPetSpecies(species);
    if (petEntry?.coinsToFullyReplenishHunger != null && petEntry.coinsToFullyReplenishHunger > 0) {
      // Catalog data has 1:1 ratio: coins = hunger capacity
      return petEntry.coinsToFullyReplenishHunger;
    }
  } catch (err) {
    // Catalog not loaded or error accessing it - fall through to hardcoded
  }

  // Priority 2: Hardcoded fallback
  const key = normalizeKey(species);
  if (!key) {
    return null;
  }
  return RAW_CAPS[key] ?? null;
}

export function getHungerCapOrDefault(species: string | null | undefined): number {
  return getHungerCapForSpecies(species) ?? DEFAULT_HUNGER_CAP;
}

export function getKnownHungerCaps(): Record<string, number> {
  return { ...RAW_CAPS };
}
