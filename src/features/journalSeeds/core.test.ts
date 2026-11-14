import { describe, expect, it, vi } from 'vitest';
import type { Journal } from '../journal/checker';

// literal-list-justified: mocked mutation catalog fixture (id → display name) for the test.
const MUTATIONS = { Gold: { name: 'Gold' }, Wet: { name: 'Wet' }, Ambershine: { name: 'Amberlit' } };
vi.mock('../../catalogs/gameCatalogs', () => ({ getMutationCatalog: () => MUTATIONS }));

const { computeWatchedSeeds, countOwnedSeeds } = await import('./core');

const ALL = ['Normal', 'Gold', 'Wet', 'Ambershine', 'Max Weight'];
const log = (...variants: string[]) => ({ variantsLogged: variants.map((variant) => ({ variant })) });
// literal-list-justified: test fixture species/journal for the pure core.
const SPECIES = ['Carrot', 'Daisy', 'PurpleDaisy', 'Tulip'];
const PAIRS = [{ patch: 'Daisy', rare: 'PurpleDaisy' }];
const run = (journal: Journal, owned: Record<string, number> = {}, over: { pairs?: typeof PAIRS | null; weatherMutation?: string | null } = {}) =>
  computeWatchedSeeds({ journal, species: SPECIES, owned: new Map(Object.entries(owned)), pairs: over.pairs === undefined ? PAIRS : over.pairs, weatherMutation: over.weatherMutation ?? null });
// literal-list-justified: test fixture species/journal for the pure core.
const complete: Journal = { produce: { Carrot: log(...ALL), Daisy: log(...ALL), PurpleDaisy: log(...ALL), Tulip: log(...ALL) } };

describe('countOwnedSeeds (ALR-16.3, D1)', () => {
  it('adds bag seeds, Seed Silo seeds and planted plants on both garden maps; other items ignored', () => {
    const myData = {
      inventory: {
        items: [{ itemType: 'Seed', species: 'Carrot', quantity: 2 }, { itemType: 'Produce', species: 'Tulip', quantity: 9 }],
        storages: [{ decorId: 'PetHutch', items: [{ itemType: 'Seed', species: 'Tulip', quantity: 5 }] }, { decorId: 'SeedSilo', items: [{ itemType: 'Seed', species: 'Carrot', quantity: 3 }, { itemType: 'Seed', species: 'Daisy', quantity: 1 }] }],
      },
      garden: { tileObjects: { 1: { objectType: 'plant', species: 'Tulip' }, 2: { objectType: 'egg', eggId: 'X' } }, boardwalkTileObjects: { 7: { objectType: 'plant', species: 'Tulip' } } },
    };
    expect(Object.fromEntries(countOwnedSeeds(myData))).toEqual({ Carrot: 5, Daisy: 1, Tulip: 2 });
    expect(countOwnedSeeds(null).size).toBe(0);
  });
});

describe('computeWatchedSeeds (ALR-16.3)', () => {
  it('a species never logged is watched with every variant missing; complete species are not', () => {
    const j: Journal = { produce: { ...complete.produce, Carrot: log() } };
    expect(run(j)).toEqual([{ seedSpecies: 'Carrot', forSpecies: 'Carrot', missing: ALL, weatherMatch: null }]);
    expect(run(complete)).toEqual([]);
  });

  it('owning the seed in bag, Silo or garden excludes it (counts arrive merged)', () => {
    const j: Journal = { produce: { ...complete.produce, Tulip: log('Normal') } };
    expect(run(j).map((w) => w.seedSpecies)).toEqual(['Tulip']);
    expect(run(j, { Tulip: 1 })).toEqual([]);
  });

  it('an unlogged rare crop watches its base seed; owning the base excludes it; pairs null → no base-seed entry', () => {
    const j: Journal = { produce: { ...complete.produce, PurpleDaisy: log('Normal') } };
    expect(run(j)).toEqual([{ seedSpecies: 'Daisy', forSpecies: 'PurpleDaisy', missing: ['Gold', 'Wet', 'Ambershine', 'Max Weight'], weatherMatch: null }]);
    expect(run(j, { Daisy: 3 })).toEqual([]);
    expect(run(j, {}, { pairs: null }).filter((w) => w.seedSpecies !== w.forSpecies)).toEqual([]);
  });

  it('weather match: set when the weather mutation is unlogged (id or name), sorted first; off when logged', () => {
    // literal-list-justified: test fixture species/journal for the pure core.
    const j: Journal = { produce: { Carrot: log('Wet'), Daisy: log(...ALL), PurpleDaisy: log(...ALL), Tulip: log('Normal') } };
    expect(run(j, {}, { weatherMutation: 'Wet' }).map((w) => [w.forSpecies, w.weatherMatch])).toEqual([['Tulip', 'Wet'], ['Carrot', null]]);
    expect(run(j, {}, { weatherMutation: 'Ambershine' }).map((w) => w.weatherMatch)).toEqual(['Ambershine', 'Ambershine']);
    expect(run(j).every((w) => w.weatherMatch === null)).toBe(true);
  });
});
