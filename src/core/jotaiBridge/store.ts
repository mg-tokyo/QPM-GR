import { pageWindow, shareGlobal } from '../pageContext';
import type { CaptureMode, JotaiStore } from './types';
import {
  NATIVE_STORE_WAIT_MS,
  STORE_GLOBAL_KEY,
  getStoreRef,
  isCaptureInFlight,
  setCaptureInFlight,
  setLastCaptureMode,
  setStoreRef,
  getLastCaptureMode,
  wait,
} from './state';
import { diagLog, reportJotaiCapture } from './diagnostics';
import { getAtomCache } from './cache';
import {
  captureViaWriteOnce,
  createCacheReadStore,
  findStoreViaFiber,
  getExistingStore,
} from './capture';

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

  // __jotaiStore is the game's own slot since release 1604 — never write it.
}

function existingStoreMode(store: JotaiStore): Exclude<CaptureMode, 'none'> {
  if (store.__source === 'native' || store.__source === 'aries') return store.__source;
  return 'shared';
}

function adoptExistingStore(store: JotaiStore): JotaiStore {
  const mode = existingStoreMode(store);
  setStoreRef(store);
  setLastCaptureMode(mode);
  shareStoreNonInvasively(store);
  reportJotaiCapture(mode);
  return store;
}

/**
 * Main entry point - get a Jotai store for reading
 */
export async function ensureJotaiStore(): Promise<JotaiStore> {
  // Return cached store if we have a valid one
  const cached = getStoreRef();
  if (cached && !cached.__polyfill) {
    return cached;
  }

  // 1) The game's published store, or one from Aries Mod / other mods
  const existing = getExistingStore();
  if (existing) return adoptExistingStore(existing);

  // 2) The game assigns __jotaiStore before first render with no event to
  //    hook; give it (and a slow Aries Mod) a bounded window before patching.
  const start = Date.now();
  while (Date.now() - start < NATIVE_STORE_WAIT_MS) {
    await wait(200);
    const late = getExistingStore();
    if (late) return adoptExistingStore(late);
  }

  // Prevent concurrent captures
  if (isCaptureInFlight()) {
    const maxWait = 6000;
    const start = Date.now();
    while (isCaptureInFlight() && Date.now() - start < maxWait) {
      await wait(50);
    }
    const afterWait = getStoreRef();
    if (afterWait && !afterWait.__polyfill) {
      return afterWait;
    }
  }

  setCaptureInFlight(true);
  try {
    // 3) Try React Fiber
    const fiberStore = findStoreViaFiber();
    if (fiberStore) {
      setStoreRef(fiberStore);
      setLastCaptureMode('fiber');
      shareStoreNonInvasively(fiberStore);
      reportJotaiCapture('fiber');
      return fiberStore;
    }

    // 4) Try write-once capture (only if no other mod has captured). It can
    //    also return the game's store if that appeared while it waited.
    const writeStore = await captureViaWriteOnce(5000);
    if (writeStore) {
      const mode = writeStore.__source === 'native' ? 'native' : 'write';
      setStoreRef(writeStore);
      setLastCaptureMode(mode);
      shareStoreNonInvasively(writeStore);
      reportJotaiCapture(mode);
      return writeStore;
    }

    // 5) Final fallback: cache-read-only store
    // This can at least read values if the cache exists
    const cache = getAtomCache();
    if (cache) {
      const cacheReadStore = createCacheReadStore();
      setStoreRef(cacheReadStore);
      setLastCaptureMode('cache-read');
      shareStoreNonInvasively(cacheReadStore);
      diagLog.debug('Using cache-read fallback store');
      reportJotaiCapture('cache-read');
      return cacheReadStore;
    }

    // 6) No options left - return a store that will throw on every operation
    diagLog.debug('No Jotai store available - functionality limited');
    const noneStore: JotaiStore = {
      get() { throw new Error('Jotai store unavailable'); },
      set() { throw new Error('Jotai store unavailable'); },
      sub() { return () => {}; },
      __polyfill: true,
      __source: 'none',
    };
    setStoreRef(noneStore);
    setLastCaptureMode(null);
    reportJotaiCapture('none');
    return noneStore;
  } finally {
    setCaptureInFlight(false);
  }
}

/**
 * Get info about how we captured the store
 */
export function getCapturedInfo() {
  const store = getStoreRef();
  return {
    mode: getLastCaptureMode(),
    hasStore: !!store && !store.__polyfill,
    isReadOnly: store?.__polyfill ?? true,
    source: store?.__source,
  };
}

export function getCachedStore(): JotaiStore | null {
  return getStoreRef();
}
