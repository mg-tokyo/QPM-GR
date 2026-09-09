/** Tracks how many Crop Size Boosts are needed to maximize garden crops.
 * Catalog-driven: any ability whose params match a size-boost shape is picked
 * up automatically via sizeBoost.ts (see 2026-09-09-crop-size-boost-catalog-driven.md). */

import { storage } from '../../utils/storage';
import { getActivePetInfos, onActivePetInfos } from '../../store/pets';
import { getGardenSnapshot, onGardenSnapshot } from '../garden/bridge';
import { getCropSizePercent, lookupMaxScale } from '../../utils/game/plantScales';
import {
  arePetAbilitiesCaptured,
  getAbilityDef,
  mergePetAbilitiesIfIncomplete,
  onPetAbilitiesCaptured,
} from '../../catalogs/gameCatalogs';
import {
  classifySizeBoostAbility,
  getAllSizeBoostAbilityIds,
  type SizeBoostShape,
} from './data/petAbilities/sizeBoost';
import { getAbilityDefinition } from './data/petAbilities/catalogAdapter';
import { diag, publishOk } from './_diagnostics';

export interface CropBoostConfig {
  enabled: boolean;
  autoRefresh: boolean;
  refreshInterval: number; // seconds
  selectedSpecies: string | null; // null = all crops
}

export interface BoostPetInfo {
  slotIndex: number;
  displayName: string;
  species: string;
  strength: number;
  abilityId: string;
  abilityName: string;
  shape: SizeBoostShape;
  baseAmount: number;      // shape.amountPerProc (flat) or percentPerProc (percent)
  effectiveAmount: number; // baseAmount * (strength/100) when strengthScalesEffect
  baseProcChance: number;
  effectiveProcChance: number;
  expectedMinutesPerProc: number;
}

export interface CropSizeInfo {
  species: string;
  currentScale?: number;   // legacy percent-shape math only
  maxScale?: number;       // legacy percent-shape math only
  currentSizePercent: number; // 50-100%, always populated
  sizeRemaining: number;
  mutations: string[];
  fruitCount: number;
  isMature: boolean;
  tileKey: string;
  slotIndex: number;
}

export interface BoostEstimate {
  boostsNeeded: number;
  timeEstimateP10: number; // minutes (10th percentile - optimistic)
  timeEstimateP50: number; // minutes (50th percentile - median/expected)
  timeEstimateP90: number; // minutes (90th percentile - pessimistic)
  boostsReceived: number;  // boosts received so far
  lastBoostAt: number | null; // timestamp of last boost
  expectedNextBoostAt: number; // expected timestamp of next boost
}

export interface TrackerAnalysis {
  boostPets: BoostPetInfo[];
  crops: CropSizeInfo[];

  totalBoostPets: number;
  totalMatureCrops: number;
  totalCropsAtMax: number;
  totalCropsNeedingBoost: number;

  averageAmount: number;
  weakestAmount: number;
  strongestAmount: number;

  averageMinutesPerProc: number;
  slowestMinutesPerProc: number;
  fastestMinutesPerProc: number;

  overallEstimate: BoostEstimate;

  cropEstimates: Map<string, BoostEstimate>; // key: `${tileKey}-${slotIndex}`

  timestamp: number;
}

const DEFAULT_CONFIG: CropBoostConfig = {
  enabled: true,
  autoRefresh: true,
  refreshInterval: 30, // 30 seconds
  selectedSpecies: null, // Show all crops by default
};

let config: CropBoostConfig = { ...DEFAULT_CONFIG };
let currentAnalysis: TrackerAnalysis | null = null;
let gardenUnsubscribe: (() => void) | null = null;
let petsUnsubscribe: (() => void) | null = null;
let catalogUnsubscribe: (() => void) | null = null;
const changeCallbacks = new Set<(analysis: TrackerAnalysis | null) => void>();
let lastRecalcTime = 0;
let lastHadBoostPets = false;
const RECALC_THROTTLE_MS = 5000; // Only recalculate every 5 seconds max

interface CropBoostHistory {
  initialSize: number;
  boostTimestamps: number[];
  lastSize: number;
}

const cropBoostHistory = new Map<string, CropBoostHistory>();

export function getConfig(): CropBoostConfig {
  return { ...config };
}

export function setConfig(updates: Partial<CropBoostConfig>): void {
  config = { ...config, ...updates };
  saveConfig();

  if (config.enabled) {
    startTracking();
  } else {
    stopTracking();
  }
}

export function setSelectedSpecies(species: string | null): void {
  config.selectedSpecies = species;
  saveConfig();
  recalculate();
}

function saveConfig(): void {
  storage.set('cropBoostTracker:config', config);
}

function loadConfig(): void {
  const saved = storage.get<CropBoostConfig>('cropBoostTracker:config', DEFAULT_CONFIG);
  config = { ...DEFAULT_CONFIG, ...saved };
}

export function onAnalysisChange(callback: (analysis: TrackerAnalysis | null) => void): () => void {
  changeCallbacks.add(callback);
  return () => { changeCallbacks.delete(callback); };
}

function getBoostPets(): BoostPetInfo[] {
  const pets = getActivePetInfos();
  if (pets.length === 0) return [];

  const boostIds = new Set(getAllSizeBoostAbilityIds());
  if (boostIds.size === 0) return [];

  const boostPets: BoostPetInfo[] = [];
  for (const pet of pets) {
    if (!pet.abilities) continue;
    const strength = pet.strength ?? 100;
    const strengthFactor = strength / 100;

    for (const abilityId of pet.abilities) {
      if (!boostIds.has(abilityId)) continue;
      const shape = classifySizeBoostAbility(abilityId);
      if (!shape) continue;
      const def = getAbilityDef(abilityId);
      if (!def) continue;
      const baseAmount = shape.kind === 'flatSize' ? shape.amountPerProc : shape.percentPerProc;
      const effectiveAmount = shape.strengthScalesEffect ? baseAmount * strengthFactor : baseAmount;
      const baseProcChance = typeof def.baseProbability === 'number' && Number.isFinite(def.baseProbability)
        ? def.baseProbability
        : 0;
      const effectiveProcChance = baseProcChance * strengthFactor;
      const abilityName = getAbilityDefinition(abilityId)?.name ?? abilityId;
      const minutesPerProc = effectiveProcChance > 0 ? 100 / effectiveProcChance : Infinity;

      boostPets.push({
        slotIndex: pet.slotIndex,
        displayName: pet.name ?? pet.species ?? 'Unknown',
        species: pet.species ?? 'unknown',
        strength,
        abilityId,
        abilityName,
        shape,
        baseAmount,
        effectiveAmount,
        baseProcChance,
        effectiveProcChance,
        expectedMinutesPerProc: minutesPerProc,
      });
    }
  }

  return boostPets;
}

function scanGardenCrops(): CropSizeInfo[] {
  const snapshot = getGardenSnapshot();
  if (!snapshot) return [];

  const crops: CropSizeInfo[] = [];

  const processTiles = (tiles: Record<string, any> | undefined, prefix: string) => {
    if (!tiles) return;

    for (const [tileKey, tile] of Object.entries(tiles)) {
      if (tile.objectType !== 'plant') continue;
      if (!tile.slots || !Array.isArray(tile.slots)) continue;

      for (let i = 0; i < tile.slots.length; i++) {
        const slot = tile.slots[i];
        if (!slot || !slot.species) continue;

        const species = slot.species;
        const normalizedSpecies = String(species).toLowerCase();
        const explicitCurrentScale = slot.targetScale ?? slot.scale ?? slot.plantScale;
        const explicitMaxScale = slot.maxScale ?? slot.targetMaxScale;
        const currentScale = typeof explicitCurrentScale === 'number' ? explicitCurrentScale : undefined;
        const maxScale = typeof explicitMaxScale === 'number'
          ? explicitMaxScale
          : (lookupMaxScale(normalizedSpecies) ?? undefined);
        const mutations = slot.mutations ?? [];
        const fruitCount = slot.fruitCount ?? slot.remainingFruitCount ?? 1;
        const endTime = slot.endTime ?? 0;
        const isMature = endTime > 0 && Date.now() >= endTime;

        const currentSizePercent = getCropSizePercent(slot);
        const sizeRemaining = Math.max(0, 100 - currentSizePercent);

        crops.push({
          species,
          ...(currentScale !== undefined ? { currentScale } : {}),
          ...(maxScale !== undefined ? { maxScale } : {}),
          currentSizePercent,
          sizeRemaining,
          mutations,
          fruitCount,
          isMature,
          tileKey: `${prefix}${tileKey}`,
          slotIndex: i,
        });
      }
    }
  };

  processTiles(snapshot.tileObjects, '');
  processTiles(snapshot.boardwalkTileObjects, 'bw-');

  return crops;
}

// Shape-aware. Flat: N boosts = ceil(remaining Size / amount). Percent (legacy):
// n = log(maxScale/currentScale) / log(1 + percent/100). Missing legacy scale
// fields collapse to the flat approximation on the 50-100 axis.
function calculateBoostsNeeded(
  crop: CropSizeInfo,
  shape: SizeBoostShape,
): number {
  if (crop.sizeRemaining <= 0) return 0;

  if (shape.kind === 'flatSize') {
    if (shape.amountPerProc <= 0) return Infinity;
    return Math.ceil(crop.sizeRemaining / shape.amountPerProc);
  }

  if (shape.percentPerProc <= 0) return Infinity;
  const currentScale = crop.currentScale;
  const maxScale = crop.maxScale;
  if (currentScale !== undefined && maxScale !== undefined && currentScale > 0 && maxScale > currentScale) {
    const multiplier = 1 + shape.percentPerProc / 100;
    if (multiplier <= 1) return Infinity;
    return Math.ceil(Math.log(maxScale / currentScale) / Math.log(multiplier));
  }
  // Legacy shape but no scale data on this slot — fall back to the linear 50-100 axis.
  return Math.ceil(crop.sizeRemaining / shape.percentPerProc);
}

// Only the weakest boost is used per proc, so estimate off the weakest pet.
// Under flat-size, "weakest" is min effectiveAmount (a smaller Size delta).
function calculateTimeEstimates(
  boostsNeeded: number,
  boostPets: BoostPetInfo[]
): { p10: number; p50: number; p90: number } {
  if (boostPets.length === 0 || boostsNeeded <= 0) {
    return { p10: 0, p50: 0, p90: 0 };
  }

  const weakestPet = boostPets.reduce((worst, pet) =>
    pet.effectiveAmount < worst.effectiveAmount ? pet : worst
  );

  const minutesPerProc = weakestPet.expectedMinutesPerProc;
  if (!Number.isFinite(minutesPerProc)) {
    return { p10: Infinity, p50: Infinity, p90: Infinity };
  }

  // Conservative estimates (abilities don't proc as often in practice)
  // Add 50% buffer to account for RNG variance and real-world proc rates
  const adjustedMinutesPerProc = minutesPerProc * 1.5;

  // Calculate time for N boosts with variance
  const baseTime = boostsNeeded * adjustedMinutesPerProc;
  
  // Percentiles based on variance
  // P10: optimistic (20% faster than expected)
  // P50: median (expected value)
  // P90: pessimistic (50% slower than expected)
  const p10 = baseTime * 0.8;
  const p50 = baseTime;
  const p90 = baseTime * 1.5;

  return { p10, p50, p90 };
}

/**
 * Update boost history for crops (detect new boosts based on size changes)
 */
function updateBoostHistory(crops: CropSizeInfo[]): void {
  const now = Date.now();

  for (const crop of crops) {
    const key = `${crop.tileKey}-${crop.slotIndex}`;
    const history = cropBoostHistory.get(key);

    if (!history) {
      // Initialize tracking for new crop
      cropBoostHistory.set(key, {
        initialSize: crop.currentSizePercent,
        boostTimestamps: [],
        lastSize: crop.currentSizePercent,
      });
    } else {
      // Check if size increased (potential boost)
      const sizeDiff = crop.currentSizePercent - history.lastSize;
      if (sizeDiff > 0.5) {
        // Size increased significantly - likely a boost!
        history.boostTimestamps.push(now);
        history.lastSize = crop.currentSizePercent;
      }
    }
  }

  // Clean up history for crops that no longer exist
  const currentKeys = new Set(crops.map(c => `${c.tileKey}-${c.slotIndex}`));
  for (const key of cropBoostHistory.keys()) {
    if (!currentKeys.has(key)) {
      cropBoostHistory.delete(key);
    }
  }
}

function analyzeBoostTracker(): TrackerAnalysis | null {
  // Catalog holds the authoritative amount/chance numbers. Show nothing rather
  // than stale hardcoded values while capture is pending.
  if (!arePetAbilitiesCaptured()) return null;

  const boostPets = getBoostPets();
  const allCrops = scanGardenCrops();

  if (boostPets.length === 0) {
    return null;
  }

  updateBoostHistory(allCrops);

  const cropsAtMax = allCrops.filter(c => c.sizeRemaining <= 0);
  const cropsNeedingBoost = allCrops.filter(c => c.sizeRemaining > 0);

  const amounts = boostPets.map(p => p.effectiveAmount);
  const averageAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const weakestAmount = Math.min(...amounts);
  const strongestAmount = Math.max(...amounts);

  const minutesList = boostPets.map(p => p.expectedMinutesPerProc);
  const averageMinutesPerProc = minutesList.reduce((a, b) => a + b, 0) / minutesList.length;
  const slowestMinutesPerProc = Math.max(...minutesList);
  const fastestMinutesPerProc = Math.min(...minutesList);

  // Use the weakest pet's shape for the conservative estimate. Matches the
  // "only weakest boost is used per proc" changelog rule.
  const weakestPet = boostPets.reduce((worst, pet) =>
    pet.effectiveAmount < worst.effectiveAmount ? pet : worst
  );
  const conservativeShape: SizeBoostShape = weakestPet.shape.strengthScalesEffect
    ? { kind: 'scalePercent', percentPerProc: weakestPet.effectiveAmount, strengthScalesEffect: true }
    : { kind: 'flatSize', amountPerProc: weakestPet.effectiveAmount, strengthScalesEffect: false };

  const cropEstimates = new Map<string, BoostEstimate>();
  let totalBoostsNeeded = 0;
  const now = Date.now();

  for (const crop of cropsNeedingBoost) {
    const key = `${crop.tileKey}-${crop.slotIndex}`;
    const history = cropBoostHistory.get(key);
    const boostsReceived = history?.boostTimestamps.length ?? 0;
    const lastBoostAt = history?.boostTimestamps[history.boostTimestamps.length - 1] ?? null;

    const boostsNeeded = calculateBoostsNeeded(crop, conservativeShape);
    const remainingBoosts = Math.max(0, boostsNeeded - boostsReceived);

    const estimates = calculateTimeEstimates(remainingBoosts, boostPets);
    const singleBoostEstimate = calculateTimeEstimates(1, boostPets);
    const expectedNextBoostAt = now + (singleBoostEstimate.p50 * 60 * 1000);

    const estimate: BoostEstimate = {
      boostsNeeded,
      timeEstimateP10: estimates.p10,
      timeEstimateP50: estimates.p50,
      timeEstimateP90: estimates.p90,
      boostsReceived,
      lastBoostAt,
      expectedNextBoostAt,
    };

    cropEstimates.set(key, estimate);
    totalBoostsNeeded = Math.max(totalBoostsNeeded, boostsNeeded);
  }

  const overallEstimates = calculateTimeEstimates(totalBoostsNeeded, boostPets);

  const analysis: TrackerAnalysis = {
    boostPets,
    crops: allCrops,

    totalBoostPets: boostPets.length,
    totalMatureCrops: allCrops.length,
    totalCropsAtMax: cropsAtMax.length,
    totalCropsNeedingBoost: cropsNeedingBoost.length,

    averageAmount,
    weakestAmount,
    strongestAmount,

    averageMinutesPerProc,
    slowestMinutesPerProc,
    fastestMinutesPerProc,

    overallEstimate: {
      boostsNeeded: totalBoostsNeeded,
      timeEstimateP10: overallEstimates.p10,
      timeEstimateP50: overallEstimates.p50,
      timeEstimateP90: overallEstimates.p90,
      boostsReceived: 0,
      lastBoostAt: null,
      expectedNextBoostAt: 0,
    },

    cropEstimates,

    timestamp: Date.now(),
  };

  return analysis;
}

function recalculate(force = false): void {
  const now = Date.now();
  if (!force && now - lastRecalcTime < RECALC_THROTTLE_MS) return;
  lastRecalcTime = now;
  currentAnalysis = analyzeBoostTracker();
  for (const cb of changeCallbacks) cb(currentAnalysis);
}

function hasBoostPets(): boolean {
  const pets = getActivePetInfos();
  if (pets.length === 0) return false;
  const boostIds = new Set(getAllSizeBoostAbilityIds());
  if (boostIds.size === 0) return false;
  for (const pet of pets) {
    if (!pet.abilities) continue;
    for (const abilityId of pet.abilities) {
      if (boostIds.has(abilityId)) return true;
    }
  }
  return false;
}

function attachGardenSubscription(): void {
  if (gardenUnsubscribe) return;
  recalculate();
  gardenUnsubscribe = onGardenSnapshot(() => {
    recalculate();
  });
}

function detachGardenSubscription(): void {
  if (!gardenUnsubscribe) return;
  gardenUnsubscribe();
  gardenUnsubscribe = null;
  if (currentAnalysis !== null) {
    currentAnalysis = null;
    for (const cb of changeCallbacks) cb(null);
  }
}

function startTracking(): void {
  if (petsUnsubscribe) return;

  diag.debug('crop boost tracker starting');
  // Nudge bundle-text fallback so a missed capture still resolves without polling.
  void mergePetAbilitiesIfIncomplete();

  lastHadBoostPets = hasBoostPets();
  if (lastHadBoostPets) attachGardenSubscription();

  petsUnsubscribe = onActivePetInfos(() => {
    const hasNow = hasBoostPets();
    if (hasNow === lastHadBoostPets) return;
    lastHadBoostPets = hasNow;
    if (hasNow) attachGardenSubscription();
    else detachGardenSubscription();
  }, false);

  // Catalog-capture push (persistent listener): re-check membership (pets may
  // have arrived before the ability catalog did) and force a recalc past the
  // 5s throttle.
  catalogUnsubscribe = onPetAbilitiesCaptured(() => {
    const hasNow = hasBoostPets();
    if (hasNow !== lastHadBoostPets) {
      lastHadBoostPets = hasNow;
      if (hasNow) attachGardenSubscription();
      else detachGardenSubscription();
    }
    recalculate(true);
  });
}

function stopTracking(): void {
  detachGardenSubscription();
  if (petsUnsubscribe) { petsUnsubscribe(); petsUnsubscribe = null; }
  if (catalogUnsubscribe) { catalogUnsubscribe(); catalogUnsubscribe = null; }
  lastHadBoostPets = false;
  diag.debug('crop boost tracker stopped');
}

export function getCurrentAnalysis(): TrackerAnalysis | null {
  return currentAnalysis;
}

// Catalog readiness gate for the tracker window. Returns false during the
// brief window between page load and the first petAbilities capture; the
// window shows a "loading" state so a null analysis is not misread as
// "no boost pets on team".
export function isBoostCatalogReady(): boolean {
  return arePetAbilitiesCaptured();
}

export function manualRefresh(): void {
  recalculate();
}

export function startCropBoostTracker(): void {
  loadConfig();

  if (config.enabled) {
    startTracking();
  }

  publishOk('Crop boost tracker ready', {
    enabled: config.enabled ? 1 : 0,
    autoRefresh: config.autoRefresh ? 1 : 0,
  });
  diag.debug('crop boost tracker initialized', { enabled: config.enabled });
}

export function stopCropBoostTracker(): void {
  stopTracking();
}

/**
 * Format time estimate for display
 */
export function formatTimeEstimate(minutes: number): string {
  if (!isFinite(minutes)) return 'N/A';
  if (minutes < 1) return '< 1m';

  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  } else if (hours > 0) {
    return `${hours}h ${mins}m`;
  } else {
    return `${mins}m`;
  }
}

/**
 * Format time range for display (showing percentiles)
 */
export function formatTimeRange(p10: number, p50: number, p90: number): string {
  const p10Str = formatTimeEstimate(p10);
  const p50Str = formatTimeEstimate(p50);
  const p90Str = formatTimeEstimate(p90);

  // If all similar, just show one value
  if (p10Str === p50Str && p50Str === p90Str) {
    return p50Str;
  }

  // Show range with median
  return `${p10Str} - ${p90Str} (median: ${p50Str})`;
}

/**
 * Format countdown for live timer display
 */
export function formatCountdown(targetTimestamp: number): { text: string; isOverdue: boolean } {
  const now = Date.now();
  const msRemaining = targetTimestamp - now;

  if (msRemaining <= 0) {
    const msOverdue = Math.abs(msRemaining);
    const minutesOverdue = Math.floor(msOverdue / 60000);
    const secondsOverdue = Math.floor((msOverdue % 60000) / 1000);

    if (minutesOverdue > 0) {
      return { text: `+${minutesOverdue}m ${secondsOverdue}s overdue`, isOverdue: true };
    } else {
      return { text: `+${secondsOverdue}s overdue`, isOverdue: true };
    }
  }

  const totalSeconds = Math.floor(msRemaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return { text: `${hours}h ${minutes}m ${seconds}s`, isOverdue: false };
  } else if (minutes > 0) {
    return { text: `${minutes}m ${seconds}s`, isOverdue: false };
  } else {
    return { text: `${seconds}s`, isOverdue: false };
  }
}

/**
 * Get list of available crop species in garden
 */
export function getAvailableSpecies(): string[] {
  const analysis = getCurrentAnalysis();
  if (!analysis) return [];

  const speciesSet = new Set<string>();
  for (const crop of analysis.crops) {
    speciesSet.add(crop.species);
  }

  return Array.from(speciesSet).sort();
}
