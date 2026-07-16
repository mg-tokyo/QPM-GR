import { storage } from '../utils/storage';
import { debounce } from '../utils/scheduling/debounce';
import type { ActivePetInfo } from './pets';
import { getAllPetXpEstimates, inferXpPerLevel } from '../utils/xpInference';
import { areCatalogsReady, onCatalogsReady, getPetMaxScale } from '../catalogs/gameCatalogs';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeXp', 'xp');

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

interface XpStatsEntry { count: number; last: number }
const xpStatsIndex: Map<string, XpStatsEntry> = new Map();
const procIndexKey = (petId: string, abilityId: string): string => `${petId}::${abilityId}`;

function indexIncrement(entry: XpProcEntry): void {
  const key = procIndexKey(entry.petId, entry.abilityId);
  const existing = xpStatsIndex.get(key);
  if (existing) {
    existing.count += 1;
    if (entry.timestamp > existing.last) existing.last = entry.timestamp;
  } else {
    xpStatsIndex.set(key, { count: 1, last: entry.timestamp });
  }
}

function indexDecrement(entry: XpProcEntry): void {
  const key = procIndexKey(entry.petId, entry.abilityId);
  const existing = xpStatsIndex.get(key);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count <= 0) xpStatsIndex.delete(key);
}

function rebuildProcIndex(): void {
  xpStatsIndex.clear();
  for (const entry of procHistory) indexIncrement(entry);
}

let updateCallbacks: Array<() => void> = [];

const scheduleSaveProcs = debounce(() => {
  try {
    storage.set(STORAGE_KEY_PROCS, {
      procs: procHistory,
      savedAt: Date.now(),
    });
  } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'procs', key: STORAGE_KEY_PROCS }, error);
  }
}, SAVE_DEBOUNCE_MS);

const scheduleSaveConfig = debounce(() => {
  try {
    storage.set(STORAGE_KEY_CONFIG, configData);
  } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'config', key: STORAGE_KEY_CONFIG }, error);
  }
}, SAVE_DEBOUNCE_MS);

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
  indexIncrement(entry);

  if (procHistory.length > 1000) {
    const dropped = procHistory.shift();
    if (dropped) indexDecrement(dropped);
  }

  scheduleSaveProcs();
  notifyListeners();
}

/**
 * @param currentWeather Current weather state (for weather-dependent abilities like SnowyPetXpBoost)
 */
export function calculateXpStats(
  pet: ActivePetInfo,
  abilityId: string,
  abilityName: string,
  baseChance: number, // Base probability percentage per minute (e.g., 30 for XP Boost I)
  baseXp: number, // Base XP per proc (e.g., 300 for XP Boost I)
  requiredWeather?: 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | 'thunderstorm' | null,
  currentWeather?: 'sunny' | 'rain' | 'snow' | 'dawn' | 'amber' | 'thunderstorm' | 'unknown' | null,
): XpAbilityStats {
  const strength = pet.strength ?? 100;
  const petId = pet.petId ?? '';
  const species = pet.species ?? 'Unknown';

  const isWeatherSatisfied = !requiredWeather || !currentWeather || currentWeather === 'unknown'
    ? true // No requirement or weather unknown - assume active
    : currentWeather === requiredWeather;

  // Wiki formula: "X% × STR" means STR acts as a percentage multiplier
  // STR=100 → 100% = 1.0x, STR=89 → 89% = 0.89x
  const MIN_MULTIPLIER = 0.25;
  const MAX_CHANCE_PER_SECOND = 0.95 / 60; // Max 95% per minute = ~1.58% per second

  const multiplier = Math.max(MIN_MULTIPLIER, strength / 100);

  // Game checks every SECOND, so divide per-minute chance by 60
  const baseChancePerMinute = baseChance;
  const baseChancePerSecond = baseChance / 60; // e.g., 30% per minute = 0.5% per second

  const actualChancePerMinute = baseChancePerMinute * multiplier;
  const actualChancePerSecond = baseChancePerSecond * multiplier;

  const baseChancePerSecondDecimal = Math.max(0, baseChancePerSecond / 100);
  const chancePerSecondDecimal = Math.min(MAX_CHANCE_PER_SECOND, baseChancePerSecondDecimal * multiplier);

  // Abilities roll every SECOND, so 3600 rolls per hour (60 seconds × 60 minutes)
  const rollsPerHour = 3600;
  const expectedProcsPerHour = rollsPerHour * chancePerSecondDecimal;

  const actualXpPerProc = baseXp * multiplier;

  // If weather requirement not met, ability doesn't proc (XP = 0)
  const expectedXpPerHour = isWeatherSatisfied
    ? expectedProcsPerHour * actualXpPerProc
    : 0;

  const indexEntry = xpStatsIndex.get(procIndexKey(petId, abilityId));
  const procCount = indexEntry?.count ?? 0;
  const lastProcAt = indexEntry ? indexEntry.last : null;

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
    lastProcAt,
    procCount,
    level: pet.level ?? null,
    currentXp: pet.xp ?? null,
  };
}

/** Abilities roll independently in game logic; the combined chance below is for display only. */
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

  // Display-only: statistical chance of at least one proc/sec; game rolls each ability independently
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

/** Automatically calculated based on hours to mature. */
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

/** Reads from the live petCatalog — works automatically for any species the game adds. */
export function getSpeciesMaxScale(species: string): number | null {
  return getPetMaxScale(species);
}

/** Formula from Aries mod: ((targetScale - 1) / (maxScale - 1)) * 20 + 80 → range 80-100. */
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

  if (rounded < 80 || rounded > 100) {
    return null;
  }

  return rounded;
}

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
      diag.warn('QPM-STORE-003', { phase: 'notifyListeners' }, error);
    }
  });
}

function autoPopulateXpEstimates(): void {
  const catalogEstimates = getAllPetXpEstimates();

  // Merge with existing config (don't overwrite user customizations)
  for (const [species, xp] of Object.entries(catalogEstimates)) {
    if (!(species in configData.speciesXpPerLevel)) {
      configData.speciesXpPerLevel[species] = xp;
    }
  }

  scheduleSaveConfig();
}

export function initializeXpTracker(): void {
  diag.register('Restoring XP tracker from storage');
  try {
    const savedProcs = storage.get<{ procs: XpProcEntry[] } | null>(STORAGE_KEY_PROCS, null);
    if (savedProcs?.procs) {
      procHistory.splice(0, procHistory.length, ...savedProcs.procs);
    }
    rebuildProcIndex();

    const savedConfig = storage.get<XpTrackerConfig | null>(STORAGE_KEY_CONFIG, null);
    if (savedConfig?.speciesXpPerLevel) {
      Object.assign(configData.speciesXpPerLevel, savedConfig.speciesXpPerLevel);
    }
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'restoreFromStorage' }, error);
  }

  if (areCatalogsReady()) {
    autoPopulateXpEstimates();
  } else {
    onCatalogsReady(() => {
      autoPopulateXpEstimates();
    });
  }

  diag.publishOk(`${procHistory.length} proc(s) restored`, {
    procCount: procHistory.length,
    speciesEstimates: Object.keys(configData.speciesXpPerLevel).length,
  });
}

export function getXpProcHistory(): XpProcEntry[] {
  return [...procHistory];
}
