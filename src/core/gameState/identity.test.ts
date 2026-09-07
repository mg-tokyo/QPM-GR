import { beforeEach, describe, expect, it } from 'vitest';
import {
  explainIdentity, getIdentity, initIdentity, onIdentityChange, refreshIdentity, stopIdentity, type IdentityDeps,
} from './identity';
import { resetTopology } from './topology';

function deps(over: Partial<IdentityDeps> = {}): IdentityDeps {
  const store = new Map<string, unknown>();
  return {
    readAtomByExactLabel: () => undefined,
    urlPlayerId: () => null,
    userSlots: () => [{ userId: 'p1' }, null, { userId: 'p2' }],
    playersInRoom: () => ['p1', 'p2'],
    storage: {
      get: <T,>(k: string, fb: T) => (store.has(k) ? (store.get(k) as T) : fb),
      set: (k: string, v: unknown) => { store.set(k, v); },
    },
    fetchAccountPlayerId: () => Promise.resolve(null),
    ...over,
  };
}

beforeEach(() => { stopIdentity(); resetTopology(); });

describe('identity ladder', () => {
  it('prefers playerIdAtom, then playerAtom.id, then the URL', () => {
    initIdentity(deps({ readAtomByExactLabel: (l) => (l === 'playerIdAtom' ? 'p2' : undefined) }));
    expect(getIdentity()).toEqual({ playerId: 'p2', myIdx: 2 });
    expect(explainIdentity().rung).toBe('playerIdAtom');
    stopIdentity();
    initIdentity(deps({ readAtomByExactLabel: (l) => (l === 'playerAtom' ? { id: 'p1' } : undefined) }));
    expect(getIdentity()).toEqual({ playerId: 'p1', myIdx: 0 });
    stopIdentity();
    initIdentity(deps({ urlPlayerId: () => 'p1' }));
    expect(explainIdentity().rung).toBe('url');
  });
  it('accepts a persisted id only when that player is in the room', () => {
    const d = deps();
    d.storage.set('qpm.identity.playerId.v1', 'p2');
    initIdentity(d);
    expect(getIdentity().playerId).toBe('p2');
    stopIdentity();
    const d2 = deps({ playersInRoom: () => ['p1'] });
    d2.storage.set('qpm.identity.playerId.v1', 'p2');
    initIdentity(d2);
    expect(getIdentity().playerId).toBeNull();
  });
  it('persists a resolved id and notifies on change', () => {
    let calls = 0;
    const d = deps();
    initIdentity(d);
    onIdentityChange(() => { calls++; });
    expect(getIdentity().playerId).toBeNull();
    d.readAtomByExactLabel = (l) => (l === 'playerIdAtom' ? 'p1' : undefined);
    expect(refreshIdentity().playerId).toBe('p1');
    expect(d.storage.get('qpm.identity.playerId.v1', null)).toBe('p1');
    expect(calls).toBe(1);
  });
  it('re-scans myIdx when the cached slot no longer belongs to me', () => {
    let slots: unknown[] = [{ userId: 'p1' }];
    initIdentity(deps({ readAtomByExactLabel: (l) => (l === 'playerIdAtom' ? 'p1' : undefined), userSlots: () => slots }));
    expect(getIdentity().myIdx).toBe(0);
    slots = [null, { userId: 'p1' }];
    expect(getIdentity().myIdx).toBe(1);
  });
});
