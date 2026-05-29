// src/core/playerContext.ts — Shared player identity and position helpers.
//
// Centralises the "read playerAtom → extract id" and "read positionAtom → XY"
// patterns that were previously duplicated across 5+ files.

import { readAtomValue } from './atomRegistry';
import type { GridPosition } from '../types/gameAtoms';
import { isRecord } from '../utils/typeGuards';

/**
 * Resolve the current player's ID from the `player` atom.
 * Tries `id`, `playerId`, `userId` fields in that order.
 */
export async function getPlayerId(): Promise<string | null> {
  const player = await readAtomValue('player');
  if (!player) return null;

  for (const field of ['id', 'playerId', 'userId'] as const) {
    const candidate = (player as Record<string, unknown>)[field];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

/**
 * Resolve the current player's grid position.
 * Reads `position` first, falls back to `localPosition`.
 */
export async function getPlayerPosition(): Promise<GridPosition | null> {
  const pos = await readAtomValue('position');
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') return pos;

  const local = await readAtomValue('localPosition');
  if (local && typeof local.x === 'number' && typeof local.y === 'number') return local;

  return null;
}

/**
 * Resolve the current player's user-slot index.
 * Reads `myUserSlotIdx` directly, falls back to searching stateAtom + playerAtom.
 */
export async function getMyUserSlotIdx(): Promise<number | null> {
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

  for (let i = 0; i < userSlots.length; i++) {
    const slot = userSlots[i];
    if (isRecord(slot) && String(slot.playerId ?? '').trim() === playerId) {
      return i;
    }
  }
  return null;
}
