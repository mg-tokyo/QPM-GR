import type { ActivePetInfo } from '../../../store/pets';
import {
  averageOverDayCycle,
  computeAbilityStats,
  getAbilityDefinition,
  getAbilityRateContext,
  type AbilityRateContext,
} from '../data/petAbilities';
import { getManualOverride } from './overrides';
import { config } from './state';
import type { ResolvedGrowthAbility, TurtleContribution, TurtlePetStats } from './types';

function sanitizeTargetScale(scale: number | null | undefined): number {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) {
    return config.fallbackTargetScale;
  }
  if (scale < 1) {
    return 1;
  }
  if (scale > config.maxTargetScale) {
    return config.maxTargetScale;
  }
  return scale;
}

export function resolveTurtlePetStats(pet: ActivePetInfo): TurtlePetStats {
  // Manual overrides fill in for missing atom data.
  const manualOverride = getManualOverride(pet);

  let xp = typeof pet.xp === 'number' && Number.isFinite(pet.xp) ? pet.xp : null;
  if (xp == null && manualOverride?.xp != null) {
    xp = manualOverride.xp;
  }

  let targetScaleRaw = pet.targetScale;
  if (targetScaleRaw == null && manualOverride?.targetScale != null) {
    targetScaleRaw = manualOverride.targetScale;
  }
  const targetScale = sanitizeTargetScale(targetScaleRaw);

  // Prefer strength (most accurate); fall back to XP + targetScale derivation below.
  let strength = typeof pet.strength === 'number' && Number.isFinite(pet.strength) ? pet.strength : null;
  if (strength == null && manualOverride?.strength != null) {
    strength = manualOverride.strength;
  }

  const missingStats = pet.xp == null || pet.targetScale == null;
  const hasManualOverride = manualOverride && (manualOverride.xp != null || manualOverride.targetScale != null || manualOverride.strength != null);

  let baseScore: number;
  if (strength != null) {
    baseScore = Math.max(0, strength);
  } else {
    const xpComponent = Math.min(Math.floor((((xp ?? 0) / (100 * 3600)) * 30)), 30);
    const scaleComponent = Math.floor(((targetScale - 1) / (config.maxTargetScale - 1)) * 20 + 80) - 30;
    baseScore = Math.max(0, xpComponent + scaleComponent);
  }

  return {
    xp,
    targetScale,
    baseScore,
    missingStats: missingStats && !hasManualOverride,
  };
}

export function computeContribution(
  pet: ActivePetInfo,
  resolved: ResolvedGrowthAbility,
  abilityNames: string[],
): TurtleContribution {
  const petStats = resolveTurtlePetStats(pet);
  const { xp, targetScale, baseScore, missingStats } = petStats;

  const def = getAbilityDefinition(resolved.abilityId);
  const context = getAbilityRateContext(pet.species);
  // Minutes removed per hour at the stage's effective STR (crystal + nocturnal bonus), averaged
  // over the day cycle: a timer often spans stages (REL-6.8). Live until the cycle parses.
  const evaluate = (stageContext: AbilityRateContext): { procsPerHour: number; perHourReduction: number } => {
    const stats = def && baseScore > 0 ? computeAbilityStats(def, baseScore, stageContext) : null;
    if (!stats) return { procsPerHour: 0, perHourReduction: 0 };
    return {
      procsPerHour: stats.procsPerHour,
      perHourReduction: stats.procsPerHour * resolved.effectMinutesPerProc * stats.multiplier,
    };
  };
  const { procsPerHour, perHourReduction } = averageOverDayCycle(context, evaluate) ?? evaluate(context);
  // Kept as the ratio so turtleTimerLogic's variance maths sees one consistent procs/min.
  const reductionPerProc = procsPerHour > 0 ? perHourReduction / procsPerHour : 0;
  const rateContribution = perHourReduction / 60; // per-minute rate for compatibility

  return {
    ability: resolved.kind,
    abilityNames,
    slotIndex: pet.slotIndex,
    name: pet.name,
    species: pet.species,
    mutations: Array.isArray(pet.mutations) ? [...pet.mutations] : [],
    hungerPct: pet.hungerPct,
    xp,
    targetScale,
    baseScore,
    rateContribution,
    perHourReduction,
    reductionPerProc,
    missingStats,
  };
}

export function describePetKey(pet: ActivePetInfo): string {
  return pet.petId ?? pet.slotId ?? `${pet.slotIndex}-${pet.name ?? 'pet'}`;
}
