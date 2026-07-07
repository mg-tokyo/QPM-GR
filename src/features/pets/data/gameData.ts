// Source: https://magicgarden.wiki/ (last updated 2025-11-25)

import { t } from '../../../i18n';

/** Pet ability count probabilities keyed by max ability slots. */
export const PET_ABILITY_PROBABILITIES = {
  oneAbilitySlot: {
    1: 1.0,
  },

  twoAbilitySlots: {
    1: 0.90,
    2: 0.10,
  },

  threeAbilitySlots: {
    1: 0.70,
    2: 0.29,
    3: 0.01,
  },

  fourAbilitySlots: {
    2: 0.99,
    3: 0.01,
  },
} as const;

/** Special pet hatch overlay rates. */
export const SPECIAL_PET_RATES = {
  rainbow: 0.001,
  golden: 0.01,
} as const;

/** Pet species rates by egg type. */
export const EGG_PET_RATES = {
  Common: {
    Worm: 0.60,
    Snail: 0.35,
    Bee: 0.05,
  },

  Uncommon: {
    Chicken: 0.65,
    Bunny: 0.25,
    Dragonfly: 0.10,
  },

  Rare: {
    Pig: 0.80,
    Cow: 0.15,
    Turkey: 0.05,
  },

  Legendary: {
    Turtle: 0.30,
    Goat: 0.10,
    Squirrel: 0.60,
  },

  Mythical: {
    Capybara: 0.05,
    Butterfly: 0.75,
    Peacock: 0.20,
  },

  // Dawn content (PR-2644) — rates confirmed from beta eggsDex
  Dawn: {
    Sheep: 0.60,
    Horse: 0.35,
    Hedgehog: 0.05,
  },

  Horse: {
    Pony: 0.60,
    Horse: 0.35,
    FireHorse: 0.05,
  },
} as const;

/** Maps pet species to their possible abilities. */
export const PET_ABILITY_POOLS = {
  // Common Eggs
  Worm: ['Seed Finder I', 'Produce Eater'],
  Snail: ['Coin Finder I'],
  Bee: ['Produce Size Boost I', 'Mutation I'],

  // Uncommon Eggs
  Chicken: ['Egg Growth Boost I', 'Pet Refund'],
  Bunny: ['Coin Finder II', 'Sell Boost I'],
  Dragonfly: ['Hunger Restore I', 'Pet Mutation Boost I'],

  // Rare Eggs
  Pig: ['Sell Boost II', 'Hatch XP Boost I', 'Max Strength I'],
  Cow: ['Seed Finder II', 'Hunger Boost I', 'Plant Growth I'],
  Turkey: ['Rain Dance', 'Egg Growth II', 'Double Hatch'],

  // Legendary Eggs
  Turtle: ['Hunger Restore II', 'Hunger Boost II', 'Egg Growth II', 'Plant Growth II'],
  Goat: ['XP Boost', 'Hatch XP Boost II', 'Max Strength II'],
  Squirrel: ['Pet Mutation Boost II', 'Coin Finder III', 'Sell Boost III'],

  // Mythical Eggs
  Capybara: ['Produce Refund', 'Double Harvest'],
  Butterfly: ['Crop Size Boost II', 'Produce Mutation II', 'Seed Finder III'],
  Peacock: ['Sell Boost IV', 'XP Boost II', 'Pet Refund II'],

  // Dawn Eggs (PR-2644) — abilities confirmed from beta faunaSpeciesDex
  Sheep: ['Dawn Coin Finder', 'Dawnlit Granter', 'Dawnbinder Boost'],
  Horse: ['Dawn Boost', 'Dawnlit Granter', 'Dawn Plant Growth Boost', 'Pet Age Boost II'],
  Hedgehog: ['Dawn Capture', 'Dawn XP Boost', 'Produce Scale Boost II'],

  // Horse Eggs (PR-2644)
  Pony: ['Sell Boost III', 'Coin Finder III', 'Hunger Restore II', 'Seed Finder II'],
  FireHorse: ['Amber Moon Boost', 'Pet Hatch Size Boost II', 'Amberlit Granter', 'Amber Plant Growth Boost'],
} as const;

/**
 * Weather Event Timing and Probabilities
 */
export const WEATHER_EVENT_TIMING = {
  /** Regular weather events (Rain/Snow) */
  regular: {
    intervalMin: 20, // minutes
    intervalMax: 35, // minutes
    durationMinutes: 5,

    chances: {
      rain: 0.75,    // 75%
      snow: 0.25,    // 25%
    },
  },

  /** Lunar weather events (Dawn/Harvest Moon) */
  lunar: {
    intervalHours: 4,
    durationMinutes: 10,
    startTimeAEST: '12:00 AM', // Midnight AEST

    chances: {
      dawn: 0.67,         // 67%
      harvestMoon: 0.33,  // 33%
    },
  },
} as const;

/**
 * Calculate next lunar event time from AEST midnight
 * Lunar events occur every 4 hours from 12AM AEST
 */
export function getNextLunarEventTime(): Date {
  const now = new Date();

  // AEST is UTC+10 (or UTC+11 during daylight saving)
  // For simplicity, using UTC+10 (Australian Eastern Standard Time)
  const aestOffset = 10 * 60; // minutes

  // Get current time in AEST
  const nowUTC = now.getTime();
  const nowAEST = new Date(nowUTC + aestOffset * 60 * 1000);

  // Get midnight AEST today
  const midnightAEST = new Date(nowAEST);
  midnightAEST.setHours(0, 0, 0, 0);

  // Lunar events: 12am, 4am, 8am, 12pm, 4pm, 8pm AEST
  const lunarHours = [0, 4, 8, 12, 16, 20];

  // Find next lunar event
  for (const hour of lunarHours) {
    const eventTime = new Date(midnightAEST);
    eventTime.setHours(hour);

    if (eventTime > nowAEST) {
      // Convert back to user's local time
      return new Date(eventTime.getTime() - aestOffset * 60 * 1000);
    }
  }

  // If no events today, return first event tomorrow
  const tomorrowMidnight = new Date(midnightAEST);
  tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
  return new Date(tomorrowMidnight.getTime() - aestOffset * 60 * 1000);
}

/**
 * Weather Effect Mechanics
 * NOTE: Only fully mature crops get weather bonuses
 */
export const WEATHER_EFFECT_NOTES = {
  requirement: 'Only fully mature crops get weather bonuses',
  recommendation: 'Plan harvest and mutation timing around events for best results',
} as const;

/**
 * Mutation Chances
 */
export const MUTATION_CHANCES = {
  /** Base chance for lunar mutations per crop during lunar events */
  lunarBase: 0.01, // 1% per crop

  /** Can be boosted by Crop Mutation Boost I & II abilities */

  /** Dawncharged/Ambercharged mutation chance */
  charged: {
    requirement: 'Place lit crop next to Moonbinder/Dawnbinder during respective weather',
    chancePerMinute: 0.25, // 25% per minute
  },
} as const;

/**
 * Crop Tier Classification (based on shop availability)
 * Higher tier = lower quantity and appearance rate in shop
 */
export type CropTier = 'common' | 'uncommon' | 'rare' | 'mythic' | 'divine' | 'celestial';

/**
 * Get estimated time to complete variant based on difficulty
 */
export function getVariantTimeEstimate(difficulty: 'easy' | 'medium' | 'hard' | 'very-hard'): string {
  switch (difficulty) {
    case 'easy':
      return t('feature.journal.time.20to30min');
    case 'medium':
      return t('feature.journal.time.30to45min');
    case 'hard':
      return t('feature.journal.time.severalHoursToDay');
    case 'very-hard':
      return t('feature.journal.time.daysToWeeks');
  }
}

/**
 * Expected eggs needed to get specific abilities
 */
export const EXPECTED_EGGS_FOR_ABILITIES = {
  rainbowGranter: 10000, // 0.1% chance = ~10,000 eggs expected
  goldGranter: 1000,     // 1% chance = ~1,000 eggs expected

  /** Note: Higher tier eggs stock less frequently, making acquisition slower */
} as const;
