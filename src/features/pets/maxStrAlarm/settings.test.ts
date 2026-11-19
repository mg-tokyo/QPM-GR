import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
    set: (key: string, value: unknown) => { store.set(key, value); },
  },
}));

const { MAX_STR_ALERT_KEY, getMaxStrLeadMinutes, writeMaxStrLeadMinutes } = await import('./settings');

describe('max STR lead time (ALR-14.3)', () => {
  beforeEach(() => { store.clear(); });

  it('defaults to 10 and keeps a valid write under the registered key', () => {
    expect(getMaxStrLeadMinutes()).toBe(10);
    expect(writeMaxStrLeadMinutes(45)).toBe(true);
    expect(store.get(MAX_STR_ALERT_KEY)).toEqual({ leadMinutes: 45 });
    expect(getMaxStrLeadMinutes()).toBe(45);
  });

  it('refuses 0, out-of-range or fractional minutes and ignores a corrupt stored value', () => {
    expect(writeMaxStrLeadMinutes(0)).toBe(false);
    expect(writeMaxStrLeadMinutes(1441)).toBe(false);
    expect(writeMaxStrLeadMinutes(2.5)).toBe(false);
    expect(store.has(MAX_STR_ALERT_KEY)).toBe(false);
    store.set(MAX_STR_ALERT_KEY, { leadMinutes: 0 });
    expect(getMaxStrLeadMinutes()).toBe(10);
  });
});
