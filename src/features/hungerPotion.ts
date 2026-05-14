// src/features/hungerPotion.ts — Hunger (Replenish) Potion feature

import { sendRoomAction, type WebSocketSendResult } from '../websocket/api';
import { ghostStepToPet } from '../utils/ghostStep';
import { getToolCount, onToolCountChange } from '../utils/toolInventory';
import type { FoodSelection } from './petFoodRules';

/** The game's internal tool ID for the hunger potion. */
export const HUNGER_POTION_TOOL_ID = 'ReplenishPotion';

/** Normalized key used in the diet system. */
export const HUNGER_POTION_KEY = 'replenishpotion';

/** Display label for the hunger potion. */
export const HUNGER_POTION_LABEL = 'Replenish Potion';

/**
 * Get the current number of Replenish Potions in the player's inventory.
 */
export function getHungerPotionCount(): number {
  return getToolCount(HUNGER_POTION_TOOL_ID);
}

/**
 * Subscribe to hunger potion count changes.
 * Calls `cb` only when the count actually differs. Returns an unsubscribe function.
 */
export function onHungerPotionCountChange(cb: (count: number) => void): () => void {
  return onToolCountChange(HUNGER_POTION_TOOL_ID, cb);
}

/**
 * Check whether a FoodSelection represents a hunger potion.
 */
export function isHungerPotionSelection(selection: FoodSelection | null | undefined): boolean {
  if (!selection) return false;
  const species = selection.item.species;
  return species === HUNGER_POTION_KEY || species === HUNGER_POTION_TOOL_ID;
}

/**
 * Send the ReplenishPotion room action for a given pet slot ID.
 *
 * Like XP potions, the server requires the player to be on the same tile
 * as the pet. This function ghost-steps to the pet tile, sends the action,
 * then steps back.
 */
export async function sendUseHungerPotion(petSlotId: string): Promise<WebSocketSendResult> {
  const step = await ghostStepToPet(petSlotId);

  const result = sendRoomAction('ReplenishPotion', { petItemId: petSlotId }, { throttleMs: 200 });

  if (step) {
    step.stepBack();
  }

  // Dispatch event so UI can react
  try {
    window.dispatchEvent(new CustomEvent('qpm:hungerPotion', {
      detail: { petItemId: petSlotId, ok: result.ok },
    }));
  } catch {
    // no-op
  }

  return result;
}
