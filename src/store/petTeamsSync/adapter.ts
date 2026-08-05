import type { PetTeam as QpmPetTeam } from '../../types/petTeams';
import type { NativePetTeam } from './types';

/**
 * Adapt a native team into the QPM PetTeam shape so the existing teamList /
 * teamEditor renderers can display it without a parallel code path.
 * Uses the native team's id verbatim (nativeId is a string, same shape as QPM's).
 */
export function nativeTeamToDisplayPetTeam(native: NativePetTeam): QpmPetTeam {
  const slots: [string | null, string | null, string | null] = [
    native.members[0]?.petId ?? null,
    native.members[1]?.petId ?? null,
    native.members[2]?.petId ?? null,
  ];
  return {
    id: native.id,
    name: native.name,
    slots,
    createdAt: 0,
    updatedAt: 0,
  };
}
