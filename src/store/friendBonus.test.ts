import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  subs: new Map<string, (value: unknown) => void>(),
  bound: false,
  warn: vi.fn(),
  publishOk: vi.fn(),
}));

vi.mock('../core/gameState', () => ({
  subscribe: (key: string, cb: (value: unknown) => void) => { h.subs.set(key, cb); return () => { h.subs.delete(key); }; },
  explain: () => ({ boundVia: h.bound ? 'atom' : null }),
  readSync: () => false,
}));
vi.mock('./_storeDiagnostics', () => ({
  createStoreDiagnostics: () => ({ register: vi.fn(), publishOk: h.publishOk, warn: h.warn, error: vi.fn() }),
}));

const store = await import('./friendBonus');

const push = (key: string, value: unknown): void => { h.subs.get(key)?.(value); };
const slots = (filled: number, seats = 6): unknown[] =>
  Array.from({ length: seats }, (_, i) => (i < filled ? { userId: `u${i}` } : null));

describe('friend bonus store (ALR-12.1)', () => {
  beforeEach(() => {
    store.stopFriendBonusStore();
    h.subs.clear();
    h.bound = false;
    h.warn.mockClear();
    h.publishOk.mockClear();
    store.startFriendBonusStore();
  });

  it('occupancy comes from the slot array: filled = non-null, seats = length', () => {
    expect(store.occupancyOf([{ userId: 'a' }, null, { userId: 'b' }, null])).toEqual({ filled: 2, seats: 4 });
    expect(store.occupancyOf(undefined)).toEqual({ filled: 0, seats: 0 });
  });

  it('the game atom wins over the fallback formula', () => {
    push('userSlots', slots(3));
    expect(store.getFriendBonusMultiplier()).toBeCloseTo(1.2);
    push('friendBonusMultiplier', 1.0);
    expect(store.getFriendBonusMultiplier()).toBe(1.0);
    expect(store.getFriendBonusState()).toMatchObject({ source: 'atom', atomMultiplier: 1.0, filled: 3, seats: 6, degraded: false });
  });

  it('the fallback path is flagged degraded once while the atom is unbound', () => {
    push('userSlots', slots(2));
    push('userSlots', slots(4));
    expect(store.getFriendBonusState()).toMatchObject({ source: 'fallback', degraded: true });
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]?.[0]).toBe('QPM-STORE-002');
    push('friendBonusMultiplier', 1.3);
    expect(store.getFriendBonusState()).toMatchObject({ source: 'atom', degraded: false });
  });

  it('a bound atom that has not delivered yet is not degraded', () => {
    h.bound = true;
    push('userSlots', slots(2));
    expect(h.warn).not.toHaveBeenCalled();
  });

  it('listeners fire on change only', () => {
    const onBonus = vi.fn();
    const onOcc = vi.fn();
    store.onFriendBonusChange(onBonus);
    store.onRoomOccupancyChange(onOcc);
    push('friendBonusMultiplier', 1.1);
    push('userSlots', slots(2));
    push('userSlots', slots(2));
    push('friendBonusMultiplier', 1.1);
    expect(onBonus).toHaveBeenCalledTimes(1);
    expect(onOcc).toHaveBeenCalledTimes(1);
    expect(onOcc).toHaveBeenLastCalledWith({ filled: 2, seats: 6 });
  });
});
