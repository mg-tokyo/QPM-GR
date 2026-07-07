// Source: https://magicgarden.wiki/Pets

/** Minutes to fully deplete hunger, per species — independent of hunger capacity. */
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

export function getHungerDepletionTime(species: string | null | undefined): number | null {
  if (!species) return null;
  const normalized = species.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return PET_HUNGER_DEPLETION_TIMES[normalized] ?? null;
}

/**
 * @returns Hunger points depleted per minute, or null if unknown
 */
export function getHungerDepletionRate(species: string | null | undefined, hungerCap: number): number | null {
  const depletionTime = getHungerDepletionTime(species);
  if (!depletionTime) return null;

  return hungerCap / depletionTime;
}

/**
 * Feeds needed for a pet to gain X levels, assuming kept above min hunger threshold.
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

  const totalXpNeeded = xpPerLevel * levelsToGain;
  const hoursNeeded = totalXpNeeded / xpPerHour;
  const minutesNeeded = hoursNeeded * 60;
  const hungerDepleted = depletionRate * minutesNeeded;

  // +1 accounts for the initial feed needed to start gaining XP
  const feedsNeeded = Math.ceil(hungerDepleted / hungerCap) + 1;

  return feedsNeeded;
}

export function calculateFeedsPerLevel(
  species: string | null | undefined,
  hungerCap: number,
  xpPerLevel: number,
  xpPerHour: number
): number | null {
  return calculateFeedsForLevels(species, hungerCap, xpPerLevel, xpPerHour, 1);
}
