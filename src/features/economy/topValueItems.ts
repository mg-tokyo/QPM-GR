// src/features/topValueItems.ts
// Pure computation module — returns top-N most valuable items across sources.
// No DOM, no side effects.

import type { GardenSnapshot } from '../gardenBridge';
import type { InventoryItem } from '../../store/inventory';
import type { ActivePetInfo } from '../../store/pets';
import { getPlantSpecies, getPetSpecies, getSeedPrice, getDecor, getEggType } from '../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../utils/cropMultipliers';
import { computePetSellPrice } from './storageValue';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopValueItem {
  species: string;
  mutations: string[];
  scale: number;
  value: number;
  source: 'garden' | 'inventory' | 'storage' | 'activePet';
  isPet: boolean;
  isSeed?: boolean;
  isDecor?: boolean;
  isEgg?: boolean;
  quantity?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp non-finite catalog prices (Infinity for dust-only items, NaN) to 0. */
function finiteOr0(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Aggregate items with the same species + type flags into single entries,
 * summing values and quantities. Pets are never aggregated (each is unique).
 */
function aggregateItems(items: TopValueItem[]): TopValueItem[] {
  const map = new Map<string, TopValueItem>();
  const result: TopValueItem[] = [];

  for (const item of items) {
    // Pets are unique (different scale/mutations/xp) — never aggregate
    if (item.isPet) {
      result.push(item);
      continue;
    }

    const key = `${item.species}|${item.isSeed ? 's' : item.isDecor ? 'd' : item.isEgg ? 'e' : 'p'}`;
    const existing = map.get(key);
    if (existing) {
      existing.value += item.value;
      existing.quantity = (existing.quantity ?? 1) + (item.quantity ?? 1);
    } else {
      const entry = { ...item, quantity: item.quantity ?? 1 };
      map.set(key, entry);
      result.push(entry);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Garden items
// ---------------------------------------------------------------------------

export function getTopGardenItems(
  snapshot: GardenSnapshot,
  friendBonus: number,
  limit = 10,
): TopValueItem[] {
  if (!snapshot) return [];

  const items: TopValueItem[] = [];
  const now = Date.now();
  const tileSets = [snapshot.tileObjects, snapshot.boardwalkTileObjects];

  for (const tileMap of tileSets) {
    if (!tileMap) continue;
    for (const tile of Object.values(tileMap)) {
      if (!tile || typeof tile !== 'object') continue;
      const tileRec = tile as Record<string, unknown>;
      if (tileRec.objectType !== 'plant') continue;

      const slots = tileRec.slots;
      if (!Array.isArray(slots)) continue;

      for (const slot of slots) {
        if (!slot || typeof slot !== 'object') continue;
        const slotRec = slot as Record<string, unknown>;

        const species = slotRec.species;
        if (typeof species !== 'string') continue;

        const endTimeRaw = slotRec.endTime;
        const endTime = typeof endTimeRaw === 'number' ? endTimeRaw : Number(endTimeRaw);
        if (!Number.isFinite(endTime) || endTime > now) continue;

        const plantSpec = getPlantSpecies(species) as Record<string, unknown> | null;
        const cropEntry = plantSpec?.crop as Record<string, unknown> | undefined;
        const baseSellPrice = typeof cropEntry?.baseSellPrice === 'number' ? cropEntry.baseSellPrice : 0;
        if (baseSellPrice <= 0) continue;

        const scaleRaw = slotRec.targetScale;
        const scale = typeof scaleRaw === 'number' && Number.isFinite(scaleRaw) ? scaleRaw : 1;
        const mutationsRaw = slotRec.mutations;
        const mutations = Array.isArray(mutationsRaw) ? (mutationsRaw as string[]) : [];
        const { totalMultiplier } = computeMutationMultiplier(mutations);
        const basePrice = Math.round(baseSellPrice * scale * totalMultiplier);
        const value = Math.round(basePrice * friendBonus);

        items.push({ species, mutations, scale, value, source: 'garden', isPet: false });
      }
    }
  }

  items.sort((a, b) => b.value - a.value);
  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Inventory items (produce + pets only)
// ---------------------------------------------------------------------------

export function getTopInventoryItems(
  inventoryItems: InventoryItem[],
  friendBonus: number,
  limit = 10,
): TopValueItem[] {
  const items: TopValueItem[] = [];

  for (const item of inventoryItems) {
    const raw = item.raw as Record<string, unknown>;
    const itemType = ((item.itemType as string | null) ?? (raw.itemType as string | undefined) ?? '').toLowerCase();

    if (itemType === 'pet' || 'petSpecies' in raw) {
      const value = computePetSellPrice(raw, friendBonus);
      if (value <= 0) continue;
      const species = ((raw.petSpecies ?? raw.species) as string | undefined) ?? 'Pet';
      const mutations = Array.isArray(raw.mutations) ? (raw.mutations as string[]) : [];
      const scale = typeof raw.targetScale === 'number' ? raw.targetScale : 1;
      items.push({ species, mutations, scale, value, source: 'inventory', isPet: true });
    } else if (itemType === 'produce') {
      const species = ((item.species as string | null) ?? (raw.species as string | undefined) ?? '');
      if (!species) continue;
      const plantEntry = getPlantSpecies(species) as Record<string, unknown> | null;
      const cropEntry = plantEntry?.crop as Record<string, unknown> | undefined;
      const baseSellPrice = typeof cropEntry?.baseSellPrice === 'number' ? cropEntry.baseSellPrice : 0;
      if (baseSellPrice <= 0) continue;
      const scale = typeof raw.scale === 'number' ? raw.scale : typeof raw.targetScale === 'number' ? raw.targetScale : 1;
      const mutations = Array.isArray(raw.mutations) ? (raw.mutations as string[]) : [];
      const { totalMultiplier } = computeMutationMultiplier(mutations);
      const basePrice = Math.round(baseSellPrice * scale * totalMultiplier);
      const value = Math.round(basePrice * friendBonus);
      items.push({ species, mutations, scale, value, source: 'inventory', isPet: false });
    }
  }

  items.sort((a, b) => b.value - a.value);
  return items.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Net worth items (across all sources)
// ---------------------------------------------------------------------------

export function getTopNetWorthItems(
  snapshot: GardenSnapshot,
  inventoryItems: InventoryItem[],
  storages: unknown[],
  activePets: ActivePetInfo[],
  friendBonus: number,
  limit = 10,
): TopValueItem[] {
  const items: TopValueItem[] = [];

  // Garden crops
  const gardenItems = getTopGardenItems(snapshot, friendBonus, limit);
  items.push(...gardenItems);

  // Inventory produce + pets
  for (const item of inventoryItems) {
    const raw = item.raw as Record<string, unknown>;
    const itemType = ((item.itemType as string | null) ?? (raw.itemType as string | undefined) ?? '').toLowerCase();

    if (itemType === 'pet' || 'petSpecies' in raw) {
      const value = computePetSellPrice(raw, friendBonus);
      if (value <= 0) continue;
      const species = ((raw.petSpecies ?? raw.species) as string | undefined) ?? 'Pet';
      const mutations = Array.isArray(raw.mutations) ? (raw.mutations as string[]) : [];
      const scale = typeof raw.targetScale === 'number' ? raw.targetScale : 1;
      items.push({ species, mutations, scale, value, source: 'inventory', isPet: true });
    } else if (itemType === 'produce') {
      const species = ((item.species as string | null) ?? (raw.species as string | undefined) ?? '');
      if (!species) continue;
      const plantEntry = getPlantSpecies(species) as Record<string, unknown> | null;
      const cropEntry = plantEntry?.crop as Record<string, unknown> | undefined;
      const baseSellPrice = typeof cropEntry?.baseSellPrice === 'number' ? cropEntry.baseSellPrice : 0;
      if (baseSellPrice <= 0) continue;
      const scale = typeof raw.scale === 'number' ? raw.scale : typeof raw.targetScale === 'number' ? raw.targetScale : 1;
      const mutations = Array.isArray(raw.mutations) ? (raw.mutations as string[]) : [];
      const { totalMultiplier } = computeMutationMultiplier(mutations);
      const basePrice = Math.round(baseSellPrice * scale * totalMultiplier);
      const value = Math.round(basePrice * friendBonus);
      items.push({ species, mutations, scale, value, source: 'inventory', isPet: false });
    }
  }

  // Storage items (pets, produce, seeds, decor)
  for (const s of storages) {
    if (!s || typeof s !== 'object') continue;
    const storageItems = Array.isArray((s as Record<string, unknown>).items)
      ? ((s as Record<string, unknown>).items as unknown[])
      : [];
    for (const item of storageItems) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;
      const itemType = typeof raw.itemType === 'string' ? raw.itemType.toLowerCase() : '';

      if (itemType === 'pet' || 'petSpecies' in raw) {
        const value = computePetSellPrice(raw, friendBonus);
        if (value <= 0) continue;
        const species = ((raw.petSpecies ?? raw.species) as string | undefined) ?? 'Pet';
        const mutations = Array.isArray(raw.mutations) ? (raw.mutations as string[]) : [];
        const scale = typeof raw.targetScale === 'number' ? raw.targetScale : 1;
        items.push({ species, mutations, scale, value, source: 'storage', isPet: true });
      } else if (itemType === 'produce') {
        const species = typeof raw.species === 'string' ? raw.species : '';
        if (!species) continue;
        const plantEntry = getPlantSpecies(species) as Record<string, unknown> | null;
        const cropEntry = plantEntry?.crop as Record<string, unknown> | undefined;
        const baseSellPrice = typeof cropEntry?.baseSellPrice === 'number' ? cropEntry.baseSellPrice : 0;
        if (baseSellPrice <= 0) continue;
        const scale = typeof raw.scale === 'number' ? raw.scale : typeof raw.targetScale === 'number' ? raw.targetScale : 1;
        const mutations = Array.isArray(raw.mutations) ? (raw.mutations as string[]) : [];
        const { totalMultiplier } = computeMutationMultiplier(mutations);
        const basePrice = Math.round(baseSellPrice * scale * totalMultiplier);
        const value = Math.round(basePrice * friendBonus);
        items.push({ species, mutations, scale, value, source: 'storage', isPet: false });
      } else if (raw.decorId && typeof raw.decorId === 'string') {
        const entry = getDecor(raw.decorId);
        const unitPrice = finiteOr0(entry?.coinPrice);
        if (unitPrice <= 0) continue;
        const quantity =
          typeof raw.quantity === 'number' ? raw.quantity :
          typeof raw.qty === 'number' ? raw.qty :
          typeof raw.count === 'number' ? raw.count : 1;
        const value = unitPrice * quantity;
        items.push({ species: raw.decorId, mutations: [], scale: 1, value, source: 'storage', isPet: false, isDecor: true, quantity });
      } else {
        // Seeds
        const species =
          (typeof raw.species === 'string' ? raw.species : null) ??
          (typeof raw.seedName === 'string' ? raw.seedName : null) ??
          (typeof raw.crop === 'string' ? raw.crop : null);
        if (!species) continue;
        const quantity =
          typeof raw.quantity === 'number' ? raw.quantity :
          typeof raw.qty === 'number' ? raw.qty :
          typeof raw.count === 'number' ? raw.count : 1;
        const price = getSeedPrice(species);
        const value = (price?.coins ?? 0) * quantity;
        if (value <= 0) continue;
        items.push({ species, mutations: [], scale: 1, value, source: 'storage', isPet: false, isSeed: true, quantity });
      }
    }
  }

  // Active pets
  for (const pet of activePets) {
    if (!pet.raw || typeof pet.raw !== 'object') continue;
    const value = computePetSellPrice(pet.raw as Record<string, unknown>, friendBonus);
    if (value <= 0) continue;
    items.push({
      species: pet.species ?? 'Pet',
      mutations: pet.mutations,
      scale: pet.targetScale ?? 1,
      value,
      source: 'activePet',
      isPet: true,
    });
  }

  // Placed decor + eggs on garden tiles
  if (snapshot) {
    const tileSets = [snapshot.tileObjects, snapshot.boardwalkTileObjects];
    for (const tileMap of tileSets) {
      if (!tileMap) continue;
      for (const tile of Object.values(tileMap)) {
        if (!tile || typeof tile !== 'object') continue;
        const t = tile as Record<string, unknown>;
        const objType = t.objectType;

        if (objType === 'decor') {
          const decorId = (typeof t.decorId === 'string' ? t.decorId : null)
            ?? (typeof t.species === 'string' ? t.species : null);
          if (!decorId) continue;
          const entry = getDecor(decorId);
          const unitPrice = finiteOr0(entry?.coinPrice);
          if (unitPrice <= 0) continue;
          items.push({ species: decorId, mutations: [], scale: 1, value: unitPrice, source: 'garden', isPet: false, isDecor: true, quantity: 1 });
        } else if (objType === 'egg') {
          const eggId = (typeof t.eggId === 'string' ? t.eggId : null)
            ?? (typeof t.eggType === 'string' ? t.eggType : null)
            ?? (typeof t.species === 'string' ? t.species : null);
          if (!eggId) continue;
          const entry = getEggType(eggId);
          const unitPrice = finiteOr0(entry?.coinPrice);
          if (unitPrice <= 0) continue;
          items.push({ species: eggId, mutations: [], scale: 1, value: unitPrice, source: 'garden', isPet: false, isEgg: true, quantity: 1 });
        }
      }
    }
  }

  // Aggregate identical non-pet items (same species + type) before ranking
  const aggregated = aggregateItems(items);
  aggregated.sort((a, b) => b.value - a.value);
  return aggregated.slice(0, limit);
}
