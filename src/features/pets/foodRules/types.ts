export interface SpeciesOverride {
  allowed?: string[];
  forbidden?: string[];
  preferred?: string;
}

export interface PetFoodRulesState {
  avoidFavorited: boolean;
  overrides: Record<string, SpeciesOverride>;
  updatedAt: number;
}

export interface InventoryItemSnapshot {
  id: string;
  species: string | null;
  itemType: string | null;
  name: string | null;
  quantity: number | null;
  scale: number | null;
  mutations: string[];
}

export interface InventorySnapshot {
  items: InventoryItemSnapshot[];
  favoritedIds: Set<string>;
  source: string;
}

export interface FoodSelection {
  item: InventoryItemSnapshot;
  usedFavoriteFallback: boolean;
  /** When true, the selected food is a Replenish Potion (tool, not a crop). */
  isHungerPotion?: boolean;
}

export interface FoodSelectionOptions {
  avoidFavorited?: boolean;
  /**
   * Per-pet-item override. When provided, takes precedence over the species-level override.
   * Callers (e.g. instantFeed.ts) should read this from the Pet Teams feed policy.
   */
  itemOverride?: SpeciesOverride;
}

export interface EligibleFoodEntry {
  key: string;
  label: string;
  count: number;
  /** Base coin value per unit (baseSellPrice for crops, Infinity for hunger potion). */
  coinValue: number;
  isHungerPotion?: boolean;
}

export interface FoodAvailabilityResult {
  selected: FoodSelection | null;
  availableCount: number;
  eligibleFoods: EligibleFoodEntry[];
}

export interface FoodInventorySource {
  items?: unknown[];
  favoritedItemIds?: unknown;
}

export interface SpeciesCatalogEntry {
  species: string;
  key: string;
  label: string;
}

export interface DietOptionDescriptor {
  key: string;
  label: string;
}

export interface NormalizedDiet {
  display: string[];
  normalized: string[];
}
