// src/features/autoFavorite.ts
// Automatically favorites rare (gold/rainbow) pets and produce when detected

import { storage } from '../../utils/storage';
import { pageWindow } from '../../core/pageContext';
import { getInventoryItems, getFavoritedItemIds, isInventoryStoreActive } from '../../store/inventory';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { getCropCategory, getAllCropCategories } from '../../utils/cropCategorizer';
import { getAllPlantSpecies, getAllAbilities, getAllMutations, areCatalogsReady } from '../../catalogs/gameCatalogs';
import { sendRoomAction, type WebSocketSendResult } from '../../websocket/api';
import { notify } from '../../core/notifications';
import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { Subsystem } from '../../diagnostics/types';

// ── Diagnostics ───────────────────────────────────────────────────────────

const FEATURE_SUBSYSTEM: Subsystem = 'feature:autoFavorite';
const FEATURE_NAME = 'autoFavorite';
const log = createNamedLogger(FEATURE_SUBSYSTEM);
let busRegistered = false;

/**
 * Re-attribute a FEATURE-* code emission to this feature's bus row. The
 * registered placeholder subsystem on FEATURE-* is `'feature'`; without this
 * override the bus would degrade a generic `feature` entry instead of
 * `feature:autoFavorite`.
 */
function warnFeature(code: Parameters<typeof buildError>[0], ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  log.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

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
    log.info('Failed to load auto-favorite config', { error: String(error) });
  }
}

function saveConfig(): void {
  try {
    storage.set(STORAGE_KEY, config);
    notifyListeners();
  } catch (error) {
    log.info('Failed to save auto-favorite config', { error: String(error) });
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener({ ...config });
    } catch (error) {
      log.info('Listener threw', { error: String(error) });
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
        if (sendFavoriteMessage(item.id).ok) {
          log.debug(`Auto-favorited pet: ${item.petSpecies || item.species || 'unknown'} (${reason})`);
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
        if (sendFavoriteMessage(item.id).ok) {
          cropCount++;
        }
      }
    }
  }

  if (cropCount > 0) {
    log.debug(`Auto-favorited ${cropCount} new crops`);
  }
  if (petCount > 0) {
    log.debug(`Auto-favorited ${petCount} new pets`);
  }
}

// Function to favorite ALL items of a species (called when checkbox is checked)
function favoriteSpecies(speciesName: string): void {
  const typedPageWindow = pageWindow as QPMPageWindow;

  if (!typedPageWindow?.myData?.inventory?.items) {
    log.debug('No myData available yet - waiting for game to load');
    return;
  }

  const items = typedPageWindow.myData.inventory.items;
  const favoritedIds = new Set(typedPageWindow.myData.inventory.favoritedItemIds || []);
  const tally = emptyTally();

  for (const item of items) {
    // CRITICAL: Multiple checks to ensure ONLY crops are favorited
    if (item.itemType !== 'Produce') continue;
    if (item.category === 'Pet' || item.category === 'Egg' || item.category === 'Tool') continue;
    if (item.species && (item.species.includes('Pet') || item.species.includes('Egg'))) continue;

    if (item.species === speciesName && !favoritedIds.has(item.id ?? '')) {
      tallySend(tally, sendFavoriteMessage(item.id ?? ''));
    }
  }

  reportUserBatch('Favorite', speciesName, tally, 'species');
}

// DISABLED: Script never unfavorites - only adds favorites
function unfavoriteSpecies(speciesName: string): void {
  log.debug(`Checkbox unchecked for ${speciesName} - existing favorites preserved`);
  // Do nothing - script only adds favorites, never removes them
  // This protects user's manually-favorited items (pets, eggs, crops, etc.)
}

// Function to favorite ALL items with a specific mutation (called when mutation checkbox is checked)
function favoriteMutation(mutationName: string): void {
  const typedPageWindow = pageWindow as QPMPageWindow;

  if (!typedPageWindow?.myData?.inventory?.items) {
    log.debug('No myData available yet - waiting for game to load');
    return;
  }

  const items = typedPageWindow.myData.inventory.items;
  const favoritedIds = new Set(typedPageWindow.myData.inventory.favoritedItemIds || []);
  const tally = emptyTally();

  for (const item of items) {
    // CRITICAL: Multiple checks to ensure ONLY crops are favorited
    if (item.itemType !== 'Produce') continue;
    if (item.category === 'Pet' || item.category === 'Egg' || item.category === 'Tool') continue;
    if (item.species && (item.species.includes('Pet') || item.species.includes('Egg'))) continue;

    const itemMutations = item.mutations || [];
    if (itemMutations.includes(mutationName) && !favoritedIds.has(item.id ?? '')) {
      tallySend(tally, sendFavoriteMessage(item.id ?? ''));
    }
  }

  reportUserBatch('Favorite', mutationName, tally, 'mutation');
}

// DISABLED: Script never unfavorites - only adds favorites
function unfavoriteMutation(mutationName: string): void {
  log.debug(`Checkbox unchecked for ${mutationName} - existing favorites preserved`);
  // Do nothing - script only adds favorites, never removes them
  // This protects user's manually-favorited items (pets, eggs, crops, etc.)
}

// Favorite ALL pets with a specific ability (called when checkbox is checked)
function favoritePetAbility(abilityName: string): void {
  const typedPageWindow = pageWindow as QPMPageWindow;

  if (!typedPageWindow?.myData?.inventory?.items) {
    log.debug('No myData available yet - waiting for game to load');
    return;
  }

  log.debug(`Searching for pets with ${abilityName}...`);

  const items = typedPageWindow.myData.inventory.items;
  const favoritedIds = new Set(typedPageWindow.myData.inventory.favoritedItemIds || []);
  const tally = emptyTally();
  let petsChecked = 0;

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
      log.debug(`Found matching pet: ${item.petSpecies || item.species} (${item.id})`);
      tallySend(tally, sendFavoriteMessage(item.id ?? ''));
    }
  }

  log.debug(`Scanned ${petsChecked} pets, favorited ${tally.ok} with ${abilityName}`);
  reportUserBatch('Favorite', abilityName, tally, 'ability');
}

// DISABLED: Script never unfavorites - only adds favorites
function unfavoritePetAbility(abilityName: string): void {
  log.debug(`Checkbox unchecked for ${abilityName} - existing favorites preserved`);
  // Do nothing - script only adds favorites, never removes them
}

// Function to actually send the favorite message via websocket.
// The WS layer already emits the appropriate WS-* code on failure (no_connection,
// invalid_payload, send_failed, locker_blocked). Callers aggregate per-reason
// counts and surface them via FEATURE-002.
function sendFavoriteMessage(itemId: string): WebSocketSendResult {
  return sendRoomAction('ToggleFavoriteItem', { itemId }, { throttleMs: 80 });
}

// Classify a WebSocketSendResult into ok / failed / throttled buckets for
// aggregate FEATURE-002 emission at end of a batch.
type SendOutcome = 'ok' | 'failed' | 'throttled';
function classifySend(result: WebSocketSendResult): SendOutcome {
  if (result.ok) return 'ok';
  if (result.reason === 'throttled') return 'throttled';
  return 'failed';
}

interface SendTally { ok: number; failed: number; throttled: number; total: number }
function emptyTally(): SendTally { return { ok: 0, failed: 0, throttled: 0, total: 0 }; }
function tallySend(tally: SendTally, result: WebSocketSendResult): void {
  tally.total += 1;
  const outcome = classifySend(result);
  if (outcome === 'ok') tally.ok += 1;
  else if (outcome === 'throttled') tally.throttled += 1;
  else tally.failed += 1;
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
    const tickTally = emptyTally();
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
            log.debug('Pet detected', {
              species: item.species,
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
          log.debug(`Favoriting ${item.species || 'item'} (${reason})`);
          tallySend(tickTally, sendFavoriteMessage(item.id));
        }
      }
    }

    // Aggregate any per-item failures/throttles into a single FEATURE-002 row.
    // Background path — no notify(); the bus row + error buffer are sufficient.
    if (tickTally.failed > 0 || tickTally.throttled > 0) {
      warnFeature('QPM-FEATURE-002', {
        verb: 'auto',
        ok: tickTally.ok,
        failed: tickTally.failed,
        throttled: tickTally.throttled,
        total: tickTally.total,
      });
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

  log.info('Auto-favorite polling started (2s visible-only interval)');
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
  log.info('Auto-favorite polling stopped');
}

/**
 * Surface the result of a user-initiated batch favorite (species/mutation/ability
 * checkbox). Success → success toast. Partial failure → FEATURE-002 bus row +
 * warn toast carrying the actual counts (the registry title cannot).
 */
function reportUserBatch(
  verb: 'Favorite',
  target: string,
  tally: SendTally,
  kind: 'species' | 'mutation' | 'ability',
): void {
  if (tally.total === 0) {
    notify({ feature: FEATURE_NAME, level: 'info', message: `No ${target} items to ${verb.toLowerCase()}` });
    return;
  }
  if (tally.failed === 0 && tally.throttled === 0) {
    notify({ feature: FEATURE_NAME, level: 'success', message: `${verb}d ${tally.ok}/${tally.total} ${target}` });
    return;
  }
  warnFeature('QPM-FEATURE-002', { verb, [kind]: target, ok: tally.ok, failed: tally.failed, throttled: tally.throttled, total: tally.total });
  notify({
    feature: FEATURE_NAME,
    level: tally.failed > 0 ? 'warn' : 'info',
    message: `${verb}d ${tally.ok}/${tally.total} ${target}${tally.failed > 0 ? ` — ${tally.failed} failed` : ''}${tally.throttled > 0 ? ` (${tally.throttled} throttled)` : ''}`,
  });
}

export function initializeAutoFavorite(): void {
  loadConfig();

  if (!busRegistered) {
    healthBus.register(FEATURE_SUBSYSTEM, { category: 'feature', status: 'starting' });
    busRegistered = true;
  }

  startAutoFavoritePolling();

  // Expose helper functions on pageWindow for UI integration
  const typedPageWindow = pageWindow as QPMPageWindow;
  typedPageWindow.qpm_favoriteSpecies = favoriteSpecies;
  typedPageWindow.qpm_unfavoriteSpecies = unfavoriteSpecies;
  typedPageWindow.qpm_favoriteMutation = favoriteMutation;
  typedPageWindow.qpm_unfavoriteMutation = unfavoriteMutation;
  typedPageWindow.qpm_favoritePetAbility = favoritePetAbility;
  typedPageWindow.qpm_unfavoritePetAbility = unfavoritePetAbility;

  log.info('System initialized - monitoring inventory changes', { enabled: config.enabled });
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message: 'Polling inventory every 2s',
  });
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
