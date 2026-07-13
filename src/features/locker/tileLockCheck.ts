import type { LockerConfig } from './types';
import {
  hasAnyLockedMutation,
  evaluateSizeFilter,
  evaluateColorFilter,
  evaluateWeatherFilter,
  resolveEffectiveFilter,
  hasAnyCriteria,
} from './rules-primitives';

export type TileLockContext =
  | { kind: 'plant'; species: string; baseSpecies?: string; mutations: string[]; sizePercent: number }
  | { kind: 'egg'; eggId: string }
  | { kind: 'decor'; decorId: string };

function isPlantLocked(
  tile: Extract<TileLockContext, { kind: 'plant' }>,
  config: LockerConfig,
): boolean {
  if (config.harvestLock) return true;
  // species = selected slot (may be a rare variant); baseSpecies = tile-level plant.
  // A lock on either protects this slot — mirrors the guard's harvest semantics.
  if (config.plantLocks[tile.species]) return true;
  if (tile.baseSpecies && config.plantLocks[tile.baseSpecies]) return true;
  if (hasAnyLockedMutation(tile.mutations, config.mutationLocks)) return true;

  const settings = resolveEffectiveFilter(config, tile.species);
  if (settings && hasAnyCriteria(settings)) {
    const size = evaluateSizeFilter(settings, tile.sizePercent);
    const color = evaluateColorFilter(settings, tile.mutations);
    const weather = evaluateWeatherFilter(settings, tile.mutations);

    if (settings.filterMode === 'LOCK') {
      if ((size.hasCriteria && size.matched)
        || (color.hasCriteria && color.matched)
        || (weather.hasCriteria && weather.matched)) return true;
    } else {
      if ((size.hasCriteria && !size.matched)
        || (color.hasCriteria && !color.matched)
        || (weather.hasCriteria && !weather.matched)) return true;
    }
  }

  if (config.cropSellLocks[tile.species]) return true;
  if (tile.baseSpecies && config.cropSellLocks[tile.baseSpecies]) return true;
  return false;
}

export function isTileLocked(tile: TileLockContext, config: LockerConfig): boolean {
  if (!config.enabled) return false;

  switch (tile.kind) {
    case 'plant':
      return isPlantLocked(tile, config);
    case 'egg':
      return config.hatchLock || Boolean(config.eggLocks[tile.eggId]);
    case 'decor':
      return config.decorPickupLock || Boolean(config.decorLocks[tile.decorId]);
  }
}
