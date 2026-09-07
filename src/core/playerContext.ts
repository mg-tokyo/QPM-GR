// src/core/playerContext.ts — Shared player identity and position helpers.
//
// Centralises the "read playerAtom → extract id" and "read positionAtom → XY"
// patterns that were previously duplicated across 5+ files.

import { readAtomValue, readAtomValueSync } from './atomRegistry';
import { isGameStateReady } from './gameState';
import { getIdentity } from './gameState/identity';
import type { GridPosition } from '../types/gameAtoms';
import { isRecord } from '../utils/typeGuards';

// Slot-owner primitives moved to slotOwner.ts (Task B3 Step 0) so gameState/
// can consume them without importing atomRegistry. `getPlayerIdFromUrl` lives
// in playerIdFromUrl.ts (needs getRoomConnection, which reaches `window` at
// module scope — kept out of the pure slotOwner module for vitest's node env).
// Re-exported here so the 23 existing importers keep resolving via
// '../core/playerContext'.
import { findSlotIdxByOwner } from './slotOwner';
import { getPlayerIdFromUrl } from './playerIdFromUrl';
export { getSlotOwnerId, findSlotIdxByOwner } from './slotOwner';
export { getPlayerIdFromUrl } from './playerIdFromUrl';

function extractPlayerIdFromRecord(player: unknown): string | null {
  if (!player || typeof player !== 'object') return null;
  const record = player as Record<string, unknown>;
  for (const field of ['id', 'playerId', 'userId'] as const) {
    const candidate = record[field];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

// Identity ladder (gameState/identity.ts) owns the primary rungs; keep the
// legacy player-atom + URL fallbacks so a boot-race read before gameState wires
// up still resolves. The facade throws before initGameState(), so every read
// through it must be gated on isGameStateReady() to honour that contract.
export function getPlayerIdSync(): string | null {
  const fromLadder = getIdentity().playerId;
  if (fromLadder) return fromLadder;
  if (isGameStateReady()) {
    const fromAtom = extractPlayerIdFromRecord(readAtomValueSync('player'));
    if (fromAtom) return fromAtom;
  }
  return getPlayerIdFromUrl();
}

export async function getPlayerId(): Promise<string | null> {
  const sync = getPlayerIdSync();
  if (sync) return sync;
  if (isGameStateReady()) {
    const fromAtom = extractPlayerIdFromRecord(await readAtomValue('player'));
    if (fromAtom) return fromAtom;
  }
  return getPlayerIdFromUrl();
}

/**
 * Resolve the current player's grid position.
 * Reads `position` first, falls back to `localPosition`.
 */
export async function getPlayerPosition(): Promise<GridPosition | null> {
  if (!isGameStateReady()) return null;
  const pos = await readAtomValue('position');
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') return pos;

  const local = await readAtomValue('localPosition');
  if (local && typeof local.x === 'number' && typeof local.y === 'number') return local;

  return null;
}

export async function getMyUserSlotIdx(): Promise<number | null> {
  const fromLadder = getIdentity().myIdx;
  if (fromLadder !== null) return fromLadder;
  if (!isGameStateReady()) return null;

  const idx = await readAtomValue('myUserSlotIdx');
  if (typeof idx === 'number' && idx >= 0) return idx;

  // Fallback: find our slot in stateAtom by matching playerId
  const playerId = await getPlayerId();
  if (!playerId) return null;

  const state = await readAtomValue('state');
  if (!isRecord(state)) return null;
  const child = state.child;
  if (!isRecord(child)) return null;
  const data = child.data;
  if (!isRecord(data)) return null;
  const userSlots = data.userSlots;
  if (!Array.isArray(userSlots)) return null;

  const found = findSlotIdxByOwner(userSlots, playerId);
  return found >= 0 ? found : null;
}
