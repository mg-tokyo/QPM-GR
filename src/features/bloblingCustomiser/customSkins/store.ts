import { storage } from '../../../utils/storage';
import { dispatchCustomEventAll } from '../../../core/pageContext';
import { CUSTOM_SKINS_STORAGE_KEY, emptyState, type CustomSkinsState } from './types';

const UPDATE_EVENT = 'qpm:blobling-custom-skins-updated';

let inMemory: CustomSkinsState = emptyState();
let loaded = false;

export function loadState(): CustomSkinsState {
  if (!loaded) {
    const fromStorage = storage.get<CustomSkinsState | null>(CUSTOM_SKINS_STORAGE_KEY, null);
    if (fromStorage && fromStorage.version === 1) {
      // Defensive: ensure all records exist even if the persisted blob is
      // malformed. `trimToShape` was added after v1.0 — old blobs lack it; we
      // default to true (safer for existing customs not authored against
      // cosmetic silhouettes).
      inMemory = {
        version: 1,
        library: fromStorage.library ?? {},
        active: fromStorage.active ?? {},
        trimToShape: fromStorage.trimToShape ?? true,
      };
    } else {
      inMemory = emptyState();
    }
    loaded = true;
  }
  return inMemory;
}

export function getInMemoryState(): CustomSkinsState {
  return loadState();
}

/**
 * Persist `next` to storage. Returns true on read-back-verified success,
 * false if the write was swallowed (e.g. quota exceeded — `storage.set`
 * itself returns void and silently catches exceptions, so read-back is the
 * only honest signal). Caller is responsible for rolling back the in-memory
 * state on `false` and surfacing a user-visible error.
 */
export function saveState(next: CustomSkinsState): boolean {
  storage.set(CUSTOM_SKINS_STORAGE_KEY, next);
  // Read-back verification — mirrors the pattern from
  // textureSwapper/index.ts:297-303.
  const readBack = storage.get<CustomSkinsState | null>(CUSTOM_SKINS_STORAGE_KEY, null);
  if (!readBack) return false;
  if (readBack.version !== 1) return false;
  return true;
}

/**
 * Apply a pure transform to the state, persist it, and broadcast the
 * update event. On persist failure (read-back miss), reverts the in-memory
 * state to the prior snapshot and returns false — callers should treat
 * this as a quota-exceeded condition.
 */
export function mutate(fn: (s: CustomSkinsState) => CustomSkinsState): boolean {
  const prior = loadState();
  const next = fn(prior);
  inMemory = next;
  const ok = saveState(next);
  if (!ok) {
    inMemory = prior;
    return false;
  }
  loaded = true;
  dispatchCustomEventAll(UPDATE_EVENT, {});
  return true;
}

/**
 * Subscribe to the cross-realm update event so UI + interceptor refresh
 * whenever the state changes. Listens on the sandbox window because
 * dispatchCustomEventAll dispatches to both pageWindow and sandbox; the
 * userscript runs in sandbox so this listener catches every emit.
 */
export function onStateChange(cb: () => void): () => void {
  const handler = (): void => cb();
  window.addEventListener(UPDATE_EVENT, handler);
  return () => window.removeEventListener(UPDATE_EVENT, handler);
}
