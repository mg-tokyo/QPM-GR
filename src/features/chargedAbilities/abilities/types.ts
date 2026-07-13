// Plugin registry: new abilities need only a plugin file + registry entry, no surface code changes.

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
