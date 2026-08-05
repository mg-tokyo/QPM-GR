import { storage, registerDynamicKey } from '../../utils/storage';
import { getPlayerId } from '../../core/playerContext';
import { createStoreDiagnostics } from '../_storeDiagnostics';
import type { IdMap, SyncStateChangeEvent, PendingCreate } from './types';

export const diag = createStoreDiagnostics('storePetTeamsSync', 'petTeamsSync');

export const ENABLED_KEY = 'qpm.petTeams.sync.enabled.v1';
export const ID_MAP_KEY = 'qpm.petTeams.sync.idMap.v1';

interface RuntimeState {
  enabled: boolean;
  idMap: IdMap;
  /** qpmTeamIds edited by user while sync was disabled — pushed on re-enable. */
  dirtyWhileDisabled: Set<string>;
  /** Optimistic-create tracking: match server-assigned id to our qpmTeamId. */
  pendingCreates: PendingCreate[];
  /** nativeIds we just wrote — mirror handler suppresses one echo per id. */
  expectingEchoFor: Set<string>;
  /** qpmTeamId → wall-clock ms after which we may push another op for this team. */
  cooldownUntil: Map<string, number>;
  resolvedEnabledKey: string;
  resolvedIdMapKey: string;
  initPlayerId: string | null;
  changeListeners: Set<(evt: SyncStateChangeEvent) => void>;
  nativeTeamsUnsub: (() => void) | null;
  qpmConfigUnsub: (() => void) | null;
  reconcileTimer: ReturnType<typeof setTimeout> | null;
}

export const store: RuntimeState = {
  enabled: false,
  idMap: {},
  dirtyWhileDisabled: new Set(),
  pendingCreates: [],
  expectingEchoFor: new Set(),
  cooldownUntil: new Map(),
  resolvedEnabledKey: ENABLED_KEY,
  resolvedIdMapKey: ID_MAP_KEY,
  initPlayerId: null,
  changeListeners: new Set(),
  nativeTeamsUnsub: null,
  qpmConfigUnsub: null,
  reconcileTimer: null,
};

export function saveEnabled(): void {
  storage.set(store.resolvedEnabledKey, store.enabled);
  if (store.resolvedEnabledKey !== ENABLED_KEY) {
    storage.set(ENABLED_KEY, store.enabled);
  }
}

export function saveIdMap(): void {
  storage.set(store.resolvedIdMapKey, store.idMap);
  if (store.resolvedIdMapKey !== ID_MAP_KEY) {
    storage.set(ID_MAP_KEY, store.idMap);
  }
}

export function notifyChangeListeners(evt: SyncStateChangeEvent): void {
  for (const listener of store.changeListeners) {
    try { listener(evt); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'notifyChangeListeners' }, error); }
  }
}

export async function resolvePlayerScopedKeys(): Promise<void> {
  const playerId = await getPlayerId();
  if (!playerId) {
    diag.log.debug('player id unavailable — using unscoped sync keys');
    return;
  }
  store.initPlayerId = playerId;
  const scopedEnabled = `${ENABLED_KEY}.${playerId}`;
  const scopedIdMap = `${ID_MAP_KEY}.${playerId}`;

  const existingEnabled = storage.get<boolean | null>(scopedEnabled, null);
  const existingIdMap = storage.get<IdMap | null>(scopedIdMap, null);

  if (existingEnabled === null && store.enabled) {
    storage.set(scopedEnabled, store.enabled);
  } else if (existingEnabled !== null) {
    store.enabled = existingEnabled === true;
  }

  if (existingIdMap === null && Object.keys(store.idMap).length > 0) {
    storage.set(scopedIdMap, store.idMap);
  } else if (existingIdMap !== null && typeof existingIdMap === 'object') {
    store.idMap = existingIdMap;
  }

  store.resolvedEnabledKey = scopedEnabled;
  store.resolvedIdMapKey = scopedIdMap;
  registerDynamicKey(scopedEnabled);
  registerDynamicKey(scopedIdMap);
}

export function loadInitial(): void {
  const rawEnabled = storage.get<boolean | null>(store.resolvedEnabledKey, null);
  store.enabled = rawEnabled === true;

  const rawIdMap = storage.get<IdMap | null>(store.resolvedIdMapKey, null);
  if (rawIdMap && typeof rawIdMap === 'object' && !Array.isArray(rawIdMap)) {
    const cleaned: IdMap = {};
    for (const [qpmId, nativeId] of Object.entries(rawIdMap)) {
      if (typeof qpmId === 'string' && typeof nativeId === 'string' && qpmId.length > 0 && nativeId.length > 0) {
        cleaned[qpmId] = nativeId;
      }
    }
    store.idMap = cleaned;
  } else {
    store.idMap = {};
  }
}

const PENDING_TTL_MS = 30_000;

export function prunePendingCreates(now: number): void {
  store.pendingCreates = store.pendingCreates.filter((entry) => now - entry.sentAt < PENDING_TTL_MS);
}
