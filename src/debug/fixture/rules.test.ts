import { describe, expect, it, vi } from 'vitest';

vi.mock('../../catalogs/gameCatalogs', () => ({
  getPlantCatalog: () => ({
    Carrot: { seed: { rarity: 'Common', coinPrice: 10 } },
    Beet: { seed: { rarity: 'Common', coinPrice: 210 } },
    Lily: { seed: { rarity: 'Legendary', coinPrice: 20000 } },
  }),
  getEggCatalog: () => ({
    CommonEgg: { rarity: 'Common', coinPrice: 100000 },
    RareEgg: { rarity: 'Rare', coinPrice: 10000000 },
  }),
}));

import { BACKGROUND_TYPES, judgeSend, slotKey, type Judgement, type LiveView, type SessionState } from './rules';
import type { FixtureConfig } from './types';

const config: FixtureConfig = {
  schema: 1,
  allowRarity: 'Common',
  reserveFloors: { 'egg:CommonEgg': 14000 },
  buyEggsAtOrBelowFloor: true,
  spendCapPerRun: 105000,
  spendCapPerDay: 250000,
  coinFloor: 45_000_000_000_000,
  useCaps: { seeds: 20, eggs: 5 },
};

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    runId: 'fix-run-1',
    config,
    spendCap: 105000,
    spent: 0,
    used: { seeds: 0, eggs: 0 },
    occupiedAtBegin: new Set(),
    ownedSlots: new Set(),
    ownedPetIds: new Set(),
    ownedItemIds: new Set(),
    ...over,
  };
}

type LiveOpts = { coins?: number; stacks?: Record<string, number>; occupied?: string[]; crops?: Record<string, string>; pets?: string[] };
function live(o: LiveOpts = {}): LiveView {
  const occupied = new Set(o.occupied ?? []);
  const pets = new Set(o.pets ?? []);
  return {
    coins: o.coins ?? 46_000_000_000_000,
    stackQty: (kind, id) => o.stacks?.[`${kind}:${id}`] ?? 0,
    slotEmpty: (slot) => !occupied.has(slot),
    cropSpecies: (itemId) => o.crops?.[itemId] ?? null,
    isPetItem: (itemId) => pets.has(itemId),
  };
}

const buySeed = (species: string, quantity?: number): Record<string, unknown> => ({
  type: 'PurchaseShopItem', shop: 'seed', viewMode: 'list', item: { itemType: 'Seed', species }, ...(quantity ? { quantity } : {}),
});
const buyEgg = (eggId: string): Record<string, unknown> => ({ type: 'PurchaseShopItem', shop: 'egg', viewMode: 'list', item: { itemType: 'Egg', eggId } });

function judge(type: string, payload: Record<string, unknown>, s = session(), l = live()): Judgement {
  return judgeSend(type, { type, ...payload }, s, l);
}
const reasonOf = (j: Judgement): string | null => (j.allow ? null : j.reason);

describe('judgeSend: background and unknown', () => {
  it('allows background types', () => {
    for (const t of ['PlayerPosition', 'Teleport', 'RequestPetGreet']) {
      expect(BACKGROUND_TYPES.has(t)).toBe(true);
      expect(judge(t, { position: { x: 1, y: 2 } }).allow).toBe(true);
    }
  });
  it('allows the held-object animation pair sent on item select/deselect', () => {
    for (const t of ['PickupObject', 'DropObject']) expect(judge(t, {}).allow).toBe(true);
  });
  it('refuses unknown type with reason unknown-type', () => {
    expect(reasonOf(judge('TotallyNewThing', {}))).toBe('unknown-type');
  });
});

describe('judgeSend: PurchaseShopItem', () => {
  it('allows Carrot within cap and reports the spend', () => {
    const j = judge('PurchaseShopItem', buySeed('Carrot'));
    expect(j.allow).toBe(true);
    expect(j.effects?.spend).toBe(10);
  });
  it('multiplies price by quantity', () => {
    expect(judge('PurchaseShopItem', buySeed('Carrot', 3)).effects?.spend).toBe(30);
  });
  it('refuses Lily as not-allowlisted', () => {
    expect(reasonOf(judge('PurchaseShopItem', buySeed('Lily')))).toBe('not-allowlisted');
  });
  it('refuses tools and decor as not-allowlisted', () => {
    expect(reasonOf(judge('PurchaseShopItem', { shop: 'tool', viewMode: 'list', item: { itemType: 'Tool', toolId: 'Shovel' } }))).toBe('not-allowlisted');
  });
  it('refuses when spent + price > spendCap', () => {
    expect(reasonOf(judge('PurchaseShopItem', buySeed('Beet'), session({ spent: 104900 })))).toBe('spend-cap');
  });
  it('refuses when coins - price < coinFloor', () => {
    expect(reasonOf(judge('PurchaseShopItem', buySeed('Beet'), session(), live({ coins: 45_000_000_000_100 })))).toBe('coin-floor');
  });
  it('refuses CommonEgg while stock is above the floor, allows at the floor', () => {
    expect(reasonOf(judge('PurchaseShopItem', buyEgg('CommonEgg'), session(), live({ stacks: { 'egg:CommonEgg': 14666 } })))).toBe('egg-above-floor');
    expect(judge('PurchaseShopItem', buyEgg('CommonEgg'), session(), live({ stacks: { 'egg:CommonEgg': 14000 } })).effects?.spend).toBe(100000);
  });
  it('refuses eggs entirely when egg buying is off', () => {
    const s = session({ config: { ...config, buyEggsAtOrBelowFloor: false } });
    expect(reasonOf(judge('PurchaseShopItem', buyEgg('CommonEgg'), s, live({ stacks: { 'egg:CommonEgg': 0 } })))).toBe('egg-buying-off');
  });
  it('Review Focus 3: two 60,000 purchases under a 105,000 cap — second refused', () => {
    const s = session();
    const first = judge('PurchaseShopItem', buySeed('Carrot', 6000), s);
    expect(first.effects?.spend).toBe(60000);
    const after = session({ spent: s.spent + (first.effects?.spend ?? 0) });
    expect(reasonOf(judge('PurchaseShopItem', buySeed('Carrot', 6000), after))).toBe('spend-cap');
  });
});

describe('judgeSend: PlantSeed', () => {
  const stocked = live({ stacks: { 'seed:Carrot': 5, 'seed:Lily': 27192 } });
  it('allows Carrot on an empty, unprotected slot and owns it', () => {
    const j = judge('PlantSeed', { slot: 7, species: 'Carrot' }, session(), stocked);
    expect(j.allow).toBe(true);
    expect(j.effects?.useSeed).toBe(true);
    expect(j.effects?.ownSlot).toEqual({ slot: '7', kind: 'plant', id: 'Carrot', runId: 'fix-run-1' });
  });
  it('refuses a slot occupied at begin', () => {
    expect(reasonOf(judge('PlantSeed', { slot: 7, species: 'Carrot' }, session({ occupiedAtBegin: new Set(['7']) }), stocked))).toBe('slot-protected');
  });
  it('refuses a slot occupied live', () => {
    const l = live({ stacks: { 'seed:Carrot': 5 }, occupied: ['7'] });
    expect(reasonOf(judge('PlantSeed', { slot: 7, species: 'Carrot' }, session(), l))).toBe('slot-protected');
  });
  it('refuses a non-allowlisted species', () => {
    expect(reasonOf(judge('PlantSeed', { slot: 7, species: 'Lily' }, session(), stocked))).toBe('not-allowlisted');
  });
  it('refuses when the stack would go below its floor', () => {
    const s = session({ config: { ...config, reserveFloors: { 'seed:Carrot': 5 } } });
    expect(reasonOf(judge('PlantSeed', { slot: 7, species: 'Carrot' }, s, stocked))).toBe('below-floor');
  });
  it('refuses at the seed use cap', () => {
    expect(reasonOf(judge('PlantSeed', { slot: 7, species: 'Carrot' }, session({ used: { seeds: 20, eggs: 0 } }), stocked))).toBe('use-cap');
  });
  it('Review Focus 2: numeric slot matches the string key', () => {
    expect(slotKey(7)).toBe('7');
    expect(slotKey('7')).toBe(slotKey(7));
    expect(slotKey(-1)).toBeNull();
    expect(slotKey('x')).toBeNull();
    expect(slotKey(1.5)).toBeNull();
    expect(reasonOf(judge('PlantSeed', { slot: 7, species: 'Carrot' }, session({ occupiedAtBegin: new Set(['7']) }), stocked))).toBe('slot-protected');
  });
  it('refuses a missing slot as bad-payload', () => {
    expect(reasonOf(judge('PlantSeed', { species: 'Carrot' }, session(), stocked))).toBe('bad-payload');
  });
});

describe('judgeSend: GrowEgg', () => {
  it('allows CommonEgg when post-use stock stays at or above the floor', () => {
    const j = judge('GrowEgg', { slot: 3, eggId: 'CommonEgg' }, session(), live({ stacks: { 'egg:CommonEgg': 14001 } }));
    expect(j.allow).toBe(true);
    expect(j.effects?.useEgg).toBe(true);
    expect(j.effects?.ownSlot).toEqual({ slot: '3', kind: 'egg', id: 'CommonEgg', runId: 'fix-run-1' });
  });
  it('refuses at the floor (would go to 13,999)', () => {
    expect(reasonOf(judge('GrowEgg', { slot: 3, eggId: 'CommonEgg' }, session(), live({ stacks: { 'egg:CommonEgg': 14000 } })))).toBe('below-floor');
  });
  it('refuses at the egg use cap', () => {
    const s = session({ used: { seeds: 0, eggs: 5 } });
    expect(reasonOf(judge('GrowEgg', { slot: 3, eggId: 'CommonEgg' }, s, live({ stacks: { 'egg:CommonEgg': 20000 } })))).toBe('use-cap');
  });
  it('refuses a non-allowlisted egg', () => {
    expect(reasonOf(judge('GrowEgg', { slot: 3, eggId: 'RareEgg' }, session(), live({ stacks: { 'egg:RareEgg': 9 } })))).toBe('not-allowlisted');
  });
});

describe('judgeSend: owned-slot actions', () => {
  const owned = session({ ownedSlots: new Set(['4']) });
  it('HarvestCrop on an owned slot owns the minted crop id', () => {
    const j = judge('HarvestCrop', { slot: 4, slotsIndex: 0, cropItemId: 'c-1' }, owned);
    expect(j.allow).toBe(true);
    expect(j.effects?.ownItemId).toBe('c-1');
  });
  it('HarvestCrop on an unowned slot is refused', () => {
    expect(reasonOf(judge('HarvestCrop', { slot: 5, slotsIndex: 0, cropItemId: 'c-1' }, owned))).toBe('slot-protected');
  });
  it('HatchEgg on an owned slot expects a hatch there', () => {
    expect(judge('HatchEgg', { slot: '4' }, owned).effects?.expectHatchAt).toBe('4');
  });
  it('HatchEgg on an unowned slot is refused', () => {
    expect(reasonOf(judge('HatchEgg', { slot: 5 }, owned))).toBe('slot-protected');
  });
  it('RemoveGardenObject on an owned dirt slot is allowed, unowned refused', () => {
    expect(judge('RemoveGardenObject', { slot: 4, slotType: 'Dirt' }, owned).allow).toBe(true);
    expect(reasonOf(judge('RemoveGardenObject', { slot: 5, slotType: 'Dirt' }, owned))).toBe('slot-protected');
  });
  it('RemoveGardenObject on another tile type with an owned index is refused', () => {
    expect(reasonOf(judge('RemoveGardenObject', { slot: 4, slotType: 'Boardwalk' }, owned))).toBe('slot-protected');
  });
});

describe('judgeSend: FeedPet', () => {
  it('allows any pet with an owned crop', () => {
    expect(judge('FeedPet', { petItemId: 'pet-x', cropItemId: 'c-1' }, session({ ownedItemIds: new Set(['c-1']) })).allow).toBe(true);
  });
  it('allows any pet with an allowlisted crop from stock above its floor', () => {
    const l = live({ crops: { 'c-2': 'Carrot' }, stacks: { 'crop:Carrot': 3 } });
    expect(judge('FeedPet', { petItemId: 'pet-x', cropItemId: 'c-2' }, session(), l).allow).toBe(true);
  });
  it('refuses a Lily crop', () => {
    const l = live({ crops: { 'c-3': 'Lily' }, stacks: { 'crop:Lily': 3 } });
    expect(reasonOf(judge('FeedPet', { petItemId: 'pet-x', cropItemId: 'c-3' }, session(), l))).toBe('crop-protected');
  });
  it('refuses an allowlisted crop that would cross its floor', () => {
    const s = session({ config: { ...config, reserveFloors: { 'crop:Carrot': 3 } } });
    const l = live({ crops: { 'c-2': 'Carrot' }, stacks: { 'crop:Carrot': 3 } });
    expect(reasonOf(judge('FeedPet', { petItemId: 'pet-x', cropItemId: 'c-2' }, s, l))).toBe('crop-protected');
  });
  it('refuses an unknown crop id', () => {
    expect(reasonOf(judge('FeedPet', { petItemId: 'pet-x', cropItemId: 'nope' }))).toBe('crop-protected');
  });
});

describe('judgeSend: pets and items', () => {
  it('allows pet moves on unowned pets', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['PlacePet', { itemId: 'p', position: { x: 1, y: 1 }, tileType: 'Dirt', localTileIndex: 0 }],
      ['PickupPet', { petId: 'p' }],
      ['SwapPet', { petSlotId: 'a', petInventoryId: 'b' }],
      ['SwapPetFromStorage', { petSlotId: 'a', storagePetId: 'b', storageId: 'PetHutch' }],
      ['RidePet', { petItemId: 'p' }],
      ['DismountPet', {}],
    ];
    for (const [type, payload] of cases) expect(judge(type, payload).allow).toBe(true);
  });
  it('MoveItem: a pet item allowed, an owned item allowed, an unowned crop refused', () => {
    const l = live({ pets: ['pet-1'], crops: { 'c-9': 'Carrot' } });
    const s = session({ ownedItemIds: new Set(['c-1']) });
    expect(judge('MoveItem', { from: 'inventory', to: 'PetHutch', itemId: 'pet-1' }, s, l).allow).toBe(true);
    expect(judge('MoveItem', { from: 'inventory', to: 'SeedSilo', itemId: 'c-1' }, s, l).allow).toBe(true);
    expect(reasonOf(judge('MoveItem', { from: 'inventory', to: 'SeedSilo', itemId: 'c-9' }, s, l))).toBe('item-protected');
  });
  it('SellPet / NamePet: owned pet allowed, unowned refused', () => {
    const s = session({ ownedPetIds: new Set(['pet-own']) });
    expect(judge('SellPet', { itemId: 'pet-own' }, s).allow).toBe(true);
    expect(reasonOf(judge('SellPet', { itemId: 'pet-old' }, s))).toBe('pet-protected');
    expect(judge('NamePet', { petItemId: 'pet-own', name: 'x' }, s).allow).toBe(true);
    expect(reasonOf(judge('NamePet', { petItemId: 'pet-old', name: 'x' }, s))).toBe('pet-protected');
  });
});

describe('judgeSend: always refused', () => {
  const forbidden = [
    'SellAllCrops', 'ToggleLockItem', 'XPPotion', 'ReplenishPotion', 'MutationPotion', 'WaterPlant', 'PlantGardenPlant',
    'PotPlant', 'PlaceDecor', 'PickupDecor', 'SetPlayerData', 'UpgradePetHutch', 'UpgradeSeedSilo', 'CheckFriendBonus',
    'Wish', 'SavePetTeam', 'CropCleanser', 'Chat',
  ];
  it.each(forbidden)('%s → forbidden', (type) => {
    expect(reasonOf(judge(type, {}))).toBe('forbidden');
  });
  it('judgeSend never mutates the session', () => {
    const s = session();
    judge('PurchaseShopItem', buySeed('Carrot'), s);
    judge('PlantSeed', { slot: 7, species: 'Carrot' }, s, live({ stacks: { 'seed:Carrot': 5 } }));
    expect(s.spent).toBe(0);
    expect(s.used).toEqual({ seeds: 0, eggs: 0 });
    expect(s.ownedSlots.size).toBe(0);
  });
});
