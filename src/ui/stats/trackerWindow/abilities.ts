import type { ActivePetInfo } from '../../../store/pets';
import {
  getAbilityDefinition,
  computeAbilityStats,
  computeEffectPerHour,
  computeDayAverageEffectPerHour,
  getAbilityRateContext,
  type AbilityDefinition,
  type AbilityRateContext,
  type AbilityStats,
} from '../../../features/pets/data/petAbilities';
import {
  buildAbilityValuationContext,
  resolveDynamicAbilityEffect,
  type AbilityValuationContext,
} from '../../../features/pets/abilityValuation';
import { getInactiveWeatherLabel } from '../../../features/pets/abilityWeatherGate';

export interface AbilityTrackerTotals {
  procsPerHour: number;
  coinsPerHour: number;
  dayAverageProcsPerHour: number;   // live where the day cycle is not parsed yet
  dayAverageCoinsPerHour: number;
  abilityCount: number;
  petCount: number;
}

export interface ActiveAbility {
  def: AbilityDefinition;
  raw: string;
  procsPerHour: number;
  coinsPerHour: number | null;
  dayAverageProcsPerHour: number | null;   // null until the day cycle is parsed
  dayAverageCoinsPerHour: number | null;
  isNocturnal: boolean;
  stage: string | null;
  stageBonus: number;
  /** Set while the ability's required weather is inactive: row greyed, excluded from totals. */
  inactiveWeather: string | null;
}

/**
 * Garden-valued effects are summed per stage at that stage's effective STR: some ignore STR
 * (granters, live 2026-11-12), so scaling the live value by a STR ratio is wrong.
 */
function gardenEffectDayAverage(
  def: AbilityDefinition,
  stats: AbilityStats,
  pet: ActivePetInfo,
  context: AbilityRateContext,
  gardenCtx: AbilityValuationContext,
  liveCoins: number,
): number | null {
  const stages = context.dayCycle.stages;
  if (!stats.dayAverage || !stages) return null;
  if (!context.isNocturnal) return liveCoins;
  const totalMinutes = stages.reduce((sum, s) => sum + s.minutes, 0);
  if (!(totalMinutes > 0)) return null;
  let total = 0;
  for (const { id, minutes } of stages) {
    const stageStats = computeAbilityStats(def, pet.strength, { ...context, stage: id });
    const effect = resolveDynamicAbilityEffect(def.id, gardenCtx, stageStats.multiplier * 100);
    if (effect && effect.effectPerProc > 0) total += (minutes / totalMinutes) * stageStats.procsPerHour * effect.effectPerProc;
  }
  return total;
}

export function resolvePetAbilities(pet: ActivePetInfo, gardenCtx?: AbilityValuationContext): ActiveAbility[] {
  if (!pet.abilities?.length) return [];
  const context = getAbilityRateContext(pet.species);
  const result: ActiveAbility[] = [];
  for (const raw of pet.abilities) {
    if (!raw) continue;
    const def = getAbilityDefinition(raw);
    if (!def || def.trigger !== 'continuous' || (def.baseProbability ?? 0) <= 0) continue;
    const stats = computeAbilityStats(def, pet.strength, context);
    // STR incl. crystal and stage bonus, user 2026-11-12 ("Effective STR").
    const effectiveStrength = stats.multiplier * 100;
    let coinsPerHour: number | null = null;
    let dayAverageCoinsPerHour: number | null = null;
    if (stats.procsPerHour > 0) {
      if (def.effectUnit === 'coins' && def.effectValuePerProc != null) {
        coinsPerHour = computeEffectPerHour(def, stats, effectiveStrength);
        dayAverageCoinsPerHour = computeDayAverageEffectPerHour(def, stats);
      } else if (gardenCtx && def.effectUnit !== 'xp' && def.effectUnit !== 'minutes') {
        try {
          const dynamic = resolveDynamicAbilityEffect(def.id, gardenCtx, effectiveStrength);
          if (dynamic && dynamic.effectPerProc > 0) {
            coinsPerHour = dynamic.effectPerProc * stats.procsPerHour;
            dayAverageCoinsPerHour = gardenEffectDayAverage(def, stats, pet, context, gardenCtx, coinsPerHour);
          }
        } catch { /* ignore if garden not ready */ }
      }
    }
    result.push({
      def,
      raw,
      procsPerHour: stats.procsPerHour,
      coinsPerHour,
      dayAverageProcsPerHour: stats.dayAverage?.procsPerHour ?? null,
      dayAverageCoinsPerHour,
      isNocturnal: context.isNocturnal,
      stage: stats.stage,
      stageBonus: stats.stageBonus,
      inactiveWeather: getInactiveWeatherLabel(def),
    });
  }
  return result;
}

export function getTotals(pets: ActivePetInfo[], gardenCtx?: AbilityValuationContext): AbilityTrackerTotals {
  const totals: AbilityTrackerTotals = {
    procsPerHour: 0,
    coinsPerHour: 0,
    dayAverageProcsPerHour: 0,
    dayAverageCoinsPerHour: 0,
    abilityCount: 0,
    petCount: 0,
  };
  for (const pet of pets) {
    const abilities = resolvePetAbilities(pet, gardenCtx);
    if (!abilities.length) continue;
    totals.petCount++;
    for (const a of abilities) {
      if (!a.inactiveWeather) {
        totals.procsPerHour += a.procsPerHour;
        totals.coinsPerHour += a.coinsPerHour ?? 0;
        totals.dayAverageProcsPerHour += a.dayAverageProcsPerHour ?? a.procsPerHour;
        totals.dayAverageCoinsPerHour += a.dayAverageCoinsPerHour ?? a.coinsPerHour ?? 0;
      }
      totals.abilityCount++;
    }
  }
  return totals;
}

export function getAbilityTrackerTotals(pets: ActivePetInfo[]): AbilityTrackerTotals {
  let gardenCtx: AbilityValuationContext | undefined;
  try { gardenCtx = buildAbilityValuationContext(); } catch { /* not ready yet */ }
  return getTotals(pets, gardenCtx);
}
