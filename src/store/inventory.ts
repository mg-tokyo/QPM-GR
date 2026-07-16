import { getAtomByLabel, readAtomValue } from '../core/jotaiBridge';
import { subscribeAtomValue } from '../core/atomRegistry';
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
  abilities?: any[];
  strength?: number;
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
let lastNotifySignature: string | null = null;
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

  let itemsArray: any[] = [];
  if (Array.isArray(raw)) {
    itemsArray = raw;
  } else if (Array.isArray(raw.items)) {
    itemsArray = raw.items;
  } else if (Array.isArray(raw.inventory)) {
    itemsArray = raw.inventory;
  } else if (typeof raw === 'object') {
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

function buildNotifySignature(items: InventoryItem[], favorites: Set<string>): string {
  // Per-item: id | species | itemType | quantity | strength_bucket | abilities.length.
  // Bucketing strength/5 keeps the sig stable across strength rolls (1 Hz game jitter);
  // abilities.length is the cheap fingerprint — objects aren't stably JSON-serializable here.
  let sig = `${items.length}|${favorites.size}`;
  for (const it of items) {
    const qty = it.quantity ?? it.count ?? it.amount ?? it.stackSize ?? '';
    const str = it.strength != null ? Math.floor(it.strength / 5) : '';
    const abl = it.abilities?.length ?? 0;
    sig += `\n${it.id}|${it.species ?? ''}|${it.itemType ?? ''}|${qty}|${str}|${abl}`;
  }
  return sig;
}

function notifyListeners(): void {
  const signature = buildNotifySignature(cachedInventory, cachedFavorites);
  if (signature === lastNotifySignature) return;
  lastNotifySignature = signature;

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
  diag.register('Waiting for inventory');
  try {
    // Routes through atomRegistry's `inventory` selector (stateTree fan-out) — no polling, no crop-atom fallback needed.
    const unsub = await subscribeAtomValue('inventory', (value) => {
      lastRawInventoryValue = value;
      updateCache(value);
    });

    if (unsub) {
      unsubscribe = unsub;
      diag.log.debug('store initialized');
    } else {
      diag.warn('QPM-STORE-002', { atom: 'inventory (registry)' });
    }
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
  lastNotifySignature = null;
}

export function getInventoryItems(): InventoryItem[] {
  return [...cachedInventory];
}

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

export function isInventoryStoreActive(): boolean {
  return unsubscribe !== null;
}

/** Reads inventory directly from the atom, bypassing the cache. */
export async function readInventoryDirect(): Promise<InventoryData | null> {
  try {
    let atom = getAtomByLabel(INVENTORY_ATOM_LABEL);

    if (!atom) {
      atom = getAtomByLabel(CROP_INVENTORY_ATOM_LABEL);
    }

    if (!atom) {
      diag.warn('QPM-STORE-002', {
        atom: `${INVENTORY_ATOM_LABEL} | ${CROP_INVENTORY_ATOM_LABEL}`,
        phase: 'readInventoryDirect',
      });
      return null;
    }

    const raw = await readAtomValue(atom);
    return normalizeInventoryData(raw);
  } catch (error) {
    diag.warn('QPM-STORE-002', { phase: 'readInventoryDirect' }, error);
    return null;
  }
}
