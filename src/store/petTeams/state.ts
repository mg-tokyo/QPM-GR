// src/store/petTeams/state.ts
// Shared mutable store, constants, defaults, persistence helpers, player identity.

import { storage, registerDynamicKey } from '../../utils/storage';
import { log } from '../../utils/logger';
import { dispatchCustomEventAll } from '../../core/pageContext';
import { getPlayerId } from '../../core/playerContext';
import type { PetTeamsConfig, PetFeedPolicy } from '../../types/petTeams';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONFIG_KEY = 'qpm.petTeams.config.v1';
export const FEED_POLICY_KEY = 'qpm.petTeams.feedPolicy.v1';
export const PET_FEED_POLICY_CHANGED_EVENT = 'qpm:pet-feed-policy-changed';

export const DEFAULT_CONFIG: PetTeamsConfig = Object.freeze({
  teams: [],
  keybinds: {},
  activeTeamId: null,
  lastAppliedAt: 0,
});

export const DEFAULT_FEED_POLICY: PetFeedPolicy = Object.freeze({
  petItemOverrides: {},
  updatedAt: 0,
});

// ---------------------------------------------------------------------------
// Shared mutable store
// ---------------------------------------------------------------------------

export const store = {
  config: { ...DEFAULT_CONFIG } as PetTeamsConfig,
  feedPolicy: { ...DEFAULT_FEED_POLICY } as PetFeedPolicy,
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

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export function saveConfig(): void {
  storage.set(store.resolvedConfigKey, store.config);
  notifyConfigListeners();
}

export function saveFeedPolicy(): void {
  store.feedPolicy.updatedAt = Date.now();
  storage.set(store.resolvedFeedKey, store.feedPolicy);
  dispatchCustomEventAll(PET_FEED_POLICY_CHANGED_EVENT, {
    updatedAt: store.feedPolicy.updatedAt,
  });
}

export function notifyConfigListeners(): void {
  // Inline snapshot to avoid circular dependency with config.ts getTeamsConfig
  const snapshot: PetTeamsConfig = {
    ...store.config,
    teams: store.config.teams.map(t => ({ ...t, slots: [...t.slots] as [string | null, string | null, string | null] })),
    keybinds: { ...store.config.keybinds },
  };
  for (const listener of store.configListeners) {
    try { listener(snapshot); } catch (error) { log('[petTeams] config listener threw', error); }
  }
}

// ---------------------------------------------------------------------------
// Player identity helpers (Fix B + C)
// ---------------------------------------------------------------------------

export async function resolveCurrentPlayerId(): Promise<string | null> {
  return getPlayerId();
}

export async function resolvePlayerKeyAndMigrate(): Promise<void> {
  const playerId = await resolveCurrentPlayerId();
  if (!playerId) {
    log('[PetTeams] Player ID unavailable — using unscoped storage key');
    return;
  }
  store.initPlayerId = playerId;
  const scopedConfigKey = `${CONFIG_KEY}.${playerId}`;
  const scopedFeedKey = `${FEED_POLICY_KEY}.${playerId}`;

  // Config migration: unscoped → scoped on first login under this version
  const existingScoped = storage.get<PetTeamsConfig | null>(scopedConfigKey, null);
  if (existingScoped === null) {
    if (store.config.teams.length > 0) {
      storage.set(scopedConfigKey, store.config);
      log(`[PetTeams] Migrated ${store.config.teams.length} team(s) to player-scoped key`);
    }
  } else {
    // Scoped key already has data for this player — load it and notify UI
    store.config = storage.get<PetTeamsConfig>(scopedConfigKey, DEFAULT_CONFIG);
    notifyConfigListeners();
    log(`[PetTeams] Loaded player-scoped config (${store.config.teams.length} team(s))`);
  }

  // Feed policy: same migration pattern
  const existingScopedFeed = storage.get<PetFeedPolicy | null>(scopedFeedKey, null);
  if (existingScopedFeed === null && store.feedPolicy.updatedAt > 0) {
    storage.set(scopedFeedKey, store.feedPolicy);
  } else if (existingScopedFeed !== null) {
    store.feedPolicy = storage.get<PetFeedPolicy>(scopedFeedKey, DEFAULT_FEED_POLICY);
  }

  // Activate scoped keys — all future saves use these
  store.resolvedConfigKey = scopedConfigKey;
  store.resolvedFeedKey = scopedFeedKey;

  // Register with storage export so backup/restore captures them
  registerDynamicKey(scopedConfigKey);
  registerDynamicKey(scopedFeedKey);
}
