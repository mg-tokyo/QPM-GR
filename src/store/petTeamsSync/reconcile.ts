import {
  getTeamsConfig,
  deleteTeam as deleteQpmTeam,
  mirrorTeamFromNative,
} from '../petTeams/config';
import type { PetTeam as QpmTeam } from '../../types/petTeams';
import { store, saveIdMap, notifyChangeListeners } from './state';
import { diag } from './state';
import {
  buildSpec,
  pushCreate,
  pushUpdate,
  pushDelete,
  matchPendingCreate,
  PET_TEAMS_LIMIT,
} from './pushToNative';
import type { NativePetTeam } from './types';

interface SyncSnapshot {
  name: string;
  petIdsSorted: string[];
}

const lastSyncedState = new Map<string, SyncSnapshot>();

function snapshotFromQpm(team: QpmTeam): SyncSnapshot {
  const petIds = team.slots.filter((s): s is string => typeof s === 'string' && s.length > 0);
  return { name: team.name.trim(), petIdsSorted: [...petIds].sort() };
}

function snapshotFromNative(team: NativePetTeam): SyncSnapshot {
  return {
    name: team.name.trim(),
    petIdsSorted: [...team.members.map((m) => m.petId)].sort(),
  };
}

function snapshotsEqual(a: SyncSnapshot, b: SyncSnapshot): boolean {
  if (a.name !== b.name) return false;
  if (a.petIdsSorted.length !== b.petIdsSorted.length) return false;
  return a.petIdsSorted.every((id, i) => id === b.petIdsSorted[i]);
}

function computeEffectiveCap(nativeTeams: NativePetTeam[]): number {
  const mappedNative = new Set(Object.values(store.idMap));
  const untracked = nativeTeams.filter((t) => !mappedNative.has(t.id)).length;
  return Math.max(0, PET_TEAMS_LIMIT - untracked);
}

function emitStateChange(nativeTeams: NativePetTeam[]): void {
  const mappedNative = new Set(Object.values(store.idMap));
  const mirroredCount = nativeTeams.filter((t) => mappedNative.has(t.id)).length;
  notifyChangeListeners({
    enabled: store.enabled,
    mirroredCount,
    nativeCount: nativeTeams.length,
    effectiveCap: computeEffectiveCap(nativeTeams),
  });
}

export async function reconcile(nativeTeams: NativePetTeam[]): Promise<void> {
  if (!store.enabled) return;

  const qpmTeams = getTeamsConfig().teams;
  const nativeById = new Map(nativeTeams.map((t) => [t.id, t]));
  const qpmById = new Map(qpmTeams.map((t) => [t.id, t]));

  const mappedNativeIds = new Set(Object.values(store.idMap));
  for (const nativeTeam of nativeTeams) {
    matchPendingCreate(nativeTeam, mappedNativeIds);
  }
  mappedNativeIds.clear();
  for (const nid of Object.values(store.idMap)) mappedNativeIds.add(nid);

  const effectiveCap = computeEffectiveCap(nativeTeams);
  const mappedCount = Array.from(Object.values(store.idMap)).filter((nid) => nativeById.has(nid)).length;
  let slotsAvailable = Math.max(0, effectiveCap - mappedCount);

  for (const qpm of qpmTeams) {
    const nativeId = store.idMap[qpm.id];
    const qpmSnap = snapshotFromQpm(qpm);

    if (!nativeId) {
      const spec = buildSpec(qpm.id, qpm.name, qpm.slots);
      if (!spec) continue;
      if (slotsAvailable <= 0) {
        diag.log.debug(`skip create — cap reached (qpmId=${qpm.id})`);
        continue;
      }
      const ok = await pushCreate(spec);
      if (ok) slotsAvailable--;
      continue;
    }

    const nativeTeam = nativeById.get(nativeId);
    if (!nativeTeam) {
      if (store.expectingEchoFor.has(nativeId)) {
        delete store.idMap[qpm.id];
        lastSyncedState.delete(qpm.id);
        saveIdMap();
        continue;
      }
      deleteQpmTeam(qpm.id);
      delete store.idMap[qpm.id];
      lastSyncedState.delete(qpm.id);
      saveIdMap();
      continue;
    }

    const nativeSnap = snapshotFromNative(nativeTeam);
    const lastSynced = lastSyncedState.get(qpm.id) ?? null;

    if (snapshotsEqual(qpmSnap, nativeSnap)) {
      lastSyncedState.set(qpm.id, qpmSnap);
      continue;
    }

    const qpmEdited = !lastSynced || !snapshotsEqual(qpmSnap, lastSynced);
    const nativeEdited = !lastSynced || !snapshotsEqual(nativeSnap, lastSynced);

    if (qpmEdited && !nativeEdited) {
      const spec = buildSpec(qpm.id, qpm.name, qpm.slots);
      if (!spec) {
        pushDelete(nativeId);
        deleteQpmTeam(qpm.id);
        delete store.idMap[qpm.id];
        lastSyncedState.delete(qpm.id);
        saveIdMap();
        continue;
      }
      pushUpdate(nativeId, spec);
      lastSyncedState.set(qpm.id, qpmSnap);
      continue;
    }

    if (store.expectingEchoFor.has(nativeId)) {
      lastSyncedState.set(qpm.id, nativeSnap);
      continue;
    }
    mirrorTeamFromNative(qpm.id, nativeTeam.name, nativeTeam.members.map((m) => m.petId));
    lastSyncedState.set(qpm.id, nativeSnap);
  }

  let idMapChanged = false;
  for (const qpmId of Object.keys(store.idMap)) {
    if (qpmById.has(qpmId)) continue;
    const nativeId = store.idMap[qpmId];
    if (!nativeId) continue;
    if (nativeById.has(nativeId) && !store.expectingEchoFor.has(nativeId)) {
      pushDelete(nativeId);
    }
    delete store.idMap[qpmId];
    lastSyncedState.delete(qpmId);
    idMapChanged = true;
  }
  if (idMapChanged) saveIdMap();

  store.expectingEchoFor.clear();

  emitStateChange(nativeTeams);
}

export async function reconcileOnEnable(nativeTeams: NativePetTeam[]): Promise<void> {
  store.dirtyWhileDisabled.clear();
  await reconcile(nativeTeams);
}

export async function onNativeChange(nativeTeams: NativePetTeam[]): Promise<void> {
  if (!store.enabled) {
    emitStateChange(nativeTeams);
    return;
  }
  await reconcile(nativeTeams);
}
