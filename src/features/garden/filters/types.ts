export interface GardenFiltersConfig {
  enabled: boolean;
  mutations: string[]; // List of mutations to show (Rainbow, Gold, Frozen, etc)
  excludeMutations: boolean; // Invert: show plants WITHOUT the selected mutations
  cropSpecies: string[]; // List of crop species to show (Carrot, Strawberry, etc)
  eggTypes: string[]; // List of egg types to show (CommonEgg, RareEgg, etc)
  growthStates: ('mature' | 'growing')[]; // Growth state filter ([] = show all)
}

export interface TileNode {
  node: any;
  x: number;
  y: number;
}

// Cached filter sets — rebuilt only when config changes, not on every poll
export interface CachedFilterSets {
  speciesKeysToShow: Set<string>;
  mutationsToShow: Set<string>;
  eggTypesToShow: Set<string>;
  growthStatesToShow: Set<string>;
}
