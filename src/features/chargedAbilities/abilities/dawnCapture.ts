// src/features/chargedAbilities/abilities/dawnCapture.ts
// Hedgehog / Ostrich — DawnCapture. Removes Dawn mutations from nearby crops
// and converts them into Dawn Capsules.
//
// Per-mutation capsule reward (confirmed beta source
// AbilityTooltipContent.ts:299-304):
//   Dawnlit     → 1 capsule
//   Dawncharged → 2 capsules  (display name "Dawnbound")
//
// Catalog key for Dawnbound is 'Dawncharged' (see mutationsDex.ts:52-57);
// 'dawnbound' is the lowercase display name. Slots may carry either form in
// `mutations`, so both lowercased aliases map to the 2-capsule payout.

import type { AbilityProjection, PlantSlotMinimal } from './types';
import { getCooldownRemainingMs as dawnCD } from '../../dawn/capture';

const CAPSULE_REWARD: Record<string, number> = {
  dawnlit: 1,
  dawnbound: 2,
  dawncharged: 2,
};
const DAWN_CAPTURE_COOLDOWN_MS = 300_000;

export const dawnCapture: AbilityProjection = {
  abilityId: 'DawnCapture',
  abilityName: 'DawnCapture',
  cooldownMs: DAWN_CAPTURE_COOLDOWN_MS,
  targetMutations: ['Dawnlit', 'Dawnbound'],
  requiredSpecies: ['Ostrich', 'Hedgehog'],
  replacementMutation: null,
  yieldKind: 'capsule',
  accentColor: 'var(--qpm-dawn)',

  applies(slot: PlantSlotMinimal): boolean {
    return slot.mutations.some((m) => CAPSULE_REWARD[m.toLowerCase()] != null);
  },

  projectGain(slot: PlantSlotMinimal) {
    let capsule = 0;
    for (const m of slot.mutations) {
      capsule += CAPSULE_REWARD[m.toLowerCase()] ?? 0;
    }
    return { coin: 0, capsule };
  },

  getCooldownRemainingMs(petSlotId: string): number {
    return dawnCD(petSlotId);
  },
};
