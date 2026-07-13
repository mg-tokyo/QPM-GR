import type { ActivePetInfo } from '../../../store/pets';
import { computeAbilityStats, getAbilityDefinition } from '../data/petAbilities';
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

  // Use the catalog-sourced ability definition to compute stats via the linear model
  const def = getAbilityDefinition(resolved.abilityId);
  const strengthValue = baseScore > 0 ? baseScore : null;
  const abilityStats = def ? computeAbilityStats(def, strengthValue) : null;

  // Strength-scaled effect: minutes removed per proc
  const strengthScale = baseScore > 0 ? baseScore / 100 : 0;
  const reductionPerProc = resolved.effectMinutesPerProc * strengthScale;

  // procsPerHour from the linear model (p / 60 / 100 per second × 3600 seconds)
  const procsPerHour = abilityStats ? abilityStats.procsPerHour : 0;
  const perHourReduction = procsPerHour * reductionPerProc;
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
