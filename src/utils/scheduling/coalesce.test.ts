import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { coalesce } from './debounce';

describe('coalesce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires once 100 ms after the FIRST call in a burst; later calls never push the timer', () => {
    const fn = vi.fn();
    const c = coalesce(fn, 100);
    c(); vi.advanceTimersByTime(30);
    c(); vi.advanceTimersByTime(30);
    c(); vi.advanceTimersByTime(39);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a call after the previous fire opens a new window', () => {
    const fn = vi.fn();
    const c = coalesce(fn, 100);
    c(); vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    c(); vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel() before expiry drops the pending call', () => {
    const fn = vi.fn();
    const c = coalesce(fn, 100);
    c();
    c.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel() when idle is a no-op', () => {
    const fn = vi.fn();
    const c = coalesce(fn, 100);
    expect(() => c.cancel()).not.toThrow();
    c(); vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
