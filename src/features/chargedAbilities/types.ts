import type { AbilityProjection, PlantSlotMinimal, ProjectedGain } from './abilities/types';
import type { TilePosition } from '../garden/tileRadius';

export interface OptimalityResult {
  currentGain: number;
  bestGain: number;
  pct: number;
  bestPatch: { center: TilePosition; slots: PlantSlotMinimal[]; gain: ProjectedGain } | null;
}

export interface PetAbilityTargetSnapshot {
  petSlotId: string;
  petName: string;
  petSpecies: string;
  abilityId: string;
  ability: AbilityProjection;
  ready: boolean;
  cdRemainingMs: number;
  qualifyingSlots: PlantSlotMinimal[];
  qualifyingCount: number;
  qualifyingSpeciesSummary: string;
  projectedGain: ProjectedGain;
  optimality: OptimalityResult;
  isMounted: boolean;
}
