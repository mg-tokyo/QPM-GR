import { getTimeToMatureSeconds } from '../features/pets/data/petTimeToMature';
import { createNamedLogger } from '../diagnostics/logger';
import type { ActivePetInfo } from './pets';

const log = createNamedLogger('storePetLevelCalculator');

interface XPSnapshot {
  xp: number;
  timestamp: number;
}

interface LevelEstimate {
  currentLevel: number | null;
  maxLevel: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  totalXPNeeded: number | null;
  xpGainRate: number | null; // XP per second
}

const xpHistory = new Map<string, XPSnapshot[]>();
const warnedSpecies = new Set<string>();

const TOTAL_LEVELS = 30; // pets start 30 levels below max strength
const MIN_SAMPLES = 2;
const MAX_HISTORY = 10;
const MAX_TRACKED_PETS = 200;

export function recordPetXP(pet: ActivePetInfo): void {
  if (!pet.petId || pet.xp == null) return;

  const now = Date.now();
  let history = xpHistory.get(pet.petId);

  if (!history) {
    history = [];
    xpHistory.set(pet.petId, history);
    while (xpHistory.size > MAX_TRACKED_PETS) {
      const iter = xpHistory.keys();
      const next = iter.next();
      if (next.done) break;
      const oldest = next.value;
      if (oldest === pet.petId) break;
      xpHistory.delete(oldest);
    }
  }

  history.push({
    xp: pet.xp,
    timestamp: now,
  });

  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function calculateXPGainRate(history: XPSnapshot[]): number | null {
  if (history.length < MIN_SAMPLES) return null;

  const first = history[0]!;
  const last = history[history.length - 1]!;

  const xpGained = last.xp - first.xp;
  const timeElapsed = (last.timestamp - first.timestamp) / 1000;

  if (timeElapsed <= 0 || xpGained <= 0) return null;

  return xpGained / timeElapsed;
}

export function estimatePetLevel(pet: ActivePetInfo): LevelEstimate {
  const defaultResult: LevelEstimate = {
    currentLevel: null,
    maxLevel: TOTAL_LEVELS,
    confidence: 'none',
    totalXPNeeded: null,
    xpGainRate: null,
  };

  if (!pet.petId || pet.xp == null) {
    return defaultResult;
  }

  const history = xpHistory.get(pet.petId);
  if (!history || history.length < MIN_SAMPLES) {
    return defaultResult;
  }

  const xpGainRate = calculateXPGainRate(history);
  if (!xpGainRate) {
    return defaultResult;
  }

  const timeToMatureSeconds = getTimeToMatureSeconds(pet.species);
  if (!timeToMatureSeconds) {
    if (pet.species && !warnedSpecies.has(pet.species)) {
      warnedSpecies.add(pet.species);
      log.debug('No time-to-mature data for species', { species: pet.species });
    }
    return { ...defaultResult, xpGainRate };
  }

  // totalXPNeeded = xpGainRate × timeToMature; level = (xp / totalXPNeeded) × TOTAL_LEVELS
  const totalXPNeeded = xpGainRate * timeToMatureSeconds;

  let currentLevel = (pet.xp / totalXPNeeded) * TOTAL_LEVELS;

  currentLevel = Math.max(0, Math.min(TOTAL_LEVELS, currentLevel));

  const timeSpan = (history[history.length - 1]!.timestamp - history[0]!.timestamp) / 1000;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  if (history.length >= 5 && timeSpan >= 300) {
    confidence = 'high';
  } else if (history.length >= 3 && timeSpan >= 120) {
    confidence = 'medium';
  }

  return {
    currentLevel: Math.round(currentLevel),
    maxLevel: TOTAL_LEVELS,
    confidence,
    totalXPNeeded,
    xpGainRate,
  };
}

export function getPetXPHistory(petId: string): XPSnapshot[] {
  return xpHistory.get(petId) ?? [];
}
