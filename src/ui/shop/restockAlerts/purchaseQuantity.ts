// Quantity for one batched PurchaseShopItem. Mirrors the checks of the game's
// Buy All (v1361 installPlayerSystems `hQ`): remaining stock, balance in the
// item's price currency, and tool stack room. The game refuses when a check
// fails; QPM buys as many units as every limit allows.

export type PurchaseLimit = 'stock' | 'balance' | 'stack';

/** Each cap is a unit count; null means unknown or uncapped and never limits. */
export interface PurchaseLimits {
  remainingStock: number | null;
  affordable: number | null;
  stackRoom: number | null;
}

export interface ClampedPurchaseQuantity {
  quantity: number;
  /** The first cap that lowered the quantity, or null when the request fit. */
  limitedBy: PurchaseLimit | null;
}

export function affordableUnits(balance: number | null, unitPrice: number | null): number | null {
  if (balance == null || unitPrice == null || !(unitPrice > 0) || !Number.isFinite(balance)) return null;
  return Math.floor(Math.max(0, balance) / unitPrice);
}

export function clampPurchaseQuantity(requested: number, limits: PurchaseLimits): ClampedPurchaseQuantity {
  let quantity = Math.max(0, Math.floor(requested));
  let limitedBy: PurchaseLimit | null = null;
  const caps: Array<[PurchaseLimit, number | null]> = [
    ['stock', limits.remainingStock],
    ['balance', limits.affordable],
    ['stack', limits.stackRoom],
  ];
  for (const [limit, cap] of caps) {
    if (cap == null || !Number.isFinite(cap)) continue;
    const bounded = Math.max(0, Math.floor(cap));
    if (bounded < quantity) {
      quantity = bounded;
      limitedBy = limit;
    }
  }
  return { quantity, limitedBy };
}
