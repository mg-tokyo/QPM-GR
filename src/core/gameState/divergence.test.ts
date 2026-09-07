import { describe, expect, it } from 'vitest';
import { atomSource, defineKey, stateSource } from './define';
import { runDivergenceAudit, summarizeDiff } from './divergence';
import { Registry } from './resolver';
import { createFakeRuntime } from './sources/sources.test';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';

const snap: QuinoaStateSnapshot = { scope: 'Room', data: {}, child: { scope: 'Quinoa', data: { userSlots: [{ userId: 'p1', data: { coinsCount: 5, inventory: { items: [{ id: 'a', itemType: 'Produce' }] } } }] } } };
const defs = {
  coins: defineKey<number>({ policy: 'authoritative', doc: '', sources: [
    stateSource('/c', (s, id) => (id.myIdx === null ? undefined : (s.child?.data?.userSlots?.[0]?.data?.coinsCount as number))),
    atomSource(/^myCoinsCountAtom$/, 'authoritative', { project: (v) => (typeof v === 'number' ? v : undefined) }),
  ] }),
  items: defineKey<unknown[]>({ policy: 'authoritative', doc: '', sources: [
    stateSource('/i', (s, id) => (id.myIdx === null ? undefined : (s.child?.data?.userSlots?.[0]?.data?.inventory?.items as unknown[]))),
    atomSource(/^myCropInventoryAtom$/, 'predicted', { project: (v) => (Array.isArray(v) ? v : undefined) }),
  ] }),
  stateOnly: defineKey<number>({ policy: 'authoritative', doc: '', sources: [stateSource('/s', () => 1)] }),
};

describe('divergence audit', () => {
  it('reports keys whose rungs disagree and skips keys with fewer than two available rungs', () => {
    const rt = createFakeRuntime();
    rt.setSnapshot(snap); rt.setIdentity({ playerId: 'p1', myIdx: 0 });
    rt.setAtoms({ myCoinsCountAtom: 5, myCropInventoryAtom: [{ id: 'a', itemType: 'Produce' }, { id: 'b', itemType: 'Produce' }] });
    const reg = new Registry(defs, rt); reg.start();
    const report = runDivergenceAudit(reg);
    expect(report.checked).toBe(2);
    expect(report.skipped).toEqual(['stateOnly']);
    expect(report.divergent.map((d) => d.key)).toEqual(['items']);
    expect(report.divergent[0]!.summary).toContain('length 1 vs 2');
  });
  it('applies the key auditNormalize to both rungs before comparing', () => {
    const petState = [{ id: 'p', petSpecies: 'FireHorse', hunger: 131740, xp: 200, abilityCooldowns: { A: 5 }, abilities: ['A'] }];
    const petAtomStale = [{ id: 'p', petSpecies: 'FireHorse', hunger: 200000, xp: 100, abilityCooldowns: { A: 0 }, abilities: ['A'] }];
    const petAtomWrong = [{ id: 'p', petSpecies: 'FireHorse', hunger: 200000, xp: 100, abilityCooldowns: { A: 0 }, abilities: ['B'] }];
    const petDefs = {
      pets: defineKey<unknown[]>({
        policy: 'authoritative', doc: '', sources: [
          stateSource('/p', () => petState),
          atomSource(/^myPredictedPetSlotsAtom$/, 'predicted', { project: (v) => (Array.isArray(v) ? v : undefined) }),
        ],
        auditNormalize: (slots) => (slots ?? []).map((slot) => {
          if (!slot || typeof slot !== 'object') return slot;
          const { hunger: _h, xp: _x, abilityCooldowns: _c, ...rest } = slot as Record<string, unknown>;
          return rest;
        }),
      }),
    };
    const rt = createFakeRuntime();
    rt.setSnapshot(snap); rt.setIdentity({ playerId: 'p1', myIdx: 0 });
    rt.setAtoms({ myPredictedPetSlotsAtom: petAtomStale });
    const reg = new Registry(petDefs, rt); reg.start();
    expect(runDivergenceAudit(reg).divergent).toEqual([]);

    const rt2 = createFakeRuntime();
    rt2.setSnapshot(snap); rt2.setIdentity({ playerId: 'p1', myIdx: 0 });
    rt2.setAtoms({ myPredictedPetSlotsAtom: petAtomWrong });
    const reg2 = new Registry(petDefs, rt2); reg2.start();
    expect(runDivergenceAudit(reg2).divergent.map((d) => d.key)).toEqual(['pets']);
  });
  it('honours the allow-list', () => {
    const rt = createFakeRuntime();
    rt.setSnapshot(snap); rt.setIdentity({ playerId: 'p1', myIdx: 0 });
    rt.setAtoms({ myCoinsCountAtom: 6 });
    const reg = new Registry(defs, rt); reg.start();
    expect(runDivergenceAudit(reg, { allow: new Set(['coins']) }).divergent).toEqual([]);
  });
  it('summarizes diffs without dumping payloads', () => {
    expect(summarizeDiff({ a: 1, b: 2 }, { a: 1, c: 3 })).toBe('object keys: only-state [b], only-atom [c]');
    expect(summarizeDiff([1, 2], [1])).toBe('array length 2 vs 1');
    expect(summarizeDiff(1, '1')).toBe('type number vs string');
    expect(summarizeDiff({ a: 1 }, { a: 2 })).toBe('object differs at key a');
  });
});
