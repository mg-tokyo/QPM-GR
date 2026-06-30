// src/core/atomRegistry.ts
// Finder-based atom resolution with self-healing, auto-cataloging, and health check.
//
// Each registered key has a label regex (primary, fast) and an optional structural
// matcher (fallback, scans all atoms). Resolution is cached — subsequent reads
// skip scanning entirely.

import {
  findAtomsByLabel,
  getAllAtomEntries,
  readAtomValue as readRawAtomValue,
  writeAtomValue as writeRawAtomValue,
  subscribeAtom as subscribeRawAtom,
  getCachedStore,
} from './jotaiBridge';
import { log } from '../utils/logger';
import { healthBus } from '../diagnostics/healthBus';
import { createNamedLogger } from '../diagnostics/logger';
import type { Subsystem } from '../diagnostics/types';

const diagLog = createNamedLogger('atomRegistry');
const ATOM_SUBSYSTEM: Subsystem = 'atomRegistry';
let atomDiagnosticsStarted = false;
import type {
  WeatherAtomValue,
  ShopsAtomSnapshot,
  ShopCategorySnapshot,
  GridPosition,
  PlayerAtomValue,
} from '../types/gameAtoms';

// ── Internal helpers ─────────────────────────────────────────────────────

function isRec(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ── Types ────────────────────────────────────────────────────────────────

type AtomPath = string | readonly (string | number)[];

interface AtomFinder<TValue> {
  /** Label regex — primary resolution. Broad enough to survive renames. */
  label: RegExp;
  /** Optional structural matcher — fallback when label regex fails. */
  structure?: (value: unknown) => boolean;
  /** Disambiguator when structure matches multiple atoms. */
  prefer?: (label: string) => boolean;
  /** Sub-path within the atom value (e.g. 'seed' for seedShop inside shopsAtom). */
  path?: AtomPath;
  /** Transform raw value into typed output. */
  transform?: (value: unknown) => TValue;
  /** Static default when resolution fails entirely. */
  defaultValue?: TValue;
  /** Resolve through a parent registry key when label + structure fail. */
  fallbackSource?: {
    key: AtomRegistryKey;
    path: AtomPath;
  };
}

// ── Value type map ───────────────────────────────────────────────────────

interface AtomValueMap {
  // Existing keys (upgraded to regex)
  weather: WeatherAtomValue;
  shops: ShopsAtomSnapshot | null;
  seedShop: ShopCategorySnapshot | null;
  eggShop: ShopCategorySnapshot | null;
  toolShop: ShopCategorySnapshot | null;
  decorShop: ShopCategorySnapshot | null;
  coinsBalance: number;
  creditsBalance: number;
  magicDustBalance: number;
  // Player / State
  player: PlayerAtomValue | null;
  state: Record<string, unknown> | null;
  position: GridPosition | null;
  localPosition: GridPosition | null;
  userSlots: unknown[] | null;
  myUserSlotIdx: number | null;
  // Pets
  activePetSlots: unknown[] | null;
  petInventory: unknown[] | null;
  hutchPets: unknown[] | null;
  hutchCapacity: number | null;
  petHutch: unknown | null;
  // Inventory
  inventory: unknown | null;
  cropInventory: unknown | null;
  toolInventory: unknown[] | null;
  selectedItemId: string | null;
  // Garden
  myData: Record<string, unknown> | null;
  map: Record<string, unknown> | null;
  dirtTileIndex: number | null;
  gardenObject: unknown | null;
  ownGardenObject: unknown | null;
  gardenTile: unknown | null;
  // UI State
  activeModal: string | null;
  selectedSlotId: number | null;
  // Mount
  riddenPetId: string | null;
  // Actions
  action: unknown | null;
}

export type AtomRegistryKey = keyof AtomValueMap;
export type RegistryValue<K extends AtomRegistryKey> = AtomValueMap[K] | null;

// ── Known modal values (for activeModal structure matcher) ───────────────

const KNOWN_MODALS = new Set([
  'seedShop', 'eggShop', 'toolShop', 'inventory', 'leaderboard',
  'journal', 'decorShop', 'stats', 'petHutch', 'decorShed',
  'activityLog', 'destroyCelestialConfirmation', 'seedSilo',
  'newspaper', 'billboard', 'feedingTrough',
]);

// ── Finder entries ───────────────────────────────────────────────────────

const ATOM_FINDERS: { [K in AtomRegistryKey]: AtomFinder<AtomValueMap[K]> } = {
  // ── Existing 10 keys ──────────────────────────────────────────────────
  weather: { label: /^weather(?:State)?Atom$/i },
  shops: {
    label: /^shops(?:Data)?Atom$/i,
    transform: (v) => (isRec(v) ? (v as ShopsAtomSnapshot) : null),
    fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] },
  },
  seedShop: { label: /^shops(?:Data)?Atom$/i, path: 'seed', fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] } },
  eggShop: { label: /^shops(?:Data)?Atom$/i, path: 'egg', fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] } },
  toolShop: { label: /^shops(?:Data)?Atom$/i, path: 'tool', fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] } },
  decorShop: { label: /^shops(?:Data)?Atom$/i, path: 'decor', fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] } },
  coinsBalance: { label: /^my(?:Coins|coins)(?:Count|Balance)?Atom$/i, defaultValue: 0 },
  creditsBalance: { label: /^credits(?:Balance|Count)?Atom$/i, defaultValue: 0 },
  magicDustBalance: { label: /^my(?:MagicDust|magicDust)(?:Count|Balance)?Atom$/i, defaultValue: 0 },

  // ── Player / State ────────────────────────────────────────────────────
  player: {
    label: /^player(?:Data)?Atom$/i,
    structure: (v) => isRec(v) && typeof v.id === 'string' && 'name' in v,
  },
  state: {
    label: /^(?:room|game)?[Ss]tate(?:Data)?Atom$/i,
    structure: (v) => isRec(v) && 'child' in v && isRec(v.child),
  },
  position: {
    label: /^(?:player)?(?:grid)?[Pp]osition(?:Data)?Atom$/i,
    structure: (v) => isRec(v) && typeof v.x === 'number' && typeof v.y === 'number',
    prefer: (l) =>
      !l.includes('camera') && !l.includes('last') &&
      !l.includes('freelook') && !l.includes('local'),
  },
  localPosition: { label: /^local(?:Player)?(?:Position|Pos)(?:Data)?Atom$/i },
  userSlots: {
    label: /^(?:room)?[Uu]ser[Ss]lots(?:Data)?Atom$/i,
    structure: (v) => Array.isArray(v) && v.length > 0 && isRec(v[0]) && 'playerId' in v[0],
  },
  myUserSlotIdx: {
    label: /^my(?:User)?Slot(?:Idx|Index)(?:Data)?Atom$/i,
    structure: (v) => typeof v === 'number' && v >= 0 && v < 20,
  },

  // ── Pets ──────────────────────────────────────────────────────────────
  activePetSlots: {
    label: /^my(?:Primitive)?Pet(?:Slots|SlotInfos)(?:Data)?Atom$/i,
    structure: (v) =>
      Array.isArray(v) && v.length > 0 && isRec(v[0]) &&
      ('petId' in v[0] || 'slotId' in v[0]),
  },
  petInventory: { label: /^myPet(?:Inventory|Items)(?:Data)?Atom$/i },
  hutchPets: {
    label: /^myPetHutch(?:Pet)?Items(?:Data)?Atom$/i,
    prefer: (label) => /PetItems/i.test(label),
  },
  hutchCapacity: { label: /^myPetHutch(?:Capacity|Cap)(?:Level)?(?:Data)?Atom$/i },
  petHutch: { label: /^myPetHutch(?:Storages)?(?:Data)?Atom$/i },

  // ── Inventory ─────────────────────────────────────────────────────────
  inventory: {
    label: /^my(?:Main)?Inventory(?:Data)?Atom$/i,
    structure: (v) => isRec(v) && ('storages' in v || 'items' in v),
  },
  cropInventory: { label: /^myCrop(?:s)?Inventory(?:Data)?Atom$/i },
  toolInventory: { label: /^myTool(?:s)?Inventory(?:Data)?Atom$/i },
  selectedItemId: { label: /^mySelectedItemIdAtom$/, defaultValue: null },

  // ── Garden ────────────────────────────────────────────────────────────
  myData: {
    label: /^my(?:Player)?Data(?:Atom)?$/i,
    structure: (v) =>
      isRec(v) && 'garden' in v && isRec(v.garden) && 'tileObjects' in v.garden,
  },
  map: {
    label: /^(?:room|garden)?[Mm]ap(?:Data)?Atom$/i,
    structure: (v) =>
      isRec(v) && 'cols' in v && 'rows' in v && 'globalTileIdxToDirtTile' in v,
  },
  dirtTileIndex: { label: /^myOwn(?:Current)?DirtTile(?:Index|Idx)(?:Data)?Atom$/i },
  gardenObject: { label: /^myCurrent(?:Garden)?Object(?:Data)?Atom$/i },
  ownGardenObject: { label: /^myOwn(?:Current)?(?:Garden)?Object(?:Data)?Atom$/i },
  gardenTile: { label: /^myCurrent(?:Garden)?Tile(?:Data)?Atom$/i },

  // ── UI State ──────────────────────────────────────────────────────────
  activeModal: {
    label: /^active(?:Modal|Dialog)(?:Name)?(?:Data)?Atom$/i,
    structure: (v) => typeof v === 'string' && KNOWN_MODALS.has(v),
  },
  selectedSlotId: { label: /^mySelectedSlotIdAtom$/, defaultValue: null },

  // ── Mount ──────────────────────────────────────────────────────────────
  riddenPetId: { label: /^myRiddenPetId(?:Atom)?$/i, defaultValue: null },

  // ── Actions ───────────────────────────────────────────────────────────
  action: { label: /^(?:current|room)?[Aa]ction(?:Data)?Atom$/i },
};

// ── Resolution cache ─────────────────────────────────────────────────────

interface CachedResolution {
  atom: unknown;
  resolvedVia: 'label' | 'structure' | 'fallback';
  foundLabel: string;
  pathPrefix?: ReadonlyArray<string | number>;
}

const resolutionCache = new Map<AtomRegistryKey, CachedResolution>();
const missingLog = new Set<AtomRegistryKey>();

/** Get label from an atom reference. */
function atomLabel(atom: unknown): string {
  if (!atom || typeof atom !== 'object') return '';
  const obj = atom as Record<string, unknown>;
  return String(obj.debugLabel ?? obj.label ?? '');
}

/**
 * Resolve an atom reference for a registry key. Fully synchronous.
 *
 * 1. Cache hit → return immediately
 * 2. Label regex → findAtomsByLabel (fast scan)
 * 3. Structure matcher → scan all atoms via store.get (slow, only when defined)
 * 4. Fallback source → resolve through a parent registry key with path prefix
 * 5. All fail → return null, mark missing
 */
function resolveAtom(key: AtomRegistryKey): CachedResolution | null {
  const cached = resolutionCache.get(key);
  if (cached) return cached;

  const finder = ATOM_FINDERS[key];
  if (!finder) return null;

  // Label regex
  const byLabel = findAtomsByLabel(finder.label);
  if (byLabel.length > 0) {
    let atom = byLabel[0];
    if (byLabel.length > 1 && finder.prefer) {
      const preferred = byLabel.find((a) => finder.prefer!(atomLabel(a)));
      if (preferred) atom = preferred;
    }
    const entry: CachedResolution = { atom, resolvedVia: 'label', foundLabel: atomLabel(atom) };
    resolutionCache.set(key, entry);
    missingLog.delete(key);
    return entry;
  }

  // Structure match (if defined)
  if (finder.structure) {
    const store = getCachedStore();
    if (store) {
      const allEntries = getAllAtomEntries();
      const matches: Array<{ atom: unknown; label: string }> = [];
      for (const e of allEntries) {
        try {
          const value = store.get(e.atom);
          if (finder.structure(value)) matches.push(e);
        } catch { /* skip unreadable atoms */ }
      }
      if (matches.length > 0) {
        let match = matches[0]!;
        if (matches.length > 1 && finder.prefer) {
          const preferred = matches.find((m) => finder.prefer!(m.label));
          if (preferred) match = preferred;
        }
        log(`[AtomRegistry] Resolved '${key}' via structure (found label: ${match.label})`);
        const entry: CachedResolution = {
          atom: match.atom, resolvedVia: 'structure', foundLabel: match.label,
        };
        resolutionCache.set(key, entry);
        missingLog.delete(key);
        return entry;
      }
    }
  }

  // Fallback source — resolve through a parent registry key
  if (finder.fallbackSource) {
    const parentResolution = resolveAtom(finder.fallbackSource.key);
    if (parentResolution) {
      const prefix = toPathArray(finder.fallbackSource.path);
      const parentPrefix = parentResolution.pathPrefix ?? [];
      const entry: CachedResolution = {
        atom: parentResolution.atom,
        resolvedVia: 'fallback',
        foundLabel: `via ${finder.fallbackSource.key}`,
        pathPrefix: [...parentPrefix, ...prefix],
      };
      resolutionCache.set(key, entry);
      missingLog.delete(key);
      log(`[AtomRegistry] Resolved '${key}' via fallback source '${finder.fallbackSource.key}'`);
      return entry;
    }
  }

  // All fail
  if (!missingLog.has(key)) {
    diagLog.warn('QPM-ATOM-001', { key });
    missingLog.add(key);
  }
  return null;
}

/** Clear cached reference, forcing re-resolution on next access. */
function invalidateKey(key: AtomRegistryKey): void {
  resolutionCache.delete(key);
}

// ── Path + transform ─────────────────────────────────────────────────────

function toPathArray(path?: AtomPath): Array<string | number> {
  if (!path) return [];
  if (Array.isArray(path)) return path.slice();
  return String(path).split('.').map((s) => s.trim()).filter(Boolean);
}

function getPathValue(root: unknown, path?: AtomPath): unknown {
  if (!path) return root;
  const segments = toPathArray(path);
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor == null) return undefined;
    if (typeof segment === 'number') {
      cursor = Array.isArray(cursor) ? cursor[segment] : undefined;
    } else {
      cursor = (cursor as Record<string, unknown>)[segment];
    }
  }
  return cursor;
}

function applyTransform<T>(
  finder: AtomFinder<T>,
  raw: unknown,
  key: AtomRegistryKey,
  pathPrefix?: ReadonlyArray<string | number>,
): T | null {
  try {
    let base = raw;
    if (pathPrefix) base = getPathValue(base, pathPrefix);
    base = getPathValue(base, finder.path);
    if (finder.transform) return finder.transform(base);
    return (base ?? finder.defaultValue ?? null) as T | null;
  } catch (error) {
    diagLog.warn('QPM-ATOM-002', { key }, error);
    return (finder.defaultValue ?? null) as T | null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/** Async read — resolves the atom, reads its value, applies path+transform. */
export async function readAtomValue<K extends AtomRegistryKey>(key: K): Promise<RegistryValue<K>> {
  const finder = ATOM_FINDERS[key];
  const resolution = resolveAtom(key);

  if (!resolution) {
    return (finder?.defaultValue ?? null) as RegistryValue<K>;
  }

  try {
    const raw = await readRawAtomValue(resolution.atom);
    return applyTransform(finder, raw, key, resolution.pathPrefix) as RegistryValue<K>;
  } catch {
    // Cached ref might be stale — clear and retry once
    invalidateKey(key);
    const retry = resolveAtom(key);
    if (retry) {
      try {
        const raw = await readRawAtomValue(retry.atom);
        return applyTransform(finder, raw, key, retry.pathPrefix) as RegistryValue<K>;
      } catch { /* fall through */ }
    }
    return (finder?.defaultValue ?? null) as RegistryValue<K>;
  }
}

/** Subscribe to reactive updates for a registry key. Returns null if atom not found. */
export async function subscribeAtomValue<K extends AtomRegistryKey>(
  key: K,
  cb: (value: RegistryValue<K>) => void,
): Promise<(() => void) | null> {
  const finder = ATOM_FINDERS[key];
  const resolution = resolveAtom(key);

  if (!resolution) {
    log(`[AtomRegistry] Cannot subscribe '${key}': atom not found`);
    return null;
  }

  const unsubscribe = await subscribeRawAtom(resolution.atom, (raw: unknown) => {
    const value = applyTransform(finder, raw, key, resolution.pathPrefix);
    cb((value ?? null) as RegistryValue<K>);
  });

  return () => {
    try { unsubscribe(); } catch (error) {
      log(`[AtomRegistry] Unsubscribe error for '${key}'`, error);
    }
  };
}

/** Synchronous read — for keydown handlers and other sync-only contexts. */
export function readAtomValueSync<K extends AtomRegistryKey>(key: K): RegistryValue<K> {
  const finder = ATOM_FINDERS[key];
  const resolution = resolveAtom(key);

  if (!resolution) {
    return (finder?.defaultValue ?? null) as RegistryValue<K>;
  }

  const store = getCachedStore();
  if (!store) {
    return (finder?.defaultValue ?? null) as RegistryValue<K>;
  }

  try {
    const raw = store.get(resolution.atom);
    return applyTransform(finder, raw, key, resolution.pathPrefix) as RegistryValue<K>;
  } catch {
    invalidateKey(key);
    const retry = resolveAtom(key);
    if (retry) {
      try {
        const raw = store.get(retry.atom);
        return applyTransform(finder, raw, key, retry.pathPrefix) as RegistryValue<K>;
      } catch { /* fall through */ }
    }
    return (finder?.defaultValue ?? null) as RegistryValue<K>;
  }
}

/** Write a value to a resolved registry atom. Throws if atom not found or store is read-only. */
export async function writeRegistryAtom<K extends AtomRegistryKey>(
  key: K,
  value: RegistryValue<K>,
): Promise<void> {
  const resolution = resolveAtom(key);
  if (!resolution) {
    throw new Error(`[AtomRegistry] Cannot write: atom '${key}' not resolved`);
  }
  await writeRawAtomValue(resolution.atom, value);
}

// ── Health check + catalog ───────────────────────────────────────────────

export interface AtomHealthCheckResult {
  registered: Array<{ key: string; label: string; resolvedVia: 'label' | 'structure' | 'fallback' }>;
  missing: string[];
  unregistered: Array<{ label: string; populated: boolean }>;
}

/**
 * Wire the atomRegistry subsystem into the diagnostics health bus. Idempotent.
 * Call once on init BEFORE any atom resolution so the 'starting' state is
 * visible briefly; later `runAtomHealthCheck()` publishes the final state.
 */
export function startAtomRegistryDiagnostics(): void {
  if (atomDiagnosticsStarted) return;
  atomDiagnosticsStarted = true;
  healthBus.register(ATOM_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Awaiting health check',
  });
}

function publishHealthFromResult(result: AtomHealthCheckResult): void {
  if (!atomDiagnosticsStarted) return;
  const total = result.registered.length + result.missing.length;
  const metrics: Readonly<Record<string, number>> = {
    registered: result.registered.length,
    missing: result.missing.length,
    unregisteredDiscovered: result.unregistered.length,
    total,
  };
  const message = result.missing.length === 0
    ? `${result.registered.length}/${total} atoms resolved`
    : `${result.registered.length}/${total} resolved, ${result.missing.length} missing`;

  if (result.missing.length === 0) {
    healthBus.publish({
      subsystem: ATOM_SUBSYSTEM,
      category: 'core',
      status: 'ok',
      message,
      metrics,
    });
    return;
  }

  // Bus is already 'degraded' from ATOM-001 emissions during resolution. Omit
  // status here so the bus preserves it; just refresh message + metrics.
  healthBus.publish({
    subsystem: ATOM_SUBSYSTEM,
    category: 'core',
    message,
    metrics,
  });
}

/** Scan all registered keys and catalog all game atoms. Diagnostic only. */
export function runAtomHealthCheck(): AtomHealthCheckResult {
  const registered: AtomHealthCheckResult['registered'] = [];
  const missing: string[] = [];
  const allKeys = Object.keys(ATOM_FINDERS) as AtomRegistryKey[];

  for (const key of allKeys) {
    const resolution = resolveAtom(key);
    if (resolution) {
      registered.push({ key, label: resolution.foundLabel, resolvedVia: resolution.resolvedVia });
    } else {
      missing.push(key);
    }
  }

  // Catalog unregistered atoms
  const registeredLabels = new Set(registered.map((r) => r.label));
  const allEntries = getAllAtomEntries();
  const unregistered: AtomHealthCheckResult['unregistered'] = [];
  const store = getCachedStore();

  for (const entry of allEntries) {
    if (!entry.label || registeredLabels.has(entry.label)) continue;
    let populated = false;
    if (store) {
      try { populated = store.get(entry.atom) != null; } catch { /* skip */ }
    }
    unregistered.push({ label: entry.label, populated });
  }

  log(
    `[AtomRegistry] Health: ${registered.length} registered ` +
    `(${registered.length} found, ${missing.length} missing), ` +
    `${unregistered.length} unregistered discovered`,
  );
  if (missing.length > 0) {
    log(`[AtomRegistry] ⚠️ Missing keys: ${missing.join(', ')}`);
  }

  const result: AtomHealthCheckResult = { registered, missing, unregistered };
  publishHealthFromResult(result);
  return result;
}

/** List all registered keys with resolution status. */
export function getRegisteredKeys(): Array<{
  key: string; resolved: boolean; label: string | null; via: string | null;
}> {
  return (Object.keys(ATOM_FINDERS) as AtomRegistryKey[]).map((key) => {
    const cached = resolutionCache.get(key);
    return {
      key,
      resolved: !!cached,
      label: cached?.foundLabel ?? null,
      via: cached?.resolvedVia ?? null,
    };
  });
}

/** One-line summary for debug console. */
export function getRegistryStatus(): string {
  const total = Object.keys(ATOM_FINDERS).length;
  const resolved = resolutionCache.size;
  const missing = missingLog.size;
  return `AtomRegistry: ${resolved}/${total} resolved, ${missing} missing`;
}
