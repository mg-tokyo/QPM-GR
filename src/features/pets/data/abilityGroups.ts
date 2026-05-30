// src/data/abilityGroups.ts
// Defines ability groups for cross-ability comparison in Pet Hub

import type { AbilityStats } from '../../../utils/petDataTester';
import { getGardenSnapshot } from '../../garden/bridge';
import { buildAbilityValuationContext, resolveDynamicAbilityEffect } from '../abilityValuation';

/**
 * Ability Group Definition
 * Groups abilities that can be meaningfully compared despite having different effects
 */
export interface AbilityGroup {
  id: string;
  name: string;
  displayName: string;
  description: string;
  abilityIds: string[];
  comparisonMetric: 'value_per_hour' | 'garden_impact' | 'procs_per_hour';
  /**
   * Calculate comparable value for an ability within this group
   * Returns value in coins per hour for comparison purposes
   */
  calculateComparableValue: (ability: AbilityStats, currentStrength: number | null) => number | null;
}

/**
 * Crop Harvest Value Group
 * Abilities that increase coin income through crop harvesting/selling
 * - Double Harvest: Gives extra crop on harvest
 * - Crop Refund: Refunds items when selling (can proc multiple times per sale)
 * - Sell Boost: Percentage bonus on entire sale value
 */
const CROP_HARVEST_VALUE_GROUP: AbilityGroup = {
  id: 'crop_harvest_value',
  name: 'Crop Harvest Value',
  displayName: '💰 Crop Harvest Value',
  description: 'Abilities that increase coin income through harvesting and selling crops',
  abilityIds: [
    'DoubleHarvest',
    'ProduceRefund', // Crop Refund
    'SellBoostI',
    'SellBoostII',
    'SellBoostIII',
    'SellBoostIV',
  ],
  comparisonMetric: 'garden_impact',
  calculateComparableValue: (ability: AbilityStats, currentStrength: number | null): number | null => {
    // Use garden-aware valuation for value per proc
    const gardenSnapshot = getGardenSnapshot();
    const context = buildAbilityValuationContext(gardenSnapshot);

    // Check if ability already has calculated garden value
    if (ability.gardenValuePerProc != null && ability.gardenValuePerProc > 0) {
      return ability.gardenValuePerProc;
    }

    // Try to resolve dynamic ability effect (for garden-dependent abilities like Gold/Rainbow Granter)
    try {
      const dynamicEffect = resolveDynamicAbilityEffect(ability.id, context, currentStrength ?? 100);
      if (dynamicEffect && dynamicEffect.effectPerProc > 0) {
        return dynamicEffect.effectPerProc;
      }
    } catch (e) {
      // Not a dynamically valued ability, continue
    }

    // For abilities without pre-calculated values, estimate based on garden
    if (context.totalMatureValue > 0 && context.crops.length > 0) {
      const avgCropValue = context.totalMatureValue / context.crops.length;

      // Ability-specific calculations
      if (ability.id === 'DoubleHarvest') {
        // Double Harvest: value of getting one extra crop
        return avgCropValue;
      }

      if (ability.id === 'ProduceRefund') {
        // Crop Refund: value of one crop refunded (simplified)
        return avgCropValue;
      }

      if (ability.id.startsWith('SellBoost')) {
        // Sell Boost: percentage of total sale value
        // Extract tier from ability name to determine boost %
        const tier = ability.tier ?? 1;
        const boostPercent = 10 + (tier - 1) * 2; // I:10%, II:12%, III:14%, IV:16%
        return (context.totalMatureValue * boostPercent) / 100;
      }

      // Default: average crop value
      return avgCropValue;
    }

    // Last resort: use effective value if available
    if (ability.effectiveValue != null && ability.effectiveValue > 0) {
      return ability.effectiveValue;
    }

    return null;
  },
};

/**
 * Mutation Group
 * Abilities that transform crops (size, color, mutations)
 * - Crop Size Boost: Increases crop scale (capped at max)
 * - Crop Mutation Boost: Increases mutation chances
 * - Gold Granter: Converts uncolored crops to Gold
 * - Rainbow Granter: Converts uncolored crops to Rainbow
 */
const MUTATION_GROUP: AbilityGroup = {
  id: 'mutation',
  name: 'Mutation',
  displayName: '🌟 Mutation & Transformation',
  description: 'Abilities that transform crops through size increases or color mutations',
  abilityIds: [
    'ProduceScaleBoost', // Crop Size Boost I
    'ProduceScaleBoostII', // Crop Size Boost II
    'ProduceMutationBoost', // Crop Mutation Boost I
    'ProduceMutationBoostII', // Crop Mutation Boost II
    'GoldGranter',
    'RainbowGranter',
  ],
  comparisonMetric: 'garden_impact',
  calculateComparableValue: (ability: AbilityStats, currentStrength: number | null): number | null => {
    // Use garden-aware valuation for mutation abilities
    const gardenSnapshot = getGardenSnapshot();
    const context = buildAbilityValuationContext(gardenSnapshot);

    try {
      const dynamicEffect = resolveDynamicAbilityEffect(ability.id, context, currentStrength ?? 100);
      if (dynamicEffect && dynamicEffect.effectPerProc > 0) {
        // Calculate value per hour: procs/hr × effect per proc
        const procsPerHour = ability.procsPerHour ?? 0;
        return procsPerHour * dynamicEffect.effectPerProc;
      }
    } catch (e) {
      // Fall through to default calculation
    }

    // Fallback to ability's built-in garden value calculations
    if (ability.valuePerHour != null && ability.valuePerHour > 0) {
      return ability.valuePerHour;
    }

    if (ability.gardenValuePerProc != null && ability.procsPerHour != null) {
      return ability.gardenValuePerProc * ability.procsPerHour;
    }

    return null;
  },
};

/**
 * All ability groups
 */
export const ABILITY_GROUPS: AbilityGroup[] = [
  CROP_HARVEST_VALUE_GROUP,
  MUTATION_GROUP,
];

/**
 * Map of ability ID to group
 */
const ABILITY_TO_GROUP_MAP = new Map<string, AbilityGroup>();
for (const group of ABILITY_GROUPS) {
  for (const abilityId of group.abilityIds) {
    ABILITY_TO_GROUP_MAP.set(abilityId, group);
  }
}

/**
 * Get the ability group for a given ability ID
 */
export function getAbilityGroup(abilityId: string): AbilityGroup | null {
  return ABILITY_TO_GROUP_MAP.get(abilityId) ?? null;
}

/**
 * Check if two abilities belong to the same group
 */
export function abilitiesShareGroup(abilityIdA: string, abilityIdB: string): boolean {
  const groupA = getAbilityGroup(abilityIdA);
  const groupB = getAbilityGroup(abilityIdB);
  return groupA != null && groupB != null && groupA.id === groupB.id;
}

/**
 * Get all ability IDs in a specific group
 */
export function getAbilitiesInGroup(groupId: string): string[] {
  const group = ABILITY_GROUPS.find(g => g.id === groupId);
  return group ? group.abilityIds : [];
}

/**
 * Get group display name for filtering
 */
export function getGroupDisplayName(groupId: string): string | null {
  const group = ABILITY_GROUPS.find(g => g.id === groupId);
  return group ? group.displayName : null;
}

/**
 * Calculate comparable values for two abilities in the same group
 * Returns normalized comparison data
 */
export interface AbilityComparison {
  abilityA: AbilityStats;
  abilityB: AbilityStats;
  group: AbilityGroup;
  valueA: number | null;
  valueB: number | null;
  winner: 'A' | 'B' | null;
  comparisonLabel: string;
}

export function compareAbilitiesInGroup(
  abilityA: AbilityStats,
  abilityB: AbilityStats,
  strengthA: number | null,
  strengthB: number | null,
): AbilityComparison | null {
  const groupA = getAbilityGroup(abilityA.id);
  const groupB = getAbilityGroup(abilityB.id);

  if (!groupA || !groupB || groupA.id !== groupB.id) {
    return null; // Not in same group
  }

  const valueA = groupA.calculateComparableValue(abilityA, strengthA);
  const valueB = groupB.calculateComparableValue(abilityB, strengthB);

  let winner: 'A' | 'B' | null = null;
  if (valueA != null && valueB != null) {
    if (valueA > valueB) winner = 'A';
    else if (valueB > valueA) winner = 'B';
  }

  return {
    abilityA,
    abilityB,
    group: groupA,
    valueA,
    valueB,
    winner,
    comparisonLabel: groupA.comparisonMetric === 'value_per_hour'
      ? '💰 Value/Hour'
      : groupA.comparisonMetric === 'garden_impact'
        ? '🌿 Garden Impact/Hour'
        : '⚡ Procs/Hour',
  };
}
