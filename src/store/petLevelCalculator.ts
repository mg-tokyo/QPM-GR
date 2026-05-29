// src/store/petLevelCalculator.ts
// Calculate pet levels from XP gain rate and time-to-mature

import { getTimeToMatureSeconds } from '../data/petTimeToMature';
import { log } from '../utils/logger';
import type { ActivePetInfo } from './pets';

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

// Store XP snapshots per pet (by petId)
const xpHistory = new Map<string, XPSnapshot[]>();
const warnedSpecies = new Set<string>(); // Track which species we've warned about

// Constants from wiki
const TOTAL_LEVELS = 30; // Pets start 30 levels below max strength
const MIN_SAMPLES = 2; // Need at least 2 XP samples to calculate rate
const MAX_HISTORY = 10; // Keep last 10 XP snapshots per pet

/**
 * Record XP observation for a pet
 */
export function recordPetXP(pet: ActivePetInfo): void {
  if (!pet.petId || pet.xp == null) return;

  const now = Date.now();
  let history = xpHistory.get(pet.petId);

  if (!history) {
    history = [];
    xpHistory.set(pet.petId, history);
  }

  // Add new snapshot
  history.push({
    xp: pet.xp,
    timestamp: now,
  });

  // Keep only recent snapshots
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

/**
 * Calculate XP gain rate (XP per second)
 */
function calculateXPGainRate(history: XPSnapshot[]): number | null {
  if (history.length < MIN_SAMPLES) return null;

  // Use first and last snapshots for rate calculation
  const first = history[0]!;
  const last = history[history.length - 1]!;

  const xpGained = last.xp - first.xp;
  const timeElapsed = (last.timestamp - first.timestamp) / 1000; // Convert to seconds

  if (timeElapsed <= 0 || xpGained <= 0) return null;

  return xpGained / timeElapsed;
}

/**
 * Estimate pet level using XP gain rate and time-to-mature
 */
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
    // Only log once per species to avoid console spam
    if (pet.species && !warnedSpecies.has(pet.species)) {
      warnedSpecies.add(pet.species);
      log(`⚠️ No time-to-mature data for species: ${pet.species}`);
    }
    return { ...defaultResult, xpGainRate };
  }

  // Calculate total XP needed to reach max level
  // Total XP = XP gain rate × time to mature
  const totalXPNeeded = xpGainRate * timeToMatureSeconds;

  // Calculate current level
  // Since all levels are equal XP apart:
  // Level = (current XP / total XP) × max levels
  let currentLevel = (pet.xp / totalXPNeeded) * TOTAL_LEVELS;

  // Clamp to valid range
  currentLevel = Math.max(0, Math.min(TOTAL_LEVELS, currentLevel));

  // Determine confidence based on sample size and time span
  const timeSpan = (history[history.length - 1]!.timestamp - history[0]!.timestamp) / 1000;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  if (history.length >= 5 && timeSpan >= 300) {
    // 5+ samples over 5+ minutes
    confidence = 'high';
  } else if (history.length >= 3 && timeSpan >= 120) {
    // 3+ samples over 2+ minutes
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

/**
 * Get XP history for debugging
 */
export function getPetXPHistory(petId: string): XPSnapshot[] {
  return xpHistory.get(petId) ?? [];
}
