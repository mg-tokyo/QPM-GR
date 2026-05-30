// src/data/petHungerDepletion.ts
// Hunger depletion times from Magic Garden Wiki
// Source: https://magicgarden.wiki/Pets

/**
 * How long it takes for a pet to fully deplete their hunger (minutes)
 * This is independent of hunger capacity - all pets deplete at species-specific rates
 * Source: Magic Garden Wiki (https://magicgarden.wiki/Pets)
 */
export const PET_HUNGER_DEPLETION_TIMES: Record<string, number> = {
  // Common pets
  worm: 30,
  snail: 60,
  bee: 15,

  // Uncommon pets
  chicken: 60,
  bunny: 45,
  dragonfly: 15,

  // Rare pets
  pig: 60,
  cow: 75,
  turkey: 60,

  // Winter pets (Legendary, 100 hours to mature)
  snowfox: 45,
  stoat: 60,
  whitecaribou: 75,
  caribou: 75, // Alias for WhiteCaribou

  // Legendary pets
  squirrel: 30,
  turtle: 90,
  goat: 60,
  pony: 60,
  horse: 75,
  firehorse: 90,

  // Mythical pets
  butterfly: 30,
  peacock: 60,
  capybara: 60,
};

/**
 * Get hunger depletion time in minutes for a species
 */
export function getHungerDepletionTime(species: string | null | undefined): number | null {
  if (!species) return null;
  const normalized = species.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return PET_HUNGER_DEPLETION_TIMES[normalized] ?? null;
}

/**
 * Calculate hunger depletion rate (hunger points per minute)
 * @param species Pet species
 * @param hungerCap Maximum hunger capacity for this species
 * @returns Hunger points depleted per minute, or null if unknown
 */
export function getHungerDepletionRate(species: string | null | undefined, hungerCap: number): number | null {
  const depletionTime = getHungerDepletionTime(species);
  if (!depletionTime) return null;

  // Rate = capacity / time to fully deplete
  return hungerCap / depletionTime;
}

/**
 * Calculate how many feeds are needed for a pet to gain X levels
 * Assumes pet is kept at optimal hunger (> minimum threshold)
 * 
 * @param species Pet species
 * @param hungerCap Pet's hunger capacity
 * @param xpPerLevel XP required per level
 * @param xpPerHour Team XP generation rate (XP/hour)
 * @param levelsToGain Number of levels to calculate feeds for
 * @returns Number of feeds needed, or null if calculation not possible
 */
export function calculateFeedsForLevels(
  species: string | null | undefined,
  hungerCap: number,
  xpPerLevel: number,
  xpPerHour: number,
  levelsToGain: number
): number | null {
  const depletionRate = getHungerDepletionRate(species, hungerCap);
  if (!depletionRate || xpPerHour <= 0) return null;

  // Total XP needed for these levels
  const totalXpNeeded = xpPerLevel * levelsToGain;

  // Time required to gain this XP (hours)
  const hoursNeeded = totalXpNeeded / xpPerHour;

  // Convert to minutes
  const minutesNeeded = hoursNeeded * 60;

  // Hunger depleted during this time
  const hungerDepleted = depletionRate * minutesNeeded;

  // Number of feeds needed (each feed restores full hunger)
  // Add 1 to account for initial feed to start gaining XP
  const feedsNeeded = Math.ceil(hungerDepleted / hungerCap) + 1;

  return feedsNeeded;
}

/**
 * Calculate feeds per level (convenience wrapper)
 */
export function calculateFeedsPerLevel(
  species: string | null | undefined,
  hungerCap: number,
  xpPerLevel: number,
  xpPerHour: number
): number | null {
  return calculateFeedsForLevels(species, hungerCap, xpPerLevel, xpPerHour, 1);
}
