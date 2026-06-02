// src/store/xpTracker.ts - Track XP ability procs and calculate XP rates

import { storage } from '../utils/storage';
import { log } from '../utils/logger';
import { debounce } from '../utils/scheduling/debounce';
import type { ActivePetInfo } from './pets';
import { getAllPetXpEstimates, inferXpPerLevel } from '../utils/xpInference';
import { areCatalogsReady, onCatalogsReady, getPetMaxScale } from '../catalogs/gameCatalogs';

const STORAGE_KEY_PROCS = 'qpm.xpTrackerProcs.v1';
const STORAGE_KEY_CONFIG = 'qpm.xpTrackerConfig.v1';
const SAVE_DEBOUNCE_MS = 2500;

export interface XpProcEntry {
  petId: string;
  petName: string;
  species: string;
  abilityId: string;
  xpAmount: number;
  timestamp: number;
}

export interface XpAbilityStats {
  petId: string;
  petName: string;
  species: string;
  abilityId: string;
  abilityName: string;
  strength: number;
  baseXpPerProc: number;
  actualXpPerProc: number;
  baseChancePerMinute: number;
  actualChancePerMinute: number;
  baseChancePerSecond: number; // Per-second chance (game checks every second)
  actualChancePerSecond: number; // Scaled by strength
  expectedProcsPerHour: number;
  expectedXpPerHour: number;
  lastProcAt: number | null;
  procCount: number;
  level: number | null;
  currentXp: number | null;
}

export interface XpTrackerConfig {
  speciesXpPerLevel: Record<string, number>; // e.g., { "Goat": 50000, "Peacock": 60000 }
}

const procHistory: XpProcEntry[] = [];
const configData: XpTrackerConfig = {
  speciesXpPerLevel: {},
};

let updateCallbacks: Array<() => void> = [];

const scheduleSaveProcs = debounce(() => {
  try {
    storage.set(STORAGE_KEY_PROCS, {
      procs: procHistory,
      savedAt: Date.now(),
    });
  } catch (error) {
    log('⚠️ Failed to persist XP proc history', error);
  }
}, SAVE_DEBOUNCE_MS);

const scheduleSaveConfig = debounce(() => {
  try {
    storage.set(STORAGE_KEY_CONFIG, configData);
  } catch (error) {
    log('⚠️ Failed to persist XP tracker config', error);
  }
}, SAVE_DEBOUNCE_MS);

/**
 * Record an XP proc from an ability
 */
export function recordXpProc(
  petId: string,
  petName: string,
  species: string,
  abilityId: string,
  xpAmount: number,
): void {
  const entry: XpProcEntry = {
    petId,
    petName,
    species,
    abilityId,
    xpAmount,
    timestamp: Date.now(),
  };

  procHistory.push(entry);

  // Keep only last 1000 procs to prevent unbounded growth
  if (procHistory.length > 1000) {
    procHistory.shift();
  }

  scheduleSaveProcs();
  notifyListeners();
}

/**
 * Calculate XP statistics for a given pet's XP ability
 * @param currentWeather Current weather state (for weather-dependent abilities like SnowyPetXpBoost)
 */
export function calculateXpStats(
  pet: ActivePetInfo,
  abilityId: string,
  abilityName: string,
  baseChance: number, // Base probability percentage per minute (e.g., 30 for XP Boost I)
  baseXp: number, // Base XP per proc (e.g., 300 for XP Boost I)
  requiredWeather?: 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | null,
  currentWeather?: 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | 'unknown' | null,
): XpAbilityStats {
  const strength = pet.strength ?? 100;
  const petId = pet.petId ?? '';
  const species = pet.species ?? 'Unknown';

  // Check if weather requirement is met
  const isWeatherSatisfied = !requiredWeather || !currentWeather || currentWeather === 'unknown'
    ? true // No requirement or weather unknown - assume active
    : currentWeather === requiredWeather;

  // Wiki formula: "X% × STR" means STR acts as a percentage multiplier
  // STR=100 → 100% = 1.0x, STR=89 → 89% = 0.89x
  const MIN_MULTIPLIER = 0.25;
  const MAX_CHANCE_PER_SECOND = 0.95 / 60; // Max 95% per minute = ~1.58% per second

  const multiplier = Math.max(MIN_MULTIPLIER, strength / 100);

  // Game checks every SECOND, not every minute
  // So we divide the per-minute chance by 60 to get per-second chance
  const baseChancePerMinute = baseChance;
  const baseChancePerSecond = baseChance / 60; // e.g., 30% per minute = 0.5% per second

  const actualChancePerMinute = baseChancePerMinute * multiplier;
  const actualChancePerSecond = baseChancePerSecond * multiplier;

  const baseChancePerSecondDecimal = Math.max(0, baseChancePerSecond / 100);
  const chancePerSecondDecimal = Math.min(MAX_CHANCE_PER_SECOND, baseChancePerSecondDecimal * multiplier);

  // Abilities roll every SECOND, so 3600 rolls per hour (60 seconds × 60 minutes)
  const rollsPerHour = 3600;
  const expectedProcsPerHour = rollsPerHour * chancePerSecondDecimal;

  // Calculate XP values
  const actualXpPerProc = baseXp * multiplier;

  // If weather requirement not met, ability doesn't proc (XP = 0)
  const expectedXpPerHour = isWeatherSatisfied
    ? expectedProcsPerHour * actualXpPerProc
    : 0;

  // Find last proc for this pet's ability
  const relevantProcs = procHistory.filter(
    (p) => p.petId === petId && p.abilityId === abilityId
  );
  const lastProc = relevantProcs.length > 0 ? relevantProcs[relevantProcs.length - 1] : null;

  return {
    petId,
    petName: pet.name ?? pet.species ?? 'Unknown',
    species,
    abilityId,
    abilityName,
    strength,
    baseXpPerProc: baseXp,
    actualXpPerProc,
    baseChancePerMinute: baseChance,
    actualChancePerMinute,
    baseChancePerSecond,
    actualChancePerSecond,
    expectedProcsPerHour,
    expectedXpPerHour,
    lastProcAt: lastProc?.timestamp ?? null,
    procCount: relevantProcs.length,
    level: pet.level ?? null,
    currentXp: pet.xp ?? null,
  };
}

/**
 * Get total stats for multiple pets with XP abilities
 * Note: Abilities roll independently - they don't "combine" in game logic
 * The combined chance is calculated for display purposes only
 */
export function getCombinedXpStats(stats: XpAbilityStats[]): {
  totalXpPerHour: number;
  totalProcsPerHour: number;
  combinedChancePerSecond: number; // For display only
  combinedChancePerMinute: number; // For display only
  lastProcAt: number | null;
  totalProcCount: number;
} {
  const totalXpPerHour = stats.reduce((sum, s) => sum + s.expectedXpPerHour, 0);
  const totalProcsPerHour = stats.reduce((sum, s) => sum + s.expectedProcsPerHour, 0);

  // Calculate combined probability for DISPLAY purposes only
  // This represents the statistical chance of at least one proc per second
  // BUT the game doesn't use this - each ability rolls independently
  const individualChancesPerSecond = stats.map((s) => s.actualChancePerSecond / 100);
  const combinedChancePerSecondDecimal = 1 - individualChancesPerSecond.reduce((prod, p) => prod * (1 - p), 1);
  const combinedChancePerSecond = combinedChancePerSecondDecimal * 100;
  const combinedChancePerMinute = combinedChancePerSecond * 60;

  const lastProcTimes = stats.map((s) => s.lastProcAt).filter((t): t is number => t !== null);
  const lastProcAt = lastProcTimes.length > 0 ? Math.max(...lastProcTimes) : null;

  const totalProcCount = stats.reduce((sum, s) => sum + s.procCount, 0);

  return {
    totalXpPerHour,
    totalProcsPerHour,
    combinedChancePerSecond,
    combinedChancePerMinute,
    lastProcAt,
    totalProcCount,
  };
}

/**
 * Get XP required per level for a species
 * Automatically calculated based on hours to mature
 */
export function getSpeciesXpPerLevel(species: string): number | null {
  // Priority 1: Try catalog first (from inferXpPerLevel utility)
  const catalogXp = inferXpPerLevel(species);
  if (catalogXp !== null) {
    return catalogXp;
  }

  // Priority 2: User-configured value
  if (configData.speciesXpPerLevel[species] !== undefined) {
    return configData.speciesXpPerLevel[species];
  }

  // Priority 3: Unknown
  return null;
}

/**
 * Get max scale for a species — reads from the live petCatalog.
 * Works automatically for any species the game adds.
 */
export function getSpeciesMaxScale(species: string): number | null {
  return getPetMaxScale(species);
}

/**
 * Calculate MAX Strength for a pet using targetScale
 * Formula from Aries mod: ((targetScale - 1) / (maxScale - 1)) * 20 + 80
 * This gives a range of 80-100 based on the pet's targetScale
 */
export function calculateMaxStrength(
  targetScale: number | null,
  species: string
): number | null {
  if (!targetScale || targetScale < 1) {
    return null;
  }

  const maxScale = getSpeciesMaxScale(species);
  if (!maxScale || maxScale <= 1) {
    return null;
  }

  const ratio = (targetScale - 1) / (maxScale - 1);
  const maxStr = ratio * 20 + 80;
  const rounded = Math.floor(maxStr);

  // Validate the result is in expected range (80-100)
  if (rounded < 80 || rounded > 100) {
    return null;
  }

  return rounded;
}

/**
 * Calculate time to level up for a pet
 */
export function calculateTimeToLevel(
  currentXp: number,
  targetXp: number,
  xpPerHour: number,
): { hours: number; minutes: number; totalMinutes: number } | null {
  if (xpPerHour <= 0 || currentXp >= targetXp) {
    return null;
  }

  const xpNeeded = targetXp - currentXp;
  const hoursNeeded = xpNeeded / xpPerHour;
  const totalMinutes = hoursNeeded * 60;
  const hours = Math.floor(hoursNeeded);
  const minutes = Math.round((hoursNeeded - hours) * 60);

  return { hours, minutes, totalMinutes };
}

/**
 * Subscribe to XP tracker updates
 */
export function onXpTrackerUpdate(callback: () => void): () => void {
  updateCallbacks.push(callback);
  return () => {
    updateCallbacks = updateCallbacks.filter((cb) => cb !== callback);
  };
}

function notifyListeners(): void {
  updateCallbacks.forEach((cb) => {
    try {
      cb();
    } catch (error) {
      log('⚠️ XP tracker callback error', error);
    }
  });
}

/**
 * Auto-populate XP estimates from catalog (FUTUREPROOF!)
 */
function autoPopulateXpEstimates(): void {
  const catalogEstimates = getAllPetXpEstimates();

  // Merge with existing config (don't overwrite user customizations)
  for (const [species, xp] of Object.entries(catalogEstimates)) {
    if (!(species in configData.speciesXpPerLevel)) {
      // Only add if not already configured
      configData.speciesXpPerLevel[species] = xp;
    }
  }

  scheduleSaveConfig();
}

/**
 * Initialize XP tracker from storage
 */
export function initializeXpTracker(): void {
  try {
    const savedProcs = storage.get<{ procs: XpProcEntry[] } | null>(STORAGE_KEY_PROCS, null);
    if (savedProcs?.procs) {
      procHistory.splice(0, procHistory.length, ...savedProcs.procs);
    }

    const savedConfig = storage.get<XpTrackerConfig | null>(STORAGE_KEY_CONFIG, null);
    if (savedConfig?.speciesXpPerLevel) {
      Object.assign(configData.speciesXpPerLevel, savedConfig.speciesXpPerLevel);
    }
  } catch (error) {
    log('⚠️ Failed to restore XP tracker data', error);
  }

  // Auto-populate XP estimates from catalog (FUTUREPROOF!)
  if (areCatalogsReady()) {
    autoPopulateXpEstimates();
  } else {
    // Wait for catalogs and populate once ready
    onCatalogsReady(() => {
      autoPopulateXpEstimates();
    });
  }
}

/**
 * Get all XP procs for debugging
 */
export function getXpProcHistory(): XpProcEntry[] {
  return [...procHistory];
}
