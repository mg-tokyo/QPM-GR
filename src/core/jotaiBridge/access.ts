import { ensureJotaiStore } from './store';
import { noteStoreGetFailure, noteStoreGetSuccess } from './capture';
import { getAtomCache } from './cache';

export async function readAtomValue<T = unknown>(atom: any): Promise<T> {
  // Try store first
  try {
    const store = await ensureJotaiStore();
    if (!store.__polyfill) {
      try {
        const value = store.get(atom) as T;
        noteStoreGetSuccess();
        return value;
      } catch (err) {
        noteStoreGetFailure();
        throw err;
      }
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

export async function subscribeAtom<T = unknown>(
  atom: any,
  cb: (value: T) => void,
  hint?: import('../reactive/types').SubscriberTier,
  statePath?: import('../reactive/types').PatchPath,
): Promise<() => void> {
  const store = await ensureJotaiStore();

  let disposed = false;
  const invoke = () => {
    if (disposed) return;
    try {
      const value = store.get(atom) as T;
      cb(value);
    } catch {}
  };

  const maybeUnsub = store.sub(atom, invoke, hint, statePath);
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
