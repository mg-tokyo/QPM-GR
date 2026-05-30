// src/features/roomPlayerEconomy.ts
// Data layer for comparing economy stats across room players.
// Reads stateAtom (userSlots + players) to extract coins, garden value,
// inventory value, and pet count for every player in the room.

import { getAtomByLabel, readAtomValue, subscribeAtom } from '../../core/jotaiBridge';
import { getPlayerId } from '../../core/playerContext';
import { computeGardenValueFromCatalog } from './valueCalculator';
import { computeStorageItemsValue, computePetSellPrice, computePlacedDecorAndEggValue, computeGrowingCropsValue } from './storageValue';
import { getDecor } from '../../catalogs/gameCatalogs';
import { debounceCancelable } from '../../utils/debounce';
import { createLogger } from '../../utils/logger';
import { isRecord } from '../../utils/typeGuards';
import { getFriendBonusMultiplier } from '../../store/friendBonus';

const log = createLogger('QPM:RoomPlayerEcon');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoomPlayerEconomy {
  playerId: string;
  displayName: string;
  coins: number;
  gardenValue: number;
  growingCropsValue: number;
  placedDecorValue: number;
  inventoryValue: number;
  storageValue: number;
  activePetsValue: number;
  petCount: number;
  slotIndex: number;
}

export interface RoomPlayersSnapshot {
  self: RoomPlayerEconomy | null;
  others: RoomPlayerEconomy[];
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let started = false;
let stateAtomUnsub: (() => void) | null = null;
let debouncedUpdate: ((() => void) & { cancel: () => void }) | null = null;
let selfPlayerId: string | null = null;

let currentSnapshot: RoomPlayersSnapshot = { self: null, others: [], updatedAt: 0 };
const listeners = new Set<(snap: RoomPlayersSnapshot) => void>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function notifyListeners(): void {
  for (const cb of listeners) {
    try { cb(currentSnapshot); } catch { /* ignore */ }
  }
}

/** Resolve the local player's ID from playerAtom. */
async function resolveSelfPlayerId(): Promise<string | null> {
  return getPlayerId();
}

/** Extract economy data from a single userSlot. */
function extractSlotEconomy(
  slot: Record<string, unknown>,
  slotIndex: number,
  playerNameMap: Map<string, string>,
): RoomPlayerEconomy | null {
  const playerId = typeof slot.playerId === 'string' ? slot.playerId.trim() : '';
  if (!playerId) return null;

  const data = isRecord(slot.data) ? slot.data as Record<string, unknown> : null;
  if (!data) return null;

  // Coins
  const coins = typeof data.coinsCount === 'number' ? data.coinsCount : 0;
  const fb = getFriendBonusMultiplier();

  // Garden value — data.garden has { tileObjects, boardwalkTileObjects }
  const garden = isRecord(data.garden) ? data.garden : null;
  const gardenSnap = garden as { tileObjects?: Record<string, unknown>; boardwalkTileObjects?: Record<string, unknown> } | null;
  const gardenValue = gardenSnap
    ? computeGardenValueFromCatalog(gardenSnap, fb)
    : 0;

  // Placed decor/egg value + growing crops value (from garden tiles)
  const placedDecorValue = gardenSnap ? computePlacedDecorAndEggValue(gardenSnap) : 0;
  const growingCropsValue = gardenSnap ? computeGrowingCropsValue(gardenSnap) : 0;

  // Inventory value — data.inventory.items
  const inventory = isRecord(data.inventory) ? data.inventory : null;
  const invItems = Array.isArray(inventory?.items) ? (inventory!.items as unknown[]) : [];
  const inventoryValue = computeStorageItemsValue(invItems, fb);

  // Storage buildings value (Seed Silo, Pet Hutch, Decor Shed) — building price + contents
  const storages = Array.isArray(inventory?.storages) ? (inventory!.storages as unknown[]) : [];
  let storageValueTotal = 0;
  for (const s of storages) {
    if (!s || typeof s !== 'object') continue;
    const rec = s as Record<string, unknown>;
    // Building's own purchase price
    const decorId = typeof rec.decorId === 'string' ? rec.decorId : '';
    if (decorId) {
      const entry = getDecor(decorId);
      if (entry) storageValueTotal += Number.isFinite(entry.coinPrice) ? entry.coinPrice : 0;
    }
    // Items inside
    const storageItems = Array.isArray(rec.items) ? (rec.items as unknown[]) : [];
    storageValueTotal += computeStorageItemsValue(storageItems, fb);
  }

  // Active pets — count + sell value
  const petSlots = Array.isArray(data.petSlots) ? data.petSlots : [];
  const activePets = petSlots.filter((s) => s != null).length;
  let activePetsValueTotal = 0;
  for (const ps of petSlots) {
    if (!ps || typeof ps !== 'object') continue;
    activePetsValueTotal += computePetSellPrice(ps as Record<string, unknown>, fb);
  }

  let inventoryPets = 0;
  for (const item of invItems) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const itemType = typeof raw.itemType === 'string' ? raw.itemType.toLowerCase() : '';
    if (itemType === 'pet' || 'petSpecies' in raw) inventoryPets++;
  }

  let hutchPets = 0;
  for (const s of storages) {
    if (!s || typeof s !== 'object') continue;
    const storageRec = s as Record<string, unknown>;
    if (storageRec.decorId !== 'PetHutch') continue;
    const hutchItems = Array.isArray(storageRec.items) ? (storageRec.items as unknown[]) : [];
    for (const item of hutchItems) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;
      const itemType = typeof raw.itemType === 'string' ? raw.itemType.toLowerCase() : '';
      if (itemType === 'pet' || 'petSpecies' in raw) hutchPets++;
    }
  }

  const petCount = activePets + inventoryPets + hutchPets;

  // Display name
  const displayName = playerNameMap.get(playerId) ?? `Player ${playerId.slice(0, 6)}`;

  return {
    playerId, displayName, coins, gardenValue, growingCropsValue, placedDecorValue,
    inventoryValue, storageValue: storageValueTotal, activePetsValue: activePetsValueTotal,
    petCount, slotIndex,
  };
}

/** Rebuild snapshot from stateAtom value. */
function rebuildSnapshot(stateValue: unknown): void {
  const userSlots = readPath(stateValue, ['child', 'data', 'userSlots']);
  const players = readPath(stateValue, ['data', 'players']);

  // Build player name map
  const nameMap = new Map<string, string>();
  if (Array.isArray(players)) {
    for (const p of players) {
      if (!isRecord(p)) continue;
      const id = typeof p.id === 'string' ? p.id : '';
      const name = typeof p.name === 'string' ? p.name : '';
      if (id && name) nameMap.set(id, name);
    }
  }

  const self: RoomPlayerEconomy | null = null;
  const others: RoomPlayerEconomy[] = [];

  const slots = Array.isArray(userSlots) ? userSlots : [];
  let foundSelf: RoomPlayerEconomy | null = null;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!isRecord(slot)) continue;

    const economy = extractSlotEconomy(slot as Record<string, unknown>, i, nameMap);
    if (!economy) continue;

    if (selfPlayerId && economy.playerId === selfPlayerId) {
      foundSelf = economy;
    } else {
      others.push(economy);
    }
  }

  currentSnapshot = {
    self: foundSelf,
    others,
    updatedAt: Date.now(),
  };
  notifyListeners();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getRoomPlayersSnapshot(): RoomPlayersSnapshot {
  return currentSnapshot;
}

export function onRoomPlayersChange(cb: (snap: RoomPlayersSnapshot) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export async function startRoomPlayerEconomy(): Promise<() => void> {
  if (started) return stopRoomPlayerEconomy;
  started = true;

  // Resolve self player ID
  selfPlayerId = await resolveSelfPlayerId();

  const stateAtom = getAtomByLabel('stateAtom');
  if (!stateAtom) {
    log('stateAtom not found — room player economy unavailable');
    started = false;
    return () => {};
  }

  debouncedUpdate = debounceCancelable(async () => {
    try {
      const state = await readAtomValue<unknown>(stateAtom);
      rebuildSnapshot(state);
    } catch { /* ignore */ }
  }, 300);

  try {
    stateAtomUnsub = await subscribeAtom<unknown>(stateAtom, () => {
      debouncedUpdate?.();
    });
  } catch (err) {
    log('Failed to subscribe to stateAtom', err);
    started = false;
    return () => {};
  }

  // Initial read
  debouncedUpdate();

  return stopRoomPlayerEconomy;
}

export function stopRoomPlayerEconomy(): void {
  if (!started) return;
  started = false;

  debouncedUpdate?.cancel();
  debouncedUpdate = null;

  stateAtomUnsub?.();
  stateAtomUnsub = null;

  listeners.clear();
  selfPlayerId = null;
  currentSnapshot = { self: null, others: [], updatedAt: 0 };
}
