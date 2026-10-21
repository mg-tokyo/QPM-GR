import { describe, expect, it, vi } from 'vitest';
import { subscribeRoomWelcome } from './roomWelcome';

describe('subscribeRoomWelcome', () => {
  it('prefers legacy subscribeToWelcome and forwards its arguments', () => {
    const unsub = vi.fn();
    const addReconnectionListener = vi.fn();
    const cb = vi.fn();
    const room = {
      subscribeToWelcome: (fn: (s: unknown, ms?: number, seq?: number) => void) => { fn({ a: 1 }, 5, 9); return unsub; },
      addReconnectionListener,
    };
    expect(subscribeRoomWelcome(room, cb)).toBe(unsub);
    expect(cb).toHaveBeenCalledWith({ state: { a: 1 }, publishedAtServerMs: 5, executedCommandSequence: 9 });
    expect(addReconnectionListener).not.toHaveBeenCalled();
  });

  it('1686+: fires on isConnected:true reconnection events only, plus once when already connected', () => {
    let listener: ((e: unknown) => void) | null = null;
    const remove = vi.fn();
    const cb = vi.fn();
    const room = {
      addReconnectionListener(fn: (e: unknown) => void) { listener = fn; return remove; },
      isConnected: () => true,
    };
    const unsub = subscribeRoomWelcome(room, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    listener!({ isConnected: false, numConsecutiveAttempts: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
    listener!({ isConnected: true });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(null);
    unsub?.();
    expect(remove).toHaveBeenCalled();
  });

  it('does not fire immediately while the session is not admitted', () => {
    const cb = vi.fn();
    subscribeRoomWelcome({ addReconnectionListener: () => () => true, isConnected: () => false }, cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns null when the build has neither hook', () => {
    expect(subscribeRoomWelcome({}, vi.fn())).toBeNull();
  });
});
