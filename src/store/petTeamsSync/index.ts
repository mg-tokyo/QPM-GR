import { onTeamsChange, getTeamsConfig } from '../petTeams/config';
import {
  store,
  diag,
  loadInitial,
  saveEnabled,
  resolvePlayerScopedKeys,
  notifyChangeListeners,
} from './state';
import { readMyOptimisticPetTeams, subscribeToNativeTeams } from './nativeReader';
import { onNativeChange, reconcileOnEnable, reconcile } from './reconcile';
import { detectActiveNativeTeamId } from './detectActive';
import type { NativePetTeam, SyncStateChangeEvent } from './types';

const RECONCILE_DEBOUNCE_MS = 300;

let latestNativeTeams: NativePetTeam[] = [];

function scheduleReconcile(source: 'qpm' | 'native'): void {
  if (store.reconcileTimer) clearTimeout(store.reconcileTimer);
  store.reconcileTimer = setTimeout(() => {
    store.reconcileTimer = null;
    void onNativeChange(latestNativeTeams).catch((error) => {
      diag.warn('QPM-STORE-005', { phase: 'reconcile', source }, error);
    });
  }, RECONCILE_DEBOUNCE_MS);
}

function startNativeSubscription(): void {
  if (store.nativeTeamsUnsub) return;
  try {
    store.nativeTeamsUnsub = subscribeToNativeTeams((teams) => {
      latestNativeTeams = teams;
      scheduleReconcile('native');
    });
  } catch (error) {
    diag.warn('QPM-STORE-005', { phase: 'subscribeNative' }, error);
  }
}

function stopNativeSubscription(): void {
  store.nativeTeamsUnsub?.();
  store.nativeTeamsUnsub = null;
}

export async function initPetTeamsSync(): Promise<void> {
  diag.register('loading sync config');
  loadInitial();

  store.qpmConfigUnsub = onTeamsChange(() => {
    if (!store.enabled) {
      for (const team of getTeamsConfig().teams) {
        if (store.idMap[team.id]) store.dirtyWhileDisabled.add(team.id);
      }
      return;
    }
    scheduleReconcile('qpm');
  });

  await resolvePlayerScopedKeys().catch((error) => {
    diag.warn('QPM-STORE-001', { phase: 'resolvePlayerScopedKeys' }, error);
  });
  loadInitial();

  if (store.enabled) {
    startNativeSubscription();
    latestNativeTeams = await readMyOptimisticPetTeams();
    await reconcileOnEnable(latestNativeTeams).catch((error) => {
      diag.warn('QPM-STORE-005', { phase: 'initialReconcile' }, error);
    });
  } else {
    latestNativeTeams = await readMyOptimisticPetTeams();
  }

  diag.publishOk(
    store.enabled ? `sync on (${latestNativeTeams.length} native)` : 'sync off',
    { enabled: store.enabled ? 1 : 0, native: latestNativeTeams.length, mapped: Object.keys(store.idMap).length },
  );
}

export function stopPetTeamsSync(): void {
  if (store.reconcileTimer) { clearTimeout(store.reconcileTimer); store.reconcileTimer = null; }
  stopNativeSubscription();
  store.qpmConfigUnsub?.();
  store.qpmConfigUnsub = null;
  store.changeListeners.clear();
  store.pendingCreates = [];
  store.expectingEchoFor.clear();
  store.dirtyWhileDisabled.clear();
  store.cooldownUntil.clear();
}

export async function setSyncEnabled(next: boolean): Promise<void> {
  if (store.enabled === next) return;
  store.enabled = next;
  saveEnabled();

  if (next) {
    startNativeSubscription();
    latestNativeTeams = await readMyOptimisticPetTeams();
    await reconcileOnEnable(latestNativeTeams).catch((error) => {
      diag.warn('QPM-STORE-005', { phase: 'reconcileOnEnable' }, error);
    });
  } else {
    stopNativeSubscription();
    notifyChangeListeners({
      enabled: false,
      mirroredCount: Object.keys(store.idMap).length,
      nativeCount: latestNativeTeams.length,
      effectiveCap: 0,
    });
  }
}

export function isSyncEnabled(): boolean {
  return store.enabled;
}

export function getSyncState(): { enabled: boolean; idMap: Readonly<Record<string, string>> } {
  return { enabled: store.enabled, idMap: { ...store.idMap } };
}

export function isNativeTeamMirrored(nativeId: string): boolean {
  for (const nid of Object.values(store.idMap)) if (nid === nativeId) return true;
  return false;
}

export function isQpmTeamMirrored(qpmId: string): boolean {
  return Boolean(store.idMap[qpmId]);
}

/**
 * True if the given `teamId` is a native-owned team (visible in QPM UI as
 * read-only). Callers pass the id shown in QPM's list — for native-owned
 * teams that's the nativeId directly (they don't have QPM ids).
 */
export function isTeamNativeOwned(id: string): boolean {
  if (!latestNativeTeams.some((t) => t.id === id)) return false;
  return !isNativeTeamMirrored(id);
}

export function getNativeTeams(): NativePetTeam[] {
  return latestNativeTeams;
}

export function getNativeTeamById(nativeId: string): NativePetTeam | null {
  return latestNativeTeams.find((t) => t.id === nativeId) ?? null;
}

export function getActiveNativeTeamId(): string | null {
  return detectActiveNativeTeamId(latestNativeTeams);
}

export function onSyncStateChange(cb: (evt: SyncStateChangeEvent) => void): () => void {
  store.changeListeners.add(cb);
  return () => store.changeListeners.delete(cb);
}

export async function forceReconcile(): Promise<void> {
  latestNativeTeams = await readMyOptimisticPetTeams();
  await reconcile(latestNativeTeams);
}

export { nativeTeamToDisplayPetTeam } from './adapter';
export type { NativePetTeam, NativePetTeamMember, NativePetTeamEmblem, SyncStateChangeEvent } from './types';
