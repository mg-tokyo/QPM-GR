import { sendRoomAction } from '../../websocket/api';
import { getAllPooledPets } from '../petTeams/pool';
import { store, saveIdMap, prunePendingCreates } from './state';
import { diag } from './state';
import type { NativePetTeam, PendingCreate } from './types';

export const PET_TEAMS_LIMIT = 25;
export const MAX_TEAM_SIZE = 3;
const COOLDOWN_MS = 15_000;

export interface TeamSyncSpec {
  qpmTeamId: string;
  name: string;
  petIds: string[];
}

function sortedCopy(ids: string[]): string[] {
  return [...ids].sort();
}

function inCooldown(qpmTeamId: string): boolean {
  const until = store.cooldownUntil.get(qpmTeamId);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    store.cooldownUntil.delete(qpmTeamId);
    return false;
  }
  return true;
}

function setCooldown(qpmTeamId: string): void {
  store.cooldownUntil.set(qpmTeamId, Date.now() + COOLDOWN_MS);
}

function hasPendingCreateFor(qpmTeamId: string): boolean {
  prunePendingCreates(Date.now());
  return store.pendingCreates.some((p) => p.qpmTeamId === qpmTeamId);
}

export function clearCooldown(qpmTeamId: string): void {
  store.cooldownUntil.delete(qpmTeamId);
}

export function buildSpec(qpmTeamId: string, name: string, slots: Array<string | null>): TeamSyncSpec | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const petIds: string[] = [];
  for (const s of slots) {
    if (typeof s === 'string' && s.length > 0 && !petIds.includes(s)) petIds.push(s);
    if (petIds.length >= MAX_TEAM_SIZE) break;
  }
  if (petIds.length === 0) return null;
  return { qpmTeamId, name: trimmed, petIds };
}

export async function filterOwnedPetIds(petIds: string[]): Promise<string[]> {
  const pool = await getAllPooledPets();
  const owned = new Set(pool.map((p) => p.id));
  return petIds.filter((id) => owned.has(id));
}

export async function pushCreate(spec: TeamSyncSpec): Promise<boolean> {
  if (hasPendingCreateFor(spec.qpmTeamId)) {
    return false;
  }
  if (inCooldown(spec.qpmTeamId)) {
    return false;
  }
  const ownedIds = await filterOwnedPetIds(spec.petIds);
  if (ownedIds.length === 0) {
    diag.log.debug(`pushCreate skipped — no owned pets for "${spec.name}"`);
    setCooldown(spec.qpmTeamId);
    return false;
  }
  const entry: PendingCreate = {
    qpmTeamId: spec.qpmTeamId,
    nameTrim: spec.name,
    petIdsSorted: sortedCopy(ownedIds),
    sentAt: Date.now(),
  };
  store.pendingCreates.push(entry);
  setCooldown(spec.qpmTeamId);
  const result = sendRoomAction('SavePetTeam', {
    teamId: null,
    name: spec.name,
    petIds: ownedIds,
  }, { skipThrottle: true });
  if (!result.ok) {
    store.pendingCreates = store.pendingCreates.filter((p) => p !== entry);
    diag.log.debug(`pushCreate send failed reason=${result.reason ?? 'unknown'} qpmId=${spec.qpmTeamId}`);
    return false;
  }
  prunePendingCreates(entry.sentAt);
  diag.log.debug(`pushCreate sent "${spec.name}" qpmId=${spec.qpmTeamId} petCount=${ownedIds.length}`);
  return true;
}

export function pushUpdate(nativeId: string, spec: TeamSyncSpec): boolean {
  if (inCooldown(spec.qpmTeamId)) return false;
  setCooldown(spec.qpmTeamId);
  const result = sendRoomAction('SavePetTeam', {
    teamId: nativeId,
    name: spec.name,
    petIds: spec.petIds,
  }, { skipThrottle: true });
  if (!result.ok) {
    diag.log.debug(`pushUpdate send failed reason=${result.reason ?? 'unknown'} nativeId=${nativeId}`);
    return false;
  }
  store.expectingEchoFor.add(nativeId);
  diag.log.debug(`pushUpdate sent nativeId=${nativeId} name="${spec.name}" petCount=${spec.petIds.length}`);
  return true;
}

export function pushDelete(nativeId: string): boolean {
  const result = sendRoomAction('DeletePetTeam', { teamId: nativeId }, { skipThrottle: true });
  if (!result.ok) {
    diag.log.debug(`pushDelete send failed reason=${result.reason ?? 'unknown'} nativeId=${nativeId}`);
    return false;
  }
  store.expectingEchoFor.add(nativeId);
  diag.log.debug(`pushDelete sent nativeId=${nativeId}`);
  return true;
}

export function pushReorder(nativeId: string, toNativeIndex: number): boolean {
  const result = sendRoomAction('MovePetTeam', {
    movePetTeamId: nativeId,
    toPetTeamIndex: toNativeIndex,
  }, { skipThrottle: true });
  if (!result.ok) {
    diag.log.debug(`pushReorder send failed reason=${result.reason ?? 'unknown'} nativeId=${nativeId}`);
    return false;
  }
  store.expectingEchoFor.add(nativeId);
  diag.log.debug(`pushReorder sent nativeId=${nativeId} toIndex=${toNativeIndex}`);
  return true;
}

/**
 * Try to match a pending optimistic create against a native team that
 * appeared in the atom. Match on trimmed name + sorted petIds set.
 */
export function matchPendingCreate(nativeTeam: NativePetTeam, existingMappedNativeIds: Set<string>): string | null {
  if (existingMappedNativeIds.has(nativeTeam.id)) return null;
  const nativeName = nativeTeam.name.trim();
  const nativeSortedIds = sortedCopy(nativeTeam.members.map((m) => m.petId));
  const now = Date.now();
  prunePendingCreates(now);
  for (let i = 0; i < store.pendingCreates.length; i++) {
    const p = store.pendingCreates[i]!;
    if (p.nameTrim !== nativeName) continue;
    if (p.petIdsSorted.length !== nativeSortedIds.length) continue;
    if (!p.petIdsSorted.every((id, idx) => id === nativeSortedIds[idx])) continue;
    store.pendingCreates.splice(i, 1);
    store.idMap[p.qpmTeamId] = nativeTeam.id;
    clearCooldown(p.qpmTeamId);
    saveIdMap();
    diag.log.debug(`matched pending create qpmId=${p.qpmTeamId} → nativeId=${nativeTeam.id}`);
    return p.qpmTeamId;
  }
  return null;
}
