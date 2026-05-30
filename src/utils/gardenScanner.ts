// src/utils/gardenScanner.ts
// Garden scanner for finding valuable mutation opportunities

import type { AbilityValuationContext } from '../features/abilityValuation';
import { buildAbilityValuationContext } from '../features/abilityValuation';
import {
  calculateMultiplier,
  getMostValuableWeatherMutation,
  type MutationType,
  type WeatherCondition
} from '../features/garden/data/cropMultipliers';
import { calculatePlantValue } from '../features/economy/valueCalculator';

export interface MutationOpportunity {
  cropSpecies: string;
  cropIndex: number;
  currentMutations: string[];
  currentMultiplier: number;
  currentValue: number;
  targetWeather: WeatherCondition;
  targetMultiplier: number;
  targetValue: number;
  valueDifference: number;
  weatherEventName: string;
}

/**
 * Parse mutations from crop data into mutation type and weather conditions
 */
function parseMutations(mutations: string[]): {
  mutation: MutationType | null;
  weather: WeatherCondition[];
} {
  let mutation: MutationType | null = null;
  const weather: WeatherCondition[] = [];

  for (const mut of mutations) {
    const lower = mut.toLowerCase();
    if (lower === 'golden' || lower === 'gold') {
      mutation = 'golden';
    } else if (lower === 'rainbow') {
      mutation = 'rainbow';
    } else if (lower === 'wet') {
      weather.push('wet');
    } else if (lower === 'chilled') {
      weather.push('chilled');
    } else if (lower === 'frozen') {
      weather.push('frozen');
    } else if (lower === 'dawnlit') {
      weather.push('dawnlit');
    } else if (lower === 'dawnbound') {
      weather.push('dawnbound');
    } else if (lower === 'amberlit') {
      weather.push('amberlit');
    } else if (lower === 'amberbound') {
      weather.push('amberbound');
    }
  }

  return { mutation, weather };
}

/**
 * Scan the garden and find the most valuable mutation opportunity
 * Returns the crop that would benefit most from a weather mutation
 */
export function findBestMutationOpportunity(): MutationOpportunity | null {
  const context: AbilityValuationContext = buildAbilityValuationContext();

  if (context.crops.length === 0) {
    return null;
  }

  // Only consider mature crops
  const matureCrops = context.crops.filter(crop => crop.isMature);
  if (matureCrops.length === 0) {
    return null;
  }

  let bestOpportunity: MutationOpportunity | null = null;

  matureCrops.forEach((crop, index) => {
    const { mutation, weather } = parseMutations(crop.mutations);

    // Get the most valuable weather mutation for this crop
    const opportunity = getMostValuableWeatherMutation(mutation, weather);

    if (!opportunity) {
      return; // No valid mutation available for this crop
    }

    // Calculate current multiplier
    const currentMultiplier = calculateMultiplier(mutation, weather);

    // Calculate current and target values
    const currentValue = crop.currentValue * Math.max(1, crop.fruitCount);
    const targetValue = (currentValue / currentMultiplier) * opportunity.multiplier;
    const valueDifference = targetValue - currentValue;

    // Track the best opportunity (highest value gain)
    if (!bestOpportunity || valueDifference > bestOpportunity.valueDifference) {
      bestOpportunity = {
        cropSpecies: crop.species,
        cropIndex: index,
        currentMutations: [...crop.mutations],
        currentMultiplier,
        currentValue,
        targetWeather: opportunity.weather,
        targetMultiplier: opportunity.multiplier,
        targetValue,
        valueDifference,
        weatherEventName: opportunity.weatherEventName,
      };
    }
  });

  return bestOpportunity;
}

/**
 * Format mutation opportunity for display
 */
export function formatMutationOpportunity(
  opportunity: MutationOpportunity | null,
  petStrength: number,
): string {
  if (!opportunity) {
    return 'No mutation opportunities found';
  }

  const baseChancePercent = opportunity.weatherEventName.includes('Dawn') || opportunity.weatherEventName.includes('Amber')
    ? 1 // Lunar events: 1% base chance
    : 7; // Rain/Frost: 7% base chance

  const boostedChance = baseChancePercent * (petStrength / 100);

  return `Best: ${opportunity.cropSpecies} → ${opportunity.weatherEventName} (${boostedChance.toFixed(2)}% chance, +${(opportunity.targetMultiplier / opportunity.currentMultiplier).toFixed(1)}× value)`;
}
