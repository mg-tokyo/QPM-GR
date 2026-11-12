import { healthBus } from '../diagnostics/healthBus';
import type { Subsystem } from '../diagnostics/types';
import { EXPORT_EXCLUDE_KEYS, EXPORT_EXCLUDE_PREFIXES, QPM_DYNAMIC_KEY_PREFIXES, QPM_STORAGE_KEYS } from './storageKeys';
import {
  hydrateMirror,
  isMirrorAvailable,
  mirrorHas,
  mirrorIsDeleted,
  mirrorSet,
  pruneMirrorDeletions,
  setMirrorFailureHandler,
} from './storageMirror';
import {
  deserialize,
  getLegacyGmApi,
  getModernGmApi,
  listLocalKeys,
  mirrorDelete,
  mirrorKeyList,
  mirrorRead,
  mirrorWrite,
  readLocalRaw,
  removeLocalKey,
  serialize,
  writeLocalRaw,
  type LegacyGmStorageApi,
  type ModernGmStorageApi,
} from './storageBackends';
export { QPM_STORAGE_KEYS, SHOP_ENHANCER_MODE_KEY, SHOP_ENHANCER_MODES, type ShopEnhancerMode } from './storageKeys';
export { readLocalRaw } from './storageBackends';

type StorageRuntime = 'legacy-gm' | 'modern-gm' | 'local-storage';

export interface Storage {
  get<T = unknown>(key: string, fallback?: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  clear(): void;
}

/** Keys whose owning code is gone; deleted once at init so they stop occupying quota. */
const ORPHANED_KEYS: readonly string[] = ['qpm.petTeams.logs.v1'];

/** Runtime-registered dynamic (e.g. player-scoped) keys — fallback discovery for exportAllValues(). */
const dynamicKeys = new Set<string>();

/**
 * Register a storage key that was generated at runtime (e.g. player-scoped).
 * Ensures it will be included in exports even when GM_listValues is unavailable.
 */
export function registerDynamicKey(key: string): void {
  dynamicKeys.add(key);
}

const READ_CACHE_MISSING = Symbol('storage.read.missing');
const readCache = new Map<string, unknown>();

let runtime: StorageRuntime = 'local-storage';
let legacyGm: LegacyGmStorageApi | null = null;
let modernGm: ModernGmStorageApi | null = null;
let storageInitialized = false;
let storageInitPromise: Promise<void> | null = null;
let modernWriteQueue: Promise<void> = Promise.resolve();
let mirrorFailureReported = false;

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

/** Synchronous durable read: legacy GM only — modern GM is async and is copied into the mirror at init. */
function readGmRaw(key: string): string | null {
  if (runtime === 'legacy-gm' && legacyGm) {
    try {
      const gmRaw = legacyGm.getValue(key);
      return typeof gmRaw === 'string' ? gmRaw : null;
    } catch {}
  }
  return null;
}

/**
 * The script manager's copy, shared across origins (web and Discord), bypassing the
 * per-origin mirror that `storage.get` prefers. Under `local-storage` nothing is shared,
 * so the origin's own copy is returned. A removal on this origin still wins.
 */
export async function readDurable<T = unknown>(key: string, fallback: T = null as T): Promise<T> {
  refreshRuntime();
  if (mirrorIsDeleted(key)) return fallback;
  let raw: string | null = null;
  if (runtime === 'legacy-gm') {
    raw = readGmRaw(key);
  } else if (runtime === 'modern-gm' && modernGm) {
    const gm = modernGm;
    await modernWriteQueue;
    const value = await gm.getValue<string | null>(key, null).catch(() => null);
    raw = typeof value === 'string' ? value : null;
  } else {
    raw = mirrorRead(key) ?? readLocalRaw(key);
  }
  return deserialize(raw, fallback);
}

async function hydrateFromModernGm(): Promise<void> {
  if (!modernGm) return;
  const keys = modernGm.listValues ? await modernGm.listValues().catch(() => []) : [];
  if (keys.length === 0) return;
  const values = await Promise.all(
    keys.map(async (key) => {
      const raw = await modernGm!.getValue<string | null>(key, null).catch(() => null);
      return { key, raw };
    }),
  );
  for (const { key, raw } of values) {
    if (typeof raw === 'string' && !mirrorHas(key)) mirrorSet(key, raw);
  }
}

/**
 * One-time move of the old localStorage mirrors into IndexedDB. A localStorage copy may be
 * stale (quota-blocked writes), so it is only adopted when neither the mirror nor GM holds
 * the key; either way it is deleted to hand the origin quota back to the game.
 */
function migrateLocalMirrors(): void {
  if (!isMirrorAvailable() || runtime === 'local-storage') return;
  for (const key of listLocalKeys()) {
    if (!isQpmKey(key)) continue;
    const raw = readLocalRaw(key);
    if (raw != null && !mirrorHas(key) && readGmRaw(key) == null) mirrorSet(key, raw);
    removeLocalKey(key);
  }
}

function reportMirrorFailure(error: unknown): void {
  if (mirrorFailureReported) return;
  mirrorFailureReported = true;
  healthBus.publish({
    subsystem: STORAGE_SUBSYSTEM,
    category: 'core',
    status: 'degraded',
    message: `IndexedDB mirror write failed; reads fall back to GM (${error instanceof Error ? error.message : String(error)})`,
  });
}

export function initializeStorage(): Promise<void> {
  if (storageInitialized) return Promise.resolve();
  if (storageInitPromise) return storageInitPromise;

  refreshRuntime();
  setMirrorFailureHandler(reportMirrorFailure);
  storageInitPromise = (async () => {
    try {
      await hydrateMirror();
      if (runtime === 'modern-gm') await hydrateFromModernGm();
      migrateLocalMirrors();
      for (const key of ORPHANED_KEYS) storage.remove(key);
      // Modern GM has no sync read to confirm the old value is gone, so its markers stay.
      pruneMirrorDeletions((key) => runtime === 'modern-gm' || (runtime === 'legacy-gm' ? readGmRaw(key) : readLocalRaw(key)) != null);
    } catch {}
    // Reads issued before hydration cached fallbacks for keys hydration just populated;
    // clear so the next get() re-reads from the freshly-hydrated mirror.
    readCache.clear();
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

// Row 6.23 — register the storage subsystem on the health bus so the runtime
// backend (legacy-gm / modern-gm / local-storage) surfaces in Diagnostics.
// Idempotent. Call after initializeStorage() so `runtime` is resolved.
const STORAGE_SUBSYSTEM: Subsystem = 'storage';
let storageBusRegistered = false;
export function startStorageDiagnostics(): void {
  if (storageBusRegistered) return;
  storageBusRegistered = true;
  refreshRuntime();
  const mirror = isMirrorAvailable() ? 'indexedDB' : 'localStorage';
  healthBus.register(STORAGE_SUBSYSTEM, {
    category: 'core',
    status: 'ok',
    message: `runtime=${runtime} mirror=${mirror}`,
  });
  healthBus.publish({
    subsystem: STORAGE_SUBSYSTEM,
    category: 'core',
    status: 'ok',
    message: `runtime=${runtime} mirror=${mirror}`,
    metrics: {
      runtime,
      mirror,
      registeredKeys: QPM_STORAGE_KEYS.length,
    },
  });
}

function collectPrefixMatches(prefixes: readonly string[]): string[] {
  const out = new Set<string>();
  const matches = (key: string): boolean => prefixes.some((prefix) => key.startsWith(prefix));
  for (const key of QPM_STORAGE_KEYS) if (matches(key)) out.add(key);
  for (const key of dynamicKeys) if (matches(key)) out.add(key);
  for (const key of mirrorKeyList()) if (matches(key)) out.add(key);
  return Array.from(out);
}

export function removeStorageKeysByPrefix(prefixes: readonly string[]): number {
  if (prefixes.length === 0) return 0;
  const keys = collectPrefixMatches(prefixes);
  for (const key of keys) storage.remove(key);
  return keys.length;
}

export const storage: Storage = {
  get<T = unknown>(key: string, fallback: T = null as T): T {
    if (readCache.has(key)) {
      const cached = readCache.get(key);
      return cached === READ_CACHE_MISSING ? fallback : (cached as T);
    }

    refreshRuntime();

    // Mirror first: it is written synchronously, so it is fresher than GM values a
    // script manager baked in at page load. GM is the durable fallback; a leftover
    // localStorage copy only matters for reads issued before the mirror hydrated.
    // A removal marker also beats GM, which may still serve the removed value.
    if (mirrorIsDeleted(key)) {
      readCache.set(key, READ_CACHE_MISSING);
      return fallback;
    }
    let raw = mirrorRead(key);
    if (raw == null) raw = readGmRaw(key);
    if (raw == null) raw = readLocalRaw(key);

    if (raw == null) {
      readCache.set(key, READ_CACHE_MISSING);
      return fallback;
    }
    const parsed = deserialize(raw, fallback);
    readCache.set(key, parsed);
    return parsed;
  },

  set(key: string, value: unknown): void {
    const raw = serialize(value);
    refreshRuntime();
    readCache.set(key, value);
    mirrorWrite(key, raw);

    if (runtime === 'legacy-gm' && legacyGm) {
      try {
        legacyGm.setValue(key, raw);
      } catch {}
      return;
    }

    if (runtime === 'modern-gm' && modernGm) {
      enqueueModernWrite(async () => {
        if (!modernGm) return;
        await modernGm.setValue(key, raw).catch(() => undefined);
      });
      return;
    }

    // No script manager: localStorage is the durable store (the IDB mirror doubles as backup).
    if (isMirrorAvailable() && !writeLocalRaw(key, raw)) removeLocalKey(key);
  },

  remove(key: string): void {
    refreshRuntime();
    readCache.set(key, READ_CACHE_MISSING);
    mirrorDelete(key);

    if (runtime === 'legacy-gm' && legacyGm) {
      try {
        legacyGm.deleteValue(key);
      } catch {}
      return;
    }

    if (runtime === 'modern-gm' && modernGm) {
      enqueueModernWrite(async () => {
        if (!modernGm) return;
        await modernGm.deleteValue(key).catch(() => undefined);
      });
    }
  },

  clear(): void {
    const keys = new Set<string>([
      ...collectPrefixMatches(['qpm.', 'quinoa']),
      ...QPM_STORAGE_KEYS,
    ]);
    for (const key of keys) {
      storage.remove(key);
    }
    readCache.clear();
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
 * Returns true if `key` should be excluded from settings export.
 * Matches exact keys in EXPORT_EXCLUDE_KEYS and prefix matches in EXPORT_EXCLUDE_PREFIXES.
 */
function isExportExcluded(key: string): boolean {
  if (EXPORT_EXCLUDE_KEYS.includes(key)) return true;
  return EXPORT_EXCLUDE_PREFIXES.some(p => key.startsWith(p));
}

/**
 * Serialises all currently-stored QPM values (from QPM_STORAGE_KEYS, dynamic keys, and
 * the mirror) to a plain object of JSON strings, excluding dynamic window layout keys.
 * Output format matches storage.set, ready for import or Starweaver Mod Manager.
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
  for (const key of mirrorKeyList()) {
    if (isQpmKey(key)) candidateKeys.add(key);
  }
  if (runtime === 'legacy-gm' && legacyGm?.listValues) {
    try {
      for (const key of legacyGm.listValues()) {
        if (isQpmKey(key)) candidateKeys.add(key);
      }
    } catch {}
  }

  for (const key of candidateKeys) {
    if (isDynamicWindowKey(key) || isExportExcluded(key)) continue;
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
    } catch {}
  }
  return count;
}
