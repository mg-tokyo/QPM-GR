import { describe, expect, it } from 'vitest';
import type { JotaiStore } from '../jotaiBridge';
import { runModalPeek } from './modalPeek';

interface ModalState { modal: string | null; openId: number }
type Setter = (atom: unknown, value: unknown) => void;
interface WriteAtom { write(get: unknown, set: Setter): void }

const STATE_ATOM = { debugLabel: 'activeModalStateAtom' };

// jotai's contract as the peek relies on it: sets inside a write atom land at once, listeners run once after the outer set.
function fakeStore(initial: ModalState) {
  let state: unknown = initial;
  let depth = 0;
  let dirty = false;
  const seenByListeners: unknown[] = [];
  const writes: unknown[] = [];
  const flush = (): void => {
    if (depth > 0 || !dirty) return;
    dirty = false;
    seenByListeners.push(state);
  };
  const set: Setter = (atom, value) => {
    depth += 1;
    try {
      if (atom === STATE_ATOM) { state = value; dirty = true; writes.push(value); }
      else (atom as WriteAtom).write(() => state, set);
    } finally {
      depth -= 1;
      flush();
    }
  };
  const store: JotaiStore = { get: (atom) => (atom === STATE_ATOM ? state : undefined), set, sub: () => () => {} };
  return { store, seenByListeners, writes, current: () => state };
}

describe('runModalPeek', () => {
  it('reads each name mid-batch and leaves the identical state object', () => {
    const initial: ModalState = { modal: null, openId: 7 };
    const fake = fakeStore(initial);
    const names = ['seedShop', 'rainShop', 'nope'];
    const result = runModalPeek(fake.store, STATE_ATOM, names, () => {
      const modal = (fake.current() as ModalState).modal;
      return modal === 'nope' ? null : { name: modal };
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.requests]).toEqual([['seedShop', { name: 'seedShop' }], ['rainShop', { name: 'rainShop' }], ['nope', null]]);
    expect(fake.current()).toBe(initial);
    expect(fake.writes.slice(0, 3)).toEqual(names.map(modal => ({ modal, openId: 7 })));
  });

  it('lets listeners run once, after the state is back', () => {
    const initial: ModalState = { modal: null, openId: 1 };
    const fake = fakeStore(initial);
    runModalPeek(fake.store, STATE_ATOM, ['seedShop', 'eggShop'], () => null);
    expect(fake.seenByListeners).toHaveLength(1);
    expect(fake.seenByListeners[0]).toBe(initial);
  });

  it('refuses while a modal is open, without writing', () => {
    const fake = fakeStore({ modal: 'journal', openId: 3 });
    expect(runModalPeek(fake.store, STATE_ATOM, ['seedShop'], () => null)).toEqual({ ok: false, reason: 'modal-open' });
    expect(fake.writes).toEqual([]);
  });

  it('refuses a missing or polyfill store and an unreadable state atom', () => {
    const fake = fakeStore({ modal: null, openId: 0 });
    expect(runModalPeek(null, STATE_ATOM, ['seedShop'], () => null)).toEqual({ ok: false, reason: 'no-store' });
    expect(runModalPeek({ ...fake.store, __polyfill: true }, STATE_ATOM, ['seedShop'], () => null)).toEqual({ ok: false, reason: 'no-store' });
    expect(runModalPeek(fake.store, null, ['seedShop'], () => null)).toEqual({ ok: false, reason: 'no-atom' });
    expect(runModalPeek(fake.store, { other: true }, ['seedShop'], () => null)).toEqual({ ok: false, reason: 'no-atom' });
    expect(fake.writes).toEqual([]);
  });

  it('restores the state when the reader throws', () => {
    const initial: ModalState = { modal: null, openId: 2 };
    const fake = fakeStore(initial);
    const result = runModalPeek(fake.store, STATE_ATOM, ['seedShop', 'eggShop'], () => { throw new Error('read'); });
    expect(result).toEqual({ ok: false, reason: 'threw' });
    expect(fake.current()).toBe(initial);
    expect(fake.seenByListeners).toHaveLength(1);
  });

  it('does nothing when the store runs the batch late', () => {
    const initial: ModalState = { modal: null, openId: 4 };
    const fake = fakeStore(initial);
    const pending: Array<() => void> = [];
    const deferred: JotaiStore = {
      ...fake.store,
      set: (atom, value) => { pending.push(() => { void fake.store.set(atom, value); }); },
    };
    expect(runModalPeek(deferred, STATE_ATOM, ['seedShop'], () => null)).toEqual({ ok: false, reason: 'not-run' });
    for (const run of pending) run();
    expect(fake.writes).toEqual([]);
    expect(fake.current()).toBe(initial);
  });

  it('reports a state it could not put back, and writes it back directly', () => {
    const initial: ModalState = { modal: null, openId: 9 };
    const fake = fakeStore(initial);
    let batchSets = 0;
    const lossy: JotaiStore = {
      ...fake.store,
      set: (atom, value) => {
        if (atom === STATE_ATOM) { void fake.store.set(atom, value); return; }
        (atom as WriteAtom).write(() => fake.current(), (a, v) => {
          batchSets += 1;
          if (batchSets === 2) throw new Error('restore refused');
          void fake.store.set(a, v);
        });
      },
    };
    expect(runModalPeek(lossy, STATE_ATOM, ['seedShop'], () => null)).toEqual({ ok: false, reason: 'not-restored' });
    expect(fake.current()).toBe(initial);
  });
});
