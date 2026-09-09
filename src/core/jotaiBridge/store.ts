import { pageWindow, shareGlobal } from '../pageContext';
import type { JotaiStore } from './types';
import {
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
  const cached = getStoreRef();
  if (cached && !cached.__polyfill) {
    return cached;
  }

  // 1) Check for existing store from Aries Mod or other mods
  let existing = getExistingStore();
  if (existing) {
    setStoreRef(existing);
    setLastCaptureMode(existing.__source === 'aries' ? 'aries' : 'shared');
    shareStoreNonInvasively(existing);
    reportJotaiCapture(existing.__source === 'aries' ? 'aries' : 'shared');
    return existing;
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
        setStoreRef(existing);
        setLastCaptureMode(existing.__source === 'aries' ? 'aries' : 'shared');
        shareStoreNonInvasively(existing);
        reportJotaiCapture(existing.__source === 'aries' ? 'aries' : 'shared');
        return existing;
      }
    }
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

    // 4) Try write-once capture (only if no other mod has captured). The store
    //    reports its own __source: 'write' when the write channel fired, or
    //    'read' when only the atom.read channel captured a store getter (still
    //    usable for reads, throws on set).
    const writeStore = await captureViaWriteOnce(5000);
    if (writeStore) {
      const mode = writeStore.__source === 'read' ? 'read' : 'write';
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
