// src/features/petTeamActions.ts
// WebSocket message helpers for pet team operations.
// SwapPet is handled by existing swapPetIntoActiveSlot() in petSwap.ts.

import { log } from '../utils/logger';
import { sendRoomAction, type WebSocketSendResult } from '../websocket/api';
import { getMapSnapshot, getGardenSnapshot } from './garden/bridge';
import { getActivePetInfos } from '../store/pets';
import { isRecord } from '../utils/typeGuards';
import { getMyUserSlotIdx } from '../core/playerContext';

function sendAction(type: 'StorePet' | 'PlacePet' | 'ToggleFavoriteItem' | 'ToggleLockItem' | 'SellPet', payload: Record<string, unknown>): WebSocketSendResult {
  const sent = sendRoomAction(type, payload, { throttleMs: 90 });
  if (!sent.ok && sent.reason !== 'throttled') {
    log(`[PetTeamActions] send failed (${type})`, sent.reason);
  }
  return sent;
}

/**
 * Send an active pet to the hutch.
 * itemId = ActivePetInfo.slotId (the pet item UUID).
 */
export function sendStorePet(itemId: string): WebSocketSendResult {
  return sendAction('StorePet', { itemId });
}

/**
 * Place a pet from inventory into an EMPTY active slot.
 * Only needed when the player has fewer active pets than the team requires.
 *
 * position/tileType/localTileIndex are unverified defaults from Aries source.
 */
export function sendPlacePet(
  itemId: string,
  position: { x: number; y: number },
  tileType: string,
  localTileIndex: number,
): WebSocketSendResult {
  return sendAction('PlacePet', { itemId, position, tileType, localTileIndex });
}

/**
 * Toggle the favorited state of an item.
 * itemId = inventory item UUID.
 */
export function sendToggleFavoriteItem(itemId: string): boolean {
  return sendAction('ToggleFavoriteItem', { itemId }).ok;
}

/**
 * Unlock a locked item (ToggleLockItem).
 * itemId = inventory item UUID.
 */
export function sendToggleLockItem(itemId: string): boolean {
  return sendAction('ToggleLockItem', { itemId }).ok;
}

/**
 * Sell a pet directly.
 * itemId = inventory item UUID (pet must be in inventory to sell).
 *
 * WARNING: This does NOT check for unlogged journal variants. Callers that
 * initiate sells should use `ensureJournalLogged()` from `journalGuard.ts`
 * before calling this to avoid losing unlogged Gold/Rainbow/Normal/Max Weight
 * variants. Currently has zero callers (sell paths use sendRoomAction directly).
 */
export function sendSellPet(itemId: string): WebSocketSendResult {
  return sendAction('SellPet', { itemId });
}

/**
 * PlacePet position fallback constants (last resort when map/garden data unavailable).
 */
export const PLACE_PET_DEFAULTS = {
  position: { x: 0, y: 0 } as { x: number; y: number },
  tileType: 'Boardwalk',
  localTileIndex: 64,
} as const;

// ---------------------------------------------------------------------------
// User slot index resolution (player's garden slot in multiplayer)
// ---------------------------------------------------------------------------

/**
 * Derive userSlotIdx from an active pet's known position on the map.
 * Returns null when there are no active pets or the map data isn't available.
 */
function deriveSlotIdxFromActivePets(): number | null {
  const map = getMapSnapshot();
  if (!map?.cols) return null;

  const activePets = getActivePetInfos();
  for (const pet of activePets) {
    if (pet.position?.x == null || pet.position?.y == null) continue;
    const globalIdx = pet.position.x + pet.position.y * map.cols;
    const bw = map.globalTileIdxToBoardwalk?.[globalIdx];
    if (bw != null) return bw.userSlotIdx;
    const dirt = map.globalTileIdxToDirtTile?.[globalIdx];
    if (dirt != null) return dirt.userSlotIdx;
  }
  return null;
}

/**
 * Resolve the player's userSlotIdx (their garden position in the room).
 *
 * Strategy order:
 * 1. `myUserSlotIdxAtom` — direct Jotai atom (game's canonical source)
 * 2. `playerAtom.id` + `stateAtom.child.data.userSlots` — manual findIndex
 * 3. Derive from active pet positions on the map (existing fallback)
 */
export async function resolveMyUserSlotIdx(): Promise<number | null> {
  // Strategies 1 + 2: direct atom + player slot lookup (via shared helper)
  const idx = await getMyUserSlotIdx();
  if (idx != null) return idx;

  // Strategy 3: derive from active pet positions on the map
  return deriveSlotIdxFromActivePets();
}

// ---------------------------------------------------------------------------
// Empty tile discovery for PlacePet
// ---------------------------------------------------------------------------

export interface PlacePetTile {
  position: { x: number; y: number };
  tileType: string;
  localTileIndex: number;
}

/**
 * Find an empty garden tile suitable for PlacePet.
 *
 * Reads the map + garden snapshots from gardenBridge, then scans for a tile
 * that has no garden object and no active pet. Prefers boardwalk tiles.
 *
 * @param excludePositions - additional positions to skip (format "x,y"),
 *   used when placing multiple pets in a single batch.
 * @param userSlotIdx - pre-resolved player slot index. When provided and non-null,
 *   only tiles belonging to this slot are returned. When null/undefined, falls back
 *   to deriving from active pet positions (backward compat).
 * @returns a valid tile or null if none found.
 */
export function findEmptyGardenTile(
  excludePositions?: Set<string>,
  userSlotIdx?: number | null,
): PlacePetTile | null {
  const map = getMapSnapshot();
  const garden = getGardenSnapshot();
  if (!map || !garden || !map.cols || !map.rows) return null;

  // Collect positions occupied by active pets
  const occupied = new Set<string>(excludePositions);
  const activePets = getActivePetInfos();
  for (const pet of activePets) {
    if (pet.position?.x != null && pet.position?.y != null) {
      occupied.add(`${pet.position.x},${pet.position.y}`);
    }
  }

  // Use provided userSlotIdx, or derive from active pet positions (backward compat)
  const mySlotIdx: number | null = userSlotIdx ?? deriveSlotIdxFromActivePets();

  // Scan boardwalk tiles first (natural pet placement area)
  const bwEntries = map.globalTileIdxToBoardwalk;
  if (bwEntries) {
    for (const globalIdxStr of Object.keys(bwEntries)) {
      const mapping = bwEntries[Number(globalIdxStr)];
      if (!mapping) continue;
      if (mySlotIdx != null && mapping.userSlotIdx !== mySlotIdx) continue;

      const globalIdx = Number(globalIdxStr);
      const x = globalIdx % map.cols;
      const y = Math.floor(globalIdx / map.cols);
      if (occupied.has(`${x},${y}`)) continue;

      const localIdx = mapping.boardwalkTileIdx;
      if (garden.boardwalkTileObjects?.[localIdx]) continue;

      return { position: { x, y }, tileType: 'Boardwalk', localTileIndex: localIdx };
    }
  }

  // Fallback: scan dirt tiles (pets can be placed on any garden tile)
  const dirtEntries = map.globalTileIdxToDirtTile;
  if (dirtEntries) {
    for (const globalIdxStr of Object.keys(dirtEntries)) {
      const mapping = dirtEntries[Number(globalIdxStr)];
      if (!mapping) continue;
      if (mySlotIdx != null && mapping.userSlotIdx !== mySlotIdx) continue;

      const globalIdx = Number(globalIdxStr);
      const x = globalIdx % map.cols;
      const y = Math.floor(globalIdx / map.cols);
      if (occupied.has(`${x},${y}`)) continue;

      const localIdx = mapping.dirtTileIdx;
      if (garden.tileObjects?.[localIdx]) continue;

      return { position: { x, y }, tileType: 'Dirt', localTileIndex: localIdx };
    }
  }

  log('[PetTeamActions] No empty garden tile found for PlacePet');
  return null;
}
