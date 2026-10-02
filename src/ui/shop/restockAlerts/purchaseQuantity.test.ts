import { describe, expect, it } from 'vitest';
import { affordableUnits, clampPurchaseQuantity } from './purchaseQuantity';

const OPEN = { remainingStock: null, affordable: null, stackRoom: null };

describe('affordableUnits', () => {
  it('floors balance / price', () => {
    expect(affordableUnits(250, 100)).toBe(2);
    expect(affordableUnits(99, 100)).toBe(0);
  });

  it('is unknown without a balance or a positive price', () => {
    expect(affordableUnits(null, 100)).toBeNull();
    expect(affordableUnits(500, null)).toBeNull();
    expect(affordableUnits(500, 0)).toBeNull();
  });
});

describe('clampPurchaseQuantity', () => {
  it('passes the request through when no cap is known', () => {
    expect(clampPurchaseQuantity(7, OPEN)).toEqual({ quantity: 7, limitedBy: null });
  });

  it('takes the minimum of stock, balance and stack room', () => {
    expect(clampPurchaseQuantity(10, { remainingStock: 6, affordable: 4, stackRoom: 9 })).toEqual({ quantity: 4, limitedBy: 'balance' });
    expect(clampPurchaseQuantity(10, { remainingStock: 3, affordable: 4, stackRoom: 9 })).toEqual({ quantity: 3, limitedBy: 'stock' });
    expect(clampPurchaseQuantity(10, { remainingStock: 6, affordable: 4, stackRoom: 2 })).toEqual({ quantity: 2, limitedBy: 'stack' });
  });

  it('reports sold out ahead of balance when both are zero', () => {
    expect(clampPurchaseQuantity(5, { remainingStock: 0, affordable: 0, stackRoom: null })).toEqual({ quantity: 0, limitedBy: 'stock' });
  });

  it('caps at or above the request leave limitedBy null', () => {
    expect(clampPurchaseQuantity(4, { remainingStock: 4, affordable: 100, stackRoom: 4 })).toEqual({ quantity: 4, limitedBy: null });
  });

  it('floors fractional inputs and ignores non-finite caps', () => {
    expect(clampPurchaseQuantity(3.9, { ...OPEN, stackRoom: Infinity })).toEqual({ quantity: 3, limitedBy: null });
  });
});
