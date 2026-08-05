import { getActivePetInfos } from '../pets';
import type { NativePetTeam } from './types';

/**
 * Returns the native team id whose members exactly match the current active
 * pet slot ids as a set. Mirrors QPM's own detectCurrentTeam rule
 * (src/store/petTeams/config.ts:293-306).
 */
export function detectActiveNativeTeamId(nativeTeams: NativePetTeam[]): string | null {
  const activeIds = new Set(
    getActivePetInfos().map((p) => p.slotId).filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  if (activeIds.size === 0) return null;

  for (const team of nativeTeams) {
    if (team.members.length === 0) continue;
    const memberIds = new Set(team.members.map((m) => m.petId));
    if (memberIds.size !== team.members.length) continue;
    if (memberIds.size === activeIds.size && [...memberIds].every((id) => activeIds.has(id))) {
      return team.id;
    }
  }
  return null;
}
