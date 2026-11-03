import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/gameState', () => ({ readSync: vi.fn(() => null) }));
vi.mock('../../catalogs/gameCatalogs', () => ({
  getPlantCatalog: () => ({ Carrot: { seed: { rarity: 'Common', coinPrice: 10 } }, Lily: { seed: { rarity: 'Legendary', coinPrice: 20000 } } }),
  getEggCatalog: () => ({ CommonEgg: { rarity: 'Common', coinPrice: 100000 } }),
}));

import type { GuardPredicate } from '../../websocket/sendGuard';
import type { QuinoaUserSlotData } from '../../types/gameAtoms';
import { createFixtureSession, type FixtureSessionDeps } from './session';
import { buildSnapshot } from './snapshot';
import type { BeginInput, EndResult, FixtureConfig, LedgerSlot } from './types';

const config: FixtureConfig = {
  schema: 1, allowRarity: 'Common', reserveFloors: { 'egg:CommonEgg': 14000 }, buyEggsAtOrBelowFloor: true,
  spendCapPerRun: 105000, spendCapPerDay: 250000, coinFloor: 45_000_000_000_000, useCaps: { seeds: 20, eggs: 5 },
};

const pet = (id: string, species = 'Bee'): Record<string, unknown> => ({ id, petSpecies: species, name: null, itemType: 'Pet', hunger: 1 });

type World = { data: QuinoaUserSlotData };
function world(): World {
  return {
    data: {
      coinsCount: 46_000_000_000_000,
      inventory: {
        items: [{ itemType: 'Seed', species: 'Carrot', quantity: 5 }, { itemType: 'Egg', eggId: 'CommonEgg', quantity: 14000 }, pet('p-inv')],
        storages: [{ decorId: 'PetHutch', items: [pet('p-hutch')] }],
        favoritedItemIds: ['p-hutch'],
      },
      petSlots: [{ id: 'p-active', petSpecies: 'Worm', name: null }],
      petTeams: [{ id: 't1', members: [{ petId: 'p-active' }] }],
      garden: { tileObjects: { 3: { objectType: 'plant', species: 'Lily', plantedAt: 111 }, 9: { objectType: 'egg', eggId: 'CommonEgg', plantedAt: 222 } } },
    },
  };
}

type Harness = {
  deps: FixtureSessionDeps;
  w: World;
  guards: Map<string, GuardPredicate>;
  fireConnection(): void;
  fireData(): void;
  identity: unknown[];
  target: EventTarget;
  clock: { t: number };
};
function harness(over: Partial<FixtureSessionDeps> = {}): Harness {
  const w = world();
  const guards = new Map<string, GuardPredicate>();
  const connCbs = new Set<() => void>();
  const dataCbs = new Set<() => void>();
  const identity: unknown[] = [{ room: 1 }, { socket: 1 }];
  const target = new EventTarget();
  const clock = { t: Date.parse('2026-10-26T00:00:00Z') };
  const deps: FixtureSessionDeps = {
    readData: () => w.data,
    isReady: () => true,
    addGuard: (name, p) => { guards.set(name, p); return true; },
    removeGuard: (name) => { guards.delete(name); },
    guardActive: () => guards.size > 0,
    connectionIdentity: () => [...identity],
    onConnectionChange: (cb) => { connCbs.add(cb); return () => connCbs.delete(cb); },
    subscribeData: (cb) => { dataCbs.add(cb); return () => dataCbs.delete(cb); },
    unloadTarget: target,
    now: () => new Date(clock.t),
    ...over,
  };
  return {
    deps, w, guards, identity, target, clock,
    fireConnection: () => { for (const cb of [...connCbs]) cb(); },
    fireData: () => { for (const cb of [...dataCbs]) cb(); },
  };
}

const input = (over: Partial<BeginInput> = {}): BeginInput => ({
  runId: 'fix-run-20261026-000000', config, ledger: { schema: 1, slots: [], petIds: [], itemIds: [] }, budget: { spendCap: 105000 }, alert: false, ...over,
});
const send = (h: Harness, type: string, payload: Record<string, unknown>, origin: 'qpm' | 'native' = 'qpm') => {
  const g = h.guards.get('fixture');
  if (!g) throw new Error('no fixture guard');
  return g(type, { type, ...payload }, origin);
};
const asEnd = (v: ReturnType<ReturnType<typeof createFixtureSession>['end']>): EndResult => {
  if ('ok' in v) throw new Error('end refused');
  return v;
};

let h: Harness;
beforeEach(() => { h = harness(); });

describe('fixture session begin', () => {
  it('begin refuses on alert / open session / not ready / bad input', () => {
    const s = createFixtureSession(h.deps);
    expect(s.begin(input({ alert: true }))).toEqual({ ok: false, reason: 'alert' });
    expect(s.begin({ runId: 'x' })).toEqual({ ok: false, reason: 'bad-input' });
    expect(createFixtureSession(harness({ isReady: () => false }).deps).begin(input())).toEqual({ ok: false, reason: 'not-ready' });
    expect(createFixtureSession(harness({ addGuard: () => false }).deps).begin(input())).toEqual({ ok: false, reason: 'not-ready' });
    expect(s.begin(input()).ok).toBe(true);
    expect(s.begin(input())).toEqual({ ok: false, reason: 'open' });
    expect(h.guards.has('fixture')).toBe(true);
  });

  it('begin drops ledger slots whose object is gone or changed', () => {
    const slots: LedgerSlot[] = [
      { slot: '9', kind: 'egg', id: 'CommonEgg', runId: 'r0', objectId: '222' },
      { slot: '3', kind: 'plant', id: 'Carrot', runId: 'r0' },
      { slot: '9', kind: 'egg', id: 'CommonEgg', runId: 'r0', objectId: '999' },
      { slot: '20', kind: 'plant', id: 'Carrot', runId: 'r0' },
    ];
    const r = createFixtureSession(h.deps).begin(input({ ledger: { schema: 1, slots, petIds: [], itemIds: [] } }));
    if (!r.ok) throw new Error('begin refused');
    expect(r.ledgerDropped.map((s) => s.slot)).toEqual(['3', '9', '20']);
    expect(send(h, 'HatchEgg', { slot: 9 })).toEqual({ allow: true });
    expect(send(h, 'HarvestCrop', { slot: 3, slotsIndex: 0, cropItemId: 'c1' })).toEqual({ allow: false, reason: 'slot-protected' });
  });

  it('begin returns the allowlisted ids of the before snapshot, by catalog rarity', () => {
    h.w.data.inventory?.items?.push(
      { itemType: 'Seed', species: 'Lily', quantity: 2 },
      { itemType: 'Produce', id: 'c1', species: 'Carrot' },
      { itemType: 'Produce', id: 'c2', species: 'Lily' },
      { itemType: 'Produce', id: 'c3', species: 'Carrot' },
    );
    const r = createFixtureSession(h.deps).begin(input());
    if (!r.ok) throw new Error('begin refused');
    expect(r.allowlist).toEqual({ seed: ['Carrot'], egg: ['CommonEgg'], crop: ['Carrot'] });
  });
});

describe('fixture session guard', () => {
  it('allowed purchase reserves spend; status().spent reflects it', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input());
    expect(send(h, 'PurchaseShopItem', { shop: 'seed', item: { itemType: 'Seed', species: 'Carrot' }, quantity: 3 })).toEqual({ allow: true });
    expect(s.status()).toMatchObject({ open: true, spent: 30 });
  });

  it('refused send recorded with origin and reason', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input());
    expect(send(h, 'SellPet', { itemId: 'p-hutch' }, 'native')).toEqual({ allow: false, reason: 'pet-protected' });
    expect(s.status().refusals).toEqual([{ at: '2026-10-26T00:00:00.000Z', type: 'SellPet', origin: 'native', verdict: 'refuse', reason: 'pet-protected' }]);
  });

  it('background allows are logged once per type and origin', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input());
    send(h, 'PlayerPosition', { x: 1 });
    send(h, 'PlayerPosition', { x: 2 });
    send(h, 'PlayerPosition', { x: 3 }, 'native');
    expect(asEnd(s.end()).events.map((e) => `${e.type}|${e.origin}`)).toEqual(['PlayerPosition|qpm', 'PlayerPosition|native']);
  });

  it('pet appearing without HatchEgg is not owned', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input());
    h.w.data.petSlots = [...(h.w.data.petSlots ?? []), pet('p-new')];
    h.fireData();
    expect(send(h, 'SellPet', { itemId: 'p-new' })).toEqual({ allow: false, reason: 'pet-protected' });
    expect(asEnd(s.end()).learned.petIds).toEqual([]);
  });

  it('pet appearing after allowed HatchEgg on owned slot is owned', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input({ ledger: { schema: 1, slots: [{ slot: '9', kind: 'egg', id: 'CommonEgg', runId: 'r0', objectId: '222' }], petIds: [], itemIds: [] } }));
    expect(send(h, 'HatchEgg', { slot: 9 })).toEqual({ allow: true });
    h.w.data.inventory?.items?.push(pet('p-hatched'), pet('p-other'));
    h.fireData();
    expect(send(h, 'SellPet', { itemId: 'p-hatched' })).toEqual({ allow: true });
    expect(send(h, 'SellPet', { itemId: 'p-other' })).toEqual({ allow: false, reason: 'pet-protected' });
    expect(asEnd(s.end()).learned.petIds).toEqual(['p-hatched']);
  });

  it('a stale HatchEgg (server rejected) does not claim a later pet', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input({ ledger: { schema: 1, slots: [{ slot: '9', kind: 'egg', id: 'CommonEgg', runId: 'r0' }], petIds: [], itemIds: [] } }));
    send(h, 'HatchEgg', { slot: 9 });
    h.clock.t += 60_000;
    h.w.data.inventory?.items?.push(pet('p-late'));
    h.fireData();
    expect(asEnd(s.end()).learned.petIds).toEqual([]);
  });

  it('plant then harvest: slot and crop id are learned, objectId filled from the after snapshot', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input());
    expect(send(h, 'PlantSeed', { slot: 7, species: 'Carrot' })).toEqual({ allow: true });
    const tiles = (h.w.data.garden as { tileObjects: Record<string, unknown> }).tileObjects;
    tiles['7'] = { objectType: 'plant', species: 'Carrot', plantedAt: 333 };
    expect(send(h, 'HarvestCrop', { slot: 7, slotsIndex: 0, cropItemId: 'crop-1' })).toEqual({ allow: true });
    const end = asEnd(s.end());
    expect(end.learned.slots).toEqual([{ slot: '7', kind: 'plant', id: 'Carrot', runId: 'fix-run-20261026-000000', objectId: '333' }]);
    expect(end.learned.itemIds).toEqual(['crop-1']);
    expect(end.endReason).toBe('end');
  });
});

describe('fixture session lifecycle', () => {
  it('connection change ends the session', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input());
    send(h, 'SellAllCrops', {});
    h.fireConnection();
    expect(h.guards.has('fixture')).toBe(true);
    h.identity[1] = { socket: 2 };
    h.fireConnection();
    expect(h.guards.has('fixture')).toBe(false);
    expect(s.status()).toMatchObject({ open: false, endReason: 'connection-changed' });
    expect(s.begin(input())).toEqual({ ok: false, reason: 'open' });
    const end = asEnd(s.end());
    expect(end.endReason).toBe('connection-changed');
    expect(end.events.map((e) => e.type)).toEqual(['SellAllCrops']);
    expect(s.end()).toEqual({ ok: false, reason: 'not-open' });
  });

  it('end removes the guard and returns after + learned + spent', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input());
    send(h, 'PurchaseShopItem', { shop: 'seed', item: { itemType: 'Seed', species: 'Carrot' } });
    const end = asEnd(s.end());
    expect(h.guards.size).toBe(0);
    expect(end).toMatchObject({ runId: 'fix-run-20261026-000000', spent: 10, learned: { slots: [], petIds: [], itemIds: [] } });
    expect(end.after).toEqual(buildSnapshot(h.w.data, new Date(h.clock.t)));
    expect(s.status().open).toBe(false);
  });

  it('pagehide ends the session and the listener is removed on end()', () => {
    const s = createFixtureSession(h.deps);
    s.begin(input());
    h.target.dispatchEvent(new Event('pagehide'));
    expect(h.guards.has('fixture')).toBe(false);
    expect(s.status().endReason).toBe('unload');
    asEnd(s.end());
    const remove = vi.spyOn(h.target, 'removeEventListener');
    s.begin(input());
    asEnd(s.end());
    expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });
});

describe('fixture snapshot', () => {
  it('emits exactly the snapshot keys, sorted, without natural-change fields', () => {
    const snap = buildSnapshot(world().data, new Date(0));
    expect(Object.keys(snap)).toEqual(['takenAt', 'coins', 'stacks', 'crops', 'favoritedItemIds', 'pets', 'teams', 'garden']);
    expect(snap.pets).toEqual([
      { id: 'p-active', species: 'Worm', name: null, location: 'active' },
      { id: 'p-hutch', species: 'Bee', name: null, location: 'hutch' },
      { id: 'p-inv', species: 'Bee', name: null, location: 'inventory' },
    ]);
    expect(snap.stacks).toEqual([{ kind: 'egg', id: 'CommonEgg', quantity: 14000 }, { kind: 'seed', id: 'Carrot', quantity: 5 }]);
    expect(snap.garden).toEqual([
      { slot: '3', objectType: 'plant', id: 'Lily', objectId: '111' },
      { slot: '9', objectType: 'egg', id: 'CommonEgg', objectId: '222' },
    ]);
    expect(snap.teams).toEqual([{ id: 't1', petIds: ['p-active'] }]);
  });

  it('sums a stack across inventory and storages; unknown item types fail closed', () => {
    const data = world().data;
    data.inventory?.storages?.push({ decorId: 'SeedSilo', items: [{ itemType: 'Seed', species: 'Carrot', quantity: 7 }, { itemType: 'Gizmo', id: 'g1' }] });
    const snap = buildSnapshot(data, new Date(0));
    expect(snap.stacks).toContainEqual({ kind: 'seed', id: 'Carrot', quantity: 12 });
    expect(snap.stacks).toContainEqual({ kind: 'unknown', id: 'Gizmo:g1', quantity: 1 });
  });
});
