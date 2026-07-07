// Public entry point — re-exports everything that was originally exported

// Types
export type {
  SpeciesOverride,
  PetFoodRulesState,
  InventoryItemSnapshot,
  InventorySnapshot,
  FoodSelection,
  FoodSelectionOptions,
  FoodAvailabilityResult,
  FoodInventorySource,
  SpeciesCatalogEntry,
  DietOptionDescriptor,
  EligibleFoodEntry,
} from './types';

// Rules
export {
  PET_FOOD_RULES_CHANGED_EVENT,
  getPetFoodRules,
  setAvoidFavoritedFoods,
  updateSpeciesOverride,
  resetPetFoodRules,
  getPetSpeciesCatalog,
  getSpeciesPreferredFood,
  setSpeciesPreferredFood,
  initializeFoodRules,
} from './rules';

// Diet
export {
  getDietOptionsForSpecies,
  buildFoodInventorySnapshot,
  readInventorySnapshot,
  evaluateFoodAvailabilityForPet,
  selectFoodForPet,
  selectFoodForPetLegacyCompatibility,
} from './diet';
