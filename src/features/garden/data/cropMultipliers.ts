// src/data/cropMultipliers.ts
// Crop multiplier data from the game (mutationsDex.ts + sell.ts)
//
// Game formula: growthMult × (1 + SUM(envCoinMultipliers) - count(envMutations))
// Environment coinMultiplier values (from mutationsDex.ts):
//   Wet=2, Chilled=2, Frozen=6, Thunderstruck=5,
//   Dawnlit=4, Ambershine(=Amberlit)=6, Dawncharged(=Dawnbound)=7, Ambercharged(=Amberbound)=10

export type MutationType = 'golden' | 'rainbow';
export type WeatherCondition = 'wet' | 'chilled' | 'frozen' | 'thunderstruck' | 'dawnlit' | 'dawnbound' | 'amberlit' | 'amberbound';

export interface MultiplierCombination {
  mutation?: MutationType;
  weather?: WeatherCondition;
  multiplier: number;
}

// Base coinMultiplier values (from mutationsDex.ts)
// Note: for env mutations, the effective contribution is (coinMultiplier - 1) additively.
export const BASE_MULTIPLIERS = {
  none: 1,
  // Growth mutations
  golden: 25,
  rainbow: 50,
  // Weather conditions (coinMultiplier values from game)
  wet: 2,
  chilled: 2,
  frozen: 6,
  thunderstruck: 5,
  // Time/Lunar mutations (uses display names as keys for backward compat)
  dawnlit: 4,
  dawnbound: 7,    // internal: Dawncharged
  amberlit: 6,     // internal: Ambershine
  amberbound: 10,  // internal: Ambercharged
};

// Combined multipliers computed via game formula:
//   growthMult × (1 + SUM(envCoinMultipliers) - count(envMutations))
export const COMBINED_MULTIPLIERS: Record<string, number> = {
  // Wet/Chilled + Dawn/Amber  (1 × (1 + a + b - 2))
  'wet+dawnlit': 5,          // 1 × (1 + 2 + 4 - 2)
  'chilled+dawnlit': 5,      // 1 × (1 + 2 + 4 - 2)
  'wet+amberlit': 7,         // 1 × (1 + 2 + 6 - 2)
  'chilled+amberlit': 7,     // 1 × (1 + 2 + 6 - 2)
  'wet+dawnbound': 8,        // 1 × (1 + 2 + 7 - 2)
  'chilled+dawnbound': 8,    // 1 × (1 + 2 + 7 - 2)
  'wet+amberbound': 11,      // 1 × (1 + 2 + 10 - 2)
  'chilled+amberbound': 11,  // 1 × (1 + 2 + 10 - 2)
  // Frozen + Dawn/Amber  (1 × (1 + 6 + x - 2))
  'frozen+dawnlit': 9,       // 1 × (1 + 6 + 4 - 2)
  'frozen+dawnbound': 12,    // 1 × (1 + 6 + 7 - 2)
  'frozen+amberlit': 11,     // 1 × (1 + 6 + 6 - 2)
  'frozen+amberbound': 15,   // 1 × (1 + 6 + 10 - 2)
  // Golden + single env  (25 × (1 + x - 1) = 25x)
  'golden+wet': 50,          // 25 × 2
  'golden+chilled': 50,      // 25 × 2
  'golden+frozen': 150,      // 25 × 6
  'golden+thunderstruck': 125, // 25 × 5
  'golden+dawnlit': 100,     // 25 × 4
  'golden+dawnbound': 175,   // 25 × 7
  'golden+amberlit': 150,    // 25 × 6
  'golden+amberbound': 250,  // 25 × 10
  // Golden + two env  (25 × (1 + a + b - 2))
  'golden+wet+dawnlit': 125,       // 25 × (1 + 2 + 4 - 2) = 25 × 5
  'golden+chilled+dawnlit': 125,   // 25 × 5
  'golden+wet+amberlit': 175,      // 25 × (1 + 2 + 6 - 2) = 25 × 7
  'golden+chilled+amberlit': 175,  // 25 × 7
  'golden+wet+dawnbound': 200,     // 25 × (1 + 2 + 7 - 2) = 25 × 8
  'golden+chilled+dawnbound': 200, // 25 × 8
  'golden+wet+amberbound': 275,    // 25 × (1 + 2 + 10 - 2) = 25 × 11
  'golden+chilled+amberbound': 275, // 25 × 11
  'golden+frozen+dawnlit': 225,    // 25 × (1 + 6 + 4 - 2) = 25 × 9
  'golden+frozen+dawnbound': 300,  // 25 × (1 + 6 + 7 - 2) = 25 × 12
  'golden+frozen+amberlit': 275,   // 25 × (1 + 6 + 6 - 2) = 25 × 11
  'golden+frozen+amberbound': 375, // 25 × (1 + 6 + 10 - 2) = 25 × 15
  // Rainbow + single env  (50 × (1 + x - 1) = 50x)
  'rainbow+wet': 100,         // 50 × 2
  'rainbow+chilled': 100,     // 50 × 2
  'rainbow+frozen': 300,      // 50 × 6
  'rainbow+thunderstruck': 250, // 50 × 5
  'rainbow+dawnlit': 200,     // 50 × 4
  'rainbow+dawnbound': 350,   // 50 × 7
  'rainbow+amberlit': 300,    // 50 × 6
  'rainbow+amberbound': 500,  // 50 × 10
  // Rainbow + two env  (50 × (1 + a + b - 2))
  'rainbow+wet+dawnlit': 250,       // 50 × (1 + 2 + 4 - 2) = 50 × 5
  'rainbow+chilled+dawnlit': 250,   // 50 × 5
  'rainbow+wet+amberlit': 350,      // 50 × (1 + 2 + 6 - 2) = 50 × 7
  'rainbow+chilled+amberlit': 350,  // 50 × 7
  'rainbow+wet+dawnbound': 400,     // 50 × (1 + 2 + 7 - 2) = 50 × 8
  'rainbow+chilled+dawnbound': 400, // 50 × 8
  'rainbow+wet+amberbound': 550,    // 50 × (1 + 2 + 10 - 2) = 50 × 11
  'rainbow+chilled+amberbound': 550, // 50 × 11
  'rainbow+frozen+dawnlit': 450,    // 50 × (1 + 6 + 4 - 2) = 50 × 9
  'rainbow+frozen+dawnbound': 600,  // 50 × (1 + 6 + 7 - 2) = 50 × 12
  'rainbow+frozen+amberlit': 550,   // 50 × (1 + 6 + 6 - 2) = 50 × 11
  'rainbow+frozen+amberbound': 750, // 50 × (1 + 6 + 10 - 2) = 50 × 15
};

/**
 * Calculate the multiplier for a given combination of mutation and weather conditions.
 * Uses the game formula: growthMult × (1 + SUM(envCoinMultipliers) - count(envMutations))
 */
export function calculateMultiplier(
  mutation: MutationType | null,
  weatherConditions: WeatherCondition[],
): number {
  // Try lookup table first
  const parts: string[] = [];
  if (mutation) parts.push(mutation);
  weatherConditions.sort().forEach((w) => parts.push(w));
  const key = parts.join('+');
  if (COMBINED_MULTIPLIERS[key]) {
    return COMBINED_MULTIPLIERS[key];
  }

  // Fallback: compute from formula
  const growthMult = mutation ? BASE_MULTIPLIERS[mutation] : 1;
  const envSum = weatherConditions.reduce((acc, w) => acc + BASE_MULTIPLIERS[w], 0);
  const envCount = weatherConditions.length;
  return growthMult * (1 + envSum - envCount);
}

/**
 * Get the most valuable weather mutation for a crop
 * Returns the weather condition and resulting multiplier
 */
export function getMostValuableWeatherMutation(
  currentMutation: MutationType | null,
  currentWeather: WeatherCondition[],
): { weather: WeatherCondition; multiplier: number; weatherEventName: string } | null {
  // All possible weather mutations that can be added
  const possibleWeather: Array<{ weather: WeatherCondition; event: string }> = [
    { weather: 'wet', event: 'Rain' },
    { weather: 'chilled', event: 'Frost' },
    { weather: 'frozen', event: 'Rain+Frost' },
    { weather: 'thunderstruck', event: 'Thunderstorm' },
    { weather: 'dawnlit', event: 'Dawn' },
    { weather: 'amberlit', event: 'Amber Moon' },
  ];

  let best: { weather: WeatherCondition; multiplier: number; weatherEventName: string } | null = null;

  for (const { weather, event } of possibleWeather) {
    // Skip if crop already has this weather condition
    if (currentWeather.includes(weather)) continue;

    // Skip incompatible combinations
    if (weather === 'dawnlit' && currentWeather.some((w) => w === 'amberlit' || w === 'amberbound')) continue;
    if (weather === 'amberlit' && currentWeather.some((w) => w === 'dawnlit' || w === 'dawnbound')) continue;
    if (weather === 'wet' && currentWeather.includes('chilled')) {
      // This would create frozen
      continue;
    }
    if (weather === 'chilled' && currentWeather.includes('wet')) {
      // This would create frozen
      continue;
    }

    const newWeather = [...currentWeather, weather];
    const newMultiplier = calculateMultiplier(currentMutation, newWeather);

    if (!best || newMultiplier > best.multiplier) {
      best = { weather, multiplier: newMultiplier, weatherEventName: event };
    }
  }

  return best;
}
