import { readInventoryDirect } from '../../store/inventory';
import { getActivePetInfos } from '../../store/pets';
import { waitForInventoryContains } from './swap';
import { sendRoomAction, type RoomActionType, type WebSocketSendResult } from '../../websocket/api';
import { delay } from '../../utils/scheduling/scheduling';
import { warnFeature } from './_diagnostics';
import type { CollectedPet } from './optimizer';
import { ensureJournalLogged } from '../journal/guard';

export interface SellPipelineResult {
  ok: boolean;
  reason?: string;
}

export type SellSender = (
  type: RoomActionType,
  payload: Record<string, unknown>,
  options?: { throttleMs?: number; skipThrottle?: boolean },
) => WebSocketSendResult | Promise<WebSocketSendResult>;

export interface SellPipelineOptions {
  send?: SellSender;
}

async function invokeSend(
  send: SellSender,
  type: RoomActionType,
  payload: Record<string, unknown>,
  options?: { throttleMs?: number; skipThrottle?: boolean },
): Promise<WebSocketSendResult> {
  const result = await send(type, payload, options);
  if (!result.ok && result.reason !== 'throttled') {
    warnFeature('QPM-FEATURE-001', { type, reason: result.reason ?? 'unknown' });
  }
  return result;
}

const PICKUP_TIMEOUT_MS = 4000;
const RETRIEVE_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 120;
const POST_UNFAVORITE_DELAY_MS = 200;
const POST_PICKUP_DELAY_MS = 200;
const SELL_DELAY_MS = 40;

/**
 * Wait for a pet to leave the active slots (after PickupPet).
 */
async function waitForPetLeavesActive(itemId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const actives = getActivePetInfos();
    const stillActive = actives.some(
      (p) => p.slotId === itemId || p.petId === itemId,
    );
    if (!stillActive) return true;
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Execute the full sell pipeline for a single pet, handling any location.
 *
 * Uses pet.itemId (the item UUID) for all WS actions — this is slotId for
 * active pets and item.id for inventory/hutch pets. Matches the sell pattern
 * in sellAllPets.ts.
 *
 * Steps:
 * 1. Fresh atom read → unfavorite/unlock via ToggleLockItem if in favoritedItemIds
 * 2. If active → PickupPet(petId) → wait leave → wait inventory
 * 3. If hutch → RetrieveFromStorage → wait inventory
 * 4. If inventory → ready
 * 5. SellPet (same as sellAllPets.ts: sendRoomAction directly)
 */
export async function executeSellPipeline(
  pet: CollectedPet,
  opts?: SellPipelineOptions,
): Promise<SellPipelineResult> {
  const itemId = pet.itemId;
  const { location } = pet;
  const send: SellSender = opts?.send ?? sendRoomAction;

  if (!itemId || itemId.startsWith('active-') || itemId.startsWith('hutch-') || itemId.startsWith('inventory-')) {
    return { ok: false, reason: 'Invalid item ID (missing or synthetic)' };
  }

  try {
    // Step 0: Auto-log unlogged journal variants before selling
    await ensureJournalLogged([pet]);

    // Step 1: Fresh atom read to avoid stale cache — unfavorite/unlock if needed
    const freshInventory = await readInventoryDirect();
    const freshFavorites = new Set(freshInventory?.favoritedItemIds ?? []);
    if (freshFavorites.has(itemId)) {
      await invokeSend(send, 'ToggleLockItem', { itemId }, { throttleMs: 90 });
      await delay(POST_UNFAVORITE_DELAY_MS);
    }

    // Step 2: Move to inventory based on location
    if (location === 'active') {
      // Wire-shape migration: StorePet is gone; PickupPet(petId) moves an
      // active pet straight into inventory — no hutch hop needed.
      const activePet = getActivePetInfos().find((p) => p.slotId === itemId);
      if (!activePet?.petId) {
        return { ok: false, reason: 'Missing petId for active pet' };
      }
      const pickupResult = await invokeSend(send, 'PickupPet', { petId: activePet.petId }, { throttleMs: 90 });
      if (!pickupResult.ok) {
        return { ok: false, reason: `PickupPet failed: ${pickupResult.reason ?? 'unknown'}` };
      }

      const left = await waitForPetLeavesActive(itemId, PICKUP_TIMEOUT_MS);
      if (!left) {
        return { ok: false, reason: 'Timed out waiting for pet to leave active slots' };
      }

      await delay(POST_PICKUP_DELAY_MS);

      const inInventory = await waitForInventoryContains(itemId, RETRIEVE_TIMEOUT_MS);
      if (!inInventory) {
        return { ok: false, reason: 'Timed out waiting for pet in inventory after PickupPet' };
      }
    } else if (location === 'hutch') {
      const retrieveResult = await invokeSend(send, 'RetrieveItemFromStorage', {
        itemId,
        storageId: 'PetHutch',
      }, { throttleMs: 0, skipThrottle: true });
      if (!retrieveResult.ok) {
        return { ok: false, reason: `RetrieveItemFromStorage failed: ${retrieveResult.reason ?? 'unknown'}` };
      }

      const inInventory = await waitForInventoryContains(itemId, RETRIEVE_TIMEOUT_MS);
      if (!inInventory) {
        return { ok: false, reason: 'Timed out waiting for pet in inventory after hutch retrieval' };
      }
    }
    // location === 'inventory' → already ready

    // Step 3: Sell — matches sellAllPets.ts pattern exactly
    const sellResult = await invokeSend(send, 'SellPet', { itemId }, { throttleMs: 0, skipThrottle: true });
    if (!sellResult.ok) {
      return { ok: false, reason: `SellPet failed: ${sellResult.reason ?? 'unknown'}` };
    }

    await delay(SELL_DELAY_MS);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    warnFeature('QPM-FEATURE-003', { what: 'executeSellPipeline', petId: itemId }, error);
    return { ok: false, reason: message };
  }
}
