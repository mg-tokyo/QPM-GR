// src/core/jotaiBridge.ts
// Jotai bridge that coordinates with Aries Mod / other mods
// Prioritizes reading from existing stores, falls back to capture if needed

import { readSharedGlobal, shareGlobal, pageWindow } from './pageContext';
import { log } from '../utils/logger';
import { healthBus } from '../diagnostics/healthBus';
import { createNamedLogger } from '../diagnostics/logger';
import type { Subsystem, SubsystemHealth } from '../diagnostics/types';

export type JotaiStore = {
  get(atom: unknown): any;
  set(atom: unknown, value: unknown): void | Promise<void>;
  sub(atom: unknown, cb: () => void): () => void | Promise<() => void>;
  __polyfill?: boolean;
  __source?: string;
};

// ── Diagnostics bus wiring (Phase 2 item 2.4) ──────────────────────────────
const JOTAI_SUBSYSTEM: Subsystem = 'jotaiBridge';
const diagLog = createNamedLogger('jotaiBridge');

type CaptureMode = 'aries' | 'shared' | 'fiber' | 'write' | 'cache-read' | 'none';

let diagnosticsStarted = false;
let lastReportedMode: CaptureMode | null = null;

const MODE_TO_STATUS: Record<CaptureMode, SubsystemHealth['status']> = {
  aries: 'ok',
  shared: 'ok',
  fiber: 'ok',
  write: 'ok',
  'cache-read': 'degraded',
  none: 'failed',
};

const MODE_TO_MESSAGE: Record<CaptureMode, string> = {
  aries: 'Captured via Aries Mod store',
  shared: 'Captured via shared global store',
  fiber: 'Captured via React fiber walk',
  write: 'Captured via write-once patch',
  'cache-read': 'Read-only cache-read fallback (polyfill)',
  none: 'No store available — polyfill that throws',
};

/**
 * Wire the jotaiBridge subsystem into the diagnostics health bus. Idempotent.
 * Must run after initDiagnostics() so the bus exists.
 */
export function startJotaiBridgeDiagnostics(): void {
  if (diagnosticsStarted) return;
  diagnosticsStarted = true;
  healthBus.register(JOTAI_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Awaiting first ensureJotaiStore() resolution',
  });

  // If a capture already happened before diagnostics started, replay it now.
  if (lastCaptureMode !== null) {
    reportJotaiCapture(lastCaptureMode);
  }
}

export function stopJotaiBridgeDiagnostics(): void {
  if (!diagnosticsStarted) return;
  diagnosticsStarted = false;
  lastReportedMode = null;
}

function reportJotaiCapture(mode: CaptureMode): void {
  if (!diagnosticsStarted) return;
  if (mode === lastReportedMode) return;
  lastReportedMode = mode;

  const status = MODE_TO_STATUS[mode];
  const message = MODE_TO_MESSAGE[mode];

  healthBus.publish({
    subsystem: JOTAI_SUBSYSTEM,
    category: 'core',
    status,
    message,
    metrics: { source: mode },
  });

  // 'none' tier is a true failure — fire JOTAI-001 for the error buffer.
  // Other tiers (including cache-read) are recorded via metrics.source per
  // JOTAI-002 — info-severity, no error-buffer noise.
  if (mode === 'none') {
    diagLog.error('QPM-JOTAI-001', {
      ariesPresent: !!(pageWindow as any)?.AriesMod,
    });
  }
}

const STORE_GLOBAL_KEY = '__qpmJotaiStore__';
const CACHE_GLOBAL_KEY = '__qpmJotaiAtomCache__';

// Keys to check for existing stores - Aries Mod keys first
const SHARED_STORE_KEYS = [
  '__jotaiStore',      // Aries Mod primary
  'jotaiStore',        // Aries Mod alternate
  '__MG_SHARED_JOTAI__',
  '__MGTOOLS_JOTAI_STORE__',
  '__QPM_SHARED_JOTAI__',
  '__QPM_JOTAI_STORE__',
] as const;

let liveAtomCache: AtomCacheLike | null = null;
let storeRef: JotaiStore | null = null;
let captureInFlight = false;
let lastCaptureMode: 'aries' | 'shared' | 'fiber' | 'write' | 'cache-read' | null = null;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type AtomCacheLike = {
  get: (key: unknown) => unknown;
  values: () => IterableIterator<any>;
  entries?: () => IterableIterator<[any, any]>;
};

function isAtomCacheLike(value: unknown): value is AtomCacheLike {
  return !!value && typeof (value as AtomCacheLike).get === 'function' && typeof (value as AtomCacheLike).values === 'function';
}

function isValidStore(store: unknown): store is JotaiStore {
  return !!store && 
    typeof (store as JotaiStore).get === 'function' &&
    typeof (store as JotaiStore).set === 'function' &&
    typeof (store as JotaiStore).sub === 'function';
}

/**
 * Get atom cache from global scope
 */
function getAtomCache(): AtomCacheLike | undefined {
  // Check our cached reference first
  if (liveAtomCache) return liveAtomCache;

  // Check shared global
  const cached = readSharedGlobal<AtomCacheLike>(CACHE_GLOBAL_KEY);
  if (cached && isAtomCacheLike(cached)) {
    liveAtomCache = cached;
    return cached;
  }

  // Check window.jotaiAtomCache (game/Aries Mod)
  const raw = (pageWindow as unknown as Record<string, unknown>).jotaiAtomCache as
    | { cache?: unknown }
    | AtomCacheLike
    | undefined;

  const candidate = raw && 'cache' in raw ? (raw as { cache?: unknown }).cache : raw;
  if (isAtomCacheLike(candidate)) {
    liveAtomCache = candidate as AtomCacheLike;
    return candidate as AtomCacheLike;
  }

  return undefined;
}

/**
 * Try to get an existing store from Aries Mod or other mods
 */
function getExistingStore(): JotaiStore | null {
  // 1) Aries Mod services - highest priority
  try {
    const ariesStore = (pageWindow as any)?.AriesMod?.services?.jotaiStore;
    if (isValidStore(ariesStore) && !ariesStore.__polyfill) {
      return { ...ariesStore, __source: 'aries' } as JotaiStore;
    }
  } catch {}

  // 2) Check shared global slots
  for (const key of SHARED_STORE_KEYS) {
    try {
      const candidate = (pageWindow as any)[key];
      if (isValidStore(candidate) && !candidate.__polyfill) {
        return candidate;
      }
    } catch {}
  }

  // 3) Check our own shared global
  const shared = readSharedGlobal<JotaiStore>(STORE_GLOBAL_KEY);
  if (isValidStore(shared) && !shared.__polyfill) {
    return shared;
  }

  return null;
}

/**
 * Find store via React Fiber tree
 */
function findStoreViaFiber(): JotaiStore | null {
  type FiberNode = {
    pendingProps?: { value?: unknown } & Record<string, unknown>;
    child?: FiberNode | null;
    sibling?: FiberNode | null;
    alternate?: FiberNode | null;
  };

  type ReactDevToolsHook = {
    renderers?: Map<number, unknown>;
    getFiberRoots?: (rendererId: number) => Set<FiberNode> | undefined;
  };

  const hook = (pageWindow as unknown as Record<string, unknown>)[
    '__REACT_DEVTOOLS_GLOBAL_HOOK__'
  ] as ReactDevToolsHook | undefined;
  
  if (!hook?.renderers?.size) return null;

  for (const [rendererId] of hook.renderers) {
    const roots = hook.getFiberRoots?.(rendererId);
    if (!roots) continue;

    for (const root of roots) {
      const seen = new Set<FiberNode>();
      const stack: Array<FiberNode | null | undefined> = [];

      const fiberRoot = (root as { current?: FiberNode }).current ?? root;
      if (fiberRoot) stack.push(fiberRoot);

      while (stack.length) {
        const fiber = stack.pop();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);

        const value = fiber.pendingProps?.value;
        if (isValidStore(value)) {
          return { ...value, __source: 'fiber' } as JotaiStore;
        }

        if (fiber.child) stack.push(fiber.child);
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.alternate) stack.push(fiber.alternate);
      }
    }
  }
  return null;
}

/**
 * Wait for atom cache to become available
 */
async function waitForAtomCache(timeoutMs = 5000): Promise<AtomCacheLike | undefined> {
  const start = Date.now();
  let cache = getAtomCache();

  while (!cache && Date.now() - start < timeoutMs) {
    await wait(100);
    cache = getAtomCache();
  }

  if (cache) {
    liveAtomCache = cache;
    // Mirror to our global for other mods
    try {
      shareGlobal(CACHE_GLOBAL_KEY, cache);
    } catch {}
  }

  return cache;
}

/**
 * Capture store via write-once patching
 * Only used as fallback when no existing store is available
 */
async function captureViaWriteOnce(timeoutMs = 5000): Promise<JotaiStore | null> {
  const cache = await waitForAtomCache(timeoutMs);
  if (!cache) {
    return null;
  }

  let capturedGet: ((atom: unknown) => unknown) | null = null;
  let capturedSet: ((atom: unknown, value: unknown) => void | Promise<void>) | null = null;

  type PatchedAtom = {
    write?: (get: any, set: any, ...args: any[]) => unknown;
    __origWrite?: (get: any, set: any, ...args: any[]) => unknown;
    __qpmPatched?: boolean;
  } & Record<string, unknown>;

  const patchedAtoms: PatchedAtom[] = [];

  const restorePatchedAtoms = () => {
    for (const atom of patchedAtoms) {
      try {
        if (atom.__origWrite) {
          atom.write = atom.__origWrite;
          delete atom.__origWrite;
          delete atom.__qpmPatched;
        }
      } catch {}
    }
  };

  let alreadyPatched = false;
  const candidates = new Set<PatchedAtom>();
  const pushCandidate = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const candidate = value as PatchedAtom;
    if (typeof candidate.write === 'function') {
      candidates.add(candidate);
    }
  };

  // Jotai cache is typically Map<atom, atomState>.
  // Patch atom KEYS first; some runtimes do not expose atom objects in cache.values().
  if (typeof cache.entries === 'function') {
    for (const [atomKey, atomState] of cache.entries()) {
      pushCandidate(atomKey);
      pushCandidate(atomState);
    }
  }

  // Keep legacy values() scan for compatibility with runtimes storing atoms as values.
  for (const atomValue of cache.values()) {
    pushCandidate(atomValue);
  }

  for (const candidate of candidates) {
    // Check if already patched by another mod (Aries Mod uses __origWrite too)
    if (candidate.__origWrite || candidate.__qpmPatched) {
      alreadyPatched = true;
      continue;
    }

    try {
      const original = candidate.write!.bind(candidate);
      candidate.__origWrite = candidate.write!;
      candidate.__qpmPatched = true;
      candidate.write = function patchedWrite(get: any, set: any, ...args: any[]) {
        if (!capturedSet) {
          capturedGet = get;
          capturedSet = set;
          restorePatchedAtoms();
        }
        return original(get, set, ...args);
      };
      patchedAtoms.push(candidate);
    } catch {
      // Some atom objects can be frozen/non-configurable in certain builds.
      // Ignore and continue patching other candidates.
    }
  }

  // If another mod already patched writes, wait to see if they expose the store
  if (alreadyPatched && !patchedAtoms.length) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const shared = getExistingStore();
      if (shared) {
        return shared;
      }
      await wait(100);
    }
    return null;
  }

  // Wait for capture
  try {
    const deadline = Date.now() + timeoutMs;
    while (!capturedSet && Date.now() < deadline) {
      await wait(50);
    }
  } finally {
    restorePatchedAtoms();
  }

  if (!capturedSet || !capturedGet) {
    return null;
  }

  // Use batched polling for subscriptions (shared with cache-read store)
  return {
    get(atom: unknown) {
      return capturedGet!(atom);
    },
    async set(atom: unknown, value: unknown) {
      await capturedSet!(atom, value);
    },
    sub(atom: unknown, cb: () => void) {
      return batchedSubscriptionManager.subscribe(atom, cb, () => {
        try { return capturedGet!(atom); } catch { return undefined; }
      });
    },
    __source: 'write',
  };
}

// ============================================================================
// BATCHED SUBSCRIPTION MANAGER
// Uses a single requestAnimationFrame loop instead of multiple setIntervals
// ============================================================================

type SubscriptionEntry = {
  atom: unknown;
  callbacks: Set<() => void>;
  getValue: () => unknown;
  lastValue: unknown;
};

class BatchedSubscriptionManager {
  private subscriptions = new Map<unknown, SubscriptionEntry>();
  private rafId: number | null = null;
  private isRunning = false;
  private lastPollTime = 0;
  private readonly POLL_INTERVAL_MS = 500; // Poll every 500ms instead of 100-250ms per subscription

  subscribe(atom: unknown, cb: () => void, getValue: () => unknown): () => void {
    let entry = this.subscriptions.get(atom);
    if (!entry) {
      entry = { atom, callbacks: new Set(), getValue, lastValue: undefined };
      // Get initial value
      try { entry.lastValue = getValue(); } catch {}
      this.subscriptions.set(atom, entry);
    }
    entry.callbacks.add(cb);

    // Start polling if not already running
    if (!this.isRunning && this.subscriptions.size > 0) {
      this.start();
    }

    return () => {
      entry?.callbacks.delete(cb);
      if (entry?.callbacks.size === 0) {
        this.subscriptions.delete(atom);
        if (this.subscriptions.size === 0) {
          this.stop();
        }
      }
    };
  }

  private start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastPollTime = performance.now();
    this.tick();
  }

  private stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isRunning = false;
  }

  private tick = (): void => {
    if (!this.isRunning) return;

    const now = performance.now();
    const elapsed = now - this.lastPollTime;

    // Only poll at the configured interval
    if (elapsed >= this.POLL_INTERVAL_MS) {
      this.lastPollTime = now;
      this.pollAllSubscriptions();
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private pollAllSubscriptions(): void {
    for (const entry of this.subscriptions.values()) {
      try {
        const current = entry.getValue();
        if (current !== entry.lastValue) {
          entry.lastValue = current;
          // Call all callbacks for this atom
          for (const cb of entry.callbacks) {
            try { cb(); } catch {}
          }
        }
      } catch {}
    }
  }

  getStats(): { count: number; atoms: string[] } {
    return {
      count: this.subscriptions.size,
      atoms: Array.from(this.subscriptions.keys()).map(a => String(a)),
    };
  }
}

const batchedSubscriptionManager = new BatchedSubscriptionManager();

/**
 * Create a cache-read-only store that reads directly from Jotai's atom cache
 */
function createCacheReadStore(): JotaiStore {
  return {
    get(atom: unknown) {
      const cache = getAtomCache();
      if (!cache) {
        throw new Error('Jotai atom cache not available');
      }
      const state = cache.get(atom) as { v?: unknown } | undefined;
      if (state && Object.prototype.hasOwnProperty.call(state, 'v')) {
        return state.v;
      }
      throw new Error('Atom value not found in cache');
    },
    set() {
      throw new Error('QPM cache-read store cannot write. Use Aries Mod for writes.');
    },
    sub(atom: unknown, cb: () => void) {
      return batchedSubscriptionManager.subscribe(atom, cb, () => {
        const cache = getAtomCache();
        if (!cache) return undefined;
        const state = cache.get(atom) as { v?: unknown } | undefined;
        return state && Object.prototype.hasOwnProperty.call(state, 'v') ? state.v : undefined;
      });
    },
    __polyfill: true,
    __source: 'cache-read',
  };
}

/**
 * Share our store for other mods, but DON'T overwrite existing stores
 */
function shareStoreNonInvasively(store: JotaiStore): void {
  try {
    shareGlobal(STORE_GLOBAL_KEY, store);
  } catch {}
  
  try {
    if (!(pageWindow as any).__QPM_JOTAI_STORE__) {
      (pageWindow as any).__QPM_JOTAI_STORE__ = store;
    }
  } catch {}
  
  // Also mirror to common global keys if not set
  try {
    if (!(pageWindow as any).__jotaiStore && !store.__polyfill) {
      (pageWindow as any).__jotaiStore = store;
    }
  } catch {}
}

/**
 * Main entry point - get a Jotai store for reading
 */
export async function ensureJotaiStore(): Promise<JotaiStore> {
  // Return cached store if we have a valid one
  if (storeRef && !storeRef.__polyfill) {
    return storeRef;
  }

  // 1) Check for existing store from Aries Mod or other mods
  let existing = getExistingStore();
  if (existing) {
    storeRef = existing;
    lastCaptureMode = existing.__source === 'aries' ? 'aries' : 'shared';
    shareStoreNonInvasively(storeRef);
    reportJotaiCapture(lastCaptureMode);
    return storeRef;
  }

  // 2) If Aries Mod is present but store not ready, wait a bit for it
  const ariesPresent = !!(pageWindow as any)?.AriesMod;
  if (ariesPresent) {
    const maxWait = 3000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await wait(200);
      existing = getExistingStore();
      if (existing) {
        storeRef = existing;
        lastCaptureMode = existing.__source === 'aries' ? 'aries' : 'shared';
        shareStoreNonInvasively(storeRef);
        reportJotaiCapture(lastCaptureMode);
        return storeRef;
      }
    }
  }

  // Prevent concurrent captures
  if (captureInFlight) {
    const maxWait = 6000;
    const start = Date.now();
    while (captureInFlight && Date.now() - start < maxWait) {
      await wait(50);
    }
    if (storeRef && !storeRef.__polyfill) {
      return storeRef;
    }
  }

  captureInFlight = true;
  try {
    // 3) Try React Fiber
    const fiberStore = findStoreViaFiber();
    if (fiberStore) {
      storeRef = fiberStore;
      lastCaptureMode = 'fiber';
      shareStoreNonInvasively(storeRef);
      reportJotaiCapture(lastCaptureMode);
      return storeRef;
    }

    // 4) Try write-once capture (only if no other mod has captured)
    const writeStore = await captureViaWriteOnce(5000);
    if (writeStore) {
      storeRef = writeStore;
      lastCaptureMode = 'write';
      shareStoreNonInvasively(storeRef);
      reportJotaiCapture(lastCaptureMode);
      return storeRef;
    }

    // 5) Final fallback: cache-read-only store
    // This can at least read values if the cache exists
    const cache = getAtomCache();
    if (cache) {
      storeRef = createCacheReadStore();
      lastCaptureMode = 'cache-read';
      shareStoreNonInvasively(storeRef);
      log('[jotaiBridge] Using cache-read fallback store');
      reportJotaiCapture(lastCaptureMode);
      return storeRef;
    }

    // 6) No options left - return a store that will throw on every operation
    log('[jotaiBridge] ⚠️ No Jotai store available - functionality limited');
    storeRef = {
      get() { throw new Error('Jotai store unavailable'); },
      set() { throw new Error('Jotai store unavailable'); },
      sub() { return () => {}; },
      __polyfill: true,
      __source: 'none',
    };
    lastCaptureMode = null;
    reportJotaiCapture('none');
    return storeRef;
  } finally {
    captureInFlight = false;
  }
}

/**
 * Get info about how we captured the store
 */
export function getCapturedInfo() {
  return {
    mode: lastCaptureMode,
    hasStore: !!storeRef && !storeRef.__polyfill,
    isReadOnly: storeRef?.__polyfill ?? true,
    source: storeRef?.__source,
  };
}

export function getCachedStore(): JotaiStore | null {
  return storeRef;
}

export function findAtomsByLabel(regex: RegExp): any[] {
  const cache = getAtomCache();
  if (!cache) return [];

  const matches: any[] = [];

  // Prefer entries() — returns [atomKey, atomMeta] pairs.
  // The KEY is the actual atom object the jotai store recognizes.
  // Derived atoms (e.g. myPetSlotInfosAtom) only work when we pass the KEY,
  // not the metadata value, to store.get() / store.sub().
  if (typeof cache.entries === 'function') {
    for (const [atom, meta] of cache.entries()) {
      if (!atom || typeof atom !== 'object') continue;
      const metaObj = meta as Record<string, unknown>;
      const atomObj = atom as Record<string, unknown>;
      // debugLabel may live on the meta object (derived atoms) or the atom itself (primitive atoms)
      const label = String(
        metaObj?.debugLabel ?? metaObj?.label ??
        atomObj.debugLabel ?? atomObj.label ?? ''
      );
      if (regex.test(label)) {
        matches.push(atom);
      }
    }
    if (matches.length > 0) return matches;
  }

  // Fallback: values() iteration (works when atom objects are stored as values,
  // as in some jotai versions where primitive atoms are their own metadata).
  for (const atom of cache.values()) {
    if (!atom) continue;
    const label = String((atom as Record<string, unknown>).debugLabel ?? (atom as Record<string, unknown>).label ?? '');
    if (regex.test(label)) {
      matches.push(atom);
    }
  }
  return matches;
}

/**
 * Return all atom entries from the cache with their labels.
 * Used by atomRegistry for structure scanning and auto-cataloging.
 */
export function getAllAtomEntries(): Array<{ atom: unknown; label: string }> {
  const cache = getAtomCache();
  if (!cache) return [];
  const entries: Array<{ atom: unknown; label: string }> = [];
  if (typeof cache.entries === 'function') {
    for (const [atom, meta] of cache.entries()) {
      if (!atom || typeof atom !== 'object') continue;
      const metaObj = meta as Record<string, unknown>;
      const atomObj = atom as Record<string, unknown>;
      const label = String(
        metaObj?.debugLabel ?? metaObj?.label ??
        atomObj.debugLabel ?? atomObj.label ?? ''
      );
      entries.push({ atom, label });
    }
  }
  return entries;
}

/**
 * Find atom by checking its value structure (fallback when labels are unavailable)
 */
function findAtomByStructure(matcher: (value: any) => boolean): any | null {
  const cache = getAtomCache();
  if (!cache) return null;

  for (const atom of cache.values()) {
    if (!atom) continue;

    try {
      const state = cache.get(atom) as { v?: unknown } | undefined;
      if (state && Object.prototype.hasOwnProperty.call(state, 'v')) {
        if (matcher(state.v)) {
          return atom;
        }
      }
    } catch {
      // Ignore atoms that can't be read
    }
  }

  return null;
}

export function getAtomByLabel(label: string): any | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped}$`);
  return findAtomsByLabel(regex)[0] ?? null;
}

export async function readAtomValue<T = unknown>(atom: any): Promise<T> {
  // Try store first
  try {
    const store = await ensureJotaiStore();
    if (!store.__polyfill) {
      return store.get(atom) as T;
    }
  } catch {}

  // Fallback: read directly from cache
  const cache = getAtomCache();
  if (cache) {
    try {
      const state = cache.get(atom) as { v?: unknown } | undefined;
      if (state && Object.prototype.hasOwnProperty.call(state, 'v')) {
        return state.v as T;
      }
    } catch {}
  }

  throw new Error('Unable to read atom value');
}

export async function writeAtomValue(atom: any, value: unknown): Promise<void> {
  const store = await ensureJotaiStore();
  if (store.__polyfill) {
    throw new Error('QPM uses read-only Jotai access. Writes require Aries Mod.');
  }
  await store.set(atom, value);
}

export async function subscribeAtom<T = unknown>(atom: any, cb: (value: T) => void): Promise<() => void> {
  const store = await ensureJotaiStore();
  
  let disposed = false;
  const invoke = () => {
    if (disposed) return;
    try {
      const value = store.get(atom) as T;
      cb(value);
    } catch {}
  };

  const maybeUnsub = store.sub(atom, invoke);
  const unsubscribe = typeof maybeUnsub === 'function' ? maybeUnsub : await maybeUnsub;

  // Initial value
  invoke();

  return () => {
    disposed = true;
    try {
      unsubscribe?.();
    } catch {}
  };
}

