import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  catalog: ['WateringCan', 'Shovel'] as string[],
  outcome: 'picked' as string,
  presses: [] as Array<{ kind: string; id: string; name: string | undefined }>,
  storageName: null as string | null,
}));

vi.mock('../../../catalogs/gameCatalogs', () => ({
  getAllItems: () => state.catalog,
  getAllDecor: () => ['SeedSilo'],
  getDecor: (id: string) => (id === 'SeedSilo' ? { name: 'Seed Silo' } : null),
}));
vi.mock('../../../catalogs/shopEligibility', () => ({
  getItemCatalogName: (id: string) => (id === 'Shovel' ? 'Garden Shovel' : null),
  getItemCatalogSpriteKey: (id: string) => (id === 'Shovel' ? 'sprite/item/Shovel' : null),
}));
vi.mock('../../../store/inventory', () => ({ getInventoryItems: () => [], onInventoryChange: () => () => {} }));
vi.mock('../selectItem', async () => {
  const core = await vi.importActual<typeof import('../selectItem/core')>('../selectItem/core');
  return {
    chooseItemId: core.chooseItemId,
    pressSelectItem: async (target: { kind: string; id: string }, labels: { item: string; storage: (id: string) => string }) => {
      state.presses.push({ kind: target.kind, id: target.id, name: labels.item });
      state.storageName = labels.storage('SeedSilo');
      return state.outcome === 'failed' ? { outcome: 'failed', reason: 'not_connected' } : { outcome: state.outcome };
    },
  };
});

const { buildToolActions, toolIdOf, toolLook, toolsInBag } = await import('./tools');

beforeEach(() => {
  state.catalog = ['WateringCan', 'Shovel'];
  state.outcome = 'picked';
  state.presses.length = 0;
});

describe('tool actions (INP-4.3)', () => {
  it('one Tools action per catalog tool, in catalog order; a new catalog tool adds a row', () => {
    expect(buildToolActions().map(a => [a.id, a.section])).toEqual([['tool:WateringCan', 'tools'], ['tool:Shovel', 'tools']]);
    state.catalog = [...state.catalog, 'SnowWardShard'];
    expect(buildToolActions().map(a => a.id)).toEqual(['tool:WateringCan', 'tool:Shovel', 'tool:SnowWardShard']);
  });

  it('running an action presses the select engine with the catalog name and storage names', async () => {
    await buildToolActions()[1]!.run();
    expect(state.presses).toEqual([{ kind: 'tool', id: 'Shovel', name: 'Garden Shovel' }]);
    expect(state.storageName).toBe('Seed Silo');
  });

  it('a send failure rejects so the dispatcher reports it; a missing tool does not', async () => {
    state.outcome = 'failed';
    await expect(buildToolActions()[1]!.run()).rejects.toThrow('not_connected');
    for (const outcome of ['missing', 'bagFull', 'refused', 'superseded']) {
      state.outcome = outcome;
      await expect(buildToolActions()[1]!.run()).resolves.toBeUndefined();
    }
  });

  it('toolIdOf and toolLook (catalog id when the name is unknown)', () => {
    expect(toolIdOf('tool:Shovel')).toBe('Shovel');
    expect(toolIdOf('tool:')).toBeNull();
    expect(toolIdOf('panel:seedSilo')).toBeNull();
    expect(toolLook('Shovel')).toEqual({ name: 'Garden Shovel', spriteKey: 'sprite/item/Shovel' });
    expect(toolLook('WateringCan')).toEqual({ name: 'WateringCan', spriteKey: null });
  });

  it('in-bag follows the engine rule: quantity 0 and other kinds do not count, charged crystals do', () => {
    const bag = [
      { itemType: 'Tool', toolId: 'a', quantity: 1 },
      { itemType: 'Tool', toolId: 'b', quantity: 0 },
      { itemType: 'Tool', toolId: 'c', id: 'c1', remainingActiveSeconds: 60 },
      { itemType: 'Seed', species: 'd', quantity: 3 },
    ];
    expect(toolsInBag(['a', 'b', 'c', 'd'], bag)).toEqual(new Set(['a', 'c']));
  });
});
