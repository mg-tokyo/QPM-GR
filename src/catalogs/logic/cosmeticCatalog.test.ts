import { beforeEach, expect, it, vi } from 'vitest';

// Game 1468 shape: a hoisted id string in the same declaration, and the currency enum in another chunk.
const entry = (n: number): string =>
  `{id:\`Mid_Item${n}.png\`,filename:\`Mid_Item${n}.png\`,type:\`Mid\`,availability:\`purchasable\`,displayName:\`Item ${n}\`,cost:w.${n % 2 ? 'CoinsD' : 'DustShowcase'}}`;
const COSMETIC_CHUNK = `var a=1;var _=x(),kt=\`Bottom_ToastShirt.png\`,w={CoinsD:{currency:_.Coins,amount:1e3},DustShowcase:{currency:_.MagicDust,amount:25e3}},T=[`
  + `{id:\`Bottom_HazmatSuit.png\`,filename:\`Bottom_HazmatSuit.png\`,type:\`Bottom\`,availability:\`purchasable\`,displayName:\`Hazmat\`,cost:w.DustShowcase},`
  + `{id:kt,filename:kt,type:\`Bottom\`,availability:\`claimable\`,displayName:\`Toast Shirt\`,drop:\`outfitStationLaunch\`},`
  + `{id:unknownRef,filename:unknownRef,type:\`Bottom\`,availability:\`claimable\`,displayName:\`Lost\`},`
  + `${Array.from({ length: 12 }, (_v, i) => entry(i)).join(',')}];`;
const ENUM_CHUNK = `${'/* pad */'.repeat(120)}var pt=function(e){return e.Coins=\`coins\`,e.Credits=\`credits\`,e.MagicDust=\`magicDust\`,e}({});`;
// Build 2016 seededShuffle-*.js / beta SmoothProgressBar-*.js: a sprite-bounds table keyed by the anchor filename.
const DECOY_CHUNK = `var b={"Bottom_GothicFrock.png":{x0:.2922,y0:.4672,x1:.7094,y1:.7484},"Bottom_HazmatSuit.png":{x0:.2719,y0:.4906,x1:.7281,y1:.7484}};`;
const COSMETIC_URL = 'https://magicgarden.gg/version/1/assets/LocalizedTextContent-B.js';
const DECOY_URL = 'https://magicgarden.gg/version/1/assets/seededShuffle-E.js';
const URLS: Record<string, string> = {
  'https://magicgarden.gg/version/1/assets/modalAtom-A.js': ENUM_CHUNK,
  [COSMETIC_URL]: COSMETIC_CHUNK,
  [DECOY_URL]: DECOY_CHUNK,
};

// Scripted failures per URL ('503' | 'throw'), consumed in order; an empty queue answers 200.
const net = { failures: new Map<string, string[]>(), calls: [] as string[], extraUrls: [] as string[], order: null as string[] | null };

// The real logger needs the page; the parser only calls debug.
vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) }));
vi.mock('../../core/pageContext', () => ({
  pageWindow: {
    performance: { getEntriesByType: () => [...(net.order ?? Object.keys(URLS)), ...net.extraUrls].map((name) => ({ name })) },
    fetch: (u: string) => {
      net.calls.push(u);
      const failure = net.failures.get(u)?.shift();
      if (failure === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
      if (failure === '503') return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(URLS[u] ?? '') });
    },
  },
}));

const cosmeticCalls = (): number => net.calls.filter((u) => u === COSMETIC_URL).length;

beforeEach(() => {
  vi.resetModules();
  net.failures.clear();
  net.calls.length = 0;
  net.extraUrls.length = 0;
  net.order = null;
});

it('skips an anchor chunk that does not parse, listed before the real one', async () => {
  net.order = [DECOY_URL, ...Object.keys(URLS).filter((u) => u !== DECOY_URL)];
  const { getCosmeticCatalogFromBundle } = await import('./cosmeticCatalog');
  expect((await getCosmeticCatalogFromBundle()).catalog).toHaveLength(14);
});

it('parses hoisted ids, drops unresolvable entries, and resolves a currency enum from another chunk', async () => {
  const { getCosmeticCatalogFromBundle } = await import('./cosmeticCatalog');
  const { catalog } = await getCosmeticCatalogFromBundle();
  expect(catalog).toHaveLength(14);
  expect(catalog?.find((e) => e.displayName === 'Toast Shirt')).toMatchObject({ id: 'Bottom_ToastShirt.png', price: 0 });
  expect(catalog?.find((e) => e.displayName === 'Lost')).toBeUndefined();
  expect(catalog?.find((e) => e.id === 'Bottom_HazmatSuit.png')).toMatchObject({ price: 25000, currency: 'magicDust' });
  expect(catalog?.find((e) => e.id === 'Mid_Item1.png')).toMatchObject({ price: 1000, currency: 'coins' });
});

// The decoy comes after the real chunk here, as on live build 2016.
it('retries a chunk whose fetch failed and parses it once the server answers', async () => {
  net.failures.set(COSMETIC_URL, ['503']);
  const { getCosmeticCatalogFromBundle } = await import('./cosmeticCatalog');
  const first = await getCosmeticCatalogFromBundle();
  expect(first).toMatchObject({ catalog: null, triedNewChunks: true });
  const second = await getCosmeticCatalogFromBundle();
  expect(second.catalog).toHaveLength(14);
  expect(cosmeticCalls()).toBe(2);
});

it('gives a URL up after 3 failed requests', async () => {
  net.failures.set(COSMETIC_URL, ['503', 'throw', '503']);
  const { getCosmeticCatalogFromBundle } = await import('./cosmeticCatalog');
  for (let i = 0; i < 3; i++) expect((await getCosmeticCatalogFromBundle()).triedNewChunks).toBe(true);
  const fourth = await getCosmeticCatalogFromBundle();
  expect(fourth).toMatchObject({ catalog: null, triedNewChunks: false });
  expect(cosmeticCalls()).toBe(3);
});

it('gives a given-up URL exactly one more request when a new chunk appears', async () => {
  net.failures.set(COSMETIC_URL, ['503', '503', '503', '503']);
  const { getCosmeticCatalogFromBundle } = await import('./cosmeticCatalog');
  for (let i = 0; i < 4; i++) await getCosmeticCatalogFromBundle();
  expect(cosmeticCalls()).toBe(3);

  net.extraUrls.push('https://magicgarden.gg/version/1/assets/nl-C.js');
  expect((await getCosmeticCatalogFromBundle()).catalog).toBeNull();
  expect(cosmeticCalls()).toBe(4);
  await getCosmeticCatalogFromBundle();
  expect(cosmeticCalls()).toBe(4);

  net.extraUrls.push('https://magicgarden.gg/version/1/assets/de-D.js');
  expect((await getCosmeticCatalogFromBundle()).catalog).toHaveLength(14);
  expect(cosmeticCalls()).toBe(5);
});
