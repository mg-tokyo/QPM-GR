import { describe, expect, it } from 'vitest';
import type { WalkedSlot } from '../slotWalk';
import { createMutationGainDiffer } from './diff';

const s = (over: Partial<WalkedSlot> = {}): WalkedSlot => ({
  tileKey: 'g:5', slotId: 0, startTime: 1000, species: 'Carrot', mutations: [], size: 50, ...over,
});

describe('createMutationGainDiffer', () => {
  it('records the first snapshot as a baseline with no gains', () => {
    const d = createMutationGainDiffer();
    expect(d.step([s({ mutations: ['Gold'] })])).toEqual([]);
  });

  it('reports a mutation added to a tracked slot', () => {
    const d = createMutationGainDiffer();
    d.step([s()]);
    expect(d.step([s({ mutations: ['Gold'] })])).toEqual([
      { mutation: 'Gold', tileKey: 'g:5', slotId: 0, species: 'Carrot' },
    ]);
  });

  it('counts an upgrade (Wet -> Frozen) as a gain of the new mutation only', () => {
    const d = createMutationGainDiffer();
    d.step([s({ mutations: ['Wet'] })]);
    expect(d.step([s({ mutations: ['Frozen'] })]).map((g) => g.mutation)).toEqual(['Frozen']);
  });

  it('treats a later startTime (harvest, regrowth, replant) as a new slot, silently (PD2)', () => {
    const d = createMutationGainDiffer();
    d.step([s()]);
    expect(d.step([s({ startTime: 5000, mutations: ['Rainbow'] })])).toEqual([]);
  });

  it('keeps the slot across watering (earlier startTime) and still sees a gain in the same step', () => {
    const d = createMutationGainDiffer();
    d.step([s({ mutations: ['Wet'] })]);
    expect(d.step([s({ startTime: 400, mutations: ['Wet', 'Gold'] })]).map((g) => g.mutation)).toEqual(['Gold']);
  });

  it('treats a species change on the same slot as a new slot', () => {
    const d = createMutationGainDiffer();
    d.step([s()]);
    expect(d.step([s({ species: 'Tulip', mutations: ['Gold'] })])).toEqual([]);
  });

  it('keys identity on tile + slotId regardless of array order, and includes boardwalk', () => {
    const d = createMutationGainDiffer();
    d.step([s({ slotId: 4 }), s({ slotId: 0 }), s({ tileKey: 'b:2' })]);
    const gains = d.step([s({ slotId: 0 }), s({ slotId: 4, mutations: ['Gold'] }), s({ tileKey: 'b:2', mutations: ['Frozen'] })]);
    expect(gains.map((g) => `${g.tileKey}#${g.slotId}:${g.mutation}`)).toEqual(['g:5#4:Gold', 'b:2#0:Frozen']);
  });

  it('drops harvested slots, so a slot that comes back is new', () => {
    const d = createMutationGainDiffer();
    d.step([s()]);
    d.step([]);
    expect(d.step([s({ mutations: ['Gold'] })])).toEqual([]);
  });

  it('reset() makes the next step a baseline again', () => {
    const d = createMutationGainDiffer();
    d.step([s()]);
    d.reset();
    expect(d.step([s({ mutations: ['Gold'] })])).toEqual([]);
  });
});
