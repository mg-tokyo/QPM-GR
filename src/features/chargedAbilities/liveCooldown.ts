import { getActivePetInfos } from '../../store/pets';

function readCooldownMs(container: unknown, abilityId: string): number | null {
  if (!container || typeof container !== 'object' || Array.isArray(container)) return null;
  const value = (container as Record<string, unknown>)[abilityId];
  return typeof value === 'number' ? Math.max(0, value) : null;
}

export function getAbilityCooldownRemainingMs(petSlotId: string, abilityId: string): number {
  for (const pet of getActivePetInfos()) {
    if (pet.slotId !== petSlotId) continue;
    const raw = pet.raw;
    if (!raw || typeof raw !== 'object') return 0;
    const rawRec = raw as Record<string, unknown>;
    const slot = rawRec.slot as Record<string, unknown> | undefined;
    const nested = slot && typeof slot === 'object' ? (slot.pet as Record<string, unknown> | undefined) : undefined;

    const candidates: unknown[] = [
      rawRec.abilityCooldowns,
      slot?.abilityCooldowns,
      nested?.abilityCooldowns,
    ];
    for (const candidate of candidates) {
      const remaining = readCooldownMs(candidate, abilityId);
      if (remaining != null) return remaining;
    }
    return 0;
  }
  return 0;
}
