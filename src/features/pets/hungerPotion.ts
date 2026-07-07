import { sendRoomAction, type WebSocketSendResult } from '../../websocket/api';
import { ghostStepToPet } from '../../utils/ghostStep';
import { getToolCount, onToolCountChange } from '../../utils/toolInventory';
import type { FoodSelection } from './foodRules';

/** The game's internal tool ID for the hunger potion. */
export const HUNGER_POTION_TOOL_ID = 'ReplenishPotion';

/** Normalized key used in the diet system. */
export const HUNGER_POTION_KEY = 'replenishpotion';

/** Display label for the hunger potion. */
export const HUNGER_POTION_LABEL = 'Replenish Potion';

export function getHungerPotionCount(): number {
  return getToolCount(HUNGER_POTION_TOOL_ID);
}

/** Calls `cb` only when the count actually differs. */
export function onHungerPotionCountChange(cb: (count: number) => void): () => void {
  return onToolCountChange(HUNGER_POTION_TOOL_ID, cb);
}

export function isHungerPotionSelection(selection: FoodSelection | null | undefined): boolean {
  if (!selection) return false;
  const species = selection.item.species;
  return species === HUNGER_POTION_KEY || species === HUNGER_POTION_TOOL_ID;
}

/** Server requires same-tile presence, like XP potions — ghost-steps to the pet, sends, then steps back. */
export async function sendUseHungerPotion(petSlotId: string): Promise<WebSocketSendResult> {
  const step = await ghostStepToPet(petSlotId);

  const result = sendRoomAction('ReplenishPotion', { petItemId: petSlotId }, { throttleMs: 200 });

  if (step) {
    step.stepBack();
  }

  try {
    window.dispatchEvent(new CustomEvent('qpm:hungerPotion', {
      detail: { petItemId: petSlotId, ok: result.ok },
    }));
  } catch {
    // no-op
  }

  return result;
}
