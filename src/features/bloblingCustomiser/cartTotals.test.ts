import { describe, expect, it } from 'vitest';
import { sumByCurrency } from './cartTotals';
import type { CartItem } from './types';

function item(filename: string, price: number, currency?: string): CartItem {
  const entry: CartItem['entry'] = { id: filename, type: 'Top', filename, displayName: filename, availability: 'default', price };
  if (currency !== undefined) entry.currency = currency;
  return { slot: 'Top', entry };
}

describe('sumByCurrency', () => {
  it('keeps each currency separate in first-seen order', () => {
    const totals = sumByCurrency([
      item('a', 25_000, 'magicDust'),
      item('b', 1_000, 'coins'),
      item('c', 5_000, 'magicDust'),
      item('d', 329, 'credits'),
      item('e', 1_000_000, 'coins'),
    ]);
    expect(totals).toEqual([
      { currency: 'magicDust', amount: 30_000 },
      { currency: 'coins', amount: 1_001_000 },
      { currency: 'credits', amount: 329 },
    ]);
  });

  it('skips free entries and returns [] for an all-free cart', () => {
    expect(sumByCurrency([item('a', 0), item('b', 0, 'coins')])).toEqual([]);
    expect(sumByCurrency([item('a', 0), item('b', 1_000, 'coins')])).toEqual([{ currency: 'coins', amount: 1_000 }]);
  });

  it('groups priced entries without a currency under null', () => {
    expect(sumByCurrency([item('a', 65), item('b', 330), item('c', 1_000, 'coins')])).toEqual([
      { currency: null, amount: 395 },
      { currency: 'coins', amount: 1_000 },
    ]);
  });
});
