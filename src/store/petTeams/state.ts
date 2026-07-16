import { storage, getStorageRuntime, registerDynamicKey } from '../../utils/storage';
import { dispatchCustomEventAll } from '../../core/pageContext';
import { getPlayerId } from '../../core/playerContext';
import type { PetTeamsConfig, PetFeedPolicy } from '../../types/petTeams';
import { createStoreDiagnostics } from '../_storeDiagnostics';

export const diag = createStoreDiagnostics('storePetTeams', 'petTeams');

export const CONFIG_KEY = 'qpm.petTeams.config.v1';
export const FEED_POLICY_KEY = 'qpm.petTeams.feedPolicy.v1';
export const PET_FEED_POLICY_CHANGED_EVENT = 'qpm:pet-feed-policy-changed';

/** Create a fresh mutable default config — always returns a new object. */
export function createDefaultConfig(): PetTeamsConfig {
  return { teams: [], keybinds: {}, activeTeamId: null, lastAppliedAt: 0 };
}

/** Create a fresh mutable default feed policy — always returns a new object. */
export function createDefaultFeedPolicy(): PetFeedPolicy {
  return { petItemOverrides: {}, updatedAt: 0 };
}

export const store = {
  config: createDefaultConfig(),
  feedPolicy: createDefaultFeedPolicy(),
  configListeners: new Set<(cfg: PetTeamsConfig) => void>(),
  resolvedConfigKey: CONFIG_KEY,
  resolvedFeedKey: FEED_POLICY_KEY,
  initPlayerId: null as string | null,
  activePetsUnsubscribe: null as (() => void) | null,
  purgeUnsubscribe: null as (() => void) | null,
  purgeInvUnsubscribe: null as (() => void) | null,
  purgeTimer: null as ReturnType<typeof setTimeout> | null,
  /** True once getAllPooledPetsWithStatus has returned hutch data at least once. */
  hutchEverLoaded: false,
  /** True while applyTeam is executing — prevents purge from corrupting slots. */
  applyInProgress: false,
  /** True after resolvePlayerKeyAndMigrate settles — prevents purge during init race. */
  purgeReady: false,
};

export function saveConfig(): void {
  diag.log.debug(`save key=${store.resolvedConfigKey} teams=${store.config.teams.length} slots=${countFilledSlots(store.config)} runtime=${getStorageRuntime()}`);
  storage.set(store.resolvedConfigKey, store.config);
  // Mirror to unscoped key so a fresh install can load teams before resolvePlayerKeyAndMigrate resolves the player ID.
  if (store.resolvedConfigKey !== CONFIG_KEY) {
    storage.set(CONFIG_KEY, store.config);
  }
  const readback = storage.get<PetTeamsConfig | null>(store.resolvedConfigKey, null);
  if (!readback || readback.teams.length !== store.config.teams.length) {
    diag.warn('QPM-STORE-004', {
      what: 'config',
      key: store.resolvedConfigKey,
      wrote: store.config.teams.length,
      readBack: readback?.teams.length ?? null,
    });
  }
  notifyConfigListeners();
}

export function saveFeedPolicy(): void {
  store.feedPolicy.updatedAt = Date.now();
  storage.set(store.resolvedFeedKey, store.feedPolicy);
  if (store.resolvedFeedKey !== FEED_POLICY_KEY) {
    storage.set(FEED_POLICY_KEY, store.feedPolicy);
  }
  dispatchCustomEventAll(PET_FEED_POLICY_CHANGED_EVENT, {
    updatedAt: store.feedPolicy.updatedAt,
  });
}

export function notifyConfigListeners(): void {
  // Inline snapshot avoids a circular dependency with config.ts's getTeamsConfig.
  const snapshot: PetTeamsConfig = {
    ...store.config,
    teams: store.config.teams.map(t => ({ ...t, slots: [...t.slots] as [string | null, string | null, string | null] })),
    keybinds: { ...store.config.keybinds },
  };
  for (const listener of store.configListeners) {
    try { listener(snapshot); } catch (error) { diag.warn('QPM-STORE-003', { phase: 'notifyConfigListeners' }, error); }
  }
}

export async function resolveCurrentPlayerId(): Promise<string | null> {
  return getPlayerId();
}

/** Count non-null slot entries across all teams — used to compare configs. */
export function countFilledSlots(config: PetTeamsConfig): number {
  let count = 0;
  for (const team of config.teams) {
    if (!Array.isArray(team.slots)) continue;
    for (const slot of team.slots) {
      if (slot) count++;
    }
  }
  return count;
}

export async function resolvePlayerKeyAndMigrate(): Promise<void> {
  const playerId = await resolveCurrentPlayerId();
  if (!playerId) {
    diag.log.debug('player id unavailable — using unscoped storage key');
    return;
  }
  store.initPlayerId = playerId;
  const scopedConfigKey = `${CONFIG_KEY}.${playerId}`;
  const scopedFeedKey = `${FEED_POLICY_KEY}.${playerId}`;

  const existingScoped = storage.get<PetTeamsConfig | null>(scopedConfigKey, null);
  if (existingScoped === null) {
    if (store.config.teams.length > 0) {
      storage.set(scopedConfigKey, store.config);
      diag.log.debug(`migrated ${store.config.teams.length} team(s) to player-scoped key`);
    }
  } else {
    // Reconcile with unscoped config — more filled slots there means it was updated while the player ID was unavailable.
    const unscopedSlots = countFilledSlots(store.config);
    const scopedSlots = countFilledSlots(existingScoped);

    if (unscopedSlots > scopedSlots) {
      diag.log.debug(`unscoped config has more data (${unscopedSlots} vs ${scopedSlots} filled slots) — keeping unscoped`);
      storage.set(scopedConfigKey, store.config);
    } else {
      store.config = existingScoped;
      notifyConfigListeners();
      diag.log.debug(`loaded player-scoped config (${store.config.teams.length} team(s), ${scopedSlots} filled slots)`);
    }
  }

  const existingScopedFeed = storage.get<PetFeedPolicy | null>(scopedFeedKey, null);
  if (existingScopedFeed === null && store.feedPolicy.updatedAt > 0) {
    storage.set(scopedFeedKey, store.feedPolicy);
  } else if (existingScopedFeed !== null) {
    store.feedPolicy = existingScopedFeed;
  }

  store.resolvedConfigKey = scopedConfigKey;
  store.resolvedFeedKey = scopedFeedKey;

  registerDynamicKey(scopedConfigKey);
  registerDynamicKey(scopedFeedKey);
}
