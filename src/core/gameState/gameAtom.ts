// Read or watch an atom object the game handed QPM (a shop config's `isOpenAtom`), on the game's own store only.
// For atoms that have no label to key on; labelled state goes through the key table.
import { getCachedStore } from '../jotaiBridge';

export type GameAtomRead = { ok: true; value: unknown } | { ok: false };

export function readGameAtom(atom: unknown): GameAtomRead {
  const store = getCachedStore();
  if (!store || store.__polyfill || atom === null || typeof atom !== 'object') return { ok: false };
  try {
    return { ok: true, value: store.get(atom) };
  } catch {
    return { ok: false };
  }
}

/** Null when it could not subscribe. `cb` is called on each change, not on subscribe. */
export function subscribeGameAtom(atom: unknown, cb: () => void): (() => void) | null {
  const store = getCachedStore();
  if (!store || store.__polyfill || atom === null || typeof atom !== 'object') return null;
  let live = true;
  try {
    const unsub = store.sub(atom, () => { if (live) cb(); });
    if (typeof unsub !== 'function') return null;
    return () => {
      live = false;
      try { void unsub(); } catch { /* store gone with the page */ }
    };
  } catch {
    return null;
  }
}
