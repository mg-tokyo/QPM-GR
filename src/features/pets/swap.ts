import { getAtomByLabel, readAtomValue } from '../../core/jotaiBridge';
import { getActivePetInfos } from '../../store/pets';
import { log } from '../../utils/logger';
import { delay } from '../../utils/scheduling';
import { hasRoomConnection, sendRoomAction } from '../../websocket/api';
import { findEmptyGardenTile, PLACE_PET_DEFAULTS, resolveMyUserSlotIdx } from './teamActions';

export type SwapPetFailureReason =
  | 'missing_connection'
  | 'missing_ids'
  | 'retrieve_failed_or_inventory_full'
  | 'swap_failed_or_timeout';

export interface SwapPetIntoActiveSlotArgs {
  source: 'inventory' | 'hutch';
  itemId: string;
  targetSlotId: string;
  storageId?: string | null;
}

export interface SwapPetIntoActiveSlotResult {
  ok: boolean;
  reason?: SwapPetFailureReason;
}

const INVENTORY_ATOM_LABEL = 'myInventoryAtom';
const HUTCH_RETRIEVE_TIMEOUT_MS = 3500;
const SWAP_TIMEOUT_MS = 2500;
const POLL_INTERVAL_MS = 100;
const DEFAULT_STORAGE_ID = 'PetHutch';

function normalizeId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function sendAction(type: 'RetrieveItemFromStorage' | 'PlacePet' | 'SwapPet', payload: Record<string, unknown>): boolean {
  const sent = sendRoomAction(type, payload, { throttleMs: 100 });
  if (!sent.ok && sent.reason !== 'throttled') {
    log('[petSwap] send failed', { type, payload, reason: sent.reason });
  }
  return sent.ok;
}

function extractInventoryItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return record.items;
    }
  }
  return [];
}

function extractCandidateIds(entry: Record<string, unknown>): string[] {
  const nestedPet = entry.pet && typeof entry.pet === 'object'
    ? (entry.pet as Record<string, unknown>)
    : null;
  const nestedRaw = entry.raw && typeof entry.raw === 'object'
    ? (entry.raw as Record<string, unknown>)
    : null;

  const candidates = [
    normalizeId(entry.id),
    normalizeId(entry.itemId),
    normalizeId(entry.petId),
    normalizeId(entry.slotId),
    normalizeId(nestedPet?.id),
    normalizeId(nestedPet?.itemId),
    normalizeId(nestedPet?.petId),
    normalizeId(nestedRaw?.id),
    normalizeId(nestedRaw?.itemId),
    normalizeId(nestedRaw?.petId),
  ];

  return candidates.filter((value): value is string => Boolean(value));
}

async function readInventoryIdSet(): Promise<Set<string>> {
  const result = new Set<string>();
  const atom = getAtomByLabel(INVENTORY_ATOM_LABEL);
  if (!atom) {
    return result;
  }

  try {
    const raw = await readAtomValue(atom);
    const items = extractInventoryItems(raw);
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      extractCandidateIds(item as Record<string, unknown>).forEach((id) => result.add(id));
    }
  } catch (error) {
    log('?? petSwap inventory read failed', error);
  }

  return result;
}

export async function waitForInventoryContains(itemId: string, timeoutMs: number): Promise<boolean> {
  const expected = normalizeId(itemId);
  if (!expected) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const inventoryIds = await readInventoryIdSet();
    if (inventoryIds.has(expected)) {
      return true;
    }
    await delay(POLL_INTERVAL_MS);
  }

  return false;
}

async function waitForSwapApplied(targetSlotId: string, itemId: string, timeoutMs: number): Promise<boolean> {
  const expectedTargetSlotId = normalizeId(targetSlotId);
  const expectedItemId = normalizeId(itemId);
  if (!expectedTargetSlotId || !expectedItemId) {
    return false;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const activePets = getActivePetInfos();
    const targetSlotPet = activePets.find((pet) => (
      normalizeId(pet.slotId) === expectedTargetSlotId ||
      normalizeId(pet.petId) === expectedTargetSlotId
    ));

    if (targetSlotPet) {
      const activePetId = normalizeId(targetSlotPet.petId);
      const activeSlotId = normalizeId(targetSlotPet.slotId);
      if (activePetId === expectedItemId || activeSlotId === expectedItemId) {
        return true;
      }
    }

    await delay(POLL_INTERVAL_MS);
  }

  return false;
}

async function waitForPetInActiveList(itemId: string, timeoutMs: number): Promise<boolean> {
  const expectedItemId = normalizeId(itemId);
  if (!expectedItemId) return false;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const activePets = getActivePetInfos();
    const found = activePets.some(
      (p) =>
        normalizeId(p.petId) === expectedItemId ||
        normalizeId(p.slotId) === expectedItemId,
    );
    if (found) return true;
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

export interface PlacePetIntoActiveSlotArgs {
  source: 'inventory' | 'hutch';
  itemId: string;
  storageId?: string | null;
}

/**
 * Place a pet from inventory or hutch into an empty active slot.
 * Uses the PlacePet WS action (no existing pet required in the target slot).
 */
export async function placePetIntoActiveSlot(
  args: PlacePetIntoActiveSlotArgs,
): Promise<SwapPetIntoActiveSlotResult> {
  const itemId = normalizeId(args.itemId);

  if (!itemId) {
    return { ok: false, reason: 'missing_ids' };
  }

  if (!hasRoomConnection()) {
    return { ok: false, reason: 'missing_connection' };
  }

  if (args.source === 'hutch') {
    const storageId = normalizeId(args.storageId) ?? DEFAULT_STORAGE_ID;
    const retrieveSent = sendAction('RetrieveItemFromStorage', {
      itemId,
      storageId,
    });

    if (!retrieveSent) {
      return { ok: false, reason: 'retrieve_failed_or_inventory_full' };
    }

    const retrieved = await waitForInventoryContains(itemId, HUTCH_RETRIEVE_TIMEOUT_MS);
    if (!retrieved) {
      return { ok: false, reason: 'retrieve_failed_or_inventory_full' };
    }
  }

  const resolvedSlotIdx = await resolveMyUserSlotIdx();
  const tile = findEmptyGardenTile(undefined, resolvedSlotIdx);
  const placeSent = sendAction('PlacePet', {
    itemId,
    position: tile?.position ?? PLACE_PET_DEFAULTS.position,
    tileType: tile?.tileType ?? PLACE_PET_DEFAULTS.tileType,
    localTileIndex: tile?.localTileIndex ?? PLACE_PET_DEFAULTS.localTileIndex,
  });

  if (!placeSent) {
    return { ok: false, reason: 'swap_failed_or_timeout' };
  }

  const applied = await waitForPetInActiveList(itemId, SWAP_TIMEOUT_MS);
  if (!applied) {
    return { ok: false, reason: 'swap_failed_or_timeout' };
  }

  return { ok: true };
}

export async function swapPetIntoActiveSlot(args: SwapPetIntoActiveSlotArgs): Promise<SwapPetIntoActiveSlotResult> {
  const itemId = normalizeId(args.itemId);
  const targetSlotId = normalizeId(args.targetSlotId);

  if (!itemId || !targetSlotId) {
    return { ok: false, reason: 'missing_ids' };
  }

  if (!hasRoomConnection()) {
    return { ok: false, reason: 'missing_connection' };
  }

  if (args.source === 'hutch') {
    const storageId = normalizeId(args.storageId) ?? DEFAULT_STORAGE_ID;
    const retrieveSent = sendAction('RetrieveItemFromStorage', {
      itemId,
      storageId,
    });

    if (!retrieveSent) {
      return { ok: false, reason: 'retrieve_failed_or_inventory_full' };
    }

    const retrieved = await waitForInventoryContains(itemId, HUTCH_RETRIEVE_TIMEOUT_MS);
    if (!retrieved) {
      return { ok: false, reason: 'retrieve_failed_or_inventory_full' };
    }
  }

  const swapSent = sendAction('SwapPet', {
    petSlotId: targetSlotId,
    petInventoryId: itemId,
  });

  if (!swapSent) {
    return { ok: false, reason: 'swap_failed_or_timeout' };
  }

  const applied = await waitForSwapApplied(targetSlotId, itemId, SWAP_TIMEOUT_MS);
  if (!applied) {
    return { ok: false, reason: 'swap_failed_or_timeout' };
  }

  return { ok: true };
}



