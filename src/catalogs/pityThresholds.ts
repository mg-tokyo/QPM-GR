// Bad Luck Protection thresholds. Egg species thresholds come from the catalog
// (`speciesPityThresholdPulls`); everything else is a client literal in the game
// bundle with no catalog source. Verified scraped-data/MainGameBundle-v1019/assets/main-BVK2blOC.js
// @957617 (SW/CW/TW/AW/jW/MW) and @399408 (vw rare-patch map). Re-verify per game version.

import {
  getAllEggTypes,
  getAllItems,
  getEggSpawnWeights,
  getEggSpeciesPityThresholds,
  getEggType,
  getMutation,
  getPlantSpecies,
} from './gameCatalogs';
import { getToolSpawnWeights } from './shopEligibility';

export const PITY_MULTIPLIER = 2;

/** 2026-08-26 UTC — accounts created before this started every counter at 50%. */
export const PITY_LAUNCH_TS = Date.UTC(2026, 7, 26);

export const GROWTH_PITY_THRESHOLDS: Readonly<Record<string, number>> = { Gold: 200, Rainbow: 2000 };

export type PityProximity = 'far' | 'close' | 'imminent' | 'due';
export const PITY_CLOSE_RATIO = 0.5;
export const PITY_IMMINENT_RATIO = 0.9;

/** Counter value the game seeded at launch: pre-launch accounts started every counter at 50%. */
export function pityLaunchFloor(thresholdPulls: number, accountCreatedAt: number | null): number {
  if (accountCreatedAt === null || accountCreatedAt >= PITY_LAUNCH_TS) return 0;
  return Math.floor(thresholdPulls / 2);
}

/**
 * Estimate of the game's counter: launch floor (until a hit is observed) plus observed
 * misses, pulled down by `correction` once a miss past the threshold proved it too high.
 */
export function estimatePityCount(
  counter: { misses: number; hits: number; correction?: number },
  thresholdPulls: number,
  accountCreatedAt: number | null,
): number {
  const floor = counter.hits === 0 ? pityLaunchFloor(thresholdPulls, accountCreatedAt) : 0;
  return Math.max(counter.misses, floor + counter.misses + (counter.correction ?? 0));
}

/**
 * "Guaranteed by pull N" forces the Nth pull, i.e. once N-1 misses are on the counter.
 * Verified live 2026-08-27: Common Egg Bee (threshold 40) hit at 20 (launch floor) + 19 misses.
 */
export function isPityDue(misses: number, thresholdPulls: number): boolean {
  return thresholdPulls > 0 && misses >= thresholdPulls - 1;
}

export function getPityProximity(misses: number, thresholdPulls: number): PityProximity {
  if (thresholdPulls <= 0) return 'far';
  if (isPityDue(misses, thresholdPulls)) return 'due';
  const ratio = (misses + 1) / thresholdPulls;
  if (ratio >= PITY_IMMINENT_RATIO) return 'imminent';
  if (ratio >= PITY_CLOSE_RATIO) return 'close';
  return 'far';
}

export const RARE_PATCH_CHANCE = 1 / 250;
export const RARE_PATCH_THRESHOLD = 500;

/** patch species → rare variant species */
export const RARE_PATCH_VARIANTS: Readonly<Record<string, string>> = {
  Daisy: 'PurpleDaisy',
  Clover: 'FourLeafClover',
  Snowdrop: 'SnowdropDouble',
  Cattail: 'VariegatedCattail',
};

const RARE_VARIANT_TO_PATCH: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(RARE_PATCH_VARIANTS).map(([patch, variant]) => [variant, patch]),
);

// AmberCapsule pulls tools, not flora: log action `openAmberCapsule` carries `toolIds`.
// Verified 3651-amber+rainshop/.../pityConfig.ts:12-15, V28_QuinoaUserJson.ts:979-986.
export const CAPSULE_PITY_THRESHOLDS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  DawnCapsule: { Dawnbreaker: 400, Ube: 80 },
  AmberCapsule: { XPShard: 80, StrengthShard: 400 },
};

export type PityKind = 'seed' | 'egg' | 'capsule';
export type PityRoll = 'species' | 'variant' | 'mutation';

export interface PityTarget {
  kind: PityKind;
  /** plant species, egg id, or capsule tool id */
  id: string;
}

export interface PityOutcome {
  outcomeId: string;
  roll: PityRoll;
  /** 0–1 */
  chance: number;
  thresholdPulls: number;
}

/** Counter bucket for a harvested crop: rare variants share their patch species' counters. */
export function pityBucketFor(cropSpecies: string): string {
  return RARE_VARIANT_TO_PATCH[cropSpecies] ?? cropSpecies;
}

export function isRareVariantSpecies(species: string): boolean {
  return species in RARE_VARIANT_TO_PATCH;
}

export function pityCounterKey(kind: PityKind, itemId: string, outcomeId: string): string {
  return `${kind}:${itemId}:${outcomeId}`;
}

export function parsePityCounterKey(key: string): { kind: PityKind; itemId: string; outcomeId: string } | null {
  const [kind, itemId, ...rest] = key.split(':');
  if ((kind !== 'seed' && kind !== 'egg' && kind !== 'capsule') || !itemId || rest.length === 0) return null;
  return { kind, itemId, outcomeId: rest.join(':') };
}

function mutationChance(mutationId: string): number {
  const chance = getMutation(mutationId)?.baseChance;
  return typeof chance === 'number' && chance > 0 ? chance : mutationId === 'Rainbow' ? 0.001 : 0.01;
}

function growthOutcomes(): PityOutcome[] {
  return Object.entries(GROWTH_PITY_THRESHOLDS)
    .map(([mutationId, thresholdPulls]) => ({
      outcomeId: mutationId,
      roll: 'mutation' as const,
      chance: mutationChance(mutationId),
      thresholdPulls,
    }))
    .sort((a, b) => a.chance - b.chance);
}

function seedOutcomes(species: string): PityOutcome[] {
  const variant = RARE_PATCH_VARIANTS[species];
  const out: PityOutcome[] = [];
  if (variant) out.push({ outcomeId: variant, roll: 'variant', chance: RARE_PATCH_CHANCE, thresholdPulls: RARE_PATCH_THRESHOLD });
  return [...out, ...growthOutcomes()];
}

function eggOutcomes(eggId: string): PityOutcome[] {
  const weights = getEggSpawnWeights(eggId);
  const total = Object.values(weights).reduce((sum, w) => sum + (Number.isFinite(w) ? w : 0), 0);
  let thresholds = getEggSpeciesPityThresholds(eggId);
  if (Object.keys(thresholds).length === 0 && total > 0) {
    // Pre-v1019 catalog: the game guarantees only the rarest species at 2× expected pulls.
    const rarest = Object.entries(weights).sort((a, b) => a[1] - b[1])[0];
    if (rarest && rarest[1] > 0) thresholds = { [rarest[0]]: Math.round((PITY_MULTIPLIER * total) / rarest[1]) };
  }
  const species = Object.entries(thresholds)
    .map(([speciesId, thresholdPulls]) => ({
      outcomeId: speciesId,
      roll: 'species' as const,
      chance: total > 0 ? (weights[speciesId] ?? 0) / total : 0,
      thresholdPulls,
    }))
    .sort((a, b) => a.chance - b.chance);
  return [...species, ...growthOutcomes()];
}

function capsuleOutcomes(toolId: string): PityOutcome[] {
  const thresholds = CAPSULE_PITY_THRESHOLDS[toolId];
  if (!thresholds) return [];
  const weights = getToolSpawnWeights(toolId);
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  return Object.entries(thresholds)
    .map(([speciesId, thresholdPulls]) => ({
      outcomeId: speciesId,
      roll: 'species' as const,
      chance: total > 0 ? (weights[speciesId] ?? 0) / total : 0,
      thresholdPulls,
    }))
    .sort((a, b) => a.chance - b.chance);
}

/** Mirrors the game's card-level `PW()` — which outcomes a seed/plant, egg, or capsule guarantees. */
export function getPityOutcomes(target: PityTarget): PityOutcome[] {
  switch (target.kind) {
    case 'seed': return getPlantSpecies(target.id) ? seedOutcomes(target.id) : [];
    case 'egg': return getEggType(target.id) ? eggOutcomes(target.id) : [];
    // Thresholds are client literals — no catalog gate, or pre-catalog hits would be dropped.
    case 'capsule': return capsuleOutcomes(target.id);
    default: return [];
  }
}

export function getPityCapsuleIds(): string[] {
  return getAllItems().filter((toolId) => toolId in CAPSULE_PITY_THRESHOLDS);
}

export function getPityEggIds(): string[] {
  return getAllEggTypes();
}
