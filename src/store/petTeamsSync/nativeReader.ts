import { select, selectSync, subscribe } from '../../core/stateTree';
import { getPlayerIdSync } from '../../core/playerContext';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';
import type { NativePetTeam, NativePetTeamMember, NativePetTeamEmblem } from './types';

function normalizeMember(raw: unknown): NativePetTeamMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const petId = typeof r.petId === 'string' ? r.petId : null;
  const petSpecies = typeof r.petSpecies === 'string' ? r.petSpecies : null;
  if (!petId || !petSpecies) return null;
  const name = typeof r.name === 'string' ? r.name : null;
  return { petId, petSpecies, name };
}

function normalizeEmblem(raw: unknown): NativePetTeamEmblem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'number' && typeof r.number === 'number') {
    return { type: 'number', number: r.number };
  }
  if (r.type === 'pet' && typeof r.petSpecies === 'string') {
    return { type: 'pet', petSpecies: r.petSpecies };
  }
  if (r.type === 'icon' && typeof r.icon === 'string') {
    return { type: 'icon', icon: r.icon };
  }
  return null;
}

function normalizeTeam(raw: unknown): NativePetTeam | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : null;
  const name = typeof r.name === 'string' ? r.name : null;
  if (!id || name === null) return null;
  if (!Array.isArray(r.members)) return null;
  const members: NativePetTeamMember[] = [];
  for (const m of r.members) {
    const nm = normalizeMember(m);
    if (nm) members.push(nm);
  }
  const emblem = normalizeEmblem(r.emblem) ?? { type: 'number' as const, number: 1 };
  return { id, name, members, emblem };
}

function normalizeTeamsArray(raw: unknown): NativePetTeam[] {
  if (!Array.isArray(raw)) return [];
  const out: NativePetTeam[] = [];
  for (const t of raw) {
    const norm = normalizeTeam(t);
    if (norm) out.push(norm);
  }
  return out;
}

/**
 * Selector — pull the current player's petTeams array out of the state tree.
 * Reads petTeams from `state.child.data.userSlots[N].data.petTeams` where N is
 * the slot whose playerId matches ours. Returns [] when the player slot isn't
 * populated yet (early boot).
 */
function selectMyPetTeams(state: QuinoaStateSnapshot): NativePetTeam[] {
  const myId = getPlayerIdSync();
  if (!myId) return [];
  const root = state as unknown as {
    child?: { data?: { userSlots?: Array<{ playerId?: string; data?: { petTeams?: unknown } }> } };
  };
  const slots = root.child?.data?.userSlots;
  if (!Array.isArray(slots)) return [];
  const mine = slots.find((s) => s && s.playerId === myId);
  return normalizeTeamsArray(mine?.data?.petTeams);
}

export async function readMyOptimisticPetTeams(): Promise<NativePetTeam[]> {
  return select(selectMyPetTeams) ?? selectSync(selectMyPetTeams) ?? [];
}

export function subscribeToNativeTeams(
  cb: (teams: NativePetTeam[]) => void,
): () => void {
  return subscribe<NativePetTeam[]>(
    selectMyPetTeams,
    (teams) => cb(teams ?? []),
    'petTeamsSync.myPetTeams',
    '/child/data/userSlots',
  );
}
