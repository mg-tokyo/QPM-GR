import { describe, expect, it, vi } from 'vitest';

vi.mock('./shopRegistry', () => ({
  getKnownShopIds: () => ['seeds', 'eggs', 'tools', 'decor'],
  isStandardShop: () => true,
}));

const { isPastDeadline, resolveStockSnapshot } = await import('./shopPurchaseCycle');

const DEADLINE = 1794116700000;
const SEED = { restockId: 'seed:1', startedAtMs: DEADLINE - 300_000, deadlineMs: DEADLINE, inventory: [] };
const CUSTOM_AT = DEADLINE - 60_000;
const CUSTOM = { restockId: `seed:custom:${CUSTOM_AT}`, startedAtMs: CUSTOM_AT, deadlineMs: DEADLINE + 120_000, inventory: [] };

describe('deadline gate mirrors the game seller', () => {
  it('sells before the deadline and nothing at or after it', () => {
    expect(resolveStockSnapshot('seed', SEED, null, null, DEADLINE - 1)).toBe(SEED);
    expect(resolveStockSnapshot('seed', SEED, null, null, DEADLINE)).toBeNull();
    expect(resolveStockSnapshot('seed', SEED, null, null, DEADLINE + 5_000)).toBeNull();
  });

  it('fails open without a clock', () => {
    expect(resolveStockSnapshot('seed', SEED, null, null, null)).toBe(SEED);
    expect(resolveStockSnapshot('seed', SEED, null, null)).toBe(SEED);
    expect(isPastDeadline(SEED, null)).toBe(false);
  });

  it('never gates on a zero or absent deadline', () => {
    const { deadlineMs: _deadline, ...noDeadline } = SEED;
    expect(resolveStockSnapshot('seed', { ...SEED, deadlineMs: 0 }, null, null, DEADLINE + 1)).not.toBeNull();
    expect(resolveStockSnapshot('seed', noDeadline, null, null, DEADLINE + 1)).not.toBeNull();
  });

  it('gates a custom restock on its own deadline, not the global one', () => {
    const restock = { purchasedAt: CUSTOM_AT };
    expect(resolveStockSnapshot('seed', SEED, restock, CUSTOM, DEADLINE + 1)).toBe(CUSTOM);
    expect(resolveStockSnapshot('seed', SEED, restock, CUSTOM, DEADLINE + 120_000)).toBeNull();
  });

  it('keeps the null-restockId rule', () => {
    expect(resolveStockSnapshot('seed', { ...SEED, restockId: null }, null, null, DEADLINE - 1)).toBeNull();
  });
});
