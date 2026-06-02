// src/store/petTeams/state.ts
// Shared mutable store, constants, defaults, persistence helpers, player identity.

import { storage, getStorageRuntime, registerDynamicKey } from '../../utils/storage';
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

/** Create a fresh mutable default config — always returns a new object. */
export function createDefaultConfig(): PetTeamsConfig {
  return { teams: [], keybinds: {}, activeTeamId: null, lastAppliedAt: 0 };
}

/** Create a fresh mutable default feed policy — always returns a new object. */
export function createDefaultFeedPolicy(): PetFeedPolicy {
  return { petItemOverrides: {}, updatedAt: 0 };
}

// ---------------------------------------------------------------------------
// Shared mutable store
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export function saveConfig(): void {
  log(`[PetTeams:Save] key=${store.resolvedConfigKey} teams=${store.config.teams.length} slots=${countFilledSlots(store.config)} runtime=${getStorageRuntime()}`);
  storage.set(store.resolvedConfigKey, store.config);
  // Mirror to unscoped key so initPetTeamsStore can load teams before
  // resolvePlayerKeyAndMigrate completes (which requires async player ID).
  // Without this, a fresh install under the Mod Manager starts with an empty
  // unscoped key and loses data if the player atom isn't ready yet.
  if (store.resolvedConfigKey !== CONFIG_KEY) {
    storage.set(CONFIG_KEY, store.config);
  }
  // Verify write round-trips — read back immediately and compare
  const readback = storage.get<PetTeamsConfig | null>(store.resolvedConfigKey, null);
  if (!readback || readback.teams.length !== store.config.teams.length) {
    log(`[PetTeams:Save] !! READBACK MISMATCH: wrote ${store.config.teams.length} teams, read back ${readback?.teams.length ?? 'null'}`);
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

/** Count non-null slot entries across all teams — used to compare configs. */
function countFilledSlots(config: PetTeamsConfig): number {
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
    // Scoped key has data — reconcile with current (unscoped) config.
    // If the unscoped key has more filled slots, it was likely updated during
    // a session where the player ID wasn't available (saves went unscoped only).
    const unscopedSlots = countFilledSlots(store.config);
    const scopedSlots = countFilledSlots(existingScoped);

    if (unscopedSlots > scopedSlots) {
      log(`[PetTeams] Unscoped config has more data (${unscopedSlots} vs ${scopedSlots} filled slots) — keeping unscoped`);
      storage.set(scopedConfigKey, store.config);
    } else {
      store.config = existingScoped;
      notifyConfigListeners();
      log(`[PetTeams] Loaded player-scoped config (${store.config.teams.length} team(s), ${scopedSlots} filled slots)`);
    }
  }

  // Feed policy: same migration pattern
  const existingScopedFeed = storage.get<PetFeedPolicy | null>(scopedFeedKey, null);
  if (existingScopedFeed === null && store.feedPolicy.updatedAt > 0) {
    storage.set(scopedFeedKey, store.feedPolicy);
  } else if (existingScopedFeed !== null) {
    store.feedPolicy = existingScopedFeed;
  }

  // Activate scoped keys — all future saves use these
  store.resolvedConfigKey = scopedConfigKey;
  store.resolvedFeedKey = scopedFeedKey;

  // Register with storage export so backup/restore captures them
  registerDynamicKey(scopedConfigKey);
  registerDynamicKey(scopedFeedKey);
}
