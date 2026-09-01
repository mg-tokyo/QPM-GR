import { getAbilityDef } from '../../../../catalogs/gameCatalogs';
import type { AbilityDefinition } from './definitions';

const STRENGTH_BASELINE = 100;
const MIN_MULTIPLIER = 0.25;
const MAX_CHANCE_PER_SECOND = 0.95 / 60; // cap: 95% per minute
const DEFAULT_ROLL_MINUTES = 1;

export interface AbilityStats {
  multiplier: number;
  chancePerRoll: number;
  rollPeriodMinutes: number;
  procsPerHour: number;
  chancePerSecond: number;   // game rolls every second
  chancePerMinute: number;   // for display
}

export function computeAbilityStats(definition: AbilityDefinition, strength: number | null | undefined): AbilityStats {
  // STR is a percentage multiplier: STR=100 → 1.0x, STR=62 → 0.62x, STR=50 → 0.5x. Game rolls every second.
  const rawStrength = Number.isFinite(strength) ? (strength as number) : STRENGTH_BASELINE;
  const multiplier = Math.max(MIN_MULTIPLIER, rawStrength / 100);

  const baseChancePerMinute = Math.max(0, definition.baseProbability ?? 0);
  const baseChancePerSecond = baseChancePerMinute / 60;

  const chancePerSecondDecimal = Math.max(0, baseChancePerSecond / 100);
  const chancePerRoll = Math.min(MAX_CHANCE_PER_SECOND, chancePerSecondDecimal * multiplier);

  const rollsPerHour = 3600;
  const procsPerHour = rollsPerHour * chancePerRoll;

  const chancePerSecond = chancePerRoll * 100;
  const chancePerMinute = chancePerSecond * 60;

  const rollPeriodMinutes = definition.rollPeriodMinutes ?? DEFAULT_ROLL_MINUTES;

  return {
    multiplier,
    chancePerRoll,
    rollPeriodMinutes,
    procsPerHour,
    chancePerSecond,
    chancePerMinute,
  };
}

export function computeEffectPerHour(
  definition: AbilityDefinition,
  stats: AbilityStats,
  strength: number | null | undefined = undefined,
): number {
  const effect = definition.effectValuePerProc ?? 0;
  if (!Number.isFinite(effect) || effect === 0) {
    return 0;
  }
  const strengthScale = strength != null && Number.isFinite(strength)
    ? Math.max(0, strength) / 100
    : 1;
  return stats.procsPerHour * effect * strengthScale;
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
