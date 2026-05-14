// src/features/locker/rules.ts
// Pure rule engine for the Locker. No side effects, no store/UI imports.

import type { LockerConfig, GuardResult, HarvestFilterSettings } from './types';

export interface InventorySnapshot {
  itemCount: number;
  capacity: number;
  /** When true, the purchase will stack into an existing slot (no new slot consumed). */
  purchaseWillStack?: boolean;
}

/** Resolved from garden tile data at the guard layer. */
export interface TileContext {
  objectType?: string; // 'plant' | 'egg' | 'decor' | etc
  species?: string;    // plant species (same across all slots)
  eggId?: string;      // egg ID from tile.eggId
  decorId?: string;    // decor type ID (objectType value for decor tiles)
  mutations?: string[]; // mutations on the targeted grow slot (matched via slotsIndex)
  sizePercent?: number; // crop size percentage (50–100), computed from targetScale + maxScale
}

const PASS: GuardResult = { blocked: false };

function inventoryReserveCheck(config: LockerConfig, inventory: InventorySnapshot): GuardResult {
  if (!config.inventoryReserve.enabled) return PASS;
  if (inventory.purchaseWillStack) return PASS;
  const freeSlots = inventory.capacity - inventory.itemCount;
  if (freeSlots < config.inventoryReserve.minFreeSlots) {
    return {
      blocked: true,
      reason: `Inventory reserve: ${freeSlots} free slots (min ${config.inventoryReserve.minFreeSlots})`,
      rule: 'inventory_reserve',
    };
  }
  return PASS;
}

function hasAnyLockedMutation(mutations: string[], locks: Record<string, boolean>): string | undefined {
  for (const m of mutations) {
    if (locks[m]) return m;
  }
  return undefined;
}

// ── Harvest filter evaluation (Aries-style) ───────────────────────────────

interface DimensionResult {
  hasCriteria: boolean; // true if the user configured any criteria in this dimension
  matched: boolean;     // true if the tile matches the criteria
}

function evaluateSizeFilter(settings: HarvestFilterSettings, sizePercent: number): DimensionResult {
  switch (settings.scaleLockMode) {
    case 'RANGE':
      return { hasCriteria: true, matched: sizePercent >= settings.minScalePct && sizePercent <= settings.maxScalePct };
    case 'MINIMUM':
      return { hasCriteria: true, matched: sizePercent >= settings.minScalePct };
    case 'MAXIMUM':
      return { hasCriteria: true, matched: sizePercent <= settings.maxScalePct };
    case 'NONE':
    default:
      return { hasCriteria: false, matched: false };
  }
}

function evaluateColorFilter(settings: HarvestFilterSettings, mutations: string[]): DimensionResult {
  if (!settings.colorGold && !settings.colorRainbow && !settings.colorNormal) {
    return { hasCriteria: false, matched: false };
  }
  const mutSet = new Set(mutations.map(m => m.toLowerCase()));
  const isGold = mutSet.has('gold') || mutSet.has('golden');
  const isRainbow = mutSet.has('rainbow');
  const isNormal = !isGold && !isRainbow;

  const matched = (settings.colorGold && isGold)
    || (settings.colorRainbow && isRainbow)
    || (settings.colorNormal && isNormal);
  return { hasCriteria: true, matched };
}

function evaluateWeatherFilter(settings: HarvestFilterSettings, mutations: string[]): DimensionResult {
  const mutLower = new Set(mutations.map(m => m.toLowerCase()));

  if (settings.weatherMode === 'RECIPES') {
    const nonEmpty = settings.weatherRecipes.filter(r => r.length > 0);
    if (nonEmpty.length === 0) return { hasCriteria: false, matched: false };
    // Each recipe is an AND group; recipes are OR'd together
    const matched = nonEmpty.some(recipe =>
      recipe.every(tag => mutLower.has(tag.toLowerCase())),
    );
    return { hasCriteria: true, matched };
  }

  // ANY / ALL modes use weatherTags
  if (settings.weatherTags.length === 0) return { hasCriteria: false, matched: false };

  if (settings.weatherMode === 'ALL') {
    const matched = settings.weatherTags.every(tag => mutLower.has(tag.toLowerCase()));
    return { hasCriteria: true, matched };
  }
  // ANY (default)
  const matched = settings.weatherTags.some(tag => mutLower.has(tag.toLowerCase()));
  return { hasCriteria: true, matched };
}

/**
 * Resolves the effective harvest filter for a species (crop override if present, else global).
 * Returns null if the filter has no active criteria (no-op).
 */
function resolveEffectiveFilter(
  config: LockerConfig,
  species?: string,
): HarvestFilterSettings | null {
  if (species) {
    const override = config.cropOverrides[species];
    if (override?.enabled) return override.settings;
  }
  return config.harvestFilter;
}

function hasAnyCriteria(settings: HarvestFilterSettings): boolean {
  if (settings.scaleLockMode !== 'NONE') return true;
  if (settings.colorGold || settings.colorRainbow || settings.colorNormal) return true;
  if (settings.weatherMode === 'RECIPES' && settings.weatherRecipes.some(r => r.length > 0)) return true;
  if (settings.weatherMode !== 'RECIPES' && settings.weatherTags.length > 0) return true;
  return false;
}

function evaluateHarvestFilterBlock(config: LockerConfig, tile?: TileContext): GuardResult {
  const settings = resolveEffectiveFilter(config, tile?.species);
  if (!settings || !hasAnyCriteria(settings)) return PASS;

  const sizePercent = tile?.sizePercent ?? 100;
  const mutations = tile?.mutations ?? [];

  const size = evaluateSizeFilter(settings, sizePercent);
  const color = evaluateColorFilter(settings, mutations);
  const weather = evaluateWeatherFilter(settings, mutations);

  if (settings.filterMode === 'LOCK') {
    // LOCK: block when ANY dimension with criteria matches
    if ((size.hasCriteria && size.matched)
      || (color.hasCriteria && color.matched)
      || (weather.hasCriteria && weather.matched)) {
      return { blocked: true, reason: 'Harvest filter (LOCK)', rule: 'harvest_filter' };
    }
  } else {
    // ALLOW: block when ANY dimension with criteria does NOT match
    if ((size.hasCriteria && !size.matched)
      || (color.hasCriteria && !color.matched)
      || (weather.hasCriteria && !weather.matched)) {
      return { blocked: true, reason: 'Harvest filter (ALLOW)', rule: 'harvest_filter' };
    }
  }
  return PASS;
}

// ── Main evaluator ────────────────────────────────────────────────────────

export function evaluateAction(
  actionType: string,
  _payload: Record<string, unknown>,
  config: LockerConfig,
  inventory: InventorySnapshot,
  tile?: TileContext,
): GuardResult {
  if (!config.enabled) return PASS;

  switch (actionType) {
    case 'HarvestCrop': {
      // Blanket harvest lock
      if (config.harvestLock) {
        return { blocked: true, reason: 'Harvest lock is active', rule: 'harvest_lock' };
      }
      // Per-plant lock: resolve species from tile context
      if (tile?.species && config.plantLocks[tile.species]) {
        return { blocked: true, reason: `Plant locked: ${tile.species}`, rule: 'plant_lock' };
      }
      // Per-mutation lock: check if any active mutation is locked
      if (tile?.mutations && tile.mutations.length > 0) {
        const lockedMut = hasAnyLockedMutation(tile.mutations, config.mutationLocks);
        if (lockedMut) {
          const label = tile.species ? `${tile.species} (${lockedMut})` : lockedMut;
          return { blocked: true, reason: `Mutation locked: ${label}`, rule: 'mutation_lock' };
        }
      }
      // Custom rules: species + ALL mutations must be present (AND logic)
      if (tile?.species && tile?.mutations && config.customRules.length > 0) {
        for (const rule of config.customRules) {
          if (rule.species === tile.species && rule.mutations.every(m => tile.mutations!.includes(m))) {
            const mutLabel = rule.mutations.join(' + ');
            return { blocked: true, reason: `Custom rule: ${rule.species} (${mutLabel})`, rule: 'custom_rule' };
          }
        }
      }
      // Harvest filters (Aries-style size/color/weather + LOCK/ALLOW)
      const filterResult = evaluateHarvestFilterBlock(config, tile);
      if (filterResult.blocked) return filterResult;

      return inventoryReserveCheck(config, inventory);
    }

    case 'RemoveGardenObject': {
      // Reuse plant locks: if a plant is locked for harvest, also protect from shoveling
      if (tile?.species && config.plantLocks[tile.species]) {
        return { blocked: true, reason: `Plant locked (shovel): ${tile.species}`, rule: 'shovel_plant_lock' };
      }
      // Reuse mutation locks: protect plants with locked mutations from shoveling
      if (tile?.mutations && tile.mutations.length > 0) {
        const lockedMut = hasAnyLockedMutation(tile.mutations, config.mutationLocks);
        if (lockedMut) {
          const label = tile.species ? `${tile.species} (${lockedMut})` : lockedMut;
          return { blocked: true, reason: `Mutation locked (shovel): ${label}`, rule: 'shovel_mutation_lock' };
        }
      }
      return PASS;
    }

    case 'PickupObject': {
      return inventoryReserveCheck(config, inventory);
    }

    case 'PickupDecor': {
      // Blanket decor pickup lock
      if (config.decorPickupLock) {
        return { blocked: true, reason: 'Decor pickup lock is active', rule: 'decor_pickup_lock' };
      }
      // Per-decor lock
      if (tile?.decorId && config.decorLocks[tile.decorId]) {
        return { blocked: true, reason: `Decor locked: ${tile.decorId}`, rule: 'decor_lock' };
      }
      return inventoryReserveCheck(config, inventory);
    }

    case 'HatchEgg': {
      // Blanket hatch lock
      if (config.hatchLock) {
        return { blocked: true, reason: 'Hatch lock is active', rule: 'hatch_lock' };
      }
      // Per-egg lock: resolve eggId from tile context
      if (tile?.eggId && config.eggLocks[tile.eggId]) {
        return { blocked: true, reason: `Egg locked: ${tile.eggId}`, rule: 'egg_lock' };
      }
      return inventoryReserveCheck(config, inventory);
    }

    case 'SellAllCrops': {
      if (config.sellAllCropsLock) {
        return { blocked: true, reason: 'Sell-all-crops lock is active', rule: 'sell_all_crops_lock' };
      }
      // Per-crop sell protection — block if any crop type is locked
      const lockedCrops = Object.keys(config.cropSellLocks).filter(k => config.cropSellLocks[k]);
      if (lockedCrops.length > 0) {
        return { blocked: true, reason: `Protected crops: ${lockedCrops.join(', ')}`, rule: 'crop_sell_lock' };
      }
      return PASS;
    }

    case 'PurchaseShopItem': {
      return inventoryReserveCheck(config, inventory);
    }

    case 'SellPet':
      // Pet sell protection is handled at the guard layer (guard.ts)
      // because it requires store access for inventory/favorites lookup.
      return PASS;

    default:
      return PASS;
  }
}
