// src/utils/petDataTester.ts
// Test utility to verify we can access all detailed pet statistics for comparison hub

import { getActivePetInfos } from '../store/pets';
import { getAbilityDefinition, getAllAbilityDefinitions } from '../features/pets/data/petAbilities';
import { getHungerCapForSpecies } from '../features/pets/data/petHungerCaps';
import { getHungerDepletionRate } from '../features/pets/data/petHungerDepletion';
import { getTimeToMature } from '../features/pets/data/petTimeToMature';
import { log } from './logger';
import {
  buildAbilityValuationContext,
  resolveDynamicAbilityEffect,
  type AbilityValuationContext,
  type DynamicAbilityEffect,
} from '../features/pets/abilityValuation';
import { calculateMaxStrength, getSpeciesMaxScale } from '../store/xpTracker';

/**
 * Comprehensive pet statistics for comparison
 */
export interface DetailedPetStats {
  // === BASIC INFO ===
  petId: string | null;
  name: string | null;
  species: string | null;
  location: 'active' | 'inventory' | 'hutch';
  slotIndex: number;
  
  // === STRENGTH & GROWTH ===
  currentStrength: number | null;      // Current strength (0-100)
  maxStrength: number | null;          // Maximum potential strength (based on scale)
  targetScale: number | null;          // Current scale (1.0 - maxScale)
  maxScale: number | null;             // Species max scale (e.g., 2.0 for most pets)
  strengthProgress: number | null;     // Percentage to max strength (%)
  maturityTime: number | null;         // Hours to mature
  
  // === XP & LEVELING ===
  xp: number | null;                   // Current XP
  level: number | null;                // Estimated level
  xpToNextLevel: number | null;        // XP needed for next level
  
  // === HUNGER SYSTEM ===
  hungerPct: number | null;            // Current hunger (%)
  hungerValue: number | null;          // Current hunger (raw value)
  hungerMax: number | null;            // Max hunger capacity
  hungerDepletionRate: number | null;  // Hunger depletion per hour
  feedsPerHour: number | null;         // How many feeds needed per hour
  timeUntilStarving: number | null;    // Hours until 0% hunger
  
  // === MUTATIONS ===
  mutations: string[];                 // e.g., ["Gold", "Rainbow"]
  mutationCount: number;               // Number of mutations
  hasGold: boolean;
  hasRainbow: boolean;
  
  // === ABILITIES ===
  abilities: AbilityStats[];           // Detailed stats for each ability
  abilityCount: number;                // Total number of abilities
  
  // === POSITION ===
  position: { x: number | null; y: number | null } | null;
  
  // === TIMESTAMPS ===
  updatedAt: number;
  
  // === RAW DATA ===
  raw: unknown;
}

/**
 * Detailed ability statistics
 */
export interface AbilityStats {
  // === BASIC INFO ===
  id: string;                          // e.g., "SeedFinderIV"
  name: string;                        // e.g., "Seed Finder IV"
  tier: number | null;                 // Tier (1-4) or null if no tier
  baseName: string;                    // e.g., "Seed Finder" (without tier)
  category: string;                    // e.g., "coins", "xp", "plantGrowth"
  trigger: string;                     // e.g., "continuous", "harvest", "sellAllCrops"
  
  // === PROBABILITY & PROC RATES ===
  baseProbability: number | null;      // Base chance (%) per roll
  effectiveProbability: number | null; // Base × (strength/100)
  rollPeriodMinutes: number | null;    // How often it rolls (minutes)
  procsPerHour: number | null;         // Expected procs per hour
  procsPerDay: number | null;          // Expected procs per day
  timeBetweenProcs: number | null;     // Average minutes between procs
  
  // === EFFECT VALUES ===
  effectLabel: string | null;          // e.g., "Scale increase", "Time reduction"
  effectBaseValue: number | null;      // e.g., 6 for "6% × STR"
  effectSuffix: string | null;         // e.g., "%", "m", ""
  effectiveValue: number | null;       // Base × (strength/100)
  effectUnit: string | null;           // e.g., "minutes", "xp", "coins"
  
  // === COMPARATIVE METRICS ===
  valuePerHour: number | null;         // Expected value generated per hour
  valuePerDay: number | null;          // Expected value generated per day
  
  // === GARDEN VALUE (for abilities affecting garden) ===
  gardenValuePerProc: number | null;   // Coin value per proc based on current garden
  gardenValueDetail: string | null;    // Explanation of garden value calculation
  
  // === NOTES ===
  notes: string | null;                // Additional info
}

/**
 * Calculate detailed ability statistics
 */
const DYNAMIC_ABILITY_IDS = new Set([
  'ProduceScaleBoost',
  'ProduceScaleBoostII',
  'GoldGranter',
  'RainbowGranter',
  'ProduceMutationBoost',
  'ProduceMutationBoostII',
]);

const ABILITY_CONTEXT_TTL_MS = 5000;
let cachedAbilityContext: AbilityValuationContext | null = null;
let cachedAbilityContextTimestamp = 0;

function getCachedAbilityValuationContext(): AbilityValuationContext | null {
  const now = Date.now();
  if (cachedAbilityContext && now - cachedAbilityContextTimestamp < ABILITY_CONTEXT_TTL_MS) {
    return cachedAbilityContext;
  }
  try {
    cachedAbilityContext = buildAbilityValuationContext();
    cachedAbilityContextTimestamp = now;
  } catch (error) {
    cachedAbilityContext = null;
    cachedAbilityContextTimestamp = 0;
    log('Failed to build ability valuation context:', error);
  }
  return cachedAbilityContext;
}

function resolveDynamicAbilityEffectWithCache(
  abilityId: string,
  strength: number | null,
): DynamicAbilityEffect | null {
  if (!DYNAMIC_ABILITY_IDS.has(abilityId)) {
    return null;
  }
  const context = getCachedAbilityValuationContext();
  if (!context) {
    return null;
  }
  try {
    return resolveDynamicAbilityEffect(abilityId, context, strength);
  } catch (error) {
    log('Failed to resolve dynamic ability effect:', error);
    return null;
  }
}

function calculateAbilityStats(
  abilityId: string,
  petStrength: number | null,
): AbilityStats {
  const def = getAbilityDefinition(abilityId);
  const strength = petStrength ?? 100;
  
  // Extract tier from ability ID (e.g., "SeedFinderIV" -> 4)
  let tier: number | null = null;
  let baseName = def?.name ?? abilityId;
  
  const tierMatch = abilityId.match(/I{1,3}V?$/);
  if (tierMatch) {
    const romanTier = tierMatch[0];
    const tierMap: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };
    tier = tierMap[romanTier] ?? null;
    baseName = baseName.replace(/\s+(I{1,3}V?|[1-4])$/, '');
  }
  
  // Calculate probability and proc rates
  const baseProbability = def?.baseProbability ?? null;
  const effectiveProbability = baseProbability != null ? (baseProbability * strength) / 100 : null;
  const rollPeriodMinutes = def?.rollPeriodMinutes ?? null;
  
  let procsPerHour: number | null = null;
  let procsPerDay: number | null = null;
  let timeBetweenProcs: number | null = null;
  
  if (effectiveProbability != null && rollPeriodMinutes != null && rollPeriodMinutes > 0) {
    const rollsPerHour = 60 / rollPeriodMinutes;
    procsPerHour = (effectiveProbability / 100) * rollsPerHour;
    procsPerDay = procsPerHour * 24;
    timeBetweenProcs = procsPerHour > 0 ? 60 / procsPerHour : null;
  }
  
  // Calculate effective values
  const effectBaseValue = def?.effectBaseValue ?? null;
  const effectiveValue = effectBaseValue != null ? (effectBaseValue * strength) / 100 : null;
  
  // Calculate value per time period
  const effectValuePerProc = def?.effectValuePerProc ?? null;
  let valuePerHour: number | null = null;
  let valuePerDay: number | null = null;
  
  if (effectValuePerProc != null && procsPerHour != null) {
    valuePerHour = effectValuePerProc * procsPerHour;
    valuePerDay = valuePerHour * 24;
  }
  
  // Calculate garden value for abilities that affect garden
  let gardenValuePerProc: number | null = null;
  let gardenValueDetail: string | null = null;
  
  const dynamicEffect = resolveDynamicAbilityEffectWithCache(abilityId, strength);
  if (dynamicEffect) {
    gardenValuePerProc = dynamicEffect.effectPerProc;
    gardenValueDetail = dynamicEffect.detail;

    // Update valuePerHour/Day with garden value if not already set
    if (gardenValuePerProc != null && gardenValuePerProc > 0 && procsPerHour != null && valuePerHour == null) {
      valuePerHour = gardenValuePerProc * procsPerHour;
      valuePerDay = valuePerHour * 24;
    }
  } else if (DYNAMIC_ABILITY_IDS.has(abilityId) && gardenValueDetail == null) {
    gardenValueDetail = 'Garden context not available';
  }
  
  return {
    id: abilityId,
    name: def?.name ?? abilityId,
    tier,
    baseName,
    category: def?.category ?? 'misc',
    trigger: def?.trigger ?? 'unknown',
    baseProbability,
    effectiveProbability,
    rollPeriodMinutes,
    procsPerHour,
    procsPerDay,
    timeBetweenProcs,
    effectLabel: def?.effectLabel ?? null,
    effectBaseValue,
    effectSuffix: def?.effectSuffix ?? null,
    effectiveValue,
    effectUnit: def?.effectUnit ?? null,
    valuePerHour,
    valuePerDay,
    gardenValuePerProc,
    gardenValueDetail,
    notes: def?.notes ?? null,
  };
}

/**
 * Get detailed statistics for a pet
 */
export function getDetailedPetStats(
  petInfo: ReturnType<typeof getActivePetInfos>[0],
): DetailedPetStats {
  const species = petInfo.species ?? '';
  const targetScale = petInfo.targetScale ?? null;
  
  const speciesMaxScale = species ? getSpeciesMaxScale(species) : null;

  // Get species-specific data
  const hungerMax = getHungerCapForSpecies(species);
  const hungerDepletionRate = hungerMax != null ? getHungerDepletionRate(species, hungerMax) : null;
  const maturityTime = getTimeToMature(species);
  
  // Calculate max strength using shared XP tracker helper
  let maxStrength = calculateMaxStrength(targetScale, species);
  if (maxStrength == null && targetScale != null) {
    // Fallback to a simple linear interpolation when species data is missing
    const denominator = speciesMaxScale ? Math.max(0.01, speciesMaxScale - 1) : 1;
    const ratio = Math.max(0, Math.min(1, (targetScale - 1) / denominator));
    maxStrength = Math.round(80 + ratio * 20);
  }
  
  // Get current strength and CAP at maxStrength (handle XP overflow)
  let currentStrength = petInfo.strength ?? null;
  if (currentStrength != null && maxStrength != null && currentStrength > maxStrength) {
    currentStrength = maxStrength;
  }
  const strengthProgress = currentStrength != null && maxStrength != null
    ? Math.round((currentStrength / maxStrength) * 100)
    : null;
  
  // Calculate hunger metrics
  const hungerValue = petInfo.hungerValue ?? null;
  const hungerPct = petInfo.hungerPct ?? null;
  
  let feedsPerHour: number | null = null;
  let timeUntilStarving: number | null = null;
  
  if (hungerDepletionRate != null && hungerMax != null) {
    const depletionPerHour = hungerDepletionRate;
    feedsPerHour = depletionPerHour / hungerMax;
    
    if (hungerPct != null && depletionPerHour > 0) {
      timeUntilStarving = (hungerPct / 100) * (hungerMax / depletionPerHour);
    }
  }
  
  // Calculate XP metrics
  const xp = petInfo.xp ?? null;
  const level = petInfo.level ?? null;
  // TODO: Calculate XP to next level based on level formula
  const xpToNextLevel: number | null = null;
  
  // Process abilities
  const abilityStats = (petInfo.abilities ?? []).map(abilityId =>
    calculateAbilityStats(abilityId, currentStrength)
  );
  
  // Mutation flags
  const mutations = petInfo.mutations ?? [];
  const hasGold = mutations.some(m => m.toLowerCase().includes('gold'));
  const hasRainbow = mutations.some(m => m.toLowerCase().includes('rainbow'));
  
  return {
    // Basic info
    petId: petInfo.petId,
    name: petInfo.name,
    species: petInfo.species,
    location: 'active', // TODO: Determine from context
    slotIndex: petInfo.slotIndex,
    
    // Strength & growth
    currentStrength,
    maxStrength,
    targetScale,
    maxScale: speciesMaxScale,
    strengthProgress,
    maturityTime,
    
    // XP & leveling
    xp,
    level,
    xpToNextLevel,
    
    // Hunger system
    hungerPct,
    hungerValue,
    hungerMax,
    hungerDepletionRate,
    feedsPerHour,
    timeUntilStarving,
    
    // Mutations
    mutations,
    mutationCount: mutations.length,
    hasGold,
    hasRainbow,
    
    // Abilities
    abilities: abilityStats,
    abilityCount: abilityStats.length,
    
    // Position
    position: petInfo.position,
    
    // Timestamps
    updatedAt: petInfo.updatedAt,
    
    // Raw data
    raw: petInfo.raw,
  };
}

/**
 * Format coin value for display
 */
function formatCoinValue(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B coins`;
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M coins`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K coins`;
  } else {
    return `${value.toFixed(0)} coins`;
  }
}

/**
 * TEST COMMAND: Get all active pets with detailed statistics
 * 
 * Usage in console:
 *   window.testPetData()
 */
export function testPetData(): void {
  log('🧪 Testing Pet Data Access...\n');
  
  const activePets = getActivePetInfos();
  
  if (activePets.length === 0) {
    log('❌ No active pets found. Make sure pets are placed in your garden.');
    return;
  }
  
  log(`✅ Found ${activePets.length} active pet(s)\n`);
  log('='.repeat(80) + '\n');
  
  for (const petInfo of activePets) {
    const stats = getDetailedPetStats(petInfo);
    
    log(`\n🐾 PET: ${stats.name ?? 'Unnamed'} (${stats.species ?? 'Unknown Species'})`);
    log(`   ID: ${stats.petId ?? 'N/A'}`);
    log(`   Slot: ${stats.slotIndex}`);
    log('');
    
    log(`📊 STRENGTH & GROWTH:`);
    log(`   Current Strength: ${stats.currentStrength ?? 'N/A'}`);
    log(`   Max Strength: ${stats.maxStrength ?? 'N/A'}`);
    log(`   Strength Progress: ${stats.strengthProgress != null ? `${stats.strengthProgress}%` : 'N/A'}`);
    log(`   Target Scale: ${stats.targetScale ?? 'N/A'}`);
    log(`   Max Scale: ${stats.maxScale ?? 'N/A'}`);
    log(`   Time to Mature: ${stats.maturityTime != null ? `${stats.maturityTime}h` : 'N/A'}`);
    log('');
    
    log(`🎓 XP & LEVELING:`);
    log(`   XP: ${stats.xp ?? 'N/A'}`);
    log(`   Level: ${stats.level ?? 'N/A'}`);
    log(`   XP to Next Level: ${stats.xpToNextLevel ?? 'N/A'}`);
    log('');
    
    log(`🍖 HUNGER SYSTEM:`);
    log(`   Hunger: ${stats.hungerPct != null ? `${stats.hungerPct.toFixed(1)}%` : 'N/A'}`);
    log(`   Hunger Value: ${stats.hungerValue ?? 'N/A'} / ${stats.hungerMax ?? 'N/A'}`);
    log(`   Depletion Rate: ${stats.hungerDepletionRate != null ? `${stats.hungerDepletionRate}/h` : 'N/A'}`);
    log(`   Feeds Per Hour: ${stats.feedsPerHour != null ? stats.feedsPerHour.toFixed(2) : 'N/A'}`);
    log(`   Time Until Starving: ${stats.timeUntilStarving != null ? `${stats.timeUntilStarving.toFixed(1)}h` : 'N/A'}`);
    log('');
    
    log(`✨ MUTATIONS (${stats.mutationCount}):`);
    if (stats.mutations.length > 0) {
      stats.mutations.forEach(m => log(`   • ${m}`));
      log(`   Gold: ${stats.hasGold ? '✅' : '❌'}`);
      log(`   Rainbow: ${stats.hasRainbow ? '✅' : '❌'}`);
    } else {
      log(`   (none)`);
    }
    log('');
    
    log(`⚡ ABILITIES (${stats.abilityCount}):`);
    if (stats.abilities.length > 0) {
      for (const ability of stats.abilities) {
        log(`\n   📌 ${ability.name} (${ability.id})`);
        log(`      Category: ${ability.category} | Trigger: ${ability.trigger}`);
        log(`      Tier: ${ability.tier ?? 'N/A'} | Base Name: ${ability.baseName}`);
        log('');
        log(`      PROBABILITY & PROC RATES:`);
        log(`      • Base Probability: ${ability.baseProbability != null ? `${ability.baseProbability}%` : 'N/A'}`);
        log(`      • Effective Probability: ${ability.effectiveProbability != null ? `${ability.effectiveProbability.toFixed(2)}%` : 'N/A'}`);
        log(`      • Roll Period: ${ability.rollPeriodMinutes != null ? `${ability.rollPeriodMinutes}m` : 'N/A'}`);
        log(`      • Procs Per Hour: ${ability.procsPerHour != null ? ability.procsPerHour.toFixed(2) : 'N/A'}`);
        log(`      • Procs Per Day: ${ability.procsPerDay != null ? ability.procsPerDay.toFixed(2) : 'N/A'}`);
        log(`      • Avg Time Between Procs: ${ability.timeBetweenProcs != null ? `${ability.timeBetweenProcs.toFixed(1)}m` : 'N/A'}`);
        log('');
        log(`      EFFECT VALUES:`);
        log(`      • Label: ${ability.effectLabel ?? 'N/A'}`);
        log(`      • Base Value: ${ability.effectBaseValue != null ? `${ability.effectBaseValue}${ability.effectSuffix ?? ''}` : 'N/A'}`);
        log(`      • Effective Value: ${ability.effectiveValue != null ? `${ability.effectiveValue.toFixed(2)}${ability.effectSuffix ?? ''}` : 'N/A'}`);
        log(`      • Unit: ${ability.effectUnit ?? 'N/A'}`);
        log('');
        
        // Show garden value if available
        if (ability.gardenValuePerProc != null) {
          log(`      🌿 GARDEN VALUE:`);
          log(`      • Value Per Proc: ${formatCoinValue(ability.gardenValuePerProc)}`);
          if (ability.gardenValueDetail) {
            log(`      • Detail: ${ability.gardenValueDetail}`);
          }
          log('');
        }
        
        log(`      VALUE PER TIME:`);
        log(`      • Value Per Hour: ${ability.valuePerHour != null ? formatCoinValue(ability.valuePerHour) : 'N/A'}`);
        log(`      • Value Per Day: ${ability.valuePerDay != null ? formatCoinValue(ability.valuePerDay) : 'N/A'}`);
        
        if (ability.notes) {
          log('');
          log(`      📝 Notes: ${ability.notes}`);
        }
      }
    } else {
      log(`   (none)`);
    }
    
    log('\n' + '='.repeat(80));
  }
  
  log('\n✅ Test complete! All pet data accessed successfully.\n');
  log('💡 Available data includes:');
  log('   • Basic info (name, species, ID, slot)');
  log('   • Strength metrics (current, max, progress, scale)');
  log('   • XP & leveling data');
  log('   • Hunger system (%, value, depletion rate, feeds/hour, time until starving)');
  log('   • Mutations (list, count, gold/rainbow flags)');
  log('   • Detailed ability stats:');
  log('     - Probability & proc rates (base, effective, per hour, per day, time between)');
  log('     - Effect values (base, effective, unit, label)');
  log('     - Value per time period (hour, day)');
  log('     - Category, trigger, tier, notes');
  log('\n📊 This data is ready for the comparison hub!');
}

/**
 * TEST COMMAND: Compare two pets side-by-side
 * 
 * Usage in console:
 *   window.testComparePets(0, 1)  // Compare slot 0 vs slot 1
 */
export function testComparePets(slotIndexA: number, slotIndexB: number): void {
  log(`🔍 Comparing Pet Slot ${slotIndexA} vs Slot ${slotIndexB}...\n`);
  
  const activePets = getActivePetInfos();
  const petA = activePets.find(p => p.slotIndex === slotIndexA);
  const petB = activePets.find(p => p.slotIndex === slotIndexB);
  
  if (!petA) {
    log(`❌ No pet found in slot ${slotIndexA}`);
    return;
  }
  if (!petB) {
    log(`❌ No pet found in slot ${slotIndexB}`);
    return;
  }
  
  const statsA = getDetailedPetStats(petA);
  const statsB = getDetailedPetStats(petB);
  
  const compareValue = (
    label: string,
    valueA: number | string | null | undefined,
    valueB: number | string | null | undefined,
    higherIsBetter = true,
    suffix = '',
  ) => {
    const strA = valueA != null ? `${valueA}${suffix}` : 'N/A';
    const strB = valueB != null ? `${valueB}${suffix}` : 'N/A';
    
    let winner = '';
    if (typeof valueA === 'number' && typeof valueB === 'number') {
      if (valueA > valueB) {
        winner = higherIsBetter ? ' 🏆 A' : ' 🏆 B';
      } else if (valueB > valueA) {
        winner = higherIsBetter ? ' 🏆 B' : ' 🏆 A';
      } else {
        winner = ' ⚖️ TIE';
      }
    }
    
    log(`   ${label.padEnd(25)} | ${strA.padEnd(15)} | ${strB.padEnd(15)} ${winner}`);
  };
  
  log(`${'Attribute'.padEnd(25)} | ${'Pet A'.padEnd(15)} | ${'Pet B'.padEnd(15)}`);
  log('='.repeat(80));
  
  log(`\n🐾 BASIC INFO:`);
  compareValue('Name', statsA.name, statsB.name, false);
  compareValue('Species', statsA.species, statsB.species, false);
  compareValue('Pet ID', statsA.petId, statsB.petId, false);
  
  log(`\n📊 STRENGTH:`);
  compareValue('Current Strength', statsA.currentStrength, statsB.currentStrength, true);
  compareValue('Max Strength', statsA.maxStrength, statsB.maxStrength, true);
  compareValue('Strength Progress', statsA.strengthProgress, statsB.strengthProgress, true, '%');
  compareValue('Target Scale', statsA.targetScale, statsB.targetScale, true);
  
  log(`\n🎓 XP & LEVEL:`);
  compareValue('XP', statsA.xp, statsB.xp, true);
  compareValue('Level', statsA.level, statsB.level, true);
  
  log(`\n🍖 HUNGER:`);
  compareValue('Hunger %', statsA.hungerPct, statsB.hungerPct, true, '%');
  compareValue('Depletion Rate', statsA.hungerDepletionRate, statsB.hungerDepletionRate, false, '/h');
  compareValue('Feeds Per Hour', statsA.feedsPerHour, statsB.feedsPerHour, false);
  compareValue('Time Until Starving', statsA.timeUntilStarving, statsB.timeUntilStarving, true, 'h');
  
  log(`\n✨ MUTATIONS:`);
  compareValue('Mutation Count', statsA.mutationCount, statsB.mutationCount, true);
  compareValue('Has Gold', statsA.hasGold ? 'Yes' : 'No', statsB.hasGold ? 'Yes' : 'No', false);
  compareValue('Has Rainbow', statsA.hasRainbow ? 'Yes' : 'No', statsB.hasRainbow ? 'Yes' : 'No', false);
  
  log(`\n⚡ ABILITIES:`);
  compareValue('Ability Count', statsA.abilityCount, statsB.abilityCount, true);
  
  // Compare common abilities
  const abilityIdsA = new Set(statsA.abilities.map(a => a.baseName));
  const abilityIdsB = new Set(statsB.abilities.map(a => a.baseName));
  const commonAbilities = [...abilityIdsA].filter(id => abilityIdsB.has(id));
  
  if (commonAbilities.length > 0) {
    log(`\n📊 SHARED ABILITIES (${commonAbilities.length}):`);
    for (const baseName of commonAbilities) {
      const abilityA = statsA.abilities.find(a => a.baseName === baseName);
      const abilityB = statsB.abilities.find(a => a.baseName === baseName);
      
      if (abilityA && abilityB) {
        log(`\n   ${baseName}:`);
        compareValue('     Tier', abilityA.tier, abilityB.tier, true);
        compareValue('     Eff. Probability', abilityA.effectiveProbability, abilityB.effectiveProbability, true, '%');
        compareValue('     Procs Per Hour', abilityA.procsPerHour, abilityB.procsPerHour, true);
        compareValue('     Effective Value', abilityA.effectiveValue, abilityB.effectiveValue, true, abilityA.effectSuffix ?? '');
        
        // Show garden value comparison if available
        if (abilityA.gardenValuePerProc != null && abilityB.gardenValuePerProc != null) {
          // Format for display but use raw numbers for comparison
          const formattedA = formatCoinValue(abilityA.gardenValuePerProc);
          const formattedB = formatCoinValue(abilityB.gardenValuePerProc);
          
          // Show comparison with formatted values
          const strA = formattedA;
          const strB = formattedB;
          let winner = '';
          if (abilityA.gardenValuePerProc > abilityB.gardenValuePerProc) {
            winner = ' 🏆 A';
          } else if (abilityB.gardenValuePerProc > abilityA.gardenValuePerProc) {
            winner = ' 🏆 B';
          } else {
            winner = ' ⚖️ TIE';
          }
          log(`        ${'Garden Value/Proc'.padEnd(25)} | ${strA.padEnd(15)} | ${strB.padEnd(15)} ${winner}`);
          
          if (abilityA.gardenValueDetail) {
            log(`        💡 ${abilityA.gardenValueDetail}`);
          }
        }
      }
    }
  }
  
  log('\n' + '='.repeat(80));
  log('\n✅ Comparison complete!');
}

/**
 * TEST COMMAND: List all available ability definitions
 * 
 * Usage in console:
 *   window.testAbilityDefinitions()
 */
export function testAbilityDefinitions(): void {
  log('📚 Testing Ability Definitions...\n');
  
  const allAbilities = getAllAbilityDefinitions();
  
  log(`✅ Found ${allAbilities.length} ability definition(s)\n`);
  log('='.repeat(80));
  
  for (const ability of allAbilities) {
    log(`\n⚡ ${ability.name} (${ability.id})`);
    log(`   Category: ${ability.category}`);
    log(`   Trigger: ${ability.trigger}`);
    
    if (ability.baseProbability != null) {
      log(`   Base Probability: ${ability.baseProbability}%`);
    }
    if (ability.rollPeriodMinutes != null) {
      log(`   Roll Period: ${ability.rollPeriodMinutes} minutes`);
    }
    if (ability.effectBaseValue != null) {
      log(`   Effect: ${ability.effectBaseValue}${ability.effectSuffix ?? ''} ${ability.effectLabel ?? ''}`);
    }
    if (ability.notes) {
      log(`   Notes: ${ability.notes}`);
    }
  }
  
  log('\n' + '='.repeat(80));
  log('\n✅ All ability definitions retrieved successfully!');
}

// Export test commands to window for console access
if (typeof window !== 'undefined') {
  (window as any).testPetData = testPetData;
  (window as any).testComparePets = testComparePets;
  (window as any).testAbilityDefinitions = testAbilityDefinitions;
  
  log('🧪 Pet Data Tester loaded! Available console commands:');
  log('   • window.testPetData() - Get detailed stats for all active pets');
  log('   • window.testComparePets(0, 1) - Compare two pets side-by-side');
  log('   • window.testAbilityDefinitions() - List all ability definitions');
}
