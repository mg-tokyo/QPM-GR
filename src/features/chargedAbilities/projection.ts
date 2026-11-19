// Mirrors the canonical formula in src/features/economy/valueCalculator.ts:70-81:
//   baseSellPrice × scale × mutationMultiplier

import { computeMutationMultiplier } from '../../utils/game/cropMultipliers';
import { getCropStats } from '../garden/data/cropBaseStats';
import type { PlantSlotMinimal } from './abilities/types';

export function computeSlotSellValue(slot: PlantSlotMinimal): number {
  const stats = getCropStats(slot.species);
  if (!stats || stats.baseSellPrice <= 0) return 0;
  const { totalMultiplier } = computeMutationMultiplier(slot.mutations);
  return Math.round(stats.baseSellPrice * slot.targetScale * totalMultiplier);
}
