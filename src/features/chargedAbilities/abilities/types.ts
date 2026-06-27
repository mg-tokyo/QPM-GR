// src/features/chargedAbilities/abilities/types.ts
// Catalog-driven ability registry — each player-activated ability is a plugin
// matching this shape. New abilities require zero changes to the surface code:
// drop a plugin file + add it to the registry index.

export interface PlantSlotMinimal {
  species: string;
  mutations: string[];
  targetScale: number;
  endTime: number;
}

export interface ProjectedGain {
  coin: number;
  capsule: number;
}

export interface AbilityProjection {
  abilityId: string;
  abilityName: string;
  /** Full cooldown duration in ms — used to render charge progress. */
  cooldownMs: number;
  targetMutations: string[];
  /** Pet species that natively carry this charged ability. Used to render the
   *  "NEED: [pet sprite]" indicator when no equipped pet has the ability. */
  requiredSpecies: readonly string[];
  replacementMutation: string | null;
  yieldKind: 'coin' | 'capsule';
  accentColor: string;
  applies(slot: PlantSlotMinimal): boolean;
  projectGain(slot: PlantSlotMinimal): ProjectedGain;
  /** Remaining cooldown ms for the given pet slot. 0 if ready / unknown. */
  getCooldownRemainingMs(petSlotId: string): number;
}
