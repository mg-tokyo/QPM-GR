import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  bag: [] as unknown[],
  plants: { Carrot: { seed: { name: 'Carrot Seed', sprite: 'sprite/seed/Carrot' } }, Patch: { seed: {} } } as Record<string, { seed: { name?: string; sprite?: string } }>,
  eggs: { SnowEgg: { name: 'Snow Egg', sprite: 'sprite/pet/SnowEgg' } } as Record<string, { name?: string; sprite?: string }>,
  decor: { HayBale: { name: 'Hay Bale', art: 'sprite/decor/HayBale' }, Arch: { name: 'Arch' } } as Record<string, { name?: string; art?: string }>,
}));

vi.mock('../../../utils/storage', () => ({
  storage: {
    get: (k: string, fallback: unknown) => (state.store.has(k) ? state.store.get(k) : fallback),
    set: (k: string, v: unknown) => { state.store.set(k, JSON.parse(JSON.stringify(v))); },
  },
}));
vi.mock('../../../catalogs/gameCatalogs', () => ({
  getAllPlantSpecies: () => Object.keys(state.plants),
  getPlantSpecies: (id: string) => state.plants[id] ?? null,
  getAllEggTypes: () => Object.keys(state.eggs),
  getEggType: (id: string) => state.eggs[id] ?? null,
  getAllDecor: () => Object.keys(state.decor),
  getDecor: (id: string) => state.decor[id] ?? null,
}));
vi.mock('../../../store/inventory', () => ({ getInventoryItems: () => state.bag.map(raw => ({ raw })) }));

const m = await import('./myItems');

beforeEach(() => {
  state.store.clear();
  state.bag = [];
});

describe('my items store (INP-4.4)', () => {
  it('adds and removes once per item, saved under qpm.keybinds.myItems.v1, and tells listeners', () => {
    const seen = vi.fn();
    const off = m.onMyItemsChange(seen);
    m.setMyItemChosen({ kind: 'seed', id: 'Carrot' }, true);
    m.setMyItemChosen({ kind: 'seed', id: 'Carrot' }, true);
    m.setMyItemChosen({ kind: 'decor', id: 'HayBale' }, true);
    expect(state.store.get('qpm.keybinds.myItems.v1')).toEqual({ items: [{ kind: 'seed', id: 'Carrot' }, { kind: 'decor', id: 'HayBale' }] });
    m.setMyItemChosen({ kind: 'seed', id: 'Carrot' }, false);
    expect(m.getMyItems()).toEqual([{ kind: 'decor', id: 'HayBale' }]);
    expect(seen).toHaveBeenCalledTimes(3);
    off();
    m.setMyItemChosen({ kind: 'egg', id: 'SnowEgg' }, true);
    expect(seen).toHaveBeenCalledTimes(3);
  });

  it('drops bad, tool and duplicate entries from a stored list', () => {
    state.store.set('qpm.keybinds.myItems.v1', { items: [
      { kind: 'egg', id: 'SnowEgg' }, { kind: 'tool', id: 'Shovel' }, { kind: 'egg', id: 'SnowEgg' }, { kind: 'seed', id: '' }, null, 'x',
    ] });
    expect(m.getMyItems()).toEqual([{ kind: 'egg', id: 'SnowEgg' }]);
    state.store.set('qpm.keybinds.myItems.v1', 'garbage');
    expect(m.getMyItems()).toEqual([]);
  });

  it('lists catalog entries with a name, sorted, with the kind\'s sprite field', () => {
    expect(m.listPickableItems('seed')).toEqual([{ kind: 'seed', id: 'Carrot', name: 'Carrot Seed', spriteKey: 'sprite/seed/Carrot' }]);
    expect(m.listPickableItems('decor').map(i => [i.id, i.spriteKey])).toEqual([['Arch', null], ['HayBale', 'sprite/decor/HayBale']]);
    state.decor = { ...state.decor, BirdBath: { name: 'Bird Bath' } };
    expect(m.listPickableItems('decor').map(i => i.name)).toEqual(['Arch', 'Bird Bath', 'Hay Bale']);
  });

  it('in-bag check follows the select engine (kind, id, quantity)', () => {
    state.bag = [
      { itemType: 'Seed', species: 'Carrot', quantity: 3 },
      { itemType: 'Egg', eggId: 'SnowEgg', quantity: 0 },
      { itemType: 'Decor', decorId: 'HayBale', quantity: 1 },
    ];
    const items = [{ kind: 'seed', id: 'Carrot' }, { kind: 'egg', id: 'SnowEgg' }, { kind: 'seed', id: 'HayBale' }, { kind: 'decor', id: 'HayBale' }] as const;
    expect([...m.myItemsInBag(items)]).toEqual(['seed:Carrot', 'decor:HayBale']);
  });
});
