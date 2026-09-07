import { pageWindow, readSharedGlobal } from '../pageContext';
import type { JotaiStore } from './types';
import {
  SHARED_STORE_KEYS,
  STORE_FAILURE_THRESHOLD,
  STORE_GLOBAL_KEY,
  getConsecutiveStoreGetFailures,
  getStoreRef,
  setConsecutiveStoreGetFailures,
  setLastCaptureMode,
  setStoreRef,
  wait,
} from './state';
import { diagLog } from './diagnostics';
import { getAtomCache, waitForAtomCache } from './cache';
import { batchedSubscriptionManager } from './polling';
import { getReactiveHook } from './reactiveHook';

export function isValidStore(store: unknown): store is JotaiStore {
  return !!store &&
    typeof (store as JotaiStore).get === 'function' &&
    typeof (store as JotaiStore).set === 'function' &&
    typeof (store as JotaiStore).sub === 'function';
}

/**
 * Functional probe: a duck-typed store from a shared global can be broken
 * (another mod's half-initialised or stale store). Try one real get() against
 * a known atom from the cache before caching the candidate for the session.
 * No probe-able atom available → accept provisionally (true).
 */
function probeStore(store: JotaiStore): boolean {
  const cache = getAtomCache();
  if (!cache) return true;
  let probeAtom: unknown;
  try {
    // Only entry KEYS are guaranteed to be real atoms (values may be atom
    // states); require the jotai atom shape (`read` fn) to avoid a false
    // negative from get()-ing a non-atom on a healthy store.
    if (typeof cache.entries === 'function') {
      let scanned = 0;
      for (const [key] of cache.entries()) {
        if (key && typeof (key as { read?: unknown }).read === 'function') {
          probeAtom = key;
          break;
        }
        if (++scanned >= 50) break;
      }
    }
  } catch {
    return true;
  }
  if (probeAtom === undefined) return true;
  try {
    store.get(probeAtom);
    return true;
  } catch {
    return false;
  }
}

export function noteStoreGetSuccess(): void {
  setConsecutiveStoreGetFailures(0);
}

export function noteStoreGetFailure(): void {
  const next = getConsecutiveStoreGetFailures() + 1;
  setConsecutiveStoreGetFailures(next);
  if (next >= STORE_FAILURE_THRESHOLD) {
    setConsecutiveStoreGetFailures(0);
    if (getStoreRef()) {
      diagLog.debug('Jotai store failing reads — invalidating cached store for recapture');
      setStoreRef(null);
      setLastCaptureMode(null);
    }
  }
}

/**
 * Try to get an existing store from Aries Mod or other mods
 */
export function getExistingStore(): JotaiStore | null {
  // 1) Aries Mod services - highest priority
  try {
    const ariesStore = (pageWindow as any)?.AriesMod?.services?.jotaiStore;
    if (isValidStore(ariesStore) && !ariesStore.__polyfill) {
      const candidate = { ...ariesStore, __source: 'aries' } as JotaiStore;
      if (probeStore(candidate)) return candidate;
      diagLog.debug('Aries jotai store failed functional probe — skipping');
    }
  } catch {}

  // 2) Check shared global slots
  for (const key of SHARED_STORE_KEYS) {
    try {
      const candidate = (pageWindow as any)[key];
      if (isValidStore(candidate) && !candidate.__polyfill) {
        if (probeStore(candidate)) return candidate;
        diagLog.debug(`Shared jotai store '${key}' failed functional probe — skipping`);
      }
    } catch {}
  }

  // 3) Check our own shared global
  const shared = readSharedGlobal<JotaiStore>(STORE_GLOBAL_KEY);
  if (isValidStore(shared) && !shared.__polyfill) {
    if (probeStore(shared)) return shared;
    diagLog.debug('Own shared jotai store failed functional probe — skipping');
  }

  return null;
}

/**
 * Find store via React Fiber tree
 */
export function findStoreViaFiber(): JotaiStore | null {
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
 * Capture store via write-once patching
 * Only used as fallback when no existing store is available
 */
export async function captureViaWriteOnce(timeoutMs = 5000): Promise<JotaiStore | null> {
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

  // Use batched polling for subscriptions (shared with cache-read store).
  // Also honors reactive-manager routing when a caller passes a tier hint AND
  // the tier's kill switch is on — see createCacheReadStore below for the same
  // routing check; both polyfill stores must handle hints for the state kill
  // switch to actually migrate subscribers.
  return {
    get(atom: unknown) {
      return capturedGet!(atom);
    },
    async set(atom: unknown, value: unknown) {
      await capturedSet!(atom, value);
    },
    sub(
      atom: unknown,
      cb: () => void,
      hint?: import('../reactive/types').SubscriberTier,
      statePath?: import('../reactive/types').PatchPath,
    ) {
      const getValue = () => {
        try { return capturedGet!(atom); } catch { return undefined; }
      };
      const hook = getReactiveHook();
      if (hint && hook && hook.isTierEnabled(hint)) {
        const opts: import('../reactive/types').ReactiveSubscribeOptions =
          statePath !== undefined
            ? { cb, getValue, tier: hint, statePath }
            : { cb, getValue, tier: hint };
        return hook.subscribe(atom, opts);
      }
      return batchedSubscriptionManager.subscribe(atom, cb, getValue);
    },
    __source: 'write',
  };
}

/**
 * Create a cache-read-only store that reads directly from Jotai's atom cache
 */
export function createCacheReadStore(): JotaiStore {
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
    sub(
      atom: unknown,
      cb: () => void,
      hint?: import('../reactive/types').SubscriberTier,
      statePath?: import('../reactive/types').PatchPath,
    ) {
      const getValue = () => {
        const cache = getAtomCache();
        if (!cache) return undefined;
        const state = cache.get(atom) as { v?: unknown } | undefined;
        return state && Object.prototype.hasOwnProperty.call(state, 'v') ? state.v : undefined;
      };
      // Route through the reactive manager when the caller supplied a tier
      // hint AND that tier's kill switch is on. Otherwise fall back to the
      // polling manager — that's still the safe path during rollout.
      const hook = getReactiveHook();
      if (hint && hook && hook.isTierEnabled(hint)) {
        const opts: import('../reactive/types').ReactiveSubscribeOptions =
          statePath !== undefined
            ? { cb, getValue, tier: hint, statePath }
            : { cb, getValue, tier: hint };
        return hook.subscribe(atom, opts);
      }
      return batchedSubscriptionManager.subscribe(atom, cb, getValue);
    },
    __polyfill: true,
    __source: 'cache-read',
  };
}
