// src/features/chargedAbilities/abilities/index.ts
// Plugin registry. Adding a new ability = drop a plugin file + extend PROJECTIONS.

import type { AbilityProjection } from './types';
import { thundercharger } from './thundercharger';
import { dawnCapture } from './dawnCapture';

const PROJECTIONS: readonly AbilityProjection[] = [thundercharger, dawnCapture];
const BY_ID = new Map<string, AbilityProjection>(PROJECTIONS.map((p) => [p.abilityId, p]));

export type { AbilityProjection, PlantSlotMinimal, ProjectedGain } from './types';
export { thundercharger, dawnCapture };

export function getAbilityProjection(abilityId: string): AbilityProjection | null {
  return BY_ID.get(abilityId) ?? null;
}

export function getAllAbilityProjections(): readonly AbilityProjection[] {
  return PROJECTIONS;
}
