import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
    set: (key: string, value: unknown) => { store.set(key, value); },
  },
}));

const { EGG_READY_ALERT_KEY, getEggReadyLeadMinutes, writeEggReadyLeadMinutes } = await import('./settings');

describe('egg ready lead time (ALR-11.3)', () => {
  beforeEach(() => { store.clear(); });

  it('defaults to 0 and keeps a valid write under the registered key', () => {
    expect(getEggReadyLeadMinutes()).toBe(0);
    expect(writeEggReadyLeadMinutes(5)).toBe(true);
    expect(store.get(EGG_READY_ALERT_KEY)).toEqual({ leadMinutes: 5 });
    expect(getEggReadyLeadMinutes()).toBe(5);
  });

  it('refuses out-of-range or fractional minutes and ignores a corrupt stored value', () => {
    expect(writeEggReadyLeadMinutes(-1)).toBe(false);
    expect(writeEggReadyLeadMinutes(181)).toBe(false);
    expect(writeEggReadyLeadMinutes(1.5)).toBe(false);
    expect(store.has(EGG_READY_ALERT_KEY)).toBe(false);
    store.set(EGG_READY_ALERT_KEY, { leadMinutes: 'x' });
    expect(getEggReadyLeadMinutes()).toBe(0);
  });
});
