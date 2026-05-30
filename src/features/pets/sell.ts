// src/features/petSell.ts
// Location-aware sell pipeline for pets (active, hutch, or inventory).
// Follows the same sell pattern as sellAllPets.ts (sendRoomAction → SellPet).

import { readInventoryDirect } from '../../store/inventory';
import { getActivePetInfos } from '../../store/pets';
import { sendStorePet, sendToggleLockItem } from './teamActions';
import { waitForInventoryContains } from './swap';
import { sendRoomAction } from '../../websocket/api';
import { delay } from '../../utils/scheduling';
import { log } from '../../utils/logger';
import type { CollectedPet } from './optimizer';
import { ensureJournalLogged } from '../journal/guard';

export interface SellPipelineResult {
  ok: boolean;
  reason?: string;
}

const STORE_TIMEOUT_MS = 4000;
const RETRIEVE_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 120;
const POST_UNFAVORITE_DELAY_MS = 200;
const POST_STORE_DELAY_MS = 200;
const SELL_DELAY_MS = 40;

/**
 * Wait for a pet to leave the active slots (after StorePet).
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
 * 2. If active → StorePet → wait leave → RetrieveFromStorage → wait inventory
 * 3. If hutch → RetrieveFromStorage → wait inventory
 * 4. If inventory → ready
 * 5. SellPet (same as sellAllPets.ts: sendRoomAction directly)
 */
export async function executeSellPipeline(pet: CollectedPet): Promise<SellPipelineResult> {
  const itemId = pet.itemId;
  const { location } = pet;

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
      sendToggleLockItem(itemId);
      await delay(POST_UNFAVORITE_DELAY_MS);
    }

    // Step 2: Move to inventory based on location
    if (location === 'active') {
      const storeResult = sendStorePet(itemId);
      if (!storeResult.ok) {
        return { ok: false, reason: `StorePet failed: ${storeResult.reason ?? 'unknown'}` };
      }

      const left = await waitForPetLeavesActive(itemId, STORE_TIMEOUT_MS);
      if (!left) {
        return { ok: false, reason: 'Timed out waiting for pet to leave active slots' };
      }

      await delay(POST_STORE_DELAY_MS);

      // Now in hutch — retrieve to inventory
      const retrieveResult = sendRoomAction('RetrieveItemFromStorage', {
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
    } else if (location === 'hutch') {
      const retrieveResult = sendRoomAction('RetrieveItemFromStorage', {
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
    const sellResult = sendRoomAction('SellPet', { itemId }, { throttleMs: 0, skipThrottle: true });
    if (!sellResult.ok) {
      return { ok: false, reason: `SellPet failed: ${sellResult.reason ?? 'unknown'}` };
    }

    await delay(SELL_DELAY_MS);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log('[petSell] executeSellPipeline failed', { petId: itemId, error });
    return { ok: false, reason: message };
  }
}
