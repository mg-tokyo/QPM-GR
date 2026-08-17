import type { BalloonModifier } from '../types';
import { CAMO_IN_SCRIPTED_ROUNDS } from '../constants';

export function resolveScriptedModifiers(
  mods: readonly BalloonModifier[] | undefined,
): readonly BalloonModifier[] | undefined {
  if (!mods || mods.length === 0) return undefined;
  if (CAMO_IN_SCRIPTED_ROUNDS) return mods;
  const filtered = mods.filter((m) => m !== 'camo');
  return filtered.length > 0 ? filtered : undefined;
}

// Shared kill-switch for endless-mode camo probability rolls, so scripted [C]
// groups and endless camo rolls can be disabled together if Owl coverage
// regresses.
export function endlessCamoEnabled(): boolean {
  return CAMO_IN_SCRIPTED_ROUNDS;
}
