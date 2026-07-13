// Pure rule engine for the Locker. No side effects, no store/UI imports.

import type { LockerConfig, GuardResult } from './types';
import {
  hasAnyLockedMutation,
  evaluateSizeFilter,
  evaluateColorFilter,
  evaluateWeatherFilter,
  resolveEffectiveFilter,
  hasAnyCriteria,
} from './rules-primitives';

export interface InventorySnapshot {
  itemCount: number;
  capacity: number;
  /** When true, the purchase will stack into an existing slot (no new slot consumed). */
  purchaseWillStack?: boolean;
}

/** Resolved from garden tile data at the guard layer. */
export interface TileContext {
  objectType?: string; // 'plant' | 'egg' | 'decor' | etc
  species?: string;    // species of the TARGETED grow slot — rare variants (SnowdropDouble,
                       // PurpleDaisy, FourLeafClover, VariegatedCattail) and override slots
                       // differ from tile.species, so this is NOT the same across all slots
  baseSpecies?: string;    // tile-level species (the base plant of the patch)
  allSpecies?: string[];   // distinct species across the tile (tile.species + every slot)
  allMutations?: string[]; // union of mutations across every slot (for whole-tile actions)
  eggId?: string;      // egg ID from tile.eggId
  decorId?: string;    // decor type ID (objectType value for decor tiles)
  mutations?: string[]; // mutations on the targeted grow slot (matched via slotsIndex)
  sizePercent?: number; // crop size percentage (50–100), computed from targetScale + maxScale
}

/**
 * First locked species relevant to the action, or undefined.
 * 'harvest' checks the targeted slot + the tile's base species (locking the base
 * protects the whole patch including variant slots; locking a variant protects
 * only that slot). 'tile' (shovel/removal) checks every species on the tile.
 */
function findLockedSpecies(
  tile: TileContext,
  locks: Record<string, boolean>,
  scope: 'harvest' | 'tile',
): string | undefined {
  if (tile.species && locks[tile.species]) return tile.species;
  if (tile.baseSpecies && locks[tile.baseSpecies]) return tile.baseSpecies;
  if (scope === 'tile') return tile.allSpecies?.find(sp => locks[sp]);
  return undefined;
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

// Main evaluator

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
      // Per-plant lock: targeted slot species or the patch's base species
      const lockedSpecies = tile ? findLockedSpecies(tile, config.plantLocks, 'harvest') : undefined;
      if (lockedSpecies) {
        return { blocked: true, reason: `Plant locked: ${lockedSpecies}`, rule: 'plant_lock' };
      }
      // Per-mutation lock: check if any active mutation is locked
      if (tile?.mutations && tile.mutations.length > 0) {
        const lockedMut = hasAnyLockedMutation(tile.mutations, config.mutationLocks);
        if (lockedMut) {
          const label = tile.species ? `${tile.species} (${lockedMut})` : lockedMut;
          return { blocked: true, reason: `Mutation locked: ${label}`, rule: 'mutation_lock' };
        }
      }
      // Harvest filters (Aries-style size/color/weather + LOCK/ALLOW)
      const filterResult = evaluateHarvestFilterBlock(config, tile);
      if (filterResult.blocked) return filterResult;

      return inventoryReserveCheck(config, inventory);
    }

    case 'RemoveGardenObject': {
      // Shoveling destroys the whole tile — protect if ANY slot's species is locked
      const shovelLockedSpecies = tile ? findLockedSpecies(tile, config.plantLocks, 'tile') : undefined;
      if (shovelLockedSpecies) {
        return { blocked: true, reason: `Plant locked (shovel): ${shovelLockedSpecies}`, rule: 'shovel_plant_lock' };
      }
      // Mutation locks: check the union of mutations across all slots, not just slot 0
      const shovelMutations = tile?.allMutations ?? tile?.mutations;
      if (shovelMutations && shovelMutations.length > 0) {
        const lockedMut = hasAnyLockedMutation(shovelMutations, config.mutationLocks);
        if (lockedMut) {
          const label = tile?.species ? `${tile.species} (${lockedMut})` : lockedMut;
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
