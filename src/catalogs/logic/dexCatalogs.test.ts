import { beforeEach, expect, it, vi } from 'vitest';

const ROCK = (id: string): string => `${id}:{art:k.Decor.${id},name:\`Rock\`,coinPrice:1e3,creditPrice:2,rarity:L.Common}`;
// bundleParser rejects chunk texts under 1000 chars.
const PAD = '/* pad */'.repeat(120);
const DEX_CHUNK = `${PAD}var Dd={${ROCK('SmallRock')},${ROCK('MediumRock')},${ROCK('LargeRock')}};`;
const ENUM_CHUNK = `${PAD}var pt=` + '{Animation:{A:`sprite/animation/A`},Decor:{SmallRock:`sprite/decor/SmallRock`,MediumRock:`sprite/decor/MediumRock`,'
  + 'LargeRock:`sprite/decor/LargeRock`},Item:{B:`sprite/item/B`},Pet:{C:`sprite/pet/C`},Seed:{D:`sprite/seed/D`}};';

const urls: Record<string, string> = {};

vi.mock('../../diagnostics/logger', () => ({ createNamedLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }) }));
vi.mock('../../core/pageContext', () => ({
  pageWindow: {
    performance: { getEntriesByType: () => Object.keys(urls).map((name) => ({ name })) },
    fetch: (u: string) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(urls[u] ?? '') }),
  },
}));

beforeEach(() => {
  vi.resetModules();
  for (const k of Object.keys(urls)) delete urls[k];
  urls['https://magicgarden.gg/version/1/assets/modalAtom-A.js'] = DEX_CHUNK;
});

it('reports spritesResolved:false and no sprite fields when the enum chunk is absent', async () => {
  const { getDexBlueprint } = await import('./dexCatalogs');
  const blueprint = await getDexBlueprint('decorCatalog');
  expect(blueprint?.spritesResolved).toBe(false);
  expect(blueprint?.map.SmallRock).not.toHaveProperty('art');
});

it('resolves sprites from the enum in another chunk', async () => {
  urls['https://magicgarden.gg/version/1/assets/AsyncEpoch-B.js'] = ENUM_CHUNK;
  const { getDexBlueprint, getDexFromBundle } = await import('./dexCatalogs');
  const blueprint = await getDexBlueprint('decorCatalog');
  expect(blueprint?.spritesResolved).toBe(true);
  expect(blueprint?.map.SmallRock?.art).toBe('sprite/decor/SmallRock');
  expect((await getDexFromBundle('decorCatalog'))?.LargeRock?.art).toBe('sprite/decor/LargeRock');
});
