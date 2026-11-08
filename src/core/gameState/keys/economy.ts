import { atomSource, defineKey, stateSource } from '../define';
import { selectMyData } from './selectors';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const shopPurchasesOf = (data: unknown): Record<string, unknown> | null | undefined => {
  if (!data || typeof data !== 'object') return undefined;
  const p = (data as Record<string, unknown>).shopPurchases;
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
};

export const ECONOMY_KEYS = {
  // No defaultValue: with no seat every rung is unavailable and the read must
  // surface null, not a masked 0 (consumers: economyTracker.ts null-guards).
  coinsBalance: defineKey<number>({
    policy: 'authoritative', tier: 'state', doc: 'Coins',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data/coinsCount', (s, id) => { const d = selectMyData(s, id); return !d ? undefined : num(d.coinsCount); }),
      atomSource(/^myCoinsCountAtom$/, 'authoritative', { project: num, requiresSeat: true }),
    ],
  }),
  magicDustBalance: defineKey<number>({
    policy: 'authoritative', tier: 'state', doc: 'Magic dust',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data/magicDustCount', (s, id) => { const d = selectMyData(s, id); return !d ? undefined : num(d.magicDustCount); }),
      atomSource(/^myMagicDustCountAtom$/, 'authoritative', { project: num, requiresSeat: true }),
    ],
  }),
  creditsBalance: defineKey<number>({
    policy: 'client', tier: 'dynamic', defaultValue: 0, doc: 'Credits (account-level, not in room state)',
    sources: [atomSource(/^creditsBalanceAtom$/, 'client', { project: num })],
  }),
  shopPurchases: defineKey<Record<string, unknown>>({
    policy: 'authoritative', tier: 'state', doc: 'Per-shop purchase counters (myData.shopPurchases)',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data/shopPurchases', (s, id) => shopPurchasesOf(selectMyData(s, id))),
      // Never bound while the tree is up; it exists so the divergence audit catches a wrong {myIdx} seat.
      atomSource(/^myDataAtom$/, 'authoritative', { project: shopPurchasesOf, requiresSeat: true }),
    ],
  }),
};
