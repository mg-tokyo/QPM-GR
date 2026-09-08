import { beforeEach, describe, expect, it } from 'vitest';
import { atomSource, defineKey, stateSource } from './define';
import { Registry } from './resolver';
import { flushTopologyNow, resetTopology, signalTopology } from './topology';
import { createFakeRuntime } from './sources/sources.test';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';

const snap = (coins: number, items: string[] = []): QuinoaStateSnapshot => ({
  scope: 'Room', data: {},
  child: { scope: 'Quinoa', data: { userSlots: [{ userId: 'p1', data: { coinsCount: coins, inventory: { items: items.map((id) => ({ id })) } } }] } },
});

const defs = {
  coins: defineKey<number>({
    policy: 'authoritative', doc: 'coins',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data/coinsCount', (s, id) => {
        if (id.myIdx === null) return undefined;
        const v = s.child?.data?.userSlots?.[id.myIdx]?.data?.coinsCount;
        return typeof v === 'number' ? v : undefined;
      }),
      atomSource(/^myCoinsCountAtom$/, 'authoritative', { project: (r) => (typeof r === 'number' ? r : undefined) }),
    ],
  }),
  modal: defineKey<string | null>({
    policy: 'client', doc: 'modal', defaultValue: null,
    sources: [atomSource(/^activeModalAtom$/, 'client', { writable: true })],
  }),
};

function setup() {
  const rt = createFakeRuntime();
  const rebinds: string[] = [];
  const reg = new Registry(defs, rt, { onRebind: (k, from, to) => rebinds.push(`${k}:${from ?? '-'}>${to ?? '-'}`), suppressMs: 50 });
  reg.start();
  return { rt, reg, rebinds };
}

beforeEach(() => resetTopology());

describe('Registry', () => {
  it('binds the first available rung and rebinds upward when the preferred rung appears', () => {
    const { rt, reg, rebinds } = setup();
    expect(reg.explain('coins').boundVia).toBeNull();
    rt.setAtoms({ myCoinsCountAtom: 3 });
    signalTopology('atoms:cacheGrowth'); flushTopologyNow();
    expect(reg.explain('coins')).toMatchObject({ boundVia: 'atom', preferred: false });
    rt.setSnapshot(snap(9)); rt.setIdentity({ playerId: 'p1', myIdx: 0 });
    signalTopology('stateTree:ready'); flushTopologyNow();
    expect(reg.explain('coins')).toMatchObject({ boundVia: 'stateTree', preferred: true, rebinds: 2 });
    expect(rebinds).toEqual(['coins:->atom:myCoinsCountAtom', 'coins:atom:myCoinsCountAtom>stateTree:/child/data/userSlots/{myIdx}/data/coinsCount']);
  });
  it('hot-swaps a live subscription without duplicate deliveries', async () => {
    const { rt, reg } = setup();
    rt.setAtoms({ myCoinsCountAtom: 3 });
    signalTopology('init'); flushTopologyNow();
    const seen: Array<number | null> = [];
    const off = reg.subscribe('coins', (v) => seen.push(v));
    await Promise.resolve(); await Promise.resolve();
    expect(seen).toEqual([3]);
    rt.setSnapshot(snap(3)); rt.setIdentity({ playerId: 'p1', myIdx: 0 });
    signalTopology('stateTree:ready'); flushTopologyNow();
    expect(seen).toEqual([3]);
    rt.setSnapshot(snap(4)); rt.fireState();
    expect(seen).toEqual([3, 4]);
    rt.setAtoms({ myCoinsCountAtom: 99 }); rt.fireAtom('myCoinsCountAtom');
    expect(seen).toEqual([3, 4]);
    off();
    rt.setSnapshot(snap(5)); rt.fireState();
    expect(seen).toEqual([3, 4]);
    expect(reg.explain('coins').subscribers).toBe(0);
  });
  it('falls down the ladder when the bound rung disappears and keeps the consumer attached', () => {
    const { rt, reg } = setup();
    rt.setSnapshot(snap(1)); rt.setIdentity({ playerId: 'p1', myIdx: 0 }); rt.setAtoms({ myCoinsCountAtom: 1 });
    signalTopology('init'); flushTopologyNow();
    const seen: Array<number | null> = [];
    reg.subscribe('coins', (v) => seen.push(v));
    expect(reg.explain('coins').boundVia).toBe('stateTree');
    reg.setSimulatedLoss('coins', 'stateTree', true);
    flushTopologyNow();
    expect(reg.explain('coins').boundVia).toBe('atom');
    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      rt.setAtoms({ myCoinsCountAtom: 2 }); rt.fireAtom('myCoinsCountAtom');
      expect(seen).toEqual([1, 2]);
      reg.setSimulatedLoss('coins', 'stateTree', false);
      flushTopologyNow();
      expect(reg.explain('coins').boundVia).toBe('stateTree');
    });
  });
  it('readSync falls through the ladder per call using the resolved rung state; defaults apply', () => {
    const { rt, reg } = setup();
    // With S3 caching, atom handles resolve once per topology epoch: setup()
    // bound with no atoms → the atom rung caches "no match" until topology
    // fires. Production emits atoms:cacheGrowth on atom registration; the test
    // does that explicitly.
    rt.setAtoms({ myCoinsCountAtom: 8 });
    signalTopology('atoms:cacheGrowth'); flushTopologyNow();
    expect(reg.readSync('coins')).toBe(8);
    expect(reg.readSync('modal')).toBeNull();
    rt.setAtoms({ myCoinsCountAtom: 8, activeModalAtom: 'inventory' });
    signalTopology('atoms:cacheGrowth'); flushTopologyNow();
    expect(reg.readSync('modal')).toBe('inventory');
  });
  it('write goes to a writable atom rung only', async () => {
    const { rt, reg } = setup();
    rt.setAtoms({ activeModalAtom: null, myCoinsCountAtom: 1 });
    signalTopology('init'); flushTopologyNow();
    await reg.write('modal', 'seedShop');
    expect(reg.readSync('modal')).toBe('seedShop');
    await expect(reg.write('coins', 5)).rejects.toThrow(/not writable/);
  });
  it('suppresses a rung whose subscribe throws and re-walks after the suppression window', async () => {
    const { rt, reg } = setup();
    rt.setAtoms({ myCoinsCountAtom: 1 });
    rt.atoms.subscribe = () => Promise.reject(new Error('boom'));
    signalTopology('init'); flushTopologyNow();
    reg.subscribe('coins', () => {});
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(reg.explain('coins').sources[1]?.suppressedUntil).not.toBeNull();
  });
});
