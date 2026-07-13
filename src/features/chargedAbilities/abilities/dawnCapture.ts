// Hedgehog/Ostrich DawnCapture: converts Dawn mutations to capsules. Reward per scraped-data/BetaGameSourceFiles/.../AbilityTooltipContent.ts:299-304.
// Catalog key for Dawnbound is 'Dawncharged' (mutationsDex.ts:52-57); slots may carry either lowercased alias.

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
