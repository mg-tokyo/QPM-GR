import type { LockerConfig, HarvestFilterSettings } from './types';

export interface DimensionResult {
  hasCriteria: boolean;
  matched: boolean;
}

export function hasAnyLockedMutation(
  mutations: string[],
  locks: Record<string, boolean>,
): string | undefined {
  for (const m of mutations) {
    if (locks[m]) return m;
  }
  return undefined;
}

export function evaluateSizeFilter(
  settings: HarvestFilterSettings,
  sizePercent: number,
): DimensionResult {
  switch (settings.scaleLockMode) {
    case 'RANGE':
      return {
        hasCriteria: true,
        matched: sizePercent >= settings.minScalePct && sizePercent <= settings.maxScalePct,
      };
    case 'MINIMUM':
      return { hasCriteria: true, matched: sizePercent >= settings.minScalePct };
    case 'MAXIMUM':
      return { hasCriteria: true, matched: sizePercent <= settings.maxScalePct };
    case 'NONE':
    default:
      return { hasCriteria: false, matched: false };
  }
}

export function evaluateColorFilter(
  settings: HarvestFilterSettings,
  mutations: string[],
): DimensionResult {
  if (!settings.colorGold && !settings.colorRainbow && !settings.colorNormal) {
    return { hasCriteria: false, matched: false };
  }
  const mutSet = new Set(mutations.map((m) => m.toLowerCase()));
  const isGold = mutSet.has('gold') || mutSet.has('golden');
  const isRainbow = mutSet.has('rainbow');
  const isNormal = !isGold && !isRainbow;

  const matched =
    (settings.colorGold && isGold) ||
    (settings.colorRainbow && isRainbow) ||
    (settings.colorNormal && isNormal);
  return { hasCriteria: true, matched };
}

export function evaluateWeatherFilter(
  settings: HarvestFilterSettings,
  mutations: string[],
): DimensionResult {
  const mutLower = new Set(mutations.map((m) => m.toLowerCase()));

  if (settings.weatherMode === 'RECIPES') {
    const nonEmpty = settings.weatherRecipes.filter((r) => r.length > 0);
    if (nonEmpty.length === 0) return { hasCriteria: false, matched: false };
    const matched = nonEmpty.some((recipe) =>
      recipe.every((tag) => mutLower.has(tag.toLowerCase())),
    );
    return { hasCriteria: true, matched };
  }

  if (settings.weatherTags.length === 0) return { hasCriteria: false, matched: false };

  if (settings.weatherMode === 'ALL') {
    const matched = settings.weatherTags.every((tag) => mutLower.has(tag.toLowerCase()));
    return { hasCriteria: true, matched };
  }
  const matched = settings.weatherTags.some((tag) => mutLower.has(tag.toLowerCase()));
  return { hasCriteria: true, matched };
}

export function resolveEffectiveFilter(
  config: LockerConfig,
  species?: string,
): HarvestFilterSettings | null {
  if (species) {
    const override = config.cropOverrides[species];
    if (override?.enabled) return override.settings;
  }
  return config.harvestFilter;
}

export function hasAnyCriteria(settings: HarvestFilterSettings): boolean {
  if (settings.scaleLockMode !== 'NONE') return true;
  if (settings.colorGold || settings.colorRainbow || settings.colorNormal) return true;
  if (settings.weatherMode === 'RECIPES' && settings.weatherRecipes.some((r) => r.length > 0)) return true;
  if (settings.weatherMode !== 'RECIPES' && settings.weatherTags.length > 0) return true;
  return false;
}
