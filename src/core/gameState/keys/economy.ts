import { atomSource, defineKey, stateSource } from '../define';
import { selectMyData } from './selectors';

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export const ECONOMY_KEYS = {
  coinsBalance: defineKey<number>({
    policy: 'authoritative', tier: 'state', defaultValue: 0, doc: 'Coins',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data/coinsCount', (s, id) => { const d = selectMyData(s, id); return !d ? undefined : num(d.coinsCount); }),
      atomSource(/^myCoinsCountAtom$/, 'authoritative', { project: num }),
    ],
  }),
  magicDustBalance: defineKey<number>({
    policy: 'authoritative', tier: 'state', defaultValue: 0, doc: 'Magic dust',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data/magicDustCount', (s, id) => { const d = selectMyData(s, id); return !d ? undefined : num(d.magicDustCount); }),
      atomSource(/^myMagicDustCountAtom$/, 'authoritative', { project: num }),
    ],
  }),
  creditsBalance: defineKey<number>({
    policy: 'client', tier: 'dynamic', defaultValue: 0, doc: 'Credits (account-level, not in room state)',
    sources: [atomSource(/^creditsBalanceAtom$/, 'client', { project: num })],
  }),
  shopPurchases: defineKey<Record<string, unknown>>({
    policy: 'authoritative', tier: 'state', doc: 'Per-shop purchase counters (myData.shopPurchases)',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data/shopPurchases', (s, id) => {
        const d = selectMyData(s, id);
        if (!d) return undefined;
        const p = d.shopPurchases;
        return p && typeof p === 'object' ? p : null;
      }),
    ],
  }),
};
