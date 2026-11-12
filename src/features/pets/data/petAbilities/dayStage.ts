// Ability-rate maths matching the game (REL-6 spec F13/F19): strength
// `(base + strengthBonus + stageBonus) / 100` with no floor, chance per minute capped at the
// bundle cap, and per-second compounding (D1). Stages, minutes, bonus and cap are parsed data.

import { getPetSpecies } from '../../../../catalogs/gameCatalogs';
import { getDayCycle } from '../../../../catalogs/logic/dayCycleCatalog';
import type { CrystalModifierTable, DayCycleData } from '../../../../catalogs/logic/dayCycleCatalog';
import { isGameStateReady, readSync } from '../../../../core/gameState';
import { isRecord } from '../../../../utils/typeGuards';
import { getGardenSnapshot } from '../../../garden/bridge';

const STRENGTH_BASELINE = 100;
// The game's own field name for the crystal STR term (strength fn param and modifier key, spec F13/F28).
const STRENGTH_MODIFIER = 'strengthBonus';

export interface AbilityRateContext {
  isNocturnal: boolean;
  stage: string | null;
  strengthBonus: number;   // crystal STR from the parsed modifier table and the garden's active crystals
  dayCycle: DayCycleData;
}

/** Crystal types with charge left, over both garden tile maps (game `dt`/`ct`, spec F28). */
export function activeCrystalTypes(garden: unknown): Set<string> {
  const out = new Set<string>();
  if (!isRecord(garden)) return out;
  for (const tiles of [garden.tileObjects, garden.boardwalkTileObjects]) {
    if (!isRecord(tiles)) continue;
    for (const obj of Object.values(tiles)) {
      if (!isRecord(obj) || typeof obj.crystalType !== 'string') continue;
      const remaining = obj.remainingActiveSeconds;
      if (typeof remaining === 'number' && remaining > 0) out.add(obj.crystalType);
    }
  }
  return out;
}

/** The parsed modifier's value for the active crystal set; null when the table lacks it. */
export function crystalModifierValue(
  table: CrystalModifierTable | null,
  modifier: string,
  active: ReadonlySet<string>,
): number | null {
  const entry = table && Object.prototype.hasOwnProperty.call(table, modifier) ? table[modifier] : undefined;
  if (!entry) return null;
  return active.has(entry.crystalType) ? entry.active : entry.inactive;
}

export function getActiveCrystalTypes(): Set<string> {
  return activeCrystalTypes(getGardenSnapshot());
}

export function getCrystalStrengthBonus(dayCycle: DayCycleData = getDayCycle()): number {
  return crystalModifierValue(dayCycle.crystalModifiers, STRENGTH_MODIFIER, getActiveCrystalTypes()) ?? 0;
}

export interface StageRate {
  stage: string | null;
  stageBonus: number;
  multiplier: number;
  chancePerMinute: number;   // decimal, capped: what the ability card shows / 100
  chancePerSecond: number;   // decimal, compounding
  procsPerHour: number;
}

export interface DayAverageRate {
  procsPerHour: number;
  strengthWeightedProcsPerHour: number;   // Σ weight · procs/h · multiplier, for effect/h
}

export function noStageContext(dayCycle: DayCycleData = getDayCycle()): AbilityRateContext {
  return { isNocturnal: false, stage: null, strengthBonus: 0, dayCycle };
}

export function getAbilityRateContext(species: string | null | undefined): AbilityRateContext {
  const entry = species ? getPetSpecies(species) : null;
  const dayCycle = getDayCycle();
  return {
    isNocturnal: entry?.isNocturnal === true,
    stage: isGameStateReady() ? readSync('dayNightStage') : null,
    strengthBonus: getCrystalStrengthBonus(dayCycle),
    dayCycle,
  };
}

export function stageStrengthBonus(
  isNocturnal: boolean,
  stage: string | null,
  bonusTable: Readonly<Record<string, number>> | null,
): number {
  if (!isNocturnal || stage === null || !bonusTable) return 0;
  const bonus = Object.prototype.hasOwnProperty.call(bonusTable, stage) ? bonusTable[stage] : undefined;
  return typeof bonus === 'number' && Number.isFinite(bonus) ? bonus : 0;
}

export function effectiveMultiplier(strength: number | null | undefined, bonus: number): number {
  const base = typeof strength === 'number' && Number.isFinite(strength) ? strength : STRENGTH_BASELINE;
  return Math.max(0, base + bonus) / 100;
}

export function cappedChancePerMinute(baseProbability: number, multiplier: number, cap: number | null): number {
  const raw = (Math.max(0, baseProbability) * multiplier) / 100;
  const clamped = Number.isNaN(raw) ? 0 : Math.min(1, Math.max(0, raw));
  return cap === null ? clamped : Math.min(cap, clamped);
}

export function compoundingChancePerSecond(chancePerMinute: number): number {
  if (chancePerMinute <= 0) return 0;
  if (chancePerMinute >= 1) return 1;
  return 1 - Math.pow(1 - chancePerMinute, 1 / 60);
}

export function computeStageRate(
  baseProbability: number,
  strength: number | null | undefined,
  context: AbilityRateContext,
  stage: string | null,
): StageRate {
  const stageBonus = stageStrengthBonus(context.isNocturnal, stage, context.dayCycle.nocturnalBonus);
  const multiplier = effectiveMultiplier(strength, context.strengthBonus + stageBonus);
  const chancePerMinute = cappedChancePerMinute(baseProbability, multiplier, context.dayCycle.chanceCapPerMinute);
  const chancePerSecond = compoundingChancePerSecond(chancePerMinute);
  return { stage, stageBonus, multiplier, chancePerMinute, chancePerSecond, procsPerHour: 3600 * chancePerSecond };
}

/** Stage rates weighted by parsed stage minutes; null until the cycle is parsed. */
export function computeDayAverageRate(
  baseProbability: number,
  strength: number | null | undefined,
  context: AbilityRateContext,
): DayAverageRate | null {
  const stages = context.dayCycle.stages;
  if (!stages) return null;
  const totalMinutes = stages.reduce((sum, s) => sum + s.minutes, 0);
  if (!(totalMinutes > 0)) return null;
  let procsPerHour = 0;
  let strengthWeightedProcsPerHour = 0;
  for (const { id, minutes } of stages) {
    const rate = computeStageRate(baseProbability, strength, context, id);
    const weight = minutes / totalMinutes;
    procsPerHour += weight * rate.procsPerHour;
    strengthWeightedProcsPerHour += weight * rate.procsPerHour * rate.multiplier;
  }
  return { procsPerHour, strengthWeightedProcsPerHour };
}

/**
 * Stage-minute-weighted average of every field `evaluate` returns; null until the cycle is parsed.
 * Average the products, not the factors: a per-proc value can itself depend on the stage's STR.
 */
export function averageOverDayCycle<T extends Record<string, number>>(
  context: AbilityRateContext,
  evaluate: (stageContext: AbilityRateContext) => T,
): T | null {
  const stages = context.dayCycle.stages;
  if (!stages) return null;
  const totalMinutes = stages.reduce((sum, s) => sum + s.minutes, 0);
  if (!(totalMinutes > 0)) return null;
  if (!context.isNocturnal) return evaluate(context);
  const sums: Record<string, number> = {};
  for (const { id, minutes } of stages) {
    const weight = minutes / totalMinutes;
    for (const [key, value] of Object.entries(evaluate({ ...context, stage: id }))) {
      sums[key] = (sums[key] ?? 0) + weight * value;
    }
  }
  return sums as T;
}
