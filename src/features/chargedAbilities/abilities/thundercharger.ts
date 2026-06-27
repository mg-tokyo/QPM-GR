// src/features/chargedAbilities/abilities/thundercharger.ts
// Thunder Wolf — Thundercharger. Replaces Thunderstruck (5×) with Thundercharged (7×).

import type { AbilityProjection, PlantSlotMinimal } from './types';
import { computeSlotSellValue, valueIfMutationReplaced } from '../projection';
import { getCooldownRemainingMs as thunderCD } from '../../thunder/charger';
import { THUNDERCHARGER_COOLDOWN_MS } from '../../thunder/charger/constants';

const TARGET = 'thunderstruck';
const REPLACEMENT = 'Thundercharged';

export const thundercharger: AbilityProjection = {
  abilityId: 'Thundercharger',
  abilityName: 'Thundercharger',
  cooldownMs: THUNDERCHARGER_COOLDOWN_MS,
  targetMutations: ['Thunderstruck'],
  requiredSpecies: ['ThunderWolf'],
  replacementMutation: REPLACEMENT,
  yieldKind: 'coin',
  accentColor: 'var(--qpm-gold)',

  applies(slot: PlantSlotMinimal): boolean {
    return slot.mutations.some((m) => m.toLowerCase() === TARGET);
  },

  projectGain(slot: PlantSlotMinimal) {
    if (!this.applies(slot)) return { coin: 0, capsule: 0 };
    const before = computeSlotSellValue(slot);
    const after = valueIfMutationReplaced(slot, TARGET, REPLACEMENT);
    return { coin: Math.max(0, after - before), capsule: 0 };
  },

  getCooldownRemainingMs(petSlotId: string): number {
    return thunderCD(petSlotId);
  },
};
