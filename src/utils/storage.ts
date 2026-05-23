// src/utils/storage.ts
type LegacyGmGetValue = (key: string) => string | undefined;
type LegacyGmSetValue = (key: string, value: string) => void;
type LegacyGmDeleteValue = (key: string) => void;
type LegacyGmListValues = () => string[];

interface LegacyGmStorageApi {
  getValue: LegacyGmGetValue;
  setValue: LegacyGmSetValue;
  deleteValue: LegacyGmDeleteValue;
  listValues?: LegacyGmListValues;
}

interface ModernGmStorageApi {
  getValue: <T = unknown>(key: string, defaultValue?: T) => Promise<T>;
  setValue: (key: string, value: string) => Promise<void>;
  deleteValue: (key: string) => Promise<void>;
  listValues?: () => Promise<string[]>;
}

type StorageRuntime = 'legacy-gm' | 'modern-gm' | 'local-storage';

export interface Storage {
  get<T = unknown>(key: string, fallback?: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  clear(): void;
}

/**
 * All QPM storage keys (for comprehensive clearing)
 */
const QPM_STORAGE_KEYS = [
  // Shop Restock Tracker
  'qpm.shopRestocks.v1',
  'qpm.shopRestockConfig.v1',
  'qpm.shopRestocks.migration',

  // XP Tracker
  'qpm.xpTrackerProcs.v1',
  'qpm.xpTrackerConfig.v1',
  'qpm.petXpObservations.v1',

  // Auto Favorite
  'qpm.autoFavorite.v1',
  'qpm.bulkFavorite.v1',
  'qpm.autoReconnect.enabled.v1',
  'qpm.autoReconnect.delayMs.v1',

  // Pet Hatching Tracker
  'qpm.petHatchingTracker.knownPetIds.v1',
  'qpm.hatchStats.v1',

  // Stats
  'quinoa:stats:v1',

  // Mutation Tracking
  'qpm.mutationValueTracking.v1',
  'qpm.weatherMutationTracking.v1',

  // Pet Food Rules
  'quinoa-pet-food-rules',

  // XP Tracker window layout
  'qpm.xpTrackerWindow.layout.v1',

  // Ability Tracker window layout
  'qpm.trackerWindow.layout.v1',

  // Turtle Timer window layout
  'qpm.turtleTimerWindow.layout.v1',

  // UI State
  'quinoa-ui-panel-position',
  'quinoa-ui-panel-collapsed',
  'quinoa-ui-notifications-collapsed',
  'quinoa-ui-notifications-detail-expanded',
  'quinoa-ui-tracker-target-mode',
  'quinoa-ui-tracker-target-pet',
  'quinoa-ui-tracker-ability-filter',
  'quinoa-ui-mutation-tracker-source',
  'quinoa-ui-mutation-tracker-detail',
  'qpm-tracker-settings',
  'qpm.home-tiles.v1',
  'qpm.home-tiles.v2',
  'qpm.home-tiles.v3',

  // Main data
  'quinoa-pet-manager',
  'quinoaData',

  // Player identity
  'quinoa:selfPlayerId',

  // Pet Teams
  'qpm.petTeams.config.v1',
  'qpm.petTeams.feedPolicy.v1',
  'qpm.petTeams.logs.v1',
  'qpm.petTeams.uiState.v1',
  'qpm.petFloatingCards.v1',

  // Shop Restock (Supabase)
  'qpm.restockCache',
  'qpm.restockCache.v2',
  'qpm.restockCache.v3',
  'qpm.restock.refreshBudget.v1',
  'qpm.restock.dismissedCycles.v1',
  'qpm.restock.detailWindows.v1',
  'qpm.restock.detailScale.v1',
  'qpm.restock.soundConfig.v1',
  'qpm.restock.customSounds.v1',
  'qpm.dashboardModules',

  // Pet Optimizer
  'qpm.petOptimizer.config.v4',
  'petOptimizer:config.v2',
  'petOptimizer:config.v3',

  // Sprite Debug
  'qpm.debug.sprite.allowLegacyFallbackOnKtx2',

  // Activity Log Enhancer
  'qpm.activityLogEnhanced.entries.v1',
  'qpm.activityLogEnhanced.entries.v2',
  'qpm.activityLogEnhanced.entries.v3',
  'qpm.activityLogEnhanced.filters.v1',
  'qpm.activityLog.history.v1',
  'qpm.activityLog.history.backup.v1',
  'qpm.activityLog.history.meta.v1',
  'qpm.activityLog.filter.action.v1',
  'qpm.activityLog.filter.type.v1',
  'qpm.activityLog.filter.order.v1',
  'qpm.activityLog.filter.petSpecies.v1',
  'qpm.activityLog.filter.plantSpecies.v1',
  'qpm.activityLog.migration.v1',
  'qpm.activityLog.ariesImport.v1',
  'qpm.activityLog.enabled.v1',
  'qpm.activityLog.debug.summary.v1',

  // Sell All Pets
  'qpm.petTeams.sellAllPets.v1',

  // Controller
  'qpm.controller.enabled.v1',
  'qpm.controller.bindings.v1',
  'qpm.controller.cursorSpeed.v1',

  // Storage Value
  'qpm.storageValue.v1',
  'qpm.trackers.storageValue.migrated.v1',

  // Texture Manipulator
  'qpm.textureSwaps.v1',

  // Action Guard (Locker)
  'qpm.locker.config.v1',

  // Crop Boost / Size Indicator / Tile Value
  'cropBoostTracker:config',
  'cropSizeIndicator:config',
  'qpm.tileValue.v1',

  // Journal
  'journal:notes',

  // Pet Hutch keybind
  'petHutch:keybind',

  // Public Rooms
  'publicRooms:refreshInterval',
  'player-inspector:journal-expanded',

  // Pet Hub
  'petHub:ariesImportOnce.v1',

  // Pets Window tab
  'qpm.petsWindow.activeTab',

  // Section collapse state
  'qpm.sectionCollapsed',

  // Legacy UI state
  'quinoa-ui-panel-size',
  'quinoa-mutation-reminder-config',

  // Turtle Timer
  'qpm-turtle-manual-overrides',
  'qpm-turtle-completion-log',

  // Garden Filters
  'qpm.gardenFilters.v1',

  // Texture Debug
  'qpm.textureSwaps.debugLogs',

  // Restock cache / tracked
  'qpm.restockCache.v4',
  'qpm.ariedam.gamedata',
  'qpm.restock.tracked',
  'qpm.restock.ui.v1',

  // Dawn capsule pull history
  'qpm.capsulePulls.v1',

  // Hub visible cards
  'qpm.utilityHub.visibleCards',
  'qpm.toolsHub.visibleCards',
  'qpm.trackersHub.visibleTrackers',

  // Stats Hub
  'qpm.statsHub.filters.v1',

  // Turtle Timer tab
  'qpm.turtleTimer.activeTab',

  // Debug globals opt-in
  'qpm.debug.globals.v1',

  // Version checker
  'qpm.versionCheck.v1',

  // Inventory Capacity
  'qpm.inventoryCapacity.v1',
  'qpm.inventoryCapacity.customSounds.v1',

  // Feed Keybinds
  'qpm.feed-keybinds.v1',

  // Shop Keybinds
  'qpm.shop-keybinds.v1',
  'qpm.panelHotkey.v1',

  // Hub State
  'qpm.hub.state.v1',
  'qpm.hub.migrated.v1',

  // Locale
  'qpm.localeOverride.v1',

  // Tour system (dynamic keys: qpm.tour.<windowId>)
  // Cleared by storage.clear() via the qpm.* prefix match
];

/**
 * Dynamic key prefixes for window position/size/state keys that are generated at runtime.
 * These are NOT in QPM_STORAGE_KEYS because the suffixes are per-window-id.
 */
const QPM_DYNAMIC_KEY_PREFIXES = [
  'qpm-window-pos-',
  'qpm-window-size-',
  'qpm-window-state-',
] as const;

/**
 * Set of storage keys registered at runtime by features that use dynamic
 * (e.g. player-scoped) key names. Used by exportAllValues() as a fallback
 * discovery mechanism alongside the localStorage prefix scan.
 */
const dynamicKeys = new Set<string>();

/**
 * Register a storage key that was generated at runtime (e.g. player-scoped).
 * Ensures it will be included in exports even when GM_listValues is unavailable.
 */
export function registerDynamicKey(key: string): void {
  dynamicKeys.add(key);
}

const globalScope = globalThis as Record<string, unknown>;
const modernCache = new Map<string, string>();

let runtime: StorageRuntime = 'local-storage';
let legacyGm: LegacyGmStorageApi | null = null;
let modernGm: ModernGmStorageApi | null = null;
let storageInitialized = false;
let storageInitPromise: Promise<void> | null = null;
let modernWriteQueue: Promise<void> = Promise.resolve();

function getLocalStorageSafe(): globalThis.Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readLocalRaw(key: string): string | null {
  const ls = getLocalStorageSafe();
  if (!ls) return null;
  try {
    return ls.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalRaw(key: string, raw: string): void {
  const ls = getLocalStorageSafe();
  if (!ls) return;
  try {
    ls.setItem(key, raw);
  } catch {}
}

function removeLocalKey(key: string): void {
  const ls = getLocalStorageSafe();
  if (!ls) return;
  try {
    ls.removeItem(key);
  } catch {}
}

function listLocalKeys(): string[] {
  const ls = getLocalStorageSafe();
  if (!ls) return [];
  try {
    return Object.keys(ls);
  } catch {
    return [];
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function deserialize<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

function getLegacyGmApi(): LegacyGmStorageApi | null {
  const getValue = globalScope.GM_getValue;
  const setValue = globalScope.GM_setValue;
  const deleteValue = globalScope.GM_deleteValue;
  const listValues = globalScope.GM_listValues;

  if (
    typeof getValue === 'function' &&
    typeof setValue === 'function' &&
    typeof deleteValue === 'function'
  ) {
    const api: LegacyGmStorageApi = {
      getValue: getValue as LegacyGmGetValue,
      setValue: setValue as LegacyGmSetValue,
      deleteValue: deleteValue as LegacyGmDeleteValue,
    };
    if (typeof listValues === 'function') {
      api.listValues = listValues as LegacyGmListValues;
    }
    return api;
  }

  return null;
}

function getModernGmApi(): ModernGmStorageApi | null {
  const gm = globalScope.GM;
  if (!gm || typeof gm !== 'object') return null;

  const gmRecord = gm as Record<string, unknown>;
  const getValue = gmRecord.getValue;
  const setValue = gmRecord.setValue;
  const deleteValue = gmRecord.deleteValue;
  const listValues = gmRecord.listValues;

  if (
    typeof getValue === 'function' &&
    typeof setValue === 'function' &&
    typeof deleteValue === 'function'
  ) {
    const api: ModernGmStorageApi = {
      getValue: getValue as <T = unknown>(key: string, defaultValue?: T) => Promise<T>,
      setValue: setValue as (key: string, value: string) => Promise<void>,
      deleteValue: deleteValue as (key: string) => Promise<void>,
    };
    if (typeof listValues === 'function') {
      api.listValues = listValues as () => Promise<string[]>;
    }
    return api;
  }

  return null;
}

function refreshRuntime(): void {
  legacyGm = getLegacyGmApi();
  modernGm = legacyGm ? null : getModernGmApi();

  if (legacyGm) {
    runtime = 'legacy-gm';
    return;
  }
  if (modernGm) {
    runtime = 'modern-gm';
    return;
  }
  runtime = 'local-storage';
}

function enqueueModernWrite(task: () => Promise<void>): void {
  modernWriteQueue = modernWriteQueue
    .then(task)
    .catch(() => undefined);
}

function syncModernMirrorSet(key: string, raw: string): void {
  modernCache.set(key, raw);
  writeLocalRaw(key, raw);
}

function syncModernMirrorRemove(key: string): void {
  modernCache.delete(key);
  removeLocalKey(key);
}

async function hydrateModernCache(): Promise<void> {
  if (!modernGm) return;

  const keys = modernGm.listValues ? await modernGm.listValues().catch(() => []) : [];
  if (keys.length > 0) {
    const values = await Promise.all(
      keys.map(async (key) => {
        const raw = await modernGm!.getValue<string | null>(key, null).catch(() => null);
        return { key, raw };
      }),
    );
    for (const { key, raw } of values) {
      if (typeof raw !== 'string') continue;
      modernCache.set(key, raw);
      writeLocalRaw(key, raw);
    }
  }

  for (const key of listLocalKeys()) {
    if (!isQpmKey(key)) continue;
    const raw = readLocalRaw(key);
    if (typeof raw === 'string' && !modernCache.has(key)) {
      modernCache.set(key, raw);
    }
  }
}

export function initializeStorage(): Promise<void> {
  if (storageInitialized) return Promise.resolve();
  if (storageInitPromise) return storageInitPromise;

  refreshRuntime();
  if (runtime !== 'modern-gm') {
    storageInitialized = true;
    return Promise.resolve();
  }

  storageInitPromise = (async () => {
    try {
      await hydrateModernCache();
    } catch {}
    storageInitialized = true;
  })().finally(() => {
    storageInitPromise = null;
  });

  return storageInitPromise;
}

export function getStorageRuntime(): StorageRuntime {
  refreshRuntime();
  return runtime;
}

function readModernRaw(key: string): string | null {
  if (modernCache.has(key)) {
    return modernCache.get(key) ?? null;
  }
  return readLocalRaw(key);
}

function collectPrefixMatches(prefixes: readonly string[]): string[] {
  const out = new Set<string>();

  for (const key of QPM_STORAGE_KEYS) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      out.add(key);
    }
  }

  for (const key of dynamicKeys) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      out.add(key);
    }
  }

  for (const key of modernCache.keys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      out.add(key);
    }
  }

  for (const key of listLocalKeys()) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      out.add(key);
    }
  }

  return Array.from(out);
}

export function removeStorageKeysByPrefix(prefixes: readonly string[]): number {
  if (prefixes.length === 0) return 0;
  refreshRuntime();

  const keys = collectPrefixMatches(prefixes);
  if (keys.length === 0) return 0;

  for (const key of keys) {
    if (runtime === 'modern-gm') {
      syncModernMirrorRemove(key);
    } else {
      removeLocalKey(key);
    }
  }

  if (runtime === 'legacy-gm' && legacyGm) {
    for (const key of keys) {
      try {
        legacyGm.deleteValue(key);
      } catch {}
    }
  } else if (runtime === 'modern-gm' && modernGm) {
    const keysToDelete = [...keys];
    enqueueModernWrite(async () => {
      if (!modernGm) return;
      for (const key of keysToDelete) {
        await modernGm.deleteValue(key).catch(() => undefined);
      }
    });
  }

  return keys.length;
}

export const storage: Storage = {
  get<T = unknown>(key: string, fallback: T = null as T): T {
    refreshRuntime();

    if (runtime === 'legacy-gm' && legacyGm) {
      try {
        const raw = legacyGm.getValue(key);
        return deserialize(raw, fallback);
      } catch {}
    }

    if (runtime === 'modern-gm') {
      return deserialize(readModernRaw(key), fallback);
    }

    return deserialize(readLocalRaw(key), fallback);
  },

  set(key: string, value: unknown): void {
    const raw = serialize(value);
    refreshRuntime();

    if (runtime === 'legacy-gm' && legacyGm) {
      try {
        legacyGm.setValue(key, raw);
        return;
      } catch {}
      writeLocalRaw(key, raw);
      return;
    }

    if (runtime === 'modern-gm' && modernGm) {
      syncModernMirrorSet(key, raw);
      enqueueModernWrite(async () => {
        if (!modernGm) return;
        await modernGm.setValue(key, raw).catch(() => undefined);
      });
      return;
    }

    writeLocalRaw(key, raw);
  },

  remove(key: string): void {
    refreshRuntime();

    if (runtime === 'legacy-gm' && legacyGm) {
      try {
        legacyGm.deleteValue(key);
      } catch {}
      removeLocalKey(key);
      return;
    }

    if (runtime === 'modern-gm' && modernGm) {
      syncModernMirrorRemove(key);
      enqueueModernWrite(async () => {
        if (!modernGm) return;
        await modernGm.deleteValue(key).catch(() => undefined);
      });
      return;
    }

    removeLocalKey(key);
  },

  clear(): void {
    const keys = new Set<string>([
      ...collectPrefixMatches(['qpm.', 'quinoa']),
      ...QPM_STORAGE_KEYS,
    ]);
    for (const key of keys) {
      storage.remove(key);
    }
  },
};

/**
 * Returns true if `key` is a recognised QPM storage key.
 * Matches: anything in QPM_STORAGE_KEYS, or prefixed with qpm. / quinoa,
 * or a dynamic window-position/size/state key.
 */
function isQpmKey(key: string): boolean {
  if (QPM_STORAGE_KEYS.includes(key)) return true;
  if (key.startsWith('qpm.') || key.startsWith('quinoa')) return true;
  if (QPM_DYNAMIC_KEY_PREFIXES.some(p => key.startsWith(p))) return true;
  return false;
}

/**
 * Returns true if `key` is a dynamic window layout key (position, size, state).
 * These are ephemeral UI state and should not be included in exports.
 */
function isDynamicWindowKey(key: string): boolean {
  return QPM_DYNAMIC_KEY_PREFIXES.some(p => key.startsWith(p));
}

/**
 * Serialises all currently-stored QPM values to a plain object of JSON strings.
 *
 * Exports keys from QPM_STORAGE_KEYS, dynamically registered keys, and any localStorage
 * keys matching known QPM prefixes (qpm.*, quinoa*).
 * Excludes dynamic window layout keys (position/size/state) — those are ephemeral UI state.
 *
 * Values are returned as JSON strings (the same format that storage.set writes)
 * so they can be written verbatim to localStorage or forwarded to the Starweaver
 * Mod Manager's import pipeline without any further transformation.
 */
export function exportAllValues(): Record<string, string> {
  const out: Record<string, string> = {};
  refreshRuntime();

  const candidateKeys = new Set<string>();

  for (const key of QPM_STORAGE_KEYS) {
    if (isQpmKey(key)) candidateKeys.add(key);
  }
  for (const key of dynamicKeys) {
    if (isQpmKey(key)) candidateKeys.add(key);
  }
  for (const key of listLocalKeys()) {
    if (isQpmKey(key)) candidateKeys.add(key);
  }
  if (runtime === 'modern-gm') {
    for (const key of modernCache.keys()) {
      if (isQpmKey(key)) candidateKeys.add(key);
    }
  }
  if (runtime === 'legacy-gm' && legacyGm?.listValues) {
    try {
      for (const key of legacyGm.listValues()) {
        if (isQpmKey(key)) candidateKeys.add(key);
      }
    } catch {}
  }

  for (const key of candidateKeys) {
    if (isDynamicWindowKey(key)) continue;
    const val = storage.get<unknown>(key, null);
    if (val == null) continue;
    try {
      out[key] = JSON.stringify(val);
    } catch {}
  }

  return out;
}

/**
 * Writes key->value pairs into storage. Values must already be JSON strings.
 * Returns the number of keys written. Callers control whether to clear() first.
 */
export function importAllValues(data: Record<string, string>): number {
  let count = 0;
  for (const [key, jsonStr] of Object.entries(data)) {
    try {
      const parsed = JSON.parse(jsonStr);
      storage.set(key, parsed);
      count++;
    } catch {
      // Skip malformed entries
    }
  }
  return count;
}
