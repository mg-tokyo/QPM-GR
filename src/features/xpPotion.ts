// src/features/xpPotion.ts — XP Potion feature (inventory check, eligibility, WS send, ghost-step)

import { calculateMaxStrength } from '../store/xpTracker';
import { sendRoomAction, type WebSocketSendResult } from '../websocket/api';
import { ghostStepToPet } from '../utils/ghostStep';
import { getToolCount, onToolCountChange } from '../utils/toolInventory';
import type { ActivePetInfo } from '../store/pets';

const XP_POTION_TOOL_ID = 'XPPotion';

/**
 * Get the current number of XP potions in the player's inventory.
 * Looks for items where `raw.toolId === 'XPPotion'`.
 */
export function getXpPotionCount(): number {
  return getToolCount(XP_POTION_TOOL_ID);
}

/**
 * Subscribe to XP potion count changes. Calls `cb` only when the count
 * actually differs from the previous value. Returns an unsubscribe function.
 */
export function onXpPotionCountChange(cb: (count: number) => void): () => void {
  return onToolCountChange(XP_POTION_TOOL_ID, cb);
}

/**
 * Check whether a pet is eligible to receive an XP potion.
 * Returns true when the pet has the required fields and is not yet at max strength.
 */
export function isPetEligibleForXpPotion(pet: ActivePetInfo): boolean {
  if (!pet.slotId) return false;
  if (!pet.species || pet.targetScale == null || pet.strength == null) return false;

  const maxStr = calculateMaxStrength(pet.targetScale, pet.species);
  if (maxStr == null) return false;

  return pet.strength < maxStr;
}

/** Fixed XP granted per potion use (from game toolsDex). */
export const XP_POTION_AMOUNT = 20_000;

export interface XpPotionProjection {
  newXp: number;
  newStrength: number;
  levelsGained: number;
  reachesMax: boolean;
  /** XP progress within the new level (0 … xpPerLevel). */
  xpIntoLevel: number;
  /** Fraction 0–1 of the new level completed. */
  pctOfLevel: number;
}

/**
 * Project the result of using an XP potion on a pet.
 *
 * Works with deltas from the current state rather than absolute XP→strength
 * conversion, because the game's strength formula includes a species-specific
 * starting offset that QPM doesn't replicate. Each `xpPerLevel` of XP equals
 * one strength point.
 */
export function projectXpPotion(
  currentXp: number,
  currentStrength: number,
  xpPerLevel: number,
  maxStrength: number,
): XpPotionProjection {
  const xpInCurrentLevel = currentXp % xpPerLevel;
  const totalFromLevelStart = xpInCurrentLevel + XP_POTION_AMOUNT;
  const additionalLevels = Math.floor(totalFromLevelStart / xpPerLevel);
  const cappedStrength = Math.min(currentStrength + additionalLevels, maxStrength);
  const levelsGained = cappedStrength - currentStrength;
  const reachesMax = cappedStrength >= maxStrength;

  const xpIntoLevel = reachesMax ? xpPerLevel : totalFromLevelStart % xpPerLevel;
  const pctOfLevel = reachesMax ? 100 : (xpIntoLevel / xpPerLevel) * 100;

  return {
    newXp: currentXp + XP_POTION_AMOUNT,
    newStrength: cappedStrength,
    levelsGained,
    reachesMax,
    xpIntoLevel,
    pctOfLevel,
  };
}

/**
 * Send the XPPotion room action for a given pet slot ID.
 *
 * The server requires the player to be on the same tile as the pet.
 * This function automatically ghost-steps (sends a temporary PlayerPosition
 * to the pet's tile, fires XPPotion, then moves back) so the user doesn't
 * have to walk there manually. If positions can't be resolved, it sends
 * the action directly (the server will reject if not on the same tile).
 */
export async function sendUseXpPotion(petSlotId: string): Promise<WebSocketSendResult> {
  const step = await ghostStepToPet(petSlotId);

  const result = sendRoomAction('XPPotion', { petItemId: petSlotId }, { throttleMs: 200 });

  if (step) {
    step.stepBack();
  }

  return result;
}
