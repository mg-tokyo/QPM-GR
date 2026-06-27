// src/store/inventory.ts
// Bridge for inventory data via myInventoryAtom and myCropInventoryAtom

import { getAtomByLabel, subscribeAtom, readAtomValue } from '../core/jotaiBridge';
import { log } from '../utils/logger';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeInventory', 'inventory');
let firstAtomValueSeen = false;

export interface InventoryItem {
  id: string;
  itemId?: string;
  species?: string | null;
  name?: string | null;
  displayName?: string | null;
  itemType?: string | null;
  quantity?: number;
  count?: number;
  amount?: number;
  stackSize?: number;
  abilities?: any[]; // Pet abilities
  strength?: number; // Pet strength
  raw: unknown;
}

export interface InventoryData {
  items: InventoryItem[];
  favoritedItemIds?: string[];
}

const INVENTORY_ATOM_LABEL = 'myInventoryAtom';
const CROP_INVENTORY_ATOM_LABEL = 'myCropInventoryAtom';

let cachedInventory: InventoryItem[] = [];
let cachedFavorites: Set<string> = new Set();
let unsubscribe: (() => void) | null = null;
let initializing = false;
let inventoryAtomRef: unknown = null;
let lastRawInventoryValue: unknown = null;
const listeners = new Set<(data: InventoryData) => void>();

function normalizeInventoryItem(raw: any): InventoryItem | null {
  if (!raw || typeof raw !== 'object') return null;

  // UUID fields take priority. Species/name are fallbacks for seeds that have no UUID.
  // Stackable items (eggs, tools, decor) only carry type-specific IDs (eggId/toolId/decorId).
  const fallbackId = raw.id ?? raw.itemId ?? raw.species ?? raw.eggId ?? raw.toolId ?? raw.decorId ?? raw.name ?? raw.displayName;
  const id = String(fallbackId ?? '').trim();
  if (!id) return null;

  return {
    id,
    itemId: raw.itemId,
    species: raw.species ?? raw.petSpecies ?? null,
    name: raw.name ?? raw.displayName ?? null,
    displayName: raw.displayName ?? raw.name ?? null,
    itemType: raw.itemType ?? null,
    quantity: raw.quantity ?? raw.count ?? raw.amount ?? raw.stackSize,
    count: raw.count,
    amount: raw.amount,
    stackSize: raw.stackSize,
    abilities: raw.abilities ?? raw.pet?.abilities,
    strength: raw.strength ?? raw.pet?.strength,
    raw,
  };
}

function normalizeInventoryData(raw: any): InventoryData | null {
  if (!raw) return null;

  // Try to extract items array
  let itemsArray: any[] = [];
  if (Array.isArray(raw)) {
    itemsArray = raw;
  } else if (Array.isArray(raw.items)) {
    itemsArray = raw.items;
  } else if (Array.isArray(raw.inventory)) {
    itemsArray = raw.inventory;
  } else if (typeof raw === 'object') {
    // Try to find an array in the object
    const values = Object.values(raw);
    const candidate = values.find((v): v is any[] =>
      Array.isArray(v) && v.length > 0 && typeof v[0] === 'object'
    );
    if (candidate) {
      itemsArray = candidate;
    }
  }

  const items: InventoryItem[] = [];
  for (const rawItem of itemsArray) {
    const normalized = normalizeInventoryItem(rawItem);
    if (normalized) {
      items.push(normalized);
    }
  }

  // Extract favorited item IDs
  let favoritedItemIds: string[] = [];
  if (Array.isArray(raw?.favoritedItemIds)) {
    favoritedItemIds = raw.favoritedItemIds.filter((id: any): id is string => typeof id === 'string');
  } else if (Array.isArray(raw?.favorites)) {
    favoritedItemIds = raw.favorites.filter((id: any): id is string => typeof id === 'string');
  }

  return {
    items,
    favoritedItemIds,
  };
}

function updateCache(raw: any): void {
  const data = normalizeInventoryData(raw);
  if (data) {
    cachedInventory = data.items;
    cachedFavorites = new Set(data.favoritedItemIds ?? []);
  } else {
    cachedInventory = [];
    cachedFavorites = new Set();
  }
  notifyListeners();
}

function getSnapshot(): InventoryData {
  return {
    items: [...cachedInventory],
    favoritedItemIds: Array.from(cachedFavorites),
  };
}

function notifyListeners(): void {
  const snapshot = getSnapshot();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      diag.warn('QPM-STORE-003', { phase: 'notify' }, error);
    }
  }
  const message = `${cachedInventory.length} items (${cachedFavorites.size} fav)`;
  const metrics = {
    itemCount: cachedInventory.length,
    favoriteCount: cachedFavorites.size,
  };
  if (!firstAtomValueSeen) {
    firstAtomValueSeen = true;
    diag.publishOk(message, metrics);
  } else {
    diag.publishMetrics(message, metrics);
  }
}

export async function startInventoryStore(): Promise<void> {
  if (unsubscribe || initializing) {
    return;
  }

  initializing = true;
  diag.register('Waiting for myInventoryAtom');
  try {
    // Try myInventoryAtom first (full inventory)
    inventoryAtomRef = getAtomByLabel(INVENTORY_ATOM_LABEL);

    // Fallback to myCropInventoryAtom if myInventoryAtom not found
    if (!inventoryAtomRef) {
      log('⚠️ myInventoryAtom not found, trying myCropInventoryAtom');
      inventoryAtomRef = getAtomByLabel(CROP_INVENTORY_ATOM_LABEL);
    }

    if (!inventoryAtomRef) {
      diag.warn('QPM-STORE-002', { atom: `${INVENTORY_ATOM_LABEL} | ${CROP_INVENTORY_ATOM_LABEL}` });
      initializing = false;
      return;
    }

    unsubscribe = await subscribeAtom(inventoryAtomRef, (value: any) => {
      lastRawInventoryValue = value;
      updateCache(value);
    });

    log('✅ Inventory store initialized');
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'startInventoryStore' }, error);
  } finally {
    initializing = false;
  }
}

export function stopInventoryStore(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  inventoryAtomRef = null;
  lastRawInventoryValue = null;
  cachedInventory = [];
  cachedFavorites = new Set();
  firstAtomValueSeen = false;
}

/**
 * Get current inventory items (synchronous)
 * Returns cached data from the subscribed atom
 */
export function getInventoryItems(): InventoryItem[] {
  return [...cachedInventory];
}

/**
 * Get current favorited item IDs (synchronous)
 */
export function getFavoritedItemIds(): Set<string> {
  return new Set(cachedFavorites);
}

export function onInventoryChange(
  callback: (data: InventoryData) => void,
  fireImmediately = false,
): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try {
      callback(getSnapshot());
    } catch (error) {
      diag.warn('QPM-STORE-003', { phase: 'onInventoryChange.immediate' }, error);
    }
  }
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Check if inventory store is running
 */
export function isInventoryStoreActive(): boolean {
  return unsubscribe !== null;
}

/**
 * Read inventory directly from atom (async, bypasses cache)
 * Useful for one-time reads without subscribing
 */
export async function readInventoryDirect(): Promise<InventoryData | null> {
  try {
    let atom = getAtomByLabel(INVENTORY_ATOM_LABEL);

    if (!atom) {
      atom = getAtomByLabel(CROP_INVENTORY_ATOM_LABEL);
    }

    if (!atom) {
      log('⚠️ Inventory atom not found');
      return null;
    }

    const raw = await readAtomValue(atom);
    return normalizeInventoryData(raw);
  } catch (error) {
    log('❌ Failed to read inventory atom', error);
    return null;
  }
}
