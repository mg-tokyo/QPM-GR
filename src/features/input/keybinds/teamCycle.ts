// Next / Previous team (INP-1 D2): steps through the saved team order, wrapping, skipping teams with no pets.

import { detectCurrentTeam, getTeamsConfig } from '../../../store/petTeams';
import { applyTeamWithToasts, getPendingKeyApplyTeamId } from '../../../ui/pets/petsWindow/teamApplyToast';
import type { PetTeam } from '../../../types/petTeams';
import type { RunnableAction } from './types';

type CycleTeam = Pick<PetTeam, 'id' | 'name' | 'slots'>;

const hasPets = (team: CycleTeam): boolean => team.slots.some(slot => slot !== null);

/** No current team (or one no longer saved): Next takes the first team, Previous the last. */
export function pickCycleTeam<T extends CycleTeam>(teams: readonly T[], currentId: string | null, dir: 1 | -1): T | null {
  const n = teams.length;
  const start = currentId === null ? -1 : teams.findIndex(team => team.id === currentId);
  const from = start >= 0 ? start : dir === 1 ? -1 : n;
  for (let step = 1; step <= n; step++) {
    const team = teams[(((from + dir * step) % n) + n) % n];
    if (team && hasPets(team)) return team;
  }
  return null;
}

async function cycleTeam(dir: 1 | -1): Promise<void> {
  const config = getTeamsConfig();
  const current = getPendingKeyApplyTeamId() ?? detectCurrentTeam() ?? config.activeTeamId;
  const team = pickCycleTeam(config.teams, current, dir);
  if (team) await applyTeamWithToasts(team);
}

export function buildTeamCycleActions(): RunnableAction[] {
  return [
    { id: 'teamNext', section: 'pets', run: () => cycleTeam(1) },
    { id: 'teamPrev', section: 'pets', run: () => cycleTeam(-1) },
  ];
}
