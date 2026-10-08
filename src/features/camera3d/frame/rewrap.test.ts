import { describe, expect, it } from 'vitest';
import { REWRAP_MAX, REWRAP_WINDOW_MS, RewrapBudget } from './rewrap';

describe('RewrapBudget (A R7)', () => {
  it('allows a few re-wraps a minute: a script that wraps once, or a late second mod', () => {
    const b = new RewrapBudget();
    for (let i = 0; i < REWRAP_MAX; i++) expect(b.take(1000 + i)).toBe('ok');
    expect(b.capped()).toBe(false);
  });

  it('one more inside the window is a fight: capped once, refused for good after', () => {
    const b = new RewrapBudget();
    for (let i = 0; i < REWRAP_MAX; i++) b.take(i * 10);
    expect(b.take(100)).toBe('capped');
    expect(b.capped()).toBe(true);
    expect(b.take(101)).toBe('denied');
    // A quiet minute does not lift it: the chain stays bounded until the next install.
    expect(b.take(100 + 10 * REWRAP_WINDOW_MS)).toBe('denied');
  });

  it('re-wraps spread wider than the window never cap', () => {
    const b = new RewrapBudget();
    for (let i = 0; i < 4 * REWRAP_MAX; i++) expect(b.take(i * (REWRAP_WINDOW_MS / (REWRAP_MAX - 1)))).toBe('ok');
  });
});
