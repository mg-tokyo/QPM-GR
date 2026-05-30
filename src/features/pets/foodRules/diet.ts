// src/features/petFoodRules/diet.ts
// Diet resolution, inventory parsing, food selection

import { normalizeSpeciesKey } from '../../../utils/helpers';
import { getPetDiet, getCropBaseSellPrice } from '../../../catalogs/gameCatalogs';
import { log } from '../../../utils/logger';
import { pageWindow } from '../../../core/pageContext';
import {
  HUNGER_POTION_KEY,
  HUNGER_POTION_LABEL,
  getHungerPotionCount,
} from '../hungerPotion';
import type {
  NormalizedDiet,
  InventoryItemSnapshot,
  InventorySnapshot,
  FoodSelection,
  FoodSelectionOptions,
  FoodAvailabilityResult,
  FoodInventorySource,
  DietOptionDescriptor,
  SpeciesOverride,
  EligibleFoodEntry,
} from './types';
import {
  getRulesState,
  DEFAULT_SAFE_FOODS,
  DEFAULT_SAFE_NORMALIZED,
  formatFriendlyName,
} from './rules';

function resolveDiet(species: string | null): NormalizedDiet {
  const toNormalizedDiet = (foods: string[]): NormalizedDiet => {
    const normalized = foods
      .map(food => normalizeSpeciesKey(food))
      .filter((food): food is string => !!food);
    if (normalized.length === 0) {
      return {
        display: [...DEFAULT_SAFE_FOODS],
        normalized: [...DEFAULT_SAFE_NORMALIZED],
      };
    }
    return {
      display: [...foods],
      normalized,
    };
  };

  if (!species) {
    return {
      display: [...DEFAULT_SAFE_FOODS],
      normalized: [...DEFAULT_SAFE_NORMALIZED],
    };
  }

  const runtimeDiet = getPetDiet(species);
  if (runtimeDiet.length > 0) {
    return toNormalizedDiet(runtimeDiet);
  }

  return {
    display: [...DEFAULT_SAFE_FOODS],
    normalized: [...DEFAULT_SAFE_NORMALIZED],
  };
}

function resolveOverride(species: string | null): SpeciesOverride | null {
  if (!species) return null;
  const key = normalizeSpeciesKey(species);
  if (!key) return null;
  return getRulesState().overrides[key] || null;
}

function mergeOverrides(
  speciesOverride: SpeciesOverride | null,
  itemOverride: SpeciesOverride | undefined,
): SpeciesOverride | null {
  const merged: SpeciesOverride = {};

  if (Array.isArray(speciesOverride?.allowed) && speciesOverride.allowed.length > 0) {
    merged.allowed = [...speciesOverride.allowed];
  }
  if (Array.isArray(speciesOverride?.forbidden) && speciesOverride.forbidden.length > 0) {
    merged.forbidden = [...speciesOverride.forbidden];
  }
  if (typeof speciesOverride?.preferred === 'string' && speciesOverride.preferred.length > 0) {
    merged.preferred = speciesOverride.preferred;
  }

  const hasItemAllowed = !!itemOverride && Object.prototype.hasOwnProperty.call(itemOverride, 'allowed');
  const hasItemForbidden = !!itemOverride && Object.prototype.hasOwnProperty.call(itemOverride, 'forbidden');
  const hasItemPreferred = !!itemOverride && Object.prototype.hasOwnProperty.call(itemOverride, 'preferred');
  if (hasItemAllowed) merged.allowed = Array.isArray(itemOverride!.allowed) ? [...itemOverride!.allowed] : [];
  if (hasItemForbidden) merged.forbidden = Array.isArray(itemOverride!.forbidden) ? [...itemOverride!.forbidden] : [];
  if (hasItemPreferred) {
    if (typeof itemOverride!.preferred === 'string' && itemOverride!.preferred.length > 0) {
      merged.preferred = itemOverride!.preferred;
    } else {
      delete merged.preferred;
    }
  }

  const hasAllowed = Array.isArray(merged.allowed);
  const hasForbidden = Array.isArray(merged.forbidden);
  const hasPreferred = typeof merged.preferred === 'string' && merged.preferred.length > 0;
  return hasAllowed || hasForbidden || hasPreferred ? merged : null;
}

function normalizeInventoryFood(item: InventoryItemSnapshot): string | null {
  const candidates = [item.species, item.itemType, item.name];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length === 0) {
      continue;
    }
    const normalized = normalizeSpeciesKey(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function formatFoodLabelForSpecies(species: string, normalizedFood: string): string {
  const options = getDietOptionsForSpecies(species);
  const match = options.find(option => option.key === normalizedFood);
  if (match) {
    return match.label;
  }
  return formatFriendlyName(normalizedFood);
}

function ensureInventoryArray(candidate: unknown): any[] | null {
  if (Array.isArray(candidate)) {
    return candidate as any[];
  }
  return null;
}

function readNestedValue(node: unknown, path: string[]): unknown {
  let current: unknown = node;
  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function tryExtractInventory(node: unknown): { items: any[]; favoritedItemIds: string[] } | null {
  if (!node || typeof node !== 'object') {
    return null;
  }

  const candidatePaths: string[][] = [
    ['items'],
    ['inventory', 'items'],
    ['inventory'],
    ['data', 'inventory', 'items'],
    ['data', 'inventory'],
    [],
  ];

  for (const path of candidatePaths) {
    const target = path.length === 0 ? node : readNestedValue(node, path);
    const items = ensureInventoryArray(target);
    if (items) {
      const favoritedCandidate = readNestedValue(node, ['favoritedItemIds']);
      const favorited = Array.isArray(favoritedCandidate)
        ? favoritedCandidate.filter((value): value is string => typeof value === 'string')
        : [];
      return { items, favoritedItemIds: favorited };
    }
  }

  return null;
}

function resolveInventoryItemId(rawItem: any): string | null {
  if (!rawItem || typeof rawItem !== 'object') {
    return null;
  }

  const candidatePaths: string[][] = [
    ['id'],
    ['itemId'],
    ['item', 'id'],
    ['data', 'id'],
    ['crop', 'id'],
    ['product', 'id'],
  ];

  for (const path of candidatePaths) {
    const value = readNestedValue(rawItem, path);
    if (typeof value === 'string' && value) {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }

  return null;
}

function resolveInventorySpecies(rawItem: any): string | null {
  if (!rawItem || typeof rawItem !== 'object') {
    return null;
  }

  const candidatePaths: string[][] = [
    ['species'],
    ['item', 'species'],
    ['plant', 'species'],
    ['data', 'species'],
    ['crop', 'species'],
    ['product', 'species'],
  ];

  for (const path of candidatePaths) {
    const value = readNestedValue(rawItem, path);
    if (typeof value === 'string' && value) {
      return value;
    }
  }

  return null;
}

function resolveInventoryName(rawItem: any): string | null {
  const candidatePaths: string[][] = [
    ['name'],
    ['item', 'name'],
    ['data', 'name'],
    ['crop', 'name'],
    ['product', 'name'],
  ];

  for (const path of candidatePaths) {
    const value = readNestedValue(rawItem, path);
    if (typeof value === 'string' && value) {
      return value;
    }
  }

  const species = resolveInventorySpecies(rawItem);
  if (species) {
    return species;
  }

  const itemType = readNestedValue(rawItem, ['itemType']);
  if (typeof itemType === 'string' && itemType) {
    return itemType;
  }

  return null;
}

function resolveInventoryItemType(rawItem: any): string | null {
  const value = readNestedValue(rawItem, ['itemType']);
  if (typeof value === 'string' && value) {
    return value;
  }
  return null;
}

function resolveInventoryQuantity(rawItem: any): number | null {
  if (!rawItem || typeof rawItem !== 'object') {
    return null;
  }

  const candidatePaths: string[][] = [
    ['quantity'],
    ['count'],
    ['amount'],
    ['stackSize'],
    ['item', 'quantity'],
    ['item', 'count'],
    ['item', 'amount'],
  ];

  for (const path of candidatePaths) {
    const value = readNestedValue(rawItem, path);
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
    }
  }

  return null;
}

function isFeedableProduceItemType(itemType: string | null): boolean {
  if (!itemType) return false;
  const normalized = itemType.trim().toLowerCase();
  return normalized === 'produce' || normalized === 'crop';
}

function coerceFavoritedIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0));
}

export function buildFoodInventorySnapshot(
  source: FoodInventorySource | null | undefined,
  excludeItemIds?: Set<string>,
): InventorySnapshot | null {
  if (!source || !Array.isArray(source.items)) return null;

  const items: InventoryItemSnapshot[] = [];
  for (const rawItem of source.items) {
    const id = resolveInventoryItemId(rawItem);
    if (!id) continue;
    if (excludeItemIds && excludeItemIds.has(id)) continue;

    const itemType = resolveInventoryItemType(rawItem);
    if (!isFeedableProduceItemType(itemType)) continue;

    // Scale and mutations may be top-level (raw game items) or nested in .raw (InventoryItem wrappers)
    const scaleCandidate = readNestedValue(rawItem, ['scale']) ?? readNestedValue(rawItem, ['raw', 'scale']);
    const scale = typeof scaleCandidate === 'number' && Number.isFinite(scaleCandidate) ? scaleCandidate : null;
    const mutationsCandidate = readNestedValue(rawItem, ['mutations']) ?? readNestedValue(rawItem, ['raw', 'mutations']);
    const mutations = Array.isArray(mutationsCandidate)
      ? mutationsCandidate.filter((m): m is string => typeof m === 'string' && m.length > 0)
      : [];

    items.push({
      id,
      species: resolveInventorySpecies(rawItem),
      itemType,
      name: resolveInventoryName(rawItem),
      quantity: resolveInventoryQuantity(rawItem),
      scale,
      mutations,
    });
  }

  return {
    items,
    favoritedIds: coerceFavoritedIds(source.favoritedItemIds),
    source: 'myInventoryAtom',
  };
}

export function readInventorySnapshot(): InventorySnapshot | null {
  try {
    const global: Record<string, unknown> = pageWindow as unknown as Record<string, unknown>;
    const candidateSources: Array<{ node: unknown; source: string }> = [
      { node: (global.page as any)?.myData?.inventory, source: 'page.myData.inventory' },
      { node: (global.myData as any)?.inventory, source: 'myData.inventory' },
      { node: (global.inventory as any), source: 'window.inventory' },
    ];

    for (const candidate of candidateSources) {
      if (!candidate.node) continue;
      const extracted = tryExtractInventory(candidate.node);
      if (!extracted) continue;

      const items: InventoryItemSnapshot[] = [];
      for (const rawItem of extracted.items) {
        const id = resolveInventoryItemId(rawItem);
        if (!id) continue;
        const species = resolveInventorySpecies(rawItem);
        const itemType = resolveInventoryItemType(rawItem);
        if (!isFeedableProduceItemType(itemType)) continue;
        const name = resolveInventoryName(rawItem);
        const quantity = resolveInventoryQuantity(rawItem);
        const rawScale = readNestedValue(rawItem, ['scale']);
        const scale = typeof rawScale === 'number' && Number.isFinite(rawScale) ? rawScale : null;
        const rawMutations = readNestedValue(rawItem, ['mutations']);
        const mutations = Array.isArray(rawMutations)
          ? rawMutations.filter((m): m is string => typeof m === 'string' && m.length > 0)
          : [];
        items.push({
          id,
          species: species ?? null,
          itemType: itemType ?? null,
          name: name ?? null,
          quantity,
          scale,
          mutations,
        });
      }

      return {
        items,
        favoritedIds: new Set(extracted.favoritedItemIds),
        source: candidate.source,
      };
    }
  } catch (error) {
    log('⚠️ Unable to read inventory snapshot', error);
  }

  return null;
}

export function getDietOptionsForSpecies(species: string): DietOptionDescriptor[] {
  const diet = resolveDiet(species);
  const options: DietOptionDescriptor[] = [];
  const seen = new Set<string>();

  for (const food of diet.display) {
    const normalized = normalizeSpeciesKey(food);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    options.push({
      key: normalized,
      label: formatFriendlyName(food),
    });
  }

  if (options.length === 0) {
    for (const fallback of DEFAULT_SAFE_FOODS) {
      const normalized = normalizeSpeciesKey(fallback);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      options.push({ key: normalized, label: formatFriendlyName(fallback) });
    }
  }

  // Always offer hunger potion as a diet option (availability checked at feed time)
  if (!seen.has(HUNGER_POTION_KEY)) {
    options.push({ key: HUNGER_POTION_KEY, label: HUNGER_POTION_LABEL });
  }

  return options;
}

function sumItemQuantities(items: InventoryItemSnapshot[]): number {
  return items.reduce((sum, item) => sum + (item.quantity != null ? Math.max(0, item.quantity) : 1), 0);
}

function buildEligibleFoods(
  items: InventoryItemSnapshot[],
  potionCount: number,
  potionAllowed: boolean,
  selectedKey: string | null,
): EligibleFoodEntry[] {
  const byKey = new Map<string, { label: string; count: number; originalSpecies: string | null }>();
  for (const item of items) {
    const key = normalizeInventoryFood(item);
    if (!key) continue;
    const existing = byKey.get(key);
    const qty = item.quantity != null ? Math.max(0, item.quantity) : 1;
    if (existing) {
      existing.count += qty;
    } else {
      // Keep the original species name (PascalCase) for catalog lookups
      byKey.set(key, { label: item.name ?? formatFriendlyName(key), count: qty, originalSpecies: item.species });
    }
  }

  if (potionCount > 0 && potionAllowed) {
    byKey.set(HUNGER_POTION_KEY, { label: HUNGER_POTION_LABEL, count: potionCount, originalSpecies: null });
  }

  const entries: EligibleFoodEntry[] = [];
  for (const [key, data] of byKey) {
    const isPotion = key === HUNGER_POTION_KEY;
    // getCropBaseSellPrice expects PascalCase species name (catalog keys), not the normalized key
    const coinValue = isPotion ? Infinity : (getCropBaseSellPrice(data.originalSpecies ?? key) ?? 0);
    entries.push({
      key,
      label: data.label,
      count: data.count,
      coinValue,
      ...(isPotion ? { isHungerPotion: true } : {}),
    });
  }

  // Selected food first, then alphabetical
  entries.sort((a, b) => {
    if (a.key === selectedKey) return -1;
    if (b.key === selectedKey) return 1;
    return a.label.localeCompare(b.label);
  });

  return entries;
}

function getFoodRulesContext(
  petSpecies: string | null,
  options: FoodSelectionOptions,
): {
  avoidFavorited: boolean;
  preferredNormalized: string | null;
  allowedNormalized: Set<string>;
  forbiddenNormalized: Set<string>;
} {
  const rulesState = getRulesState();
  const avoidFavorited = options.avoidFavorited ?? rulesState.avoidFavorited;

  const allowedNormalized = new Set<string>();
  const forbiddenNormalized = new Set<string>();
  let preferredNormalized: string | null = null;

  const diet = resolveDiet(petSpecies);
  const override = mergeOverrides(resolveOverride(petSpecies), options.itemOverride);

  diet.normalized.forEach((entry) => allowedNormalized.add(entry));

  preferredNormalized = override?.preferred ? normalizeSpeciesKey(override.preferred) : null;
  if (preferredNormalized) {
    allowedNormalized.add(preferredNormalized);
  }

  if (override?.allowed) {
    for (const entry of override.allowed) {
      const normalized = normalizeSpeciesKey(entry);
      if (normalized) allowedNormalized.add(normalized);
    }
  }

  if (override?.forbidden) {
    for (const entry of override.forbidden) {
      const normalized = normalizeSpeciesKey(entry);
      if (normalized) forbiddenNormalized.add(normalized);
    }
  }

  if (allowedNormalized.size === 0) {
    DEFAULT_SAFE_NORMALIZED.forEach((value) => allowedNormalized.add(value));
  }

  return {
    avoidFavorited,
    preferredNormalized,
    allowedNormalized,
    forbiddenNormalized,
  };
}

function findMatchingFood(
  snapshot: InventorySnapshot,
  skipFavorited: boolean,
  predicate: (normalized: string, item: InventoryItemSnapshot) => boolean,
): InventoryItemSnapshot | null {
  for (const item of snapshot.items) {
    const normalized = normalizeInventoryFood(item);
    if (!normalized) continue;
    if (skipFavorited && snapshot.favoritedIds.has(item.id)) continue;
    if (!predicate(normalized, item)) continue;
    return item;
  }
  return null;
}

function listMatchingFood(
  snapshot: InventorySnapshot,
  skipFavorited: boolean,
  predicate: (normalized: string, item: InventoryItemSnapshot) => boolean,
): InventoryItemSnapshot[] {
  const result: InventoryItemSnapshot[] = [];
  for (const item of snapshot.items) {
    const normalized = normalizeInventoryFood(item);
    if (!normalized) continue;
    if (skipFavorited && snapshot.favoritedIds.has(item.id)) continue;
    if (!predicate(normalized, item)) continue;
    result.push(item);
  }
  return result;
}

export function evaluateFoodAvailabilityForPet(
  petSpecies: string | null,
  snapshot: InventorySnapshot | null,
  options: FoodSelectionOptions = {},
): FoodAvailabilityResult {
  if (!snapshot || snapshot.items.length === 0) {
    return { selected: null, availableCount: 0, eligibleFoods: [] };
  }

  const context = getFoodRulesContext(petSpecies, options);
  const matchPreferred = (normalized: string): boolean => {
    if (!context.preferredNormalized) return false;
    return normalized === context.preferredNormalized;
  };
  const matchAllowed = (normalized: string): boolean => {
    return context.allowedNormalized.has(normalized) && !context.forbiddenNormalized.has(normalized);
  };

  const selectWithFavoritedPolicy = (
    selector: (skipFavorited: boolean) => InventoryItemSnapshot | null,
  ): FoodSelection | null => {
    const primary = selector(true);
    if (primary) {
      return { item: primary, usedFavoriteFallback: false };
    }
    if (!context.avoidFavorited) return null;

    const fallback = selector(false);
    if (!fallback) return null;
    return {
      item: fallback,
      usedFavoriteFallback: snapshot.favoritedIds.has(fallback.id),
    };
  };

  let selected: FoodSelection | null = null;
  selected = selectWithFavoritedPolicy((skipFavorited) => findMatchingFood(snapshot, skipFavorited, (normalized) => matchPreferred(normalized)));
  if (!selected) {
    selected = selectWithFavoritedPolicy((skipFavorited) => findMatchingFood(snapshot, skipFavorited, (normalized) => matchAllowed(normalized)));
  }

  // Check if hunger potion is available and allowed
  const potionCount = getHungerPotionCount();
  const potionAllowed = !context.forbiddenNormalized.has(HUNGER_POTION_KEY);
  const potionIsPreferred = context.preferredNormalized === HUNGER_POTION_KEY;

  // If potion is preferred and available, select it over crops
  if (potionIsPreferred && potionCount > 0 && potionAllowed) {
    const potionSelection: FoodSelection = {
      item: {
        id: 'hunger-potion-synthetic',
        species: HUNGER_POTION_KEY,
        itemType: 'tool',
        name: HUNGER_POTION_LABEL,
        quantity: potionCount,
        scale: null,
        mutations: [],
      },
      usedFavoriteFallback: false,
      isHungerPotion: true,
    };

    // Count: crop count + potion count
    const countPredicate = context.preferredNormalized
      ? ((normalized: string) => matchPreferred(normalized) || matchAllowed(normalized))
      : matchAllowed;
    const countItems = listMatchingFood(snapshot, context.avoidFavorited, (normalized) => countPredicate(normalized));
    return {
      selected: potionSelection,
      availableCount: sumItemQuantities(countItems) + potionCount,
      eligibleFoods: buildEligibleFoods(countItems, potionCount, potionAllowed, HUNGER_POTION_KEY),
    };
  }

  // If no crop was selected but potion is allowed and available, fall back to potion
  if (!selected && potionCount > 0 && potionAllowed) {
    return {
      selected: {
        item: {
          id: 'hunger-potion-synthetic',
          species: HUNGER_POTION_KEY,
          itemType: 'tool',
          name: HUNGER_POTION_LABEL,
          quantity: potionCount,
          scale: null,
          mutations: [],
        },
        usedFavoriteFallback: false,
        isHungerPotion: true,
      },
      availableCount: potionCount,
      eligibleFoods: buildEligibleFoods([], potionCount, true, HUNGER_POTION_KEY),
    };
  }

  if (!selected) {
    return { selected: null, availableCount: 0, eligibleFoods: [] };
  }

  const countPredicate = context.preferredNormalized
    ? ((normalized: string) => matchPreferred(normalized) || matchAllowed(normalized))
    : matchAllowed;
  const skipFavoritedForCount = context.avoidFavorited;
  const countItems = listMatchingFood(snapshot, skipFavoritedForCount, (normalized) => countPredicate(normalized));

  // Include potion count in total available if potion is allowed
  const extraPotionCount = (potionCount > 0 && potionAllowed) ? potionCount : 0;
  const selectedKey = normalizeInventoryFood(selected.item);

  return {
    selected,
    availableCount: sumItemQuantities(countItems) + extraPotionCount,
    eligibleFoods: buildEligibleFoods(countItems, potionCount, potionAllowed, selectedKey),
  };
}

export function selectFoodForPetLegacyCompatibility(
  petSpecies: string | null,
  snapshot: InventorySnapshot | null,
  options: FoodSelectionOptions = {},
): FoodSelection | null {
  // Legacy alias for integrations that still expect this helper path.
  return selectFoodForPet(petSpecies, snapshot, options);
}

export function selectFoodForPet(
  petSpecies: string | null,
  snapshot: InventorySnapshot | null,
  options: FoodSelectionOptions = {},
): FoodSelection | null {
  return evaluateFoodAvailabilityForPet(petSpecies, snapshot, options).selected;
}
