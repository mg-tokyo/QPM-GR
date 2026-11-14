import { describe, expect, it, vi } from 'vitest';

vi.mock('./selector', () => ({ subscribeAbilityTargets: () => () => undefined }));

const { createReadyEdgeTracker } = await import('./readyEdge');
type Input = import('./readyEdge').ReadyEdgeInput;

function pet(petSlotId: string, ready: boolean, gardenTargetCount = 1, abilityId = 'SproutBoost'): Input {
  return { petSlotId, abilityId, ready, gardenTargetCount };
}

const kinds = (events: Array<{ kind: string; reason?: string }>): string[] =>
  events.map((e) => (e.reason ? `${e.kind}:${e.reason}` : e.kind));

describe('ready-edge tracker (ALR-10.1)', () => {
  it('never fires on first sight, even when the pet is already charged', () => {
    const t = createReadyEdgeTracker();
    expect(t.step([pet('a', true)])).toEqual([]);
    expect(t.step([pet('a', true)])).toEqual([]);
  });

  it('fires once on the not-ready → ready edge, then stops when the ability is used', () => {
    const t = createReadyEdgeTracker();
    t.step([pet('a', false)]);
    expect(kinds(t.step([pet('a', true)]))).toEqual(['fire']);
    expect(t.step([pet('a', true)])).toEqual([]);
    expect(kinds(t.step([pet('a', false)]))).toEqual(['stop:used']);
    expect(kinds(t.step([pet('a', true)]))).toEqual(['fire']);
  });

  it('holds a recharge with no garden target and fires when a target appears', () => {
    const t = createReadyEdgeTracker();
    t.step([pet('a', false)]);
    expect(t.step([pet('a', true, 0)])).toEqual([]);
    const [fire] = t.step([pet('a', true, 3)]);
    expect(fire).toMatchObject({ kind: 'fire', gardenTargetCount: 3, key: 'a:SproutBoost' });
  });

  it('a charged pet used without firing re-arms silently on cooling', () => {
    const t = createReadyEdgeTracker();
    t.step([pet('a', false)]);
    t.step([pet('a', true, 0)]);
    expect(t.step([pet('a', false)])).toEqual([]);
  });

  it('stops a fired card when the pet leaves; a pet back already charged counts as first sight', () => {
    const t = createReadyEdgeTracker();
    t.step([pet('a', false)]);
    t.step([pet('a', true)]);
    expect(kinds(t.step([]))).toEqual(['stop:removed']);
    expect(t.step([pet('a', true)])).toEqual([]);
  });

  it('a pet removed while cooling emits nothing', () => {
    const t = createReadyEdgeTracker();
    t.step([pet('a', false)]);
    expect(t.step([])).toEqual([]);
  });

  it('keys per pet: two pets with the same ability edge independently', () => {
    const t = createReadyEdgeTracker();
    t.step([pet('a', false), pet('b', true)]);
    const events = t.step([pet('a', true), pet('b', true)]);
    expect(events.map((e) => e.petSlotId)).toEqual(['a']);
    t.step([pet('a', true), pet('b', false)]);
    expect(t.step([pet('a', true), pet('b', true)]).map((e) => e.petSlotId)).toEqual(['b']);
  });

  it('reset forgets every key', () => {
    const t = createReadyEdgeTracker();
    t.step([pet('a', false)]);
    t.reset();
    expect(t.step([pet('a', true)])).toEqual([]);
  });
});
