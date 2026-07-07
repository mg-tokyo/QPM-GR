// Hunger capacity lookups: catalog-first (coinsToFullyReplenishHunger, 1:1 ratio) with hardcoded fallback.

import { getPetSpecies } from '../../../catalogs/gameCatalogs';

/** Hardcoded hunger capacities as fallback when catalog is unavailable. */
const RAW_CAPS: Record<string, number> = {
  worm: 500,
  snail: 1000,
  bee: 1500,
  chicken: 3000,
  bunny: 750,
  dragonfly: 250,
  pig: 50000,
  cow: 25000,
  turkey: 500,
  squirrel: 15000,
  turtle: 100000,
  goat: 20000,
  snowfox: 14000,
  stoat: 10000,
  whitecaribou: 30000,
  caribou: 30000,           // alias for whitecaribou
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

/** Hunger capacity for a species: catalog value, then hardcoded fallback, else null. */
export function getHungerCapForSpecies(species: string | null | undefined): number | null {
  if (!species) {
    return null;
  }

  try {
    const petEntry = getPetSpecies(species);
    if (petEntry?.coinsToFullyReplenishHunger != null && petEntry.coinsToFullyReplenishHunger > 0) {
      return petEntry.coinsToFullyReplenishHunger;
    }
  } catch (err) {
    // catalog unavailable - fall through to hardcoded
  }

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
