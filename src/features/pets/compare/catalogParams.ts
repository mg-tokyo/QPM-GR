import { getAbilityDef } from '../../../catalogs/gameCatalogs';

function toFinitePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function getStrengthScaleFactor(strength: number): number {
  return Math.max(0.25, strength / 100);
}

export function resolveCatalogFamilyKey(abilityId: string): string | null {
  const catalogEntry = getAbilityDef(abilityId);
  if (!catalogEntry?.baseParameters || typeof catalogEntry.baseParameters !== 'object') {
    return null;
  }

  const params = catalogEntry.baseParameters as Record<string, unknown>;
  if (toFinitePositiveNumber(params['plantGrowthReductionMinutes']) != null) return 'plantgrowthboost';
  if (toFinitePositiveNumber(params['eggGrowthTimeReductionMinutes']) != null) return 'egggrowthboost';
  if (toFinitePositiveNumber(params['hungerRestorePercentage']) != null) return 'hungerrestore';
  if (toFinitePositiveNumber(params['hungerRefundPercentage']) != null) return 'hungerboost';
  if (toFinitePositiveNumber(params['scaleIncreasePercentage']) != null) return 'producescaleboost';
  if (toFinitePositiveNumber(params['baseMaxCoinsFindable']) != null) return 'coinfinder';
  if (toFinitePositiveNumber(params['bonusXp']) != null) {
    return catalogEntry.trigger === 'hatchEgg' ? 'petageboost' : 'petxpboost';
  }
  if (toFinitePositiveNumber(params['mutationChanceIncreasePercentage']) != null) {
    return catalogEntry.trigger === 'hatchEgg' ? 'petmutationboost' : 'producemutationboost';
  }
  if (toFinitePositiveNumber(params['maxStrengthIncreasePercentage']) != null) return 'pethatchsizeboost';
  if (toFinitePositiveNumber(params['cropSellPriceIncreasePercentage']) != null) {
    return catalogEntry.trigger === 'sellAllCrops' ? 'sellboost' : null;
  }
  return null;
}

export function resolveCatalogScaledParameterValue(
  abilityId: string,
  strength: number,
): { value: number; sourceKey: string } | null {
  const catalogEntry = getAbilityDef(abilityId);
  if (!catalogEntry || !catalogEntry.baseParameters || typeof catalogEntry.baseParameters !== 'object') {
    return null;
  }

  const params = catalogEntry.baseParameters as Record<string, unknown>;
  const strengthScaleFactor = getStrengthScaleFactor(strength);

  const orderedKeys = [
    'mutationChanceIncreasePercentage',
    'cropSellPriceIncreasePercentage',
    'hungerRefundPercentage',
    'hungerRestorePercentage',
    'plantGrowthReductionMinutes',
    'eggGrowthTimeReductionMinutes',
    'scaleIncreasePercentage',
    'baseMaxCoinsFindable',
    'bonusXp',
    'maxStrengthIncreasePercentage',
  ] as const;

  for (const key of orderedKeys) {
    const raw = toFinitePositiveNumber(params[key]);
    if (raw == null) continue;
    return {
      value: raw * strengthScaleFactor,
      sourceKey: key,
    };
  }

  return null;
}

export function hasCatalogBaseProbability(abilityId: string): boolean {
  const entry = getAbilityDef(abilityId);
  return typeof entry?.baseProbability === 'number' && Number.isFinite(entry.baseProbability);
}
