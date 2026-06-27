// src/integrations/cardMath.ts
//
// Local re-implementation of the pet-card display math, mirrored from the beta
// game source so QPM UIs can show the same numbers the native InventoryCardVisual
// shows without round-tripping through the renderer.
//
// Mirrored from BetaGameSourceFiles/MagicDust&PetHutchUpgradesLATEST:
//   common/games/Quinoa/utils/pets.ts       (getStrength, getPetScale, getXPForStrength)
//   common/games/Quinoa/utils/sell.ts       (calculateMutationsMultiplier)
//   common/games/Quinoa/systems/mutation/mutationsDex.ts (GROWTH_MUTATIONS)
//   common/games/Quinoa/components/.../InventoryCardVisual.ts (formatWeightNumber)
//
// All constants and growth-vs-environment categorization match the dex exactly.
// If the game changes them in a future patch this file is the single update site.

import { getPetSpecies, getMutation } from '../catalogs/gameCatalogs';

const XP_PER_HOUR = 3600;
const BASE_TARGET_STRENGTH = 80;
const MAX_TARGET_STRENGTH = 100;
const STRENGTH_GAINED_FROM_BIRTH_TO_MATURITY = 30;

const GROWTH_MUTATIONS = new Set(['Rainbow', 'Gold']);

export interface PetScaleArgs {
  speciesId: string;
  xp: number;
  targetScale: number;
}

function maxScaleOf(speciesId: string): number {
  const entry = getPetSpecies(speciesId);
  const m = (entry as { maxScale?: number } | null)?.maxScale;
  return typeof m === 'number' && m > 0 ? m : 1;
}

function hoursToMatureOf(speciesId: string): number {
  const entry = getPetSpecies(speciesId);
  const h = (entry as { hoursToMature?: number } | null)?.hoursToMature;
  return typeof h === 'number' && h > 0 ? h : 1;
}

export function getTargetStrength(speciesId: string, targetScale: number): number {
  const maxScale = maxScaleOf(speciesId);
  if (targetScale <= 1) return BASE_TARGET_STRENGTH;
  if (targetScale >= maxScale) return MAX_TARGET_STRENGTH;
  const scaleProgress = (targetScale - 1) / (maxScale - 1);
  return Math.floor(BASE_TARGET_STRENGTH + (MAX_TARGET_STRENGTH - BASE_TARGET_STRENGTH) * scaleProgress);
}

export function getStartingStrength(speciesId: string, targetScale: number): number {
  return getTargetStrength(speciesId, targetScale) - STRENGTH_GAINED_FROM_BIRTH_TO_MATURITY;
}

export function getStrength(args: PetScaleArgs): number {
  const hoursGrown = args.xp / XP_PER_HOUR;
  const strengthGainedPerHour = STRENGTH_GAINED_FROM_BIRTH_TO_MATURITY / hoursToMatureOf(args.speciesId);
  const strengthGained = Math.min(
    strengthGainedPerHour * hoursGrown,
    STRENGTH_GAINED_FROM_BIRTH_TO_MATURITY,
  );
  return Math.floor(getStartingStrength(args.speciesId, args.targetScale) + strengthGained);
}

export function getPetScale(args: PetScaleArgs): number {
  const strength = getStrength(args);
  const targetStrength = getTargetStrength(args.speciesId, args.targetScale);
  const progress = targetStrength > 0 ? strength / targetStrength : 0;
  return progress * args.targetScale;
}

/** Returns the XP at which the pet reaches max strength for its targetScale. */
export function getXPForMaturity(speciesId: string, targetScale: number): number {
  const startingStrength = getStartingStrength(speciesId, targetScale);
  const strengthGained = MAX_TARGET_STRENGTH - startingStrength;
  if (strengthGained <= 0) return 0;
  const strengthGainedPerHour = STRENGTH_GAINED_FROM_BIRTH_TO_MATURITY / hoursToMatureOf(speciesId);
  if (strengthGainedPerHour <= 0) return 0;
  return (strengthGained / strengthGainedPerHour) * XP_PER_HOUR;
}

/**
 * Mirrors `calculateMutationsMultiplier` in sell.ts. Formula:
 *   growthMult × (1 + Σ envMultipliers − envCount)
 * Growth mutations: Rainbow (×50), Gold (×25). Environment = everything else.
 */
export function calculateMutationsMultiplier(mutations: readonly string[]): number {
  if (!Array.isArray(mutations) || mutations.length === 0) return 1;
  let growthMult = 1;
  let envSum = 0;
  let envCount = 0;
  for (const m of mutations) {
    const entry = getMutation(m);
    const mult = entry?.coinMultiplier ?? 0;
    if (GROWTH_MUTATIONS.has(m)) {
      if (mult > 0) growthMult = mult;
    } else {
      envSum += mult;
      envCount += 1;
    }
  }
  return growthMult * (1 + envSum - envCount);
}

/** Mirrors InventoryCardVisual.formatWeightNumber. */
export function formatWeightNumber(weight: number): string {
  if (!Number.isFinite(weight) || weight < 0) return '0';
  if (weight < 1) return Math.max(weight, 0.01).toFixed(2);
  if (weight < 10) return weight.toFixed(1);
  return String(Math.round(weight));
}
