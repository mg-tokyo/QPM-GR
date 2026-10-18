import { describe, expect, it } from 'vitest';

import { activityLines, cardModel, heldItemOf, petTiles, slotOwnedBy, type CardNames } from './infoCardModel';

// Live 1448 shapes (userSlots[i].data). Catalog ids are stand-ins: the model never reads one itself.
const names: CardNames = {
  itemName: (id) => ({ sunflower: 'Sunflower Seed', rareEgg: 'Rare Egg', commonEgg: 'Common Egg', planterPot: 'Planter Pot', cactus: 'Cactus Seed', lily: 'Lily Seed' }[id] ?? null),
  petName: (sp) => ({ Turtle: 'Turtle', Butterfly: 'Butterfly', Chicken: 'Chicken' }[sp] ?? null),
  cropName: (sp) => ({ ThunderCelestial: 'Thunder Celestial', Carrot: 'Carrot', Lily: 'Lily' }[sp] ?? null),
  plantName: (sp) => (sp === 'Grape' ? 'Grape Plant' : null),
  abilityName: (id) => ({ HungerRestoreII: 'Hunger Restore II', SeedFinderIII: 'Seed Finder III' }[id] ?? null),
  hungerCap: (sp) => ({ Turtle: 100_000, Butterfly: 25_000 }[sp] ?? null),
};

const turtle = { id: 't1', petSpecies: 'Turtle', name: null, hunger: 81_390, mutations: ['Rainbow'], abilities: ['HungerRestoreII', 'RainbowGranter'] };
const log = (action: unknown, parameters: unknown, timestamp: unknown) => ({ action, parameters, timestamp });

describe('activityLines', () => {
  it('names an ability by its catalog name and any other action by its id split into words', () => {
    const lines = activityLines([
      log('purchaseSeed', { speciesIds: ['sunflower'], currency: 'coins', purchasePrice: 100_000_000 }, 1000),
      log('HungerRestoreII', { pet: turtle, targetPet: { ...turtle, id: 't2', petSpecies: 'Chicken' }, hungerRestoreAmount: 4475 }, 2000),
    ], names, 3);
    expect(lines).toEqual([
      { title: 'Hunger Restore II', detail: 'Turtle · Chicken', at: 2000 },
      { title: 'Purchase seed', detail: 'Sunflower Seed', at: 1000 },
    ]);
  });

  it('counts repeats and keeps at most two names per list', () => {
    const [tools] = activityLines([log('purchaseTool', { toolIds: ['planterPot', 'planterPot', 'planterPot'] }, 1)], names, 3);
    expect(tools?.detail).toBe('Planter Pot ×3');
    const [eggs] = activityLines([log('purchaseEgg', { eggIds: ['commonEgg', 'rareEgg', 'commonEgg', 'mystery'] }, 1)], names, 3);
    expect(eggs?.detail).toBe('Common Egg ×2, Rare Egg');
  });

  it('shows at most two names per line and never the same name twice', () => {
    const [l] = activityLines([log('SeedFinderIII', { pet: turtle, targetPet: turtle, speciesId: 'cactus', growSlot: { species: 'Carrot' } }, 1)], names, 3);
    expect(l).toEqual({ title: 'Seed Finder III', detail: 'Turtle · Cactus Seed', at: 1 });
  });

  it('uses a pet name the player gave, and crop names for objects with a species', () => {
    const [l] = activityLines([log('RainbowGranter', { pet: { ...turtle, name: 'Shelly' }, growSlot: { species: 'ThunderCelestial', mutations: ['Frozen'] }, mutation: 'Rainbow' }, 1)], names, 3);
    expect(l?.detail).toBe('Shelly · Thunder Celestial');
  });

  it('an unknown action or parameter shape gives a generic line, never a throw', () => {
    const lines = activityLines([
      log('logItems', { newCropVariants: { Cabbage: ['Normal'] }, newPetVariants: {} }, 3),
      log('', null, 2),
      log(42, {}, 1),
    ], names, 3);
    expect(lines).toEqual([{ title: 'Log items', detail: '', at: 3 }, { title: null, detail: '', at: 2 }, { title: null, detail: '', at: 1 }]);
  });

  it('takes the newest entries first and skips entries without a time', () => {
    const lines = activityLines([log('a', {}, 5), log('b', {}, 9), log('c', {}, 'x'), log('d', {}, 7), log('e', {}, 1)], names, 3);
    expect(lines.map((l) => l.title)).toEqual(['B', 'D', 'A']);
  });

  it('reads anything that is not a list as no activity', () => {
    expect(activityLines(undefined, names, 3)).toEqual([]);
    expect(activityLines({ length: 2 }, names, 3)).toEqual([]);
  });
});

describe('petTiles', () => {
  it('gives each active pet its label, mutations, abilities and hunger share of the species cap', () => {
    expect(petTiles([turtle, { id: 'b1', petSpecies: 'Butterfly', name: 'Flutter', hunger: 0, mutations: [], abilities: ['ProduceScaleBoostII', 7] }], names)).toEqual([
      { id: 't1', species: 'Turtle', label: 'Turtle', mutations: ['Rainbow'], abilities: ['HungerRestoreII', 'RainbowGranter'], hungerPct: 81.39 },
      { id: 'b1', species: 'Butterfly', label: 'Flutter', mutations: [], abilities: ['ProduceScaleBoostII'], hungerPct: 0 },
    ]);
  });

  it('shows no hunger bar without a catalog cap, clamps it, and falls back to the species id', () => {
    const [unknown, over] = petTiles([{ id: 'x', petSpecies: 'Mystery', hunger: 10 }, { id: 'y', petSpecies: 'Turtle', hunger: 250_000 }], names);
    expect(unknown).toMatchObject({ label: 'Mystery', hungerPct: null, mutations: [], abilities: [] });
    expect(over?.hungerPct).toBe(100);
  });

  it('skips empty or malformed slots', () => {
    expect(petTiles([null, { id: 'z' }, 'x', turtle], names).map((p) => p.id)).toEqual(['t1']);
    expect(petTiles(null, names)).toEqual([]);
  });
});

describe('heldItemOf', () => {
  const slot = (itemId: unknown, items: unknown[] = []) => ({ heldItem: { itemId, decorRotation: 0 }, data: { inventory: { items } } });

  it('is empty when nothing is held', () => {
    expect(heldItemOf(slot(null), names)).toEqual({ kind: 'none' });
    expect(heldItemOf({}, names)).toEqual({ kind: 'none' });
  });

  it('names a stackable item by its catalog id (seed, egg, tool, decor)', () => {
    expect(heldItemOf(slot('lily'), names)).toEqual({ kind: 'catalog', id: 'lily', name: 'Lily Seed' });
  });

  it('finds a unique item by its id in the inventory: pets and produce keep their mutations', () => {
    const pet = { id: 'p-uuid', itemType: 'Pet', petSpecies: 'Turtle', name: null, mutations: ['Gold'] };
    const crop = { id: 'c-uuid', itemType: 'Produce', species: 'Lily', mutations: ['Chilled'] };
    expect(heldItemOf(slot('p-uuid', [crop, pet]), names)).toEqual({ kind: 'pet', species: 'Turtle', mutations: ['Gold'], name: 'Turtle' });
    expect(heldItemOf(slot('c-uuid', [crop, pet]), names)).toEqual({ kind: 'crop', species: 'Lily', mutations: ['Chilled'], name: 'Lily' });
  });

  it('a potted plant keeps each fruit slot\'s mutations (live 1448: itemType Plant, slots[])', () => {
    const plant = { id: 'g-uuid', itemType: 'Plant', species: 'Grape', slots: [{ species: 'Grape', mutations: ['Wet'] }, { mutations: [] }, null] };
    expect(heldItemOf(slot('g-uuid', [plant]), names)).toEqual({ kind: 'plant', species: 'Grape', slotMutations: [['Wet'], [], []], name: 'Grape Plant' });
    expect(heldItemOf(slot('l-uuid', [{ id: 'l-uuid', itemType: 'Plant', species: 'Lychee' }]), names))
      .toEqual({ kind: 'plant', species: 'Lychee', slotMutations: [], name: 'Lychee' });
  });

  it('an item it cannot place is a generic held item', () => {
    expect(heldItemOf(slot('gone-uuid'), names)).toEqual({ kind: 'unknown' });
    expect(heldItemOf(slot('w-uuid', [{ id: 'w-uuid', itemType: 'Mystery', species: 'Lily' }]), names)).toEqual({ kind: 'unknown' });
  });
});

describe('cardModel', () => {
  it('collects the riding pet, pets, held item, newest lines and currencies from one slot', () => {
    const slot = {
      userId: 'u2', riddenPetId: 't1', heldItem: { itemId: null },
      data: { coinsCount: 46_406_102_183_123, magicDustCount: 243_956, petSlots: [turtle], activityLogs: [log('purchaseEgg', { eggIds: ['rareEgg'] }, 4)] },
    };
    expect(cardModel(slot, names, 1)).toEqual({
      riding: 'Turtle', pets: petTiles([turtle], names), held: { kind: 'none' },
      lines: [{ title: 'Purchase egg', detail: 'Rare Egg', at: 4 }], logs: slot.data.activityLogs, coins: 46_406_102_183_123, dust: 243_956,
    });
  });

  it('reuses the lines of an unchanged log list (the game keeps its identity, live 1448), never a changed one', () => {
    const logs = [log('purchaseEgg', { eggIds: ['rareEgg'] }, 4)];
    const first = cardModel({ data: { activityLogs: logs } }, names, 3);
    const memo = { logs: first.logs, lines: first.lines, max: 3 };
    expect(cardModel({ data: { activityLogs: logs } }, names, 3, memo).lines).toBe(first.lines);
    expect(cardModel({ data: { activityLogs: [...logs] } }, names, 3, memo).lines).not.toBe(first.lines);
    expect(cardModel({ data: { activityLogs: logs } }, names, 1, memo).lines).not.toBe(first.lines);
  });

  it('is empty for a slot it cannot read', () => {
    expect(cardModel(null, names, 3)).toEqual({ riding: null, pets: [], held: { kind: 'none' }, lines: [], logs: undefined, coins: null, dust: null });
    expect(cardModel({ riddenPetId: 'nope', data: { petSlots: [turtle] } }, names, 3).riding).toBeNull();
  });
});

describe('slotOwnedBy', () => {
  it('finds the slot by owner (userId since v985, playerId before) and tolerates empty seats', () => {
    const a = { userId: 'u1' };
    const b = { playerId: 'u2' };
    expect(slotOwnedBy([a, null, b], 'u2')).toBe(b);
    expect(slotOwnedBy([a], 'u9')).toBeNull();
    expect(slotOwnedBy(null, 'u1')).toBeNull();
  });
});
