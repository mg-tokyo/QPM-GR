// src/core/slotOwner.ts — Pure slot-owner helpers.
//
// Moved from playerContext.ts (Task B3 Step 0) so gameState/ can import
// identity primitives without pulling in atomRegistry (which imports
// gameState). No atom reads, no websocket reads, no `window` — keeps
// vitest's node env clean. `getPlayerIdFromUrl` (which needs
// getRoomConnection) lives in playerIdFromUrl.ts.

import { isRecord } from '../utils/typeGuards';

/**
 * Owner id of a userSlot. Game v985 (2026-08-20) renamed `userSlots[].playerId`
 * → `userSlots[].userId`; accept both so older bundles keep working.
 */
export function getSlotOwnerId(slot: unknown): string | null {
  if (!isRecord(slot)) return null;
  for (const field of ['userId', 'playerId'] as const) {
    const candidate = slot[field];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

/** Index of the slot owned by `ownerId`, or -1. Tolerant of null slots. */
export function findSlotIdxByOwner(slots: unknown, ownerId: string): number {
  if (!Array.isArray(slots)) return -1;
  return slots.findIndex((s) => getSlotOwnerId(s) === ownerId);
}
