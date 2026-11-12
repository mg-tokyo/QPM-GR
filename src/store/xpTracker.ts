import { storage } from '../utils/storage';
import { debounce, debounceCancelable } from '../utils/scheduling/debounce';
import type { ActivePetInfo } from './pets';
import { getAllPetXpEstimates, inferXpPerLevel } from '../utils/xpInference';
import { areCatalogsReady, onCatalogsReady, getPetMaxScale } from '../catalogs/gameCatalogs';
import { createStoreDiagnostics } from './_storeDiagnostics';
import { createPlayerScoped, type PlayerScopedHandle, type PlayerScopedLayout } from './playerScoped';
import {
  computeAbilityStats,
  computeDayAverageEffectPerHour,
  computeEffectPerHour,
  compoundingChancePerSecond,
  getAbilityRateContext,
  type AbilityDefinition,
  type AbilityRateContext,
} from '../features/pets/data/petAbilities';

const diag = createStoreDiagnostics('storeXp', 'xp');

const STORAGE_KEY_PROCS = 'qpm.xpTrackerProcs.v1';
const STORAGE_KEY_CONFIG = 'qpm.xpTrackerConfig.v1';
const SAVE_DEBOUNCE_MS = 2500;
const MAX_PROCS = 1000;

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
  baseChancePerSecond: number;   // percent, compounding over the 1 s server tick
  actualChancePerSecond: number; // percent, after strength, crystal and stage terms
  expectedProcsPerHour: number;
  expectedXpPerHour: number;
  dayAverageXpPerHour: number | null;   // null until the day cycle is parsed
  stage: string | null;
  stageBonus: number;
  isNocturnal: boolean;
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

const procIdentity = (entry: XpProcEntry): string => `${entry.petId}\u0000${entry.abilityId}\u0000${entry.timestamp}`;

/** Union by `(petId, abilityId, timestamp)`, oldest first, newest `cap` kept. Returns `a` itself when `b` adds nothing. */
export function mergeXpProcs(a: XpProcEntry[], b: XpProcEntry[], cap = MAX_PROCS): XpProcEntry[] {
  const seen = new Set(a.map(procIdentity));
  const extra: XpProcEntry[] = [];
  for (const entry of b) {
    const id = procIdentity(entry);
    if (seen.has(id)) continue;
    seen.add(id);
    extra.push(entry);
  }
  if (extra.length === 0) return a;
  const merged = [...a, ...extra].sort((x, y) => x.timestamp - y.timestamp);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

function isProcEntry(value: unknown): value is XpProcEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.petId === 'string' && typeof entry.abilityId === 'string'
    && typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)
    && typeof entry.petName === 'string' && typeof entry.species === 'string' && typeof entry.xpAmount === 'number';
}

const procsLayout: PlayerScopedLayout<XpProcEntry[]> = {
  parts: [STORAGE_KEY_PROCS],
  join: ([raw]) => {
    const procs = raw && typeof raw === 'object' ? (raw as { procs?: unknown }).procs : undefined;
    return Array.isArray(procs) ? procs.filter(isProcEntry) : undefined;
  },
  split: (procs) => [{ procs, savedAt: Date.now() }],
};

let procsHandle: PlayerScopedHandle<XpProcEntry[]> | null = null;
let procsBoundOnce = false;

function saveProcsNow(): void {
  if (!procsHandle) return;
  try {
    if (!procsHandle.write([...procHistory])) diag.warn('QPM-STORE-004', { what: 'procs', key: procsHandle.scopedKey() ?? STORAGE_KEY_PROCS });
  } catch (error) {
    diag.warn('QPM-STORE-004', { what: 'procs', key: STORAGE_KEY_PROCS }, error);
  }
}

const scheduleSaveProcs = debounceCancelable(saveProcsNow, SAVE_DEBOUNCE_MS);

function flushProcs(): void {
  scheduleSaveProcs.cancel();
  saveProcsNow();
}

/** First bind keeps this session's procs (recorded before the id); an account change replaces them. */
function onProcsBound(value: XpProcEntry[]): void {
  const next = procsBoundOnce ? value : mergeXpProcs(value, procHistory);
  procsBoundOnce = true;
  procHistory.splice(0, procHistory.length, ...next);
  rebuildProcIndex();
  if (next !== value) flushProcs();
  diag.publishOk(`${procHistory.length} proc(s) restored`, {
    procCount: procHistory.length,
    speciesEstimates: Object.keys(configData.speciesXpPerLevel).length,
  });
  notifyListeners();
}

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

  if (procHistory.length > MAX_PROCS) {
    const dropped = procHistory.shift();
    if (dropped) indexDecrement(dropped);
  }

  scheduleSaveProcs();
  notifyListeners();
}

/** Rates come from the shared ability maths (REL-6); a weather-gated ability off its weather gives 0 for both rates (PD3). */
export function calculateXpStats(
  pet: ActivePetInfo,
  definition: AbilityDefinition,
  abilityName: string,
  currentWeather?: string | null,
  context: AbilityRateContext = getAbilityRateContext(pet.species),
): XpAbilityStats {
  const strength = pet.strength ?? 100;
  const petId = pet.petId ?? '';
  const species = pet.species ?? 'Unknown';
  const abilityId = definition.id;
  const baseChance = definition.baseProbability ?? 0;
  const baseXp = definition.effectValuePerProc ?? 0;

  const requiredWeather = definition.requiredWeather;
  const isWeatherSatisfied = !requiredWeather || !currentWeather || currentWeather === 'unknown'
    || currentWeather === requiredWeather;

  const stats = computeAbilityStats(definition, strength, context);
  const dayAverageXp = computeDayAverageEffectPerHour(definition, stats);
  const expectedXpPerHour = isWeatherSatisfied ? computeEffectPerHour(definition, stats, strength) : 0;
  const dayAverageXpPerHour = dayAverageXp === null ? null : (isWeatherSatisfied ? dayAverageXp : 0);

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
    actualXpPerProc: baseXp * stats.multiplier,
    baseChancePerMinute: baseChance,
    actualChancePerMinute: stats.chancePerMinute,
    baseChancePerSecond: compoundingChancePerSecond(Math.min(1, Math.max(0, baseChance / 100))) * 100,
    actualChancePerSecond: stats.chancePerSecond,
    expectedProcsPerHour: stats.procsPerHour,
    expectedXpPerHour,
    dayAverageXpPerHour,
    stage: stats.stage,
    stageBonus: stats.stageBonus,
    isNocturnal: context.isNocturnal,
    lastProcAt,
    procCount,
    level: pet.level ?? null,
    currentXp: pet.xp ?? null,
  };
}

/** Abilities roll independently in game logic; the combined chance below is for display only. */
export function getCombinedXpStats(stats: XpAbilityStats[]): {
  totalXpPerHour: number;
  totalDayAverageXpPerHour: number | null;   // null when any row lacks a day average
  totalProcsPerHour: number;
  combinedChancePerSecond: number; // For display only
  combinedChancePerMinute: number; // For display only
  lastProcAt: number | null;
  totalProcCount: number;
} {
  const totalXpPerHour = stats.reduce((sum, s) => sum + s.expectedXpPerHour, 0);
  const totalProcsPerHour = stats.reduce((sum, s) => sum + s.expectedProcsPerHour, 0);
  let totalDayAverageXpPerHour: number | null = 0;
  for (const s of stats) {
    totalDayAverageXpPerHour = s.dayAverageXpPerHour === null || totalDayAverageXpPerHour === null
      ? null
      : totalDayAverageXpPerHour + s.dayAverageXpPerHour;
  }

  // Display-only: statistical chance of at least one proc/sec; game rolls each ability independently
  const individualChancesPerSecond = stats.map((s) => s.actualChancePerSecond / 100);
  const noProcPerSecond = individualChancesPerSecond.reduce((prod, p) => prod * (1 - p), 1);
  const combinedChancePerSecond = (1 - noProcPerSecond) * 100;
  const combinedChancePerMinute = (1 - Math.pow(noProcPerSecond, 60)) * 100;

  const lastProcTimes = stats.map((s) => s.lastProcAt).filter((t): t is number => t !== null);
  const lastProcAt = lastProcTimes.length > 0 ? Math.max(...lastProcTimes) : null;

  const totalProcCount = stats.reduce((sum, s) => sum + s.procCount, 0);

  return {
    totalXpPerHour,
    totalDayAverageXpPerHour,
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

/** Procs are kept per player (`<key>.<playerId>`) and load once the id resolves; the config stays global. */
export function initializeXpTracker(): void {
  if (!procsHandle) {
    diag.register('Waiting for the player id to load XP procs');
    procsHandle = createPlayerScoped<XpProcEntry[]>({
      baseKey: STORAGE_KEY_PROCS,
      fallback: [],
      merge: (a, b) => mergeXpProcs(a, b),
      onReady: onProcsBound,
      flush: flushProcs,
    }, procsLayout);
    procsHandle.start();
  }
  try {
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
}

/** Saves pending procs to the bound player's key, then forgets them so a later start cannot hand them to another account. */
export function stopXpTracker(): void {
  if (!procsHandle) return;
  flushProcs();
  procsHandle.stop();
  procsHandle = null;
  procsBoundOnce = false;
  procHistory.length = 0;
  xpStatsIndex.clear();
}

export function getXpProcHistory(): XpProcEntry[] {
  return [...procHistory];
}
