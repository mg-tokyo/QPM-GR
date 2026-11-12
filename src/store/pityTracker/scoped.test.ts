import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerScopedLayout, PlayerScopedSpec } from '../playerScoped';
import type { PityCopy } from './merge';

const UNCHANGED = Symbol('unchanged');
const captured: { spec: PlayerScopedSpec<PityCopy> | null; layout: PlayerScopedLayout<PityCopy> | null } = { spec: null, layout: null };
const handle = { start: vi.fn(), stop: vi.fn(), write: vi.fn(() => true), read: vi.fn(), isReady: vi.fn(), scopedKey: vi.fn() };
const subscribeAtomValue = vi.fn(async () => () => {});

vi.mock('../playerScoped', () => ({
  PLAYER_SCOPED_UNCHANGED: UNCHANGED,
  createPlayerScoped: (spec: PlayerScopedSpec<PityCopy>, layout: PlayerScopedLayout<PityCopy>) => {
    captured.spec = spec;
    captured.layout = layout;
    return handle;
  },
}));
vi.mock('../../core/atomRegistry', () => ({ subscribeAtomValue }));
vi.mock('../../services/gameAccount', () => ({
  fetchGameAccountInfo: vi.fn(async () => null),
  getGameAccountLastError: vi.fn(() => null),
}));

const { pityLayout } = await import('./scoped');
const { getPitySnapshot, startPityTracker, stopPityTracker } = await import('./index');
const { CURRENT_VERSION, LOG_STORAGE_KEY, STORAGE_KEY, ctx, defaultState, persist } = await import('./state');

const COUNTER_KEY = 'seed:Carrot:Gold';

function savedState(pulls: number): ReturnType<typeof defaultState> {
  const state = defaultState();
  state.counters[COUNTER_KEY] = {
    misses: pulls, hits: 0, totalPulls: pulls, lastHitAt: null, lastPullAt: 1, observedSince: 1, correction: 0, gapBase: 0,
  };
  return state;
}

const entry = { t: 5, k: 'seed', i: 'Carrot', r: 'mutation', h: null, g: 0, s: 'x#0' } as const;

describe('pity layout', () => {
  it('spans the state and log keys and treats a missing state as no copy', () => {
    const layout = pityLayout(() => false);
    expect(layout.parts).toEqual([STORAGE_KEY, LOG_STORAGE_KEY]);
    expect(layout.join([undefined, { version: 1, entries: [entry] }])).toBeUndefined();
  });

  it('round-trips the log and the pending-rebuild flag through the envelope', () => {
    const layout = pityLayout(() => false);
    const copy: PityCopy = { state: savedState(3), log: [entry], rebuild: { dropped: 2 } };
    const [state, envelope] = layout.split(copy, 'bind');
    expect(envelope).toEqual({ version: 1, entries: [entry], rebuild: { dropped: 2 } });
    const joined = layout.join([state, envelope]);
    expect(joined?.log).toEqual([entry]);
    expect(joined?.rebuild).toEqual({ dropped: 2 });
    expect(joined?.state.meta.version).toBe(CURRENT_VERSION);
    expect(layout.split({ ...copy, rebuild: null }, 'bind')[1]).toEqual({ version: 1, entries: [entry] });
  });

  it('writes the log part on a store write only when the log is dirty', () => {
    let dirty = false;
    const layout = pityLayout(() => dirty);
    const copy: PityCopy = { state: savedState(1), log: [entry], rebuild: null };
    expect(layout.split(copy, 'write')).toEqual([copy.state, UNCHANGED]);
    dirty = true;
    expect(layout.split(copy, 'write')[1]).toEqual({ version: 1, entries: [entry] });
  });
});

describe('pity tracker on the player-scoped helper', () => {
  beforeEach(() => {
    stopPityTracker();
    vi.clearAllMocks();
  });

  it('defers loading and the myData subscription until the copy is bound', () => {
    startPityTracker();
    expect(handle.start).toHaveBeenCalledOnce();
    expect(subscribeAtomValue).not.toHaveBeenCalled();
    persist();
    expect(handle.write).not.toHaveBeenCalled();
    const defaultKeys = Object.keys(defaultState()).sort();
    expect(Object.keys(getPitySnapshot()).sort()).toEqual(defaultKeys);

    const bound: PityCopy = { state: savedState(4), log: [entry], rebuild: null };
    captured.spec?.onReady(bound, 'A');
    expect(subscribeAtomValue).toHaveBeenCalledOnce();
    expect(subscribeAtomValue).toHaveBeenCalledWith('myData', expect.any(Function));
    expect(getPitySnapshot().counters[COUNTER_KEY]?.totalPulls).toBe(4);
    expect(Object.keys(getPitySnapshot()).sort()).toEqual(defaultKeys);

    persist();
    expect(handle.write).toHaveBeenCalledWith({ state: bound.state, log: [entry], rebuild: null });

    captured.spec?.onReady({ state: savedState(9), log: [], rebuild: null }, 'B');
    expect(subscribeAtomValue).toHaveBeenCalledOnce();
    expect(getPitySnapshot().counters[COUNTER_KEY]?.totalPulls).toBe(9);
  });

  it('never shares the fallback state between two players with no history', () => {
    startPityTracker();
    const spec = captured.spec;
    if (!spec) throw new Error('spec not captured');
    spec.onReady(spec.fallback, 'A');
    const counter = savedState(2).counters[COUNTER_KEY];
    if (counter) ctx.state.counters[COUNTER_KEY] = counter;
    spec.onReady(spec.fallback, 'B');
    expect(getPitySnapshot().counters).toEqual({});
  });

  it('stops the scope and drops the writer', () => {
    startPityTracker();
    captured.spec?.onReady({ state: savedState(1), log: [], rebuild: null }, 'A');
    stopPityTracker();
    expect(handle.stop).toHaveBeenCalledOnce();
    persist();
    expect(handle.write).not.toHaveBeenCalled();
  });
});
