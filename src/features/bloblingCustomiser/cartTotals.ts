import type { CartItem } from './types';

export interface CurrencyTotal {
  currency: string | null;   // catalog currency id, e.g. "coins"; null when the entry has none
  amount: number;
}

// Cosmetics are priced in mixed currencies since game v1361, so totals never add across them.
// Free entries are skipped; order follows first appearance in the cart.
export function sumByCurrency(items: readonly CartItem[]): CurrencyTotal[] {
  const totals = new Map<string | null, number>();
  for (const { entry } of items) {
    if (!(entry.price > 0)) continue;
    const currency = entry.currency ?? null;
    totals.set(currency, (totals.get(currency) ?? 0) + entry.price);
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}
