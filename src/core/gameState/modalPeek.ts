// Reads what the game would build for a modal without opening it. Inside ONE store write the modal state is set
// to each name, `readRequest` runs, and the state is put back to the object it held: jotai flushes listeners once,
// after the outer write returns (jotai 3.0.2 vanilla/internals.js storeSet), so no listener sees a modal open and
// the game's SetPlayerInteraction sender (beta installPlayerInteraction.ts:15-24) reads an unchanged interaction.
import type { JotaiStore } from '../jotaiBridge';
import { isRecord } from '../../utils/typeGuards';

export type ModalPeekRefusal = 'no-store' | 'no-atom' | 'modal-open' | 'not-run' | 'threw' | 'not-restored';

export type ModalPeekResult<T> =
  | { ok: true; requests: Map<string, T | null> }
  | { ok: false; reason: ModalPeekRefusal };

type AtomSetter = (atom: unknown, value: unknown) => void;

/**
 * `readRequest` must only read: a `store.sub` or a modal open inside it flushes listeners mid-batch.
 * Refuses unless the store is the game's own and no modal is open (the one spurious activeModal
 * notification is a no-op for the game's listeners only then).
 */
export function runModalPeek<T>(
  store: JotaiStore | null,
  stateAtom: unknown,
  names: readonly string[],
  readRequest: () => T | null,
): ModalPeekResult<T> {
  if (!store || store.__polyfill) return { ok: false, reason: 'no-store' };
  if (!stateAtom) return { ok: false, reason: 'no-atom' };
  let before: unknown;
  try { before = store.get(stateAtom); } catch { return { ok: false, reason: 'no-atom' }; }
  if (!isRecord(before) || typeof before.openId !== 'number') return { ok: false, reason: 'no-atom' };
  if (before.modal !== null) return { ok: false, reason: 'modal-open' };

  const openId = before.openId;
  const requests = new Map<string, T | null>();
  let live = true;
  let ran = false;
  let failed = false;
  // A jotai atom is a plain object; a write-only one batches the sets inside it.
  const batch = {
    read: (): null => null,
    write: (_get: unknown, set: AtomSetter): void => {
      // A store whose `set` is deferred would run this later, with any modal open.
      if (!live) return;
      ran = true;
      try {
        for (const name of names) {
          set(stateAtom, { modal: name, openId });
          requests.set(name, readRequest());
        }
      } catch {
        failed = true;
      } finally {
        set(stateAtom, before);
      }
    },
    toString: (): string => 'qpmModalPeek',
  };
  try {
    void store.set(batch, undefined);
  } catch {
    failed = true;
  } finally {
    live = false;
  }
  if (!ran) return { ok: false, reason: 'not-run' };

  let after: unknown;
  try { after = store.get(stateAtom); } catch { after = undefined; }
  if (after !== before) {
    try { void store.set(stateAtom, before); } catch { /* reported below either way */ }
    return { ok: false, reason: 'not-restored' };
  }
  return failed ? { ok: false, reason: 'threw' } : { ok: true, requests };
}
