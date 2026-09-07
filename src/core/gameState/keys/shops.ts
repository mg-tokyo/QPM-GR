import { atomSource, defineKey, stateSource } from '../define';
import { isRecord } from '../../../utils/typeGuards';
import type { QuinoaStateSnapshot, ShopCategorySnapshot, ShopsAtomSnapshot, WeatherAtomValue } from '../../../types/gameAtoms';

const shops = (s: QuinoaStateSnapshot): ShopsAtomSnapshot | null | undefined => {
  const d = s.child?.data;
  if (!d || typeof d !== 'object') return undefined;
  return isRecord(d.shops) ? (d.shops as ShopsAtomSnapshot) : null;
};

function category(name: 'seed' | 'egg' | 'tool' | 'decor') {
  return defineKey<ShopCategorySnapshot | null>({
    policy: 'authoritative', tier: 'state', doc: `${name} shop`,
    sources: [stateSource(`/child/data/shops/${name}`, (s) => { const all = shops(s); return all === undefined ? undefined : (all?.[name] ?? null); })],
  });
}

export const SHOP_KEYS = {
  weather: defineKey<WeatherAtomValue>({
    policy: 'authoritative', tier: 'state', doc: 'Current weather (null when clear)',
    sources: [
      stateSource('/child/data/weather', (s) => { const d = s.child?.data; if (!d || typeof d !== 'object') return undefined; const w = d.weather; return typeof w === 'string' ? w : w === null ? null : undefined; }),
      atomSource(/^weather(?:State)?Atom$/, 'authoritative', { project: (v) => (typeof v === 'string' ? v : v === null ? null : undefined) }),
    ],
  }),
  shops: defineKey<ShopsAtomSnapshot | null>({
    policy: 'authoritative', tier: 'state', doc: 'All shops keyed by id (shopsAtom was removed by the game)',
    sources: [stateSource('/child/data/shops', shops)],
  }),
  seedShop: category('seed'),
  eggShop: category('egg'),
  toolShop: category('tool'),
  decorShop: category('decor'),
};
