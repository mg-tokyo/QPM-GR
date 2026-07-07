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
import {
  select as stateTreeSelect,
  selectSync as stateTreeSelectSync,
  subscribe as stateTreeSubscribe,
  stateTreeReady,
} from './stateTree';
import type { Selector as StateTreeSelector } from './stateTree';
import type { QuinoaStateSnapshot } from '../types/gameAtoms';

const diagLog = createNamedLogger('atomRegistry');
const ATOM_SUBSYSTEM: Subsystem = 'atomRegistry';
let atomDiagnosticsStarted = false;
import type {
  WeatherAtomValue,
  ShopsAtomSnapshot,
  ShopCategorySnapshot,
  GridPosition,
  PlayerAtomValue,
  QuinoaData,
  QuinoaUserSlot,
} from '../types/gameAtoms';

// ── Internal helpers ─────────────────────────────────────────────────────

function isRec(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ── Types ────────────────────────────────────────────────────────────────

type AtomPath = string | readonly (string | number)[];

interface AtomFinder<TValue> {
  /**
   * Label regex — primary resolution. Broad enough to survive renames.
   * Optional when a `stateTreeSelector` is provided (selector-only entries
   * have no jotai atom to bind to).
   */
  label?: RegExp;
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
  /**
   * When true (and fallbackSource is set), try the fallbackSource route FIRST,
   * before label / structure. Used for keys whose convenience atom is being
   * deprecated upstream in favor of a state-tree path (e.g. shopsAtom).
   */
  preferState?: boolean;
  /**
   * Direct stateTree selector — bypasses label / structure / fallbackSource
   * resolution entirely. Called by `stateTree.select` / `stateTree.subscribe`
   * with the current QuinoaStateSnapshot. Return null when data isn't ready
   * (missing playerId, missing userSlots, unmatched slot, etc.).
   *
   * When set, this key's `useStateTree` is implied true and there is no
   * jotai atom to fall back on unless `bootFallbackLabel` is provided.
   *
   * Use for keys whose value is a projection of stateAtom that requires
   * runtime context (per-slot indexing) or non-trivial derivation.
   */
  stateTreeSelector?: (state: QuinoaStateSnapshot) => TValue | null;
  /**
   * Optional jotai atom label used only during the boot-race window where
   * stateTree isn't ready yet (`stateTreeReady() === false`). If omitted,
   * reads during that window return `defaultValue` (or null).
   *
   * Note: even when set, subscriptions go through stateTree the moment it's
   * ready; the fallback path only fires on synchronous reads before first
   * patch arrives.
   */
  bootFallbackLabel?: RegExp;
  /**
   * Reactive-tier hint for subscribeAtomValue (see src/core/reactive/types.ts).
   * When set AND the kill switch for that tier is on, subscribeAtomValue
   * routes through the ReactiveSubscriptionManager (patch-filtered path)
   * instead of the stateTree.subscribe deep-equals fan-out or the polling
   * fallback.
   */
  tier?: import('./reactive/types').SubscriberTier;
  /**
   * JSON Pointer prefix (RFC 6901) inside stateAtom.value where this atom's
   * data lives. Used by the reactive manager to route patches to subscribers.
   * `{myIdx}` is a runtime placeholder substituted at flush time with the
   * local player's slot index.
   */
  statePath?: import('./reactive/types').PatchPath;
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
  // Per-slot state-tree keys (new)
  myUserSlot: QuinoaUserSlot | null;
  quinoaData: QuinoaData | null;
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
  // Upstream dev has confirmed convenience atoms (shopsAtom, weatherAtom, etc.)
  // are being deprecated. Where a state-tree path is stable, preferState:true
  // makes it the primary source; the label-atom stays as fallback until removed.
  weather: {
    label: /^weather(?:State)?Atom$/i,
    fallbackSource: { key: 'state', path: ['child', 'data', 'weather'] },
    preferState: true,
    tier: 'state',
    statePath: '/child/data/weather',
  },
  shops: {
    label: /^shops(?:Data)?Atom$/i,
    transform: (v) => (isRec(v) ? (v as ShopsAtomSnapshot) : null),
    fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] },
    preferState: true,
    tier: 'state',
    statePath: '/child/data/shops',
  },
  seedShop: { label: /^shops(?:Data)?Atom$/i, path: 'seed', fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] }, preferState: true, tier: 'state', statePath: '/child/data/shops/seed' },
  eggShop: { label: /^shops(?:Data)?Atom$/i, path: 'egg', fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] }, preferState: true, tier: 'state', statePath: '/child/data/shops/egg' },
  toolShop: { label: /^shops(?:Data)?Atom$/i, path: 'tool', fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] }, preferState: true, tier: 'state', statePath: '/child/data/shops/tool' },
  decorShop: { label: /^shops(?:Data)?Atom$/i, path: 'decor', fallbackSource: { key: 'state', path: ['child', 'data', 'shops'] }, preferState: true, tier: 'state', statePath: '/child/data/shops/decor' },
  coinsBalance: { label: /^my(?:Coins|coins)(?:Count|Balance)?Atom$/i, defaultValue: 0, tier: 'state', statePath: '/child/data/userSlots/{myIdx}/data/coinsCount' },
  creditsBalance: { label: /^credits(?:Balance|Count)?Atom$/i, defaultValue: 0, tier: 'dynamic' },
  magicDustBalance: { label: /^my(?:MagicDust|magicDust)(?:Count|Balance)?Atom$/i, defaultValue: 0, tier: 'state', statePath: '/child/data/userSlots/{myIdx}/data/magicDustCount' },

  // ── Player / State ────────────────────────────────────────────────────
  player: {
    label: /^player(?:Data)?Atom$/i,
    structure: (v) => isRec(v) && typeof v.id === 'string' && 'name' in v,
    tier: 'client',
  },
  state: {
    label: /^(?:room|game)?[Ss]tate(?:Data)?Atom$/i,
    structure: (v) => isRec(v) && 'child' in v && isRec(v.child),
    tier: 'state',
    statePath: '',
  },
  position: {
    label: /^(?:player)?(?:grid)?[Pp]osition(?:Data)?Atom$/i,
    structure: (v) => isRec(v) && typeof v.x === 'number' && typeof v.y === 'number',
    prefer: (l) =>
      !l.includes('camera') && !l.includes('last') &&
      !l.includes('freelook') && !l.includes('local'),
    tier: 'client',
  },
  localPosition: { label: /^local(?:Player)?(?:Position|Pos)(?:Data)?Atom$/i, tier: 'client' },
  userSlots: {
    label: /^(?:room)?[Uu]ser[Ss]lots(?:Data)?Atom$/i,
    structure: (v) => Array.isArray(v) && v.length > 0 && isRec(v[0]) && 'playerId' in v[0],
    fallbackSource: { key: 'state', path: ['child', 'data', 'userSlots'] },
    preferState: true,
    tier: 'state',
    statePath: '/child/data/userSlots',
  },
  myUserSlotIdx: {
    label: /^my(?:User)?Slot(?:Idx|Index)(?:Data)?Atom$/i,
    structure: (v) => typeof v === 'number' && v >= 0 && v < 20,
    tier: 'client',
  },

  // ── Pets ──────────────────────────────────────────────────────────────
  // NOTE: label regex is broad (matches myPetSlotsAtom, myPetSlotInfosAtom,
  // myPrimitivePetSlotsAtom, etc.) but we specifically want the atom whose
  // value is `myData.petSlots` — a full-object array of PetSlot records.
  // `myPetSlotInfosAtom` returns `myUserSlot.petSlotInfos` (a Record of
  // per-pet runtime info that shows up in-cache as position-shaped entries
  // on some bundles) and MUST NOT win. `prefer` picks the Primitive variant.
  // Beta source: myAtoms.ts:967 `myPrimitivePetSlotsAtom`.
  activePetSlots: {
    label: /^my(?:Primitive)?Pet(?:Slots|SlotInfos)(?:Data)?Atom$/i,
    prefer: (l) => /^myPrimitivePetSlotsAtom$/i.test(l),
    structure: (v) =>
      Array.isArray(v) && v.length > 0 && isRec(v[0]) &&
      ('petId' in v[0] || 'slotId' in v[0]),
    tier: 'state',
    statePath: '/child/data/userSlots/{myIdx}/data/petSlots',
  },
  petInventory: {
    label: /^myPet(?:Inventory|Items)(?:Data)?Atom$/i,
    tier: 'state',
    statePath: '/child/data/userSlots/{myIdx}/data/inventory/items',
  },
  hutchPets: {
    label: /^myPetHutch(?:Pet)?Items(?:Data)?Atom$/i,
    prefer: (label) => /PetItems/i.test(label),
    tier: 'state',
    statePath: '/child/data/userSlots/{myIdx}/data/inventory/storages',
  },
  // The game renamed myPetHutchCapacityLevelAtom → myPetHutchCapacitySlotsAtom in
  // the pr-2994 bundle (2026-06/07). The value semantics also changed: level
  // (0-10) → slots (actual 25/30/35…100 count). Widened regex matches both so
  // the registry health check resolves either way. Feature-level consumers that
  // depend on level→slots interpretation are handled at the caller (e.g.
  // src/store/hutch.ts) — this finder just answers "is there a hutch-capacity
  // atom present."
  hutchCapacity: {
    label: /^myPetHutch(?:Capacity|Cap)(?:Level|Slots)?(?:Data)?Atom$/i,
    tier: 'state',
    statePath: '/child/data/userSlots/{myIdx}/data/inventory/storages',
  },
  petHutch: { label: /^myPetHutch(?:Storages)?(?:Data)?Atom$/i },

  // ── Inventory ─────────────────────────────────────────────────────────
  inventory: {
    label: /^my(?:Main)?Inventory(?:Data)?Atom$/i,
    structure: (v) => isRec(v) && ('storages' in v || 'items' in v),
    tier: 'state',
    statePath: '/child/data/userSlots/{myIdx}/data/inventory',
  },
  cropInventory: {
    label: /^myCrop(?:s)?Inventory(?:Data)?Atom$/i,
    tier: 'state',
    statePath: '/child/data/userSlots/{myIdx}/data/inventory/items',
  },
  toolInventory: {
    label: /^myTool(?:s)?Inventory(?:Data)?Atom$/i,
    tier: 'state',
    statePath: '/child/data/userSlots/{myIdx}/data/inventory/items',
  },
  selectedItemId: { label: /^mySelectedItemIdAtom$/, defaultValue: null, tier: 'client' },

  // ── Garden ────────────────────────────────────────────────────────────
  myData: {
    label: /^my(?:Player)?Data(?:Atom)?$/i,
    structure: (v) =>
      isRec(v) && 'garden' in v && isRec(v.garden) && 'tileObjects' in v.garden,
    tier: 'state',
    statePath: '/child/data/userSlots/{myIdx}/data',
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
    tier: 'client',
  },
  selectedSlotId: { label: /^mySelectedSlotIdAtom$/, defaultValue: null, tier: 'client' },

  // ── Mount ──────────────────────────────────────────────────────────────
  riddenPetId: { label: /^myRiddenPetId(?:Atom)?$/i, defaultValue: null, tier: 'client' },

  // ── Actions ───────────────────────────────────────────────────────────
  action: { label: /^(?:current|room)?[Aa]ction(?:Data)?Atom$/i, tier: 'composite' },

  // ── Extra registry entries for callers migrated in phase B ────────────
  // These exist so subscribeAtomValue('quinoaData' | 'myUserSlot') works.
  // They resolve via the jotai label + BatchedSubscriptionManager polling
  // until Task 6 opts them into the reactive manager via tier + statePath.
  quinoaData: {
    label: /^quinoaDataAtom$/,
    tier: 'state',
    statePath: '/child/data',
  },
  myUserSlot: {
    label: /^myUserSlotAtom$/,
    tier: 'state',
    statePath: '/child/data/userSlots/{myIdx}',
  },
};

// ── Resolution cache ─────────────────────────────────────────────────────

interface CachedResolution {
  atom: unknown;
  resolvedVia: 'label' | 'structure' | 'fallback' | 'stateTree';
  foundLabel: string;
  pathPrefix?: ReadonlyArray<string | number>;
  /**
   * When true, reads/subscribes for this key route through `stateTree.select`
   * and `stateTree.subscribe` instead of jotaiBridge on the resolved atom.
   * Set for keys with `preferState: true` + a `fallbackSource` (state-tree
   * path). The `atom` field still holds the resolved parent (`stateAtom`) as a
   * fallback for the boot-race window when stateTree isn't ready yet.
   */
  useStateTree?: boolean;
  /** Cached selector for stateTree route — built lazily on first use. */
  cachedSelector?: StateTreeSelector<unknown>;
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
function resolveViaFallbackSource(key: AtomRegistryKey, finder: AtomFinder<unknown>): CachedResolution | null {
  if (!finder.fallbackSource) return null;
  const parentResolution = resolveAtom(finder.fallbackSource.key);
  if (!parentResolution) return null;
  const prefix = toPathArray(finder.fallbackSource.path);
  const parentPrefix = parentResolution.pathPrefix ?? [];
  // When preferState is set, mark this resolution as stateTree-routed so the
  // reader/subscriber APIs go through the memoizing state-tree layer instead
  // of firing the atom's raw subscriber on every state event.
  const useStateTree = finder.preferState === true;
  const entry: CachedResolution = {
    atom: parentResolution.atom,
    resolvedVia: useStateTree ? 'stateTree' : 'fallback',
    foundLabel: useStateTree ? `via stateTree` : `via ${finder.fallbackSource.key}`,
    pathPrefix: [...parentPrefix, ...prefix],
    useStateTree,
  };
  resolutionCache.set(key, entry);
  missingLog.delete(key);
  log(`[AtomRegistry] Resolved '${key}' via ${entry.resolvedVia}`);
  return entry;
}

function ensureSelector<T>(resolution: CachedResolution, finder: AtomFinder<T>): StateTreeSelector<unknown> {
  if (resolution.cachedSelector) return resolution.cachedSelector;
  const pathPrefix = resolution.pathPrefix ?? [];
  const finderPath = finder.path;
  const selector: StateTreeSelector<unknown> = (state: QuinoaStateSnapshot) => {
    let base: unknown = state;
    if (pathPrefix.length > 0) base = getPathValue(base, pathPrefix);
    if (finderPath !== undefined) base = getPathValue(base, finderPath);
    return base;
  };
  resolution.cachedSelector = selector;
  return selector;
}

function resolveAtom(key: AtomRegistryKey): CachedResolution | null {
  const cached = resolutionCache.get(key);
  if (cached) return cached;

  const finder = ATOM_FINDERS[key] as AtomFinder<unknown> | undefined;
  if (!finder) return null;

  // Direct stateTree selector — no atom lookup needed. This is the primary
  // route for keys projecting off stateAtom (per-slot data, etc.); the boot
  // race is handled via `bootFallbackLabel` inside readAtomValue*.
  if (finder.stateTreeSelector) {
    const entry: CachedResolution = {
      atom: null,
      resolvedVia: 'stateTree',
      foundLabel: `stateTreeSelector:${key}`,
      useStateTree: true,
      cachedSelector: finder.stateTreeSelector as StateTreeSelector<unknown>,
    };
    resolutionCache.set(key, entry);
    missingLog.delete(key);
    return entry;
  }

  // preferState: try state-tree path FIRST. Set on keys whose convenience atom
  // is being upstream-deprecated (e.g. shopsAtom → stateAtom.child.data.shops).
  if (finder.preferState && finder.fallbackSource) {
    const viaState = resolveViaFallbackSource(key, finder);
    if (viaState) return viaState;
  }

  // Label regex
  const byLabel = finder.label ? findAtomsByLabel(finder.label) : [];
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

  // Fallback source — resolve through a parent registry key (when preferState
  // was false or its parent wasn't yet resolvable).
  if (finder.fallbackSource && !finder.preferState) {
    const viaState = resolveViaFallbackSource(key, finder);
    if (viaState) return viaState;
  }

  // Boot-race guard: suppress warning during the early phase where the game's
  // core atoms haven't finished loading. For non-'state' keys, gate on 'state'
  // being resolvable — that's a much better "boot has advanced" signal than
  // "any atoms present at all," because modules like store/store.ts (playerAtom)
  // and atoms/inventoryAtoms.ts load after the initial batch. For 'state' key
  // itself, keep the empty-cache fallback.
  const bootStillWarming = key === 'state'
    ? getAllAtomEntries().length === 0
    : !resolutionCache.has('state');
  if (bootStillWarming) return null;

  if (!missingLog.has(key)) {
    // Add to missingLog BEFORE warning, so any reentrant call from the logging
    // path (or a synchronous concurrent async chain that hasn't yielded yet)
    // sees the dedup flag and doesn't double-warn.
    missingLog.add(key);
    diagLog.warn('QPM-ATOM-001', { key });
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

  // stateTree route: use the memoized selector against the current snapshot.
  // If stateTree isn't ready yet (boot race), fall through to the legacy atom
  // read below on the same resolved parent atom.
  if (resolution.useStateTree && stateTreeReady()) {
    const selector = ensureSelector(resolution, finder);
    const selected = stateTreeSelect(selector);
    if (selected !== null || finder.defaultValue !== undefined) {
      // pathPrefix has already been applied inside the selector — pass undefined
      // to applyTransform so it doesn't double-walk.
      return applyTransform(finder, selected, key, undefined) as RegistryValue<K>;
    }
    // selected === null with no default → fall through to boot fallback below.
  }

  // Boot-race fallback via jotai label — only for selector-only entries whose
  // `resolution.atom` is null (nothing to read from raw).
  if (resolution.atom === null) {
    if (finder.bootFallbackLabel) {
      const bootAtom = findAtomsByLabel(finder.bootFallbackLabel)[0];
      if (bootAtom) {
        try {
          const raw = await readRawAtomValue(bootAtom);
          return applyTransform(finder, raw, key, undefined) as RegistryValue<K>;
        } catch { /* fall through */ }
      }
    }
    return (finder?.defaultValue ?? null) as RegistryValue<K>;
  }

  try {
    const raw = await readRawAtomValue(resolution.atom);
    return applyTransform(finder, raw, key, resolution.pathPrefix) as RegistryValue<K>;
  } catch {
    // Cached ref might be stale — clear and retry once
    invalidateKey(key);
    const retry = resolveAtom(key);
    if (retry && retry.atom !== null) {
      try {
        const raw = await readRawAtomValue(retry.atom);
        return applyTransform(finder, raw, key, retry.pathPrefix) as RegistryValue<K>;
      } catch { /* fall through */ }
    }
    return (finder?.defaultValue ?? null) as RegistryValue<K>;
  }
}

/**
 * Subscribe to reactive updates for a registry key. Returns null if atom not
 * found.
 *
 * Routing (per plan Task 5-6):
 * 1. If the resolved entry uses stateTree (`preferState` + `fallbackSource`):
 *    subscribe via `stateTreeSubscribe` with a memoized selector. Unchanged
 *    from the pre-reactive-migration behavior — these subscribers keep their
 *    push-based path even before the reactive rollout completes.
 * 2. Else: `subscribeRawAtom(atom, cb, effectiveHint)` where
 *    `effectiveHint = hint ?? finder.tier`. The jotai polyfill's `sub()`
 *    diverts to the reactive manager when that tier's kill switch is on;
 *    otherwise it falls back to the polling manager. Behavior is
 *    unchanged until the state kill switch flips.
 */
export async function subscribeAtomValue<K extends AtomRegistryKey>(
  key: K,
  cb: (value: RegistryValue<K>) => void,
  hint?: import('./reactive/types').SubscriberTier,
): Promise<(() => void) | null> {
  const finder = ATOM_FINDERS[key];
  const resolution = resolveAtom(key);

  if (!resolution) {
    log(`[AtomRegistry] Cannot subscribe '${key}': atom not found`);
    return null;
  }

  // stateTree route: subscribe via the memoized fan-out. Callback fires only
  // when the derived sub-value changes, not on every unrelated state event.
  if (resolution.useStateTree) {
    const selector = ensureSelector(resolution, finder);
    const stop = stateTreeSubscribe(
      selector,
      (selected) => {
        const value = applyTransform(finder, selected, key, undefined);
        cb((value ?? null) as RegistryValue<K>);
      },
      `atomRegistry:${key}`,
    );
    return stop;
  }

  if (resolution.atom === null) {
    log(`[AtomRegistry] Cannot subscribe '${key}': no atom to bind`);
    return null;
  }

  const effectiveHint = hint ?? finder.tier;

  const unsubscribe = await subscribeRawAtom(resolution.atom, (raw: unknown) => {
    const value = applyTransform(finder, raw, key, resolution.pathPrefix);
    cb((value ?? null) as RegistryValue<K>);
  }, effectiveHint);

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

  // stateTree route: try selectSync (uses cached snapshot with store fallback)
  // If it returns null and we have a default, use that; otherwise fall through
  // to the legacy path so keydown-time reads still work during the boot-race
  // window before stateTree is ready.
  if (resolution.useStateTree) {
    const selector = ensureSelector(resolution, finder);
    const selected = stateTreeSelectSync(selector);
    if (selected !== null || finder.defaultValue !== undefined) {
      return applyTransform(finder, selected, key, undefined) as RegistryValue<K>;
    }
  }

  // Boot-race fallback for selector-only entries: `store.get(null)` would throw.
  // Try the optional jotai label if present, else return default.
  if (resolution.atom === null) {
    const store = getCachedStore();
    if (store && finder.bootFallbackLabel) {
      const bootAtom = findAtomsByLabel(finder.bootFallbackLabel)[0];
      if (bootAtom) {
        try {
          const raw = store.get(bootAtom);
          return applyTransform(finder, raw, key, undefined) as RegistryValue<K>;
        } catch { /* fall through */ }
      }
    }
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
    if (retry && retry.atom !== null) {
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
  registered: Array<{ key: string; label: string; resolvedVia: 'label' | 'structure' | 'fallback' | 'stateTree' }>;
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
