// Reads stateAtom (userSlots + players) to extract coins, garden value,
// inventory value, and pet count for every player in the room.

import { getAtomByLabel, readAtomValue } from '../../core/jotaiBridge';
import { subscribeAtomValue } from '../../core/atomRegistry';
import { getPlayerId } from '../../core/playerContext';
import { computeGardenValueFromCatalog } from './valueCalculator';
import { computeStorageItemsValue, computePetSellPrice, computePlacedDecorAndEggValue, computeGrowingCropsValue } from './storageValue';
import { getDecor } from '../../catalogs/gameCatalogs';
import { debounceCancelable } from '../../utils/scheduling/debounce';
import { createNamedLogger } from '../../diagnostics/logger';
import { healthBus } from '../../diagnostics/healthBus';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';
import { isRecord } from '../../utils/typeGuards';
import { getFriendBonusMultiplier } from '../../store/friendBonus';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:roomPlayerEconomy';
const FEATURE_NAME = 'roomPlayerEconomy';
const diag = createNamedLogger(FEATURE_SUBSYSTEM);
let busRegistered = false;

function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(FEATURE_SUBSYSTEM, { category: 'feature', status: 'starting' });
}

function publishOk(message: string, metrics?: Record<string, number | string>): void {
  ensureBusRegistered();
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

function warnFeature(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

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

let started = false;
let stateAtomUnsub: (() => void) | null = null;
let debouncedUpdate: ((() => void) & { cancel: () => void }) | null = null;
let selfPlayerId: string | null = null;

let currentSnapshot: RoomPlayersSnapshot = { self: null, others: [], updatedAt: 0 };
const listeners = new Set<(snap: RoomPlayersSnapshot) => void>();

let slotEconomyCache = new WeakMap<object, RoomPlayerEconomy>();

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
    try { cb(currentSnapshot); } catch (err) { warnFeature('QPM-FEATURE-004', { what: 'listener:snapshot' }, err); }
  }
}

async function resolveSelfPlayerId(): Promise<string | null> {
  return getPlayerId();
}

function extractSlotEconomy(
  slot: Record<string, unknown>,
  slotIndex: number,
  playerNameMap: Map<string, string>,
): RoomPlayerEconomy | null {
  const playerId = typeof slot.playerId === 'string' ? slot.playerId.trim() : '';
  if (!playerId) return null;

  const data = isRecord(slot.data) ? slot.data as Record<string, unknown> : null;
  if (!data) return null;

  const coins = typeof data.coinsCount === 'number' ? data.coinsCount : 0;
  const fb = getFriendBonusMultiplier();

  const garden = isRecord(data.garden) ? data.garden : null;
  const gardenSnap = garden as { tileObjects?: Record<string, unknown>; boardwalkTileObjects?: Record<string, unknown> } | null;
  const gardenValue = gardenSnap
    ? computeGardenValueFromCatalog(gardenSnap, fb)
    : 0;

  const placedDecorValue = gardenSnap ? computePlacedDecorAndEggValue(gardenSnap) : 0;
  const growingCropsValue = gardenSnap ? computeGrowingCropsValue(gardenSnap) : 0;

  const inventory = isRecord(data.inventory) ? data.inventory : null;
  const invItems = Array.isArray(inventory?.items) ? (inventory!.items as unknown[]) : [];
  const inventoryValue = computeStorageItemsValue(invItems, fb);

  const storages = Array.isArray(inventory?.storages) ? (inventory!.storages as unknown[]) : [];
  let storageValueTotal = 0;
  for (const s of storages) {
    if (!s || typeof s !== 'object') continue;
    const rec = s as Record<string, unknown>;
    const decorId = typeof rec.decorId === 'string' ? rec.decorId : '';
    if (decorId) {
      const entry = getDecor(decorId);
      if (entry) storageValueTotal += Number.isFinite(entry.coinPrice) ? entry.coinPrice : 0;
    }
    const storageItems = Array.isArray(rec.items) ? (rec.items as unknown[]) : [];
    storageValueTotal += computeStorageItemsValue(storageItems, fb);
  }

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

  const displayName = playerNameMap.get(playerId) ?? `Player ${playerId.slice(0, 6)}`;

  return {
    playerId, displayName, coins, gardenValue, growingCropsValue, placedDecorValue,
    inventoryValue, storageValue: storageValueTotal, activePetsValue: activePetsValueTotal,
    petCount, slotIndex,
  };
}

function rebuildSnapshot(stateValue: unknown): void {
  const userSlots = readPath(stateValue, ['child', 'data', 'userSlots']);
  const players = readPath(stateValue, ['data', 'players']);

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

    let economy: RoomPlayerEconomy | null;
    const cached = slotEconomyCache.get(slot);
    if (cached && cached.slotIndex === i) {
      const freshName = nameMap.get(cached.playerId) ?? cached.displayName;
      economy = freshName === cached.displayName ? cached : { ...cached, displayName: freshName };
    } else {
      economy = extractSlotEconomy(slot as Record<string, unknown>, i, nameMap);
      if (economy) slotEconomyCache.set(slot, economy);
    }
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
  ensureBusRegistered();

  selfPlayerId = await resolveSelfPlayerId();

  const stateAtom = getAtomByLabel('stateAtom');
  if (!stateAtom) {
    warnFeature('QPM-FEATURE-003', { what: 'atom:stateAtom_missing' }, null);
    started = false;
    return () => {};
  }

  debouncedUpdate = debounceCancelable(async () => {
    try {
      const state = await readAtomValue<unknown>(stateAtom);
      rebuildSnapshot(state);
    } catch (err) { warnFeature('QPM-FEATURE-004', { what: 'state:read' }, err); }
  }, 1500);

  try {
    const unsub = await subscribeAtomValue('userSlots', () => {
      debouncedUpdate?.();
    });
    if (unsub) stateAtomUnsub = unsub;
  } catch (err) {
    warnFeature('QPM-FEATURE-003', { what: 'subscribe:userSlots' }, err);
    started = false;
    return () => {};
  }

  debouncedUpdate();

  publishOk('Started', { hasSelfId: selfPlayerId ? 1 : 0 });

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
  slotEconomyCache = new WeakMap();
}
