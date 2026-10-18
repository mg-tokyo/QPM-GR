import { expect, it, vi } from 'vitest';

// Game 1468 shape: a hoisted id string in the same declaration, and the currency enum in another chunk.
const entry = (n: number): string =>
  `{id:\`Mid_Item${n}.png\`,filename:\`Mid_Item${n}.png\`,type:\`Mid\`,availability:\`purchasable\`,displayName:\`Item ${n}\`,cost:w.${n % 2 ? 'CoinsD' : 'DustShowcase'}}`;
const COSMETIC_CHUNK = `var a=1;var _=x(),kt=\`Bottom_ToastShirt.png\`,w={CoinsD:{currency:_.Coins,amount:1e3},DustShowcase:{currency:_.MagicDust,amount:25e3}},T=[`
  + `{id:\`Bottom_HazmatSuit.png\`,filename:\`Bottom_HazmatSuit.png\`,type:\`Bottom\`,availability:\`purchasable\`,displayName:\`Hazmat\`,cost:w.DustShowcase},`
  + `{id:kt,filename:kt,type:\`Bottom\`,availability:\`claimable\`,displayName:\`Toast Shirt\`,drop:\`outfitStationLaunch\`},`
  + `{id:unknownRef,filename:unknownRef,type:\`Bottom\`,availability:\`claimable\`,displayName:\`Lost\`},`
  + `${Array.from({ length: 12 }, (_v, i) => entry(i)).join(',')}];`;
const ENUM_CHUNK = `${'/* pad */'.repeat(120)}var pt=function(e){return e.Coins=\`coins\`,e.Credits=\`credits\`,e.MagicDust=\`magicDust\`,e}({});`;
const URLS: Record<string, string> = {
  'https://magicgarden.gg/version/1/assets/modalAtom-A.js': ENUM_CHUNK,
  'https://magicgarden.gg/version/1/assets/LocalizedTextContent-B.js': COSMETIC_CHUNK,
};

// The real logger needs the page; the parser only calls debug.
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) }));
vi.mock('../../core/pageContext', () => ({
  pageWindow: {
    performance: { getEntriesByType: () => Object.keys(URLS).map((name) => ({ name })) },
    fetch: (u: string) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(URLS[u] ?? '') }),
  },
}));

it('parses hoisted ids, drops unresolvable entries, and resolves a currency enum from another chunk', async () => {
  const { getCosmeticCatalogFromBundle } = await import('./cosmeticCatalog');
  const { catalog } = await getCosmeticCatalogFromBundle();
  expect(catalog).toHaveLength(14);
  expect(catalog?.find((e) => e.displayName === 'Toast Shirt')).toMatchObject({ id: 'Bottom_ToastShirt.png', price: 0 });
  expect(catalog?.find((e) => e.displayName === 'Lost')).toBeUndefined();
  expect(catalog?.find((e) => e.id === 'Bottom_HazmatSuit.png')).toMatchObject({ price: 25000, currency: 'magicDust' });
  expect(catalog?.find((e) => e.id === 'Mid_Item1.png')).toMatchObject({ price: 1000, currency: 'coins' });
});
