import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { warnSpy, infoSpy } = vi.hoisted(() => ({ warnSpy: vi.fn(), infoSpy: vi.fn() }));

vi.mock('../../diagnostics/logger', () => ({
  createNamedLogger: () => ({ debug: vi.fn(), info: infoSpy, warn: warnSpy, error: vi.fn(), fatal: vi.fn() }),
}));

type PatchListener = (patches: readonly unknown[], state: unknown) => void;
const patchListeners = new Set<PatchListener>();
const subscribeSpy = vi.fn((cb: PatchListener) => {
  patchListeners.add(cb);
  return () => { patchListeners.delete(cb); };
});

vi.mock('../stateTree', () => ({
  subscribeToPatches: (cb: PatchListener) => subscribeSpy(cb),
}));

import { initIdentity, stopIdentity, type IdentityDeps } from './identity';
import { onTopologyChange, resetTopology } from './topology';
import { startSeatWatcher, stopSeatWatcher } from './seatWatcher';
import type { TopologyReason } from './types';

function emit(patches: readonly unknown[], state: unknown = {}): void {
  for (const cb of Array.from(patchListeners)) cb(patches, state);
}

function identityDeps(userSlotsFn: () => unknown): IdentityDeps {
  const store = new Map<string, unknown>();
  return {
    readAtomByExactLabel: (l) => (l === 'playerIdAtom' ? 'p1' : undefined),
    urlPlayerId: () => null,
    userSlots: userSlotsFn,
    playersInRoom: () => ['p1'],
    storage: {
      get: <T,>(k: string, fb: T) => (store.has(k) ? (store.get(k) as T) : fb),
      set: (k: string, v: unknown) => { store.set(k, v); },
    },
    fetchAccountPlayerId: () => Promise.resolve(null),
  };
}

beforeEach(() => {
  patchListeners.clear();
  subscribeSpy.mockClear();
  warnSpy.mockClear();
  infoSpy.mockClear();
  stopSeatWatcher();
  stopIdentity();
  resetTopology();
});

afterEach(() => {
  stopSeatWatcher();
  stopIdentity();
  resetTopology();
});

describe('seatWatcher', () => {
  it('subscribes exactly once even when startSeatWatcher() is called twice', () => {
    startSeatWatcher();
    startSeatWatcher();
    startSeatWatcher();
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(patchListeners.size).toBe(1);
  });

  it('removes its listener on stopSeatWatcher()', () => {
    startSeatWatcher();
    stopSeatWatcher();
    expect(patchListeners.size).toBe(0);
  });

  it('re-attaches after stopSeatWatcher() so a fresh start subscribes again', () => {
    startSeatWatcher();
    stopSeatWatcher();
    startSeatWatcher();
    expect(subscribeSpy).toHaveBeenCalledTimes(2);
    expect(patchListeners.size).toBe(1);
  });

  it('emits identity:seat when a userSlots patch flips myIdx from a number to null', async () => {
    let slots: unknown = [{ userId: 'p1' }, null];
    initIdentity(identityDeps(() => slots));
    startSeatWatcher();
    const reasons: TopologyReason[] = [];
    onTopologyChange((rs) => { for (const r of rs) reasons.push(r); });

    // First userSlots-touching batch primes the watcher's baseline
    // (lastObservedIdx moves from undefined → current myIdx; no transition).
    emit([{ op: 'replace', path: '/child/data/userSlots/0', value: { userId: 'p1' } }]);
    await Promise.resolve();
    expect(reasons).not.toContain('identity:seat');

    slots = [null, null];
    emit([{ op: 'replace', path: '/child/data/userSlots/0', value: null }]);
    await Promise.resolve();
    expect(reasons).toContain('identity:seat');
  });

  it('emits identity:seat when a userSlots patch flips myIdx from null to a number', async () => {
    let slots: unknown = [null, null];
    initIdentity(identityDeps(() => slots));
    startSeatWatcher();
    const reasons: TopologyReason[] = [];
    onTopologyChange((rs) => { for (const r of rs) reasons.push(r); });

    emit([{ op: 'replace', path: '/child/data/userSlots/0', value: null }]);
    await Promise.resolve();
    expect(reasons).not.toContain('identity:seat');

    slots = [{ userId: 'p1' }, null];
    emit([{ op: 'replace', path: '/child/data/userSlots/0', value: { userId: 'p1' } }]);
    await Promise.resolve();
    expect(reasons).toContain('identity:seat');
  });

  it('ignores patch batches that do not touch /child/data/userSlots', async () => {
    let slots: unknown = [{ userId: 'p1' }];
    initIdentity(identityDeps(() => slots));
    startSeatWatcher();
    emit([{ op: 'replace', path: '/child/data/userSlots/0', value: { userId: 'p1' } }]);
    await Promise.resolve();

    const reasons: TopologyReason[] = [];
    onTopologyChange((rs) => { for (const r of rs) reasons.push(r); });

    slots = [null, null];
    emit([{ op: 'replace', path: '/child/data/shops', value: {} }]);
    emit([{ op: 'replace', path: '/child/data/spectators', value: [] }]);
    await Promise.resolve();

    expect(reasons).not.toContain('identity:seat');
  });

  it('emits identity:seat only once per flip even when the batch has multiple userSlots ops', async () => {
    let slots: unknown = [{ userId: 'p1' }, null];
    initIdentity(identityDeps(() => slots));
    startSeatWatcher();
    emit([{ op: 'replace', path: '/child/data/userSlots/0', value: { userId: 'p1' } }]);
    await Promise.resolve();

    let seatSignals = 0;
    onTopologyChange((rs) => { if (rs.has('identity:seat')) seatSignals++; });

    slots = [null, null];
    emit([
      { op: 'replace', path: '/child/data/userSlots/0', value: null },
      { op: 'replace', path: '/child/data/userSlots/1', value: null },
    ]);
    await Promise.resolve();

    expect(seatSignals).toBe(1);
  });

  it('detects the flip on the snapshot-only path (empty patch array) when the userSlots reference changes', async () => {
    let slots: unknown = [{ userId: 'p1' }, null];
    initIdentity(identityDeps(() => slots));
    startSeatWatcher();
    const reasons: TopologyReason[] = [];
    onTopologyChange((rs) => { for (const r of rs) reasons.push(r); });

    emit([], { child: { data: { userSlots: slots } } });
    await Promise.resolve();
    expect(reasons).not.toContain('identity:seat');

    slots = [null, null];
    emit([], { child: { data: { userSlots: slots } } });
    await Promise.resolve();
    expect(reasons).toContain('identity:seat');
  });

  it('skips identity work on the snapshot-only path when the userSlots reference is unchanged', async () => {
    const slots: unknown = [{ userId: 'p1' }, null];
    const userSlotsFn = vi.fn(() => slots);
    initIdentity(identityDeps(userSlotsFn));
    startSeatWatcher();
    const state = { child: { data: { userSlots: slots } } };

    emit([], state);
    const callsAfterFirst = userSlotsFn.mock.calls.length;
    emit([], state);
    emit([], state);
    await Promise.resolve();

    expect(userSlotsFn.mock.calls.length).toBe(callsAfterFirst);
  });
});
