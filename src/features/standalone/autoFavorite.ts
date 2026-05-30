// src/features/autoFavorite.ts
// Automatically favorites rare (gold/rainbow) pets and produce when detected

import { storage } from '../../utils/storage';
import { log } from '../../utils/logger';
import { pageWindow } from '../../core/pageContext';
import { getInventoryItems, getFavoritedItemIds, isInventoryStoreActive } from '../../store/inventory';
import { visibleInterval } from '../../utils/timerManager';
import { getCropCategory, getAllCropCategories } from '../../utils/cropCategorizer';
import { getAllPlantSpecies, getAllAbilities, getAllMutations, areCatalogsReady } from '../../catalogs/gameCatalogs';
import { sendRoomAction } from '../../websocket/api';

const STORAGE_KEY = 'qpm.autoFavorite.v1';

interface QPMInventoryItem {
  id?: string;
  itemType?: string;
  category?: string;
  species?: string;
  petSpecies?: string;
  mutations?: string[];
  abilities?: Array<{ id?: string; name?: string }>;
  favorited?: boolean;
}

interface QPMPageWindow {
  MagicCircle_RoomConnection?: { sendMessage?(payload: unknown): void };
  __mga_lastScopePath?: string[];
  qpm_favoriteSpecies?: (species: string) => void;
  qpm_unfavoriteSpecies?: (species: string) => void;
  qpm_favoriteMutation?: (mutationId: string) => void;
  qpm_unfavoriteMutation?: (mutationId: string) => void;
  qpm_favoritePetAbility?: (abilityId: string) => void;
  qpm_unfavoritePetAbility?: (abilityId: string) => void;
  myData?: {
    inventory?: {
      items?: QPMInventoryItem[];
      favoritedItemIds?: Set<string>;
    };
  };
}

export interface AutoFavoriteConfig {
  enabled: boolean;
  species: string[]; // List of species names to auto-favorite
  mutations: string[]; // List of mutations to auto-favorite (Rainbow, Gold, Frozen, etc)
  petAbilities: string[]; // List of pet abilities to auto-favorite (Rainbow Granter, Gold Granter)

  // Advanced filters - now all multi-select arrays
  filterByAbilities?: string[]; // Multiple ability names to filter by
  filterByAbilityCount?: number | null | undefined; // Number of abilities (1-4)
  filterBySpecies?: string[]; // Multiple species filter
  filterByCropTypes?: string[]; // Multiple crop category filters (Seed, Fruit, Vegetable, Flower)
}

/**
 * FUTUREPROOF: Extract ability string from various ability object formats
 */
function extractAbilityId(ability: any): string {
  if (typeof ability === 'string') return ability;
  return ability?.type || ability?.abilityType || ability?.id || '';
}

/**
 * FUTUREPROOF: Normalize ability ID for comparison (handles display names and IDs)
 */
function normalizeAbilityId(abilityId: string): string {
  return abilityId.toLowerCase().replace(/\s+/g, '');
}

/**
 * FUTUREPROOF: Check if pet has Gold or Rainbow Granter ability/mutation
 * Centralized logic to avoid duplication
 */
function hasGranterAbility(
  abilities: any[],
  mutations: string[],
  granterType: 'gold' | 'rainbow'
): boolean {
  // Check mutations first (direct mutation grants)
  const mutationName = granterType === 'gold' ? 'Gold' : 'Rainbow';
  if (mutations.includes(mutationName)) {
    return true;
  }

  // Check abilities array for granter abilities
  // Handle both ability ID format (e.g., "GoldGranter") and display name (e.g., "Gold Granter")
  return abilities.some((a: any) => {
    const abilityStr = extractAbilityId(a);
    const normalized = normalizeAbilityId(abilityStr);

    // Match both "GoldGranter" ID and "Gold Granter" display name
    const granterPattern = `${granterType}granter`;
    return normalized === granterPattern || normalized.includes(granterPattern);
  });
}

/**
 * FUTUREPROOF: Check if pet has specific ability using exact matching
 * Supports both ability IDs (e.g., "ProduceEater") and display names (e.g., "Crop Eater")
 */
function petHasAbility(petAbilities: any[], filterAbilityId: string): boolean {
  const normalizedFilter = normalizeAbilityId(filterAbilityId);

  return petAbilities.some((a: any) => {
    const abilityStr = extractAbilityId(a);
    const normalizedAbility = normalizeAbilityId(abilityStr);

    // Exact match only (no substring matching to avoid false positives)
    return normalizedAbility === normalizedFilter;
  });
}

let config: AutoFavoriteConfig = {
  enabled: false,
  species: [],
  mutations: [],
  petAbilities: [],
  filterByAbilities: [],
  filterByAbilityCount: null,
  filterBySpecies: [],
  filterByCropTypes: [],
};

const listeners = new Set<(config: AutoFavoriteConfig) => void>();
let cleanupInterval: (() => void) | null = null;
let visibilityListener: ((this: Document, ev: Event) => any) | null = null;
let seenItemIds = new Set<string>();

/**
 * Get crop type category for filtering (FUTUREPROOF - uses catalog!)
 */
function getCropType(species: string | null | undefined): string | null {
  if (!species) return null;
  return getCropCategory(species);
}

/**
 * Get available filter options from catalogs (FUTUREPROOF!)
 */
export function getAvailableFilterOptions(): {
  species: string[];
  abilities: string[];
  mutations: string[];
  cropTypes: string[];
} {
  return {
    species: areCatalogsReady() ? getAllPlantSpecies() : [],
    abilities: areCatalogsReady() ? getAllAbilities() : [],
    mutations: areCatalogsReady() ? getAllMutations() : [],
    cropTypes: getAllCropCategories(),
  };
}

function loadConfig(): void {
  try {
    const stored = storage.get<Partial<AutoFavoriteConfig> | null>(STORAGE_KEY, null);
    if (stored && typeof stored === 'object') {
      // Migrate old single-value filters to arrays
      const migrateToArray = (value: any): string[] => {
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'string') return [value];
        return [];
      };

      config = {
        enabled: stored.enabled ?? config.enabled,
        species: stored.species ?? config.species,
        mutations: stored.mutations ?? config.mutations,
        petAbilities: stored.petAbilities ?? config.petAbilities,
        filterByAbilities: migrateToArray((stored as any).filterByAbilities || (stored as any).filterByAbility),
        filterByAbilityCount: stored.filterByAbilityCount !== undefined ? stored.filterByAbilityCount : config.filterByAbilityCount,
        filterBySpecies: migrateToArray((stored as any).filterBySpecies),
        filterByCropTypes: migrateToArray((stored as any).filterByCropTypes || (stored as any).filterByCropType),
      };
    }
  } catch (error) {
    log('⚠️ Failed to load auto-favorite config', error);
  }
}

function saveConfig(): void {
  try {
    storage.set(STORAGE_KEY, config);
    notifyListeners();
  } catch (error) {
    log('⚠️ Failed to save auto-favorite config', error);
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener({ ...config });
    } catch (error) {
      log('⚠️ Auto-favorite listener error', error);
    }
  }
}

function checkAndFavoriteNewItems(inventory: any): void {
  if (!inventory?.items) return;

  // DEFENSIVE: Ensure petAbilities array exists (v2.0.0 fix for upgrade path)
  if (!config.petAbilities) {
    config.petAbilities = [];
  }

  if (!config.species.length && !config.mutations.length && !config.petAbilities.length) {
    return;
  }

  const favoritedIds = new Set(inventory.favoritedItemIds || []);
  const targetSpecies = new Set(config.species);
  const targetMutations = new Set(config.mutations);
  const targetPetAbilities = new Set(config.petAbilities);
  let cropCount = 0;
  let petCount = 0;

  for (const item of inventory.items) {
    if (favoritedIds.has(item.id)) continue; // Already favorited

    // Check if it's a pet
    if (item.itemType === 'Pet') {
      let shouldFavoritePet = false;
      let reason = '';

      // Apply species filter for pets (check both species and petSpecies fields)
      if (config.filterBySpecies && config.filterBySpecies.length > 0) {
        const itemSpecies = item.species || item.petSpecies || '';
        if (!config.filterBySpecies.includes(itemSpecies)) {
          continue; // Skip this pet if it doesn't match species filter
        }
        shouldFavoritePet = true;
        reason = 'filtered species';
      }

      // Filter by ability types (multi-select) - FUTUREPROOF with exact matching
      if (config.filterByAbilities && config.filterByAbilities.length > 0) {
        const petAbilities = item.abilities || [];
        const hasAnyAbility = config.filterByAbilities.some(filterAbilityId =>
          petHasAbility(petAbilities, filterAbilityId)
        );
        if (!hasAnyAbility) continue; // Skip this pet if it doesn't have the filtered ability
        shouldFavoritePet = true;
        reason = 'filtered ability';
      }

      // Filter by ability count
      if (config.filterByAbilityCount != null) {
        const petAbilities = item.abilities || [];
        if (petAbilities.length !== config.filterByAbilityCount) {
          continue; // Skip this pet if it doesn't have the right ability count
        }
        if (!shouldFavoritePet) {
          shouldFavoritePet = true;
          reason = `${config.filterByAbilityCount} abilities`;
        }
      }
      
      // Check if Gold/Rainbow Granter filter is enabled - FUTUREPROOF with centralized logic
      if (config.filterByAbilities && config.filterByAbilities.length > 0) {
        const petMutations = item.mutations || [];
        const petAbilities = item.abilities || [];

        const hasGoldGranterFilter = config.filterByAbilities.some(abilityId =>
          normalizeAbilityId(abilityId) === 'goldgranter'
        );
        const hasRainbowGranterFilter = config.filterByAbilities.some(abilityId =>
          normalizeAbilityId(abilityId) === 'rainbowgranter'
        );

        if (hasGoldGranterFilter && hasGranterAbility(petAbilities, petMutations, 'gold')) {
          shouldFavoritePet = true;
          reason = 'Gold Granter';
        }
        if (hasRainbowGranterFilter && hasGranterAbility(petAbilities, petMutations, 'rainbow')) {
          shouldFavoritePet = true;
          reason = 'Rainbow Granter';
        }
      }

      if (shouldFavoritePet) {
        if (sendFavoriteMessage(item.id)) {
          log(`🌟 [AUTO-FAVORITE] Auto-favorited pet: ${item.petSpecies || item.species || 'unknown'} (${reason})`);
          petCount++;
        }
      }
      continue;
    }

    // Handle crops/produce
    if (item.itemType === 'Produce') {
      let shouldFavoriteCrop = false;

      // Filter by crop type/name (now individual crop names)
      if (config.filterByCropTypes && config.filterByCropTypes.length > 0) {
        if (!config.filterByCropTypes.includes(item.species)) {
          continue; // Skip this crop if it doesn't match the crop name filter
        }
        shouldFavoriteCrop = true;
      }

      // Check if item matches species (from legacy checkboxes)
      if (targetSpecies.has(item.species)) {
        shouldFavoriteCrop = true;
      }

      // Check if item matches any mutation
      const itemMutations = item.mutations || [];
      if (itemMutations.some((mut: string) => targetMutations.has(mut))) {
        shouldFavoriteCrop = true;
      }

      if (shouldFavoriteCrop) {
        if (sendFavoriteMessage(item.id)) {
          cropCount++;
        }
      }
    }
  }

  if (cropCount > 0) {
    log(`🌟 [AUTO-FAVORITE] Auto-favorited ${cropCount} new crops`);
  }
  if (petCount > 0) {
    log(`🌟 [AUTO-FAVORITE] Auto-favorited ${petCount} new pets`);
  }
}

// Function to favorite ALL items of a species (called when checkbox is checked)
function favoriteSpecies(speciesName: string): void {
  const typedPageWindow = pageWindow as QPMPageWindow;

  if (!typedPageWindow?.myData?.inventory?.items) {
    log('🌟 [AUTO-FAVORITE] No myData available yet - waiting for game to load');
    return;
  }

  const items = typedPageWindow.myData.inventory.items;
  const favoritedIds = new Set(typedPageWindow.myData.inventory.favoritedItemIds || []);
  let count = 0;

  for (const item of items) {
    // CRITICAL: Multiple checks to ensure ONLY crops are favorited
    if (item.itemType !== 'Produce') continue;
    if (item.category === 'Pet' || item.category === 'Egg' || item.category === 'Tool') continue;
    if (item.species && (item.species.includes('Pet') || item.species.includes('Egg'))) continue;

    if (item.species === speciesName && !favoritedIds.has(item.id ?? '')) {
      if (sendFavoriteMessage(item.id ?? '')) {
        count++;
      }
    }
  }

  if (count > 0) {
    log(`✅ [AUTO-FAVORITE] Favorited ${count} ${speciesName} crops`);
  } else {
    log(`ℹ️ [AUTO-FAVORITE] No ${speciesName} crops to favorite (already favorited or none in inventory)`);
  }
}

// DISABLED: Script never unfavorites - only adds favorites
function unfavoriteSpecies(speciesName: string): void {
  log(`🔒 [AUTO-FAVORITE] Checkbox unchecked for ${speciesName} - Auto-favorite disabled, but existing favorites are preserved (script never removes favorites)`);
  // Do nothing - script only adds favorites, never removes them
  // This protects user's manually-favorited items (pets, eggs, crops, etc.)
}

// Function to favorite ALL items with a specific mutation (called when mutation checkbox is checked)
function favoriteMutation(mutationName: string): void {
  const typedPageWindow = pageWindow as QPMPageWindow;

  if (!typedPageWindow?.myData?.inventory?.items) {
    log('🌟 [AUTO-FAVORITE] No myData available yet - waiting for game to load');
    return;
  }

  const items = typedPageWindow.myData.inventory.items;
  const favoritedIds = new Set(typedPageWindow.myData.inventory.favoritedItemIds || []);
  let count = 0;

  for (const item of items) {
    // CRITICAL: Multiple checks to ensure ONLY crops are favorited
    if (item.itemType !== 'Produce') continue;
    if (item.category === 'Pet' || item.category === 'Egg' || item.category === 'Tool') continue;
    if (item.species && (item.species.includes('Pet') || item.species.includes('Egg'))) continue;

    const itemMutations = item.mutations || [];
    if (itemMutations.includes(mutationName) && !favoritedIds.has(item.id ?? '')) {
      if (sendFavoriteMessage(item.id ?? '')) {
        count++;
      }
    }
  }

  if (count > 0) {
    log(`✅ [AUTO-FAVORITE] Favorited ${count} crops with ${mutationName} mutation`);
  } else {
    log(`ℹ️ [AUTO-FAVORITE] No crops with ${mutationName} mutation to favorite (already favorited or none in inventory)`);
  }
}

// DISABLED: Script never unfavorites - only adds favorites
function unfavoriteMutation(mutationName: string): void {
  log(`🔒 [AUTO-FAVORITE] Checkbox unchecked for ${mutationName} mutation - Auto-favorite disabled, but existing favorites are preserved (script never removes favorites)`);
  // Do nothing - script only adds favorites, never removes them
  // This protects user's manually-favorited items (pets, eggs, crops, etc.)
}

// Favorite ALL pets with a specific ability (called when checkbox is checked)
function favoritePetAbility(abilityName: string): void {
  const typedPageWindow = pageWindow as QPMPageWindow;

  if (!typedPageWindow?.myData?.inventory?.items) {
    log('🌟 [AUTO-FAVORITE-PET] No myData available yet - waiting for game to load');
    return;
  }

  log(`🔍 [AUTO-FAVORITE-PET] Searching for pets with ${abilityName}...`);

  const items = typedPageWindow.myData.inventory.items;
  const favoritedIds = new Set(typedPageWindow.myData.inventory.favoritedItemIds || []);
  let count = 0;
  let petsChecked = 0;

  // Debug: Log first pet structure to understand data format
  const firstPet = items.find((i: any) => i.itemType === 'Pet');
  if (firstPet) {
    log('🐾 [AUTO-FAVORITE-PET-DEBUG] Sample pet structure:', {
      species: firstPet.petSpecies,
      mutations: firstPet.mutations,
      abilities: firstPet.abilities,
      hasAbilitiesArray: Array.isArray(firstPet.abilities),
      hasMutationsArray: Array.isArray(firstPet.mutations),
    });
  }

  for (const item of items) {
    if (item.itemType !== 'Pet') continue;
    petsChecked++;

    if (favoritedIds.has(item.id ?? '')) continue; // Already favorited

    // FUTUREPROOF: Use centralized granter ability checking
    const petMutations = item.mutations || [];
    const petAbilities = item.abilities || [];

    const shouldFavorite =
      (abilityName === 'Gold Granter' && hasGranterAbility(petAbilities, petMutations, 'gold')) ||
      (abilityName === 'Rainbow Granter' && hasGranterAbility(petAbilities, petMutations, 'rainbow'));

    if (shouldFavorite) {
      log(`✨ [AUTO-FAVORITE-PET] Found matching pet: ${item.petSpecies || item.species} (${item.id}) - mutations: [${petMutations.join(', ')}], abilities: ${petAbilities.length}`);

      if (sendFavoriteMessage(item.id ?? '')) {
        count++;
      }
    }
  }

  log(`✅ [AUTO-FAVORITE-PET] Scanned ${petsChecked} pets, favorited ${count} with ${abilityName}`);
}

// DISABLED: Script never unfavorites - only adds favorites
function unfavoritePetAbility(abilityName: string): void {
  log(`🔒 [AUTO-FAVORITE-PET] Checkbox unchecked for ${abilityName} - Auto-favorite disabled, but existing favorites are preserved (script never removes favorites)`);
  // Do nothing - script only adds favorites, never removes them
}

// Function to actually send the favorite message via websocket
function sendFavoriteMessage(itemId: string): boolean {
  const sent = sendRoomAction('ToggleFavoriteItem', { itemId }, { throttleMs: 80 });
  if (!sent.ok && sent.reason !== 'throttled') {
    log(`⚠️ Failed to favorite item ${itemId} (${sent.reason ?? 'unknown'})`);
  }
  return sent.ok;
}

function startAutoFavoritePolling(): void {
  if (cleanupInterval !== null) return;

  let pollCount = 0;

  const runPollTick = (): void => {
    pollCount++;

    // Early exit if auto-favorite is disabled or no watched items
    if (!config.enabled) {
      return;
    }

    const watchedSpecies = config.species || [];
    const watchedMutations = config.mutations || [];
    const watchedPetAbilities = config.petAbilities || [];

    // Skip processing if nothing is being watched
    if (watchedSpecies.length === 0 && watchedMutations.length === 0 && watchedPetAbilities.length === 0) {
      return;
    }

    // Check if inventory store is active
    if (!isInventoryStoreActive()) {
      return;
    }

    // Get items from inventory store (uses myInventoryAtom)
    const currentItems = getInventoryItems();

    // Fast path: if item count is identical to last tick, nothing was added or removed.
    // Avoids building the currentItemIds Set (O(N) allocation) on every 2s tick when
    // inventory is stable — the common case while not actively harvesting.
    if (currentItems.length === seenItemIds.size) {
      return;
    }

    const favoritedIds = getFavoritedItemIds();

    // Get all current item IDs
    const currentItemIds = new Set<string>();
    for (const item of currentItems) {
      if (item?.id) {
        currentItemIds.add(item.id);
      }
    }

    // Find new items (IDs we haven't seen before)
    const newItemIds = new Set<string>();
    for (const id of currentItemIds) {
      if (!seenItemIds.has(id)) {
        newItemIds.add(id);
      }
    }

    // Process new items only
    if (newItemIds.size > 0) {
      // Filter to only new items
      const newItems = currentItems.filter(item => item.id && newItemIds.has(item.id));

      // Check and favorite new items
      for (const item of newItems) {
        // Skip if already favorited
        if (favoritedIds.has(item.id)) {
          continue;
        }

        const rawItem = item.raw as any;
        const mutations = Array.isArray(rawItem?.mutations) ? rawItem.mutations : [];
        const abilities = Array.isArray(item.abilities) ? item.abilities : (Array.isArray(rawItem?.abilities) ? rawItem.abilities : []);
        const itemType = rawItem?.itemType || item.itemType;

        let shouldFavorite = false;
        let reason = '';

        // === PET HANDLING ===
        if (itemType === 'Pet') {
          // Debug logging for pet abilities
          if (config.filterByAbilities && config.filterByAbilities.length > 0) {
            log(`[AUTO-FAVORITE-DEBUG] Pet detected:`, {
              species: item.species,
              abilitiesFromItem: item.abilities,
              abilitiesFromRaw: rawItem?.abilities,
              abilitiesUsed: abilities,
              filterByAbilities: config.filterByAbilities,
            });
          }

          // Apply advanced pet filters first (these act as filters, not triggers)

          // Filter by pet species (must match if filter is active)
          if (config.filterBySpecies && config.filterBySpecies.length > 0) {
            const petSpecies = rawItem?.petSpecies || rawItem?.species || item.species || '';
            if (!config.filterBySpecies.includes(petSpecies)) {
              continue; // Skip this pet if it doesn't match species filter
            }
            shouldFavorite = true;
            reason = 'filtered species';
          }

          // Filter by ability types (must have one of the filtered abilities) - FUTUREPROOF exact matching
          if (config.filterByAbilities && config.filterByAbilities.length > 0) {
            const hasAnyAbility = config.filterByAbilities.some(filterAbilityId =>
              petHasAbility(abilities, filterAbilityId)
            );
            if (!hasAnyAbility) {
              continue; // Skip this pet if it doesn't have the filtered ability
            }
            shouldFavorite = true;
            reason = 'filtered ability';
          }

          // Filter by ability count (must match exact count)
          if (config.filterByAbilityCount != null) {
            if (abilities.length !== config.filterByAbilityCount) {
              continue; // Skip this pet if it doesn't have the right ability count
            }
            if (!shouldFavorite) {
              shouldFavorite = true;
              reason = `${config.filterByAbilityCount} abilities`;
            }
          }

          // Check for Rainbow/Gold Granter abilities if filter is active - FUTUREPROOF centralized logic
          if (config.filterByAbilities && config.filterByAbilities.length > 0) {
            const hasGoldGranterFilter = config.filterByAbilities.some(abilityId =>
              normalizeAbilityId(abilityId) === 'goldgranter'
            );
            const hasRainbowGranterFilter = config.filterByAbilities.some(abilityId =>
              normalizeAbilityId(abilityId) === 'rainbowgranter'
            );

            if (hasGoldGranterFilter && hasGranterAbility(abilities, mutations, 'gold')) {
              shouldFavorite = true;
              reason = 'Gold Granter';
            }
            if (hasRainbowGranterFilter && hasGranterAbility(abilities, mutations, 'rainbow')) {
              shouldFavorite = true;
              reason = 'Rainbow Granter';
            }
          }

          // Legacy pet ability check (from watchedPetAbilities)
          if (watchedPetAbilities.length > 0 && abilities.length > 0) {
            const matchedAbility = abilities.find((ability: string) =>
              watchedPetAbilities.some(watched => watched.toLowerCase() === String(ability).toLowerCase())
            );
            if (matchedAbility) {
              shouldFavorite = true;
              reason = `ability: ${matchedAbility}`;
            }
          }
        }
        // === CROP/PRODUCE HANDLING ===
        else if (itemType === 'Produce') {
          // Filter by crop name (must match if filter is active)
          if (config.filterByCropTypes && config.filterByCropTypes.length > 0) {
            const cropSpecies = rawItem?.species || item.species || '';
            if (!config.filterByCropTypes.includes(cropSpecies)) {
              continue; // Skip this crop if it doesn't match the crop name filter
            }
            shouldFavorite = true;
            reason = 'filtered crop';
          }

          // Check mutations (Rainbow/Gold)
          if (watchedMutations.length > 0 && mutations.length > 0) {
            const matchedMutation = mutations.find((mut: string) =>
              watchedMutations.some(watched => watched.toLowerCase() === String(mut).toLowerCase())
            );
            if (matchedMutation) {
              shouldFavorite = true;
              reason = `mutation: ${matchedMutation}`;
            }
          }

          // Legacy species check (from watchedSpecies)
          if (watchedSpecies.length > 0 && item.species) {
            const matched = watchedSpecies.some(watched => watched.toLowerCase() === item.species!.toLowerCase());
            if (matched) {
              shouldFavorite = true;
              reason = `species: ${item.species}`;
            }
          }
        }

        if (shouldFavorite) {
          log(`[AUTO-FAVORITE] Favoriting ${item.species || 'item'} (${reason})`);
          sendFavoriteMessage(item.id);
        }
      }
    }

    // Update seen IDs to current state
    seenItemIds = currentItemIds;
  };

  cleanupInterval = visibleInterval('auto-favorite-poll', runPollTick, 2000);

  visibilityListener = () => {
    if (document.hidden) return;
    // Force a reconciliation scan immediately when the tab becomes visible.
    seenItemIds = new Set<string>();
    runPollTick();
  };
  document.addEventListener('visibilitychange', visibilityListener);

  log('✅ Auto-favorite polling started (2 second visible-only interval)');
}

function stopAutoFavoritePolling(): void {
  if (cleanupInterval !== null) {
    cleanupInterval();
    cleanupInterval = null;
  }
  if (visibilityListener) {
    document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }
  log('⏹️ Auto-favorite polling stopped');
}


export function initializeAutoFavorite(): void {
  loadConfig();
  startAutoFavoritePolling();

  // Expose helper functions on pageWindow for UI integration
  const typedPageWindow = pageWindow as QPMPageWindow;
  typedPageWindow.qpm_favoriteSpecies = favoriteSpecies;
  typedPageWindow.qpm_unfavoriteSpecies = unfavoriteSpecies;
  typedPageWindow.qpm_favoriteMutation = favoriteMutation;
  typedPageWindow.qpm_unfavoriteMutation = unfavoriteMutation;
  typedPageWindow.qpm_favoritePetAbility = favoritePetAbility;
  typedPageWindow.qpm_unfavoritePetAbility = unfavoritePetAbility;

  log('✅ [AUTO-FAVORITE] System initialized - monitoring inventory changes', config);
}

export function getAutoFavoriteConfig(): AutoFavoriteConfig {
  return { ...config };
}

export function updateAutoFavoriteConfig(updates: Partial<AutoFavoriteConfig>): void {
  config = { ...config, ...updates };
  saveConfig();

  // Restart polling if config changed
  if (config.enabled) {
    startAutoFavoritePolling();
  }
}

export function subscribeToAutoFavoriteConfig(listener: (config: AutoFavoriteConfig) => void): () => void {
  listeners.add(listener);
  listener({ ...config });
  return () => listeners.delete(listener);
}
