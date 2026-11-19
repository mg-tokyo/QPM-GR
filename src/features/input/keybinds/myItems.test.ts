import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  presses: [] as Array<{ kind: string; id: string; name: string }>,
}));

vi.mock('../../../utils/storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../utils/storage')>(),
  storage: {
    get: (k: string, fallback: unknown) => (state.store.has(k) ? state.store.get(k) : fallback),
    set: (k: string, v: unknown) => { state.store.set(k, JSON.parse(JSON.stringify(v))); },
  },
}));
vi.mock('../../../catalogs/gameCatalogs', () => ({
  getAllPlantSpecies: () => ['Leek'], getPlantSpecies: (id: string) => (id === 'Leek' ? { seed: { name: 'Leek Seed', sprite: 'sprite/seed/Leek' } } : null),
  getAllEggTypes: () => [], getEggType: () => null,
  getAllDecor: () => ['HayBale'], getDecor: (id: string) => (id === 'HayBale' ? { name: 'Hay Bale', art: 'sprite/decor/HayBale' } : null),
}));
vi.mock('../../../store/inventory', () => ({ getInventoryItems: () => [] }));
vi.mock('../selectItem', async () => vi.importActual<typeof import('../selectItem/myItems')>('../selectItem/myItems'));
vi.mock('./tools', () => ({
  pressSelect: (target: { kind: string; id: string }, name: string) => {
    state.presses.push({ kind: target.kind, id: target.id, name });
    return Promise.resolve();
  },
}));

const { buildMyItemActions, myItemActionId, myItemOf, setMyItemKeyed } = await import('./myItems');
const { getMyItems } = await import('../selectItem/myItems');
const { getActionBind, setActionBind } = await import('./actionBinds');

beforeEach(() => {
  state.store.clear();
  state.presses.length = 0;
});

describe('My items actions (INP-4.5)', () => {
  it('one My items action per chosen item, in chosen order', () => {
    setMyItemKeyed({ kind: 'decor', id: 'HayBale' }, true);
    setMyItemKeyed({ kind: 'seed', id: 'Leek' }, true);
    expect(buildMyItemActions().map(a => [a.id, a.section])).toEqual([['item:decor:HayBale', 'myItems'], ['item:seed:Leek', 'myItems']]);
  });

  it('running an action presses the select engine with the catalog name', async () => {
    await buildMyItemActions([{ kind: 'seed', id: 'Leek' }])[0]!.run();
    expect(state.presses).toEqual([{ kind: 'seed', id: 'Leek', name: 'Leek Seed' }]);
  });

  it('myItemOf reads the action id back; other ids and bad kinds are not items', () => {
    expect(myItemOf('item:egg:SnowEgg')).toEqual({ kind: 'egg', id: 'SnowEgg' });
    expect(myItemOf(myItemActionId({ kind: 'decor', id: 'Hay:Bale' }))).toEqual({ kind: 'decor', id: 'Hay:Bale' });
    expect(myItemOf('item:tool:Shovel')).toBeNull();
    expect(myItemOf('item:seed:')).toBeNull();
    expect(myItemOf('item:seed')).toBeNull();
    expect(myItemOf('tool:Shovel')).toBeNull();
  });

  it('removing an item drops its key; choosing it again starts unbound; other keys stay', () => {
    const leek = { kind: 'seed', id: 'Leek' } as const;
    setMyItemKeyed(leek, true);
    setActionBind(myItemActionId(leek), 'alt+1');
    setActionBind('tool:Shovel', 'alt+2');
    setMyItemKeyed(leek, false);
    expect(getMyItems()).toEqual([]);
    expect(getActionBind(myItemActionId(leek))).toBe('');
    expect(getActionBind('tool:Shovel')).toBe('alt+2');
    setMyItemKeyed(leek, true);
    expect(getActionBind(myItemActionId(leek))).toBe('');
  });
});
