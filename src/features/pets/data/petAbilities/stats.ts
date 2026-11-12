import { getAbilityDef } from '../../../../catalogs/gameCatalogs';
import type { AbilityDefinition } from './definitions';
import { computeDayAverageRate, computeStageRate, noStageContext } from './dayStage';
import type { AbilityRateContext, DayAverageRate } from './dayStage';

const DEFAULT_ROLL_MINUTES = 1;

export interface AbilityStats {
  multiplier: number;        // effective strength incl. crystal + stage bonus, no floor
  chancePerRoll: number;     // decimal per-second chance (compounding)
  rollPeriodMinutes: number;
  procsPerHour: number;
  chancePerSecond: number;   // percent; the server ticks every second
  chancePerMinute: number;   // percent, capped: the ability card's "Chance per minute"
  stage: string | null;
  stageBonus: number;
  dayAverage?: DayAverageRate;   // absent until the day cycle is parsed
}

/** Without `context` there is no stage or crystal term and no day average. */
export function computeAbilityStats(
  definition: AbilityDefinition,
  strength: number | null | undefined,
  context?: AbilityRateContext,
): AbilityStats {
  const rateContext = context ?? noStageContext();
  const baseProbability = definition.baseProbability ?? 0;
  const live = computeStageRate(baseProbability, strength, rateContext, rateContext.stage);
  const dayAverage = context ? computeDayAverageRate(baseProbability, strength, context) : null;

  return {
    multiplier: live.multiplier,
    chancePerRoll: live.chancePerSecond,
    rollPeriodMinutes: definition.rollPeriodMinutes ?? DEFAULT_ROLL_MINUTES,
    procsPerHour: live.procsPerHour,
    chancePerSecond: live.chancePerSecond * 100,
    chancePerMinute: live.chancePerMinute * 100,
    stage: live.stage,
    stageBonus: live.stageBonus,
    ...(dayAverage ? { dayAverage } : {}),
  };
}

/** With `strength` the effect scales by the effective strength (`stats.multiplier`). */
export function computeEffectPerHour(
  definition: AbilityDefinition,
  stats: AbilityStats,
  strength: number | null | undefined = undefined,
): number {
  const effect = definition.effectValuePerProc ?? 0;
  if (!Number.isFinite(effect) || effect === 0) {
    return 0;
  }
  const strengthScale = strength != null && Number.isFinite(strength) ? stats.multiplier : 1;
  return stats.procsPerHour * effect * strengthScale;
}

export function computeDayAverageEffectPerHour(definition: AbilityDefinition, stats: AbilityStats): number | null {
  const effect = definition.effectValuePerProc ?? 0;
  if (!stats.dayAverage) return null;
  if (!Number.isFinite(effect) || effect === 0) return 0;
  return stats.dayAverage.strengthWeightedProcsPerHour * effect;
}

/** Returns true if the ability has trigger 'playerActivated' (e.g. DawnCapture). */
export function isChargedAbility(abilityId: string): boolean {
  const def = getAbilityDef(abilityId);
  return def?.trigger === 'playerActivated';
}

/** Returns the first charged ability ID from the list, or null if none. */
export function getPetChargedAbility(abilities: readonly string[]): string | null {
  for (const id of abilities) {
    if (isChargedAbility(id)) return id;
  }
  return null;
}
