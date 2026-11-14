import { describe, expect, it, vi } from 'vitest';
import type { Journal } from './checker';

// literal-list-justified: mocked mutation catalog fixture (id → display name) for the test.
const MUTATIONS = {
  Gold: { name: 'Gold' },
  Rainbow: { name: 'Rainbow' },
  Ambershine: { name: 'Amberlit' },
  MaxWeight: { name: 'Max Weight' },
};
let journal: Journal = {};

vi.mock('../../catalogs/gameCatalogs', () => ({
  getMutationCatalog: () => MUTATIONS,
  getAllPlantSpecies: () => ['Carrot', 'Tulip'],
  getAllPetSpecies: () => [],
  mergeCatalogIfIncomplete: () => Promise.resolve(),
}));
vi.mock('../../core/atomRegistry', () => ({
  readAtomValue: () => Promise.resolve({ child: { data: { userSlots: [{ ownerId: 'p1', data: { journal } }] } } }),
}));
vi.mock('../../core/playerContext', () => ({
  getPlayerId: () => Promise.resolve('p1'),
  getSlotOwnerId: (s: { ownerId?: string }) => s.ownerId,
}));
vi.mock('../../utils/logger', () => ({ log: () => undefined }));

const { getUnloggedProduceVariants, unloggedBadges } = await import('./unlogged');
const { getJournalSummary, refreshJournalCache } = await import('./checker');
const { getVariantBadges } = await import('../mutations/data/variantBadges');

const log = (...variants: string[]) => ({ variantsLogged: variants.map((variant) => ({ variant, createdAt: 1 })) });
const ids = (j: Journal, species: string) => getUnloggedProduceVariants(j, species)?.map((v) => v.id);

// The tooltip's pre-ALR-16.1 matching (journalBadges.ts), kept as the oracle for the badge set.
function oldBadgeLabels(j: Journal, species: string): string[] {
  const entry = j.produce?.[species];
  if (!entry) return getVariantBadges().map((b) => b.label);
  const logged = new Set((entry.variantsLogged ?? []).map((v) => v.variant.toLowerCase()));
  return getVariantBadges().filter((b) => !b.matches.some((m) => logged.has(m.toLowerCase()))).map((b) => b.label);
}

describe('unlogged produce variants (ALR-16.1)', () => {
  const all = ['Normal', 'Gold', 'Rainbow', 'Ambershine', 'Max Weight'];

  it('never logged: every variant, journal order, catalog Max Weight entry not doubled', () => {
    expect(ids({ produce: {} }, 'Carrot')).toEqual(all);
  });

  it('partly logged: ids and display names both count as logged', () => {
    expect(ids({ produce: { Carrot: log('Normal', 'Ambershine') } }, 'Carrot')).toEqual(['Gold', 'Rainbow', 'Max Weight']);
    expect(ids({ produce: { Carrot: log('Amberlit') } }, 'Carrot')).toEqual(['Normal', 'Gold', 'Rainbow', 'Max Weight']);
  });

  it('fully logged: nothing left; Max Weight only: everything but Max Weight', () => {
    expect(ids({ produce: { Carrot: log(...all) } }, 'Carrot')).toEqual([]);
    expect(ids({ produce: { Carrot: log('Max Weight') } }, 'Carrot')).toEqual(all.slice(0, -1));
  });

  it('species key matched loosely as a guard', () => {
    expect(ids({ produce: { 'carrot ': log('Normal') } }, 'Carrot')).toEqual(all.slice(1));
  });

  it('badge set matches the old tooltip matching on never, partly and fully logged species', () => {
    const fixtures: Journal[] = [{ produce: {} }, { produce: { Carrot: log('Normal', 'Ambershine', 'Gold') } }, { produce: { Carrot: log(...all) } }];
    for (const j of fixtures) {
      expect(unloggedBadges(j, 'Carrot').map((b) => b.label)).toEqual(oldBadgeLabels(j, 'Carrot'));
    }
  });

  it('journal summary: collected flags and dates per species', async () => {
    journal = { produce: { Carrot: log('Normal', 'Ambershine') } };
    refreshJournalCache();
    const summary = await getJournalSummary();
    expect(summary?.produce).toEqual([
      { species: 'Carrot', variants: [
        { variant: 'Normal', collected: true, collectedAt: 1 },
        { variant: 'Gold', collected: false, collectedAt: undefined },
        { variant: 'Rainbow', collected: false, collectedAt: undefined },
        { variant: 'Amberlit', collected: true, collectedAt: 1 },
        { variant: 'Max Weight', collected: false, collectedAt: undefined },
      ] },
      { species: 'Tulip', variants: ['Normal', 'Gold', 'Rainbow', 'Amberlit', 'Max Weight'].map((variant) => ({ variant, collected: false, collectedAt: undefined })) },
    ]);
  });
});
