import { describe, expect, it } from 'vitest';
import { bagItemId, chooseItemId, planFetch, planSelect } from './core';

// Shapes as seen live on 2065 (spec F21, F24) and in the beta schema (V46_QuinoaUserJson.ts:344-356).
const SHOVEL = { toolId: 'Shovel', itemType: 'Tool', quantity: 1 };
const SHARDS = { toolId: 'SnowWardShard', itemType: 'Tool', quantity: 8 };
const charged = (id: string, remainingActiveSeconds: number) =>
  ({ id, toolId: 'SnowWardShard', itemType: 'Tool', quantity: 1, remainingActiveSeconds });
const LEEK = { species: 'Leek', itemType: 'Seed', quantity: 3 };
const EGG = { eggId: 'SpookyEgg', itemType: 'Egg', quantity: 2 };
const HAY = { decorId: 'HayBale', itemType: 'Decor', quantity: 1 };
const PRODUCE = { id: 'u-1', species: 'Leek', itemType: 'Produce' };

describe('bagItemId (game getInventoryItemId)', () => {
  it('uses the dex id per kind', () => {
    expect(bagItemId(SHOVEL, 'tool')).toBe('Shovel');
    expect(bagItemId(LEEK, 'seed')).toBe('Leek');
    expect(bagItemId(EGG, 'egg')).toBe('SpookyEgg');
    expect(bagItemId(HAY, 'decor')).toBe('HayBale');
  });
  it('uses the instance id of a charged crystal', () => {
    expect(bagItemId(charged('c-1', 50), 'tool')).toBe('c-1');
  });
});

describe('chooseItemId', () => {
  it('matches kind and dex id, not a produce of the same species', () => {
    expect(chooseItemId([PRODUCE, LEEK], { kind: 'seed', id: 'Leek' })).toBe('Leek');
    expect(chooseItemId([PRODUCE], { kind: 'seed', id: 'Leek' })).toBeNull();
  });
  it('skips an empty stack', () => {
    expect(chooseItemId([{ ...SHOVEL, quantity: 0 }], { kind: 'tool', id: 'Shovel' })).toBeNull();
  });
  it('D6: charged crystal with the least time first, before the fresh stack', () => {
    const bag = [SHARDS, charged('c-long', 900), charged('c-short', 60)];
    expect(chooseItemId(bag, { kind: 'tool', id: 'SnowWardShard' })).toBe('c-short');
  });
  it('a spent crystal comes after the fresh stack', () => {
    const bag = [charged('c-spent', 0), SHARDS];
    expect(chooseItemId(bag, { kind: 'tool', id: 'SnowWardShard' })).toBe('SnowWardShard');
  });
  it('a spent crystal is picked when nothing else of the type is left', () => {
    expect(chooseItemId([charged('c-spent', 0)], { kind: 'tool', id: 'SnowWardShard' })).toBe('c-spent');
  });
});

describe('planSelect', () => {
  const bag = [SHOVEL, LEEK, SHARDS, charged('c-1', 30)];
  it('picks when the hand holds something else or nothing', () => {
    expect(planSelect(bag, { kind: 'tool', id: 'Shovel' }, null)).toEqual({ action: 'pickup', itemId: 'Shovel' });
    expect(planSelect(bag, { kind: 'tool', id: 'Shovel' }, 'Leek')).toEqual({ action: 'pickup', itemId: 'Shovel' });
  });
  it('D4: puts away the held item of the same target', () => {
    expect(planSelect(bag, { kind: 'tool', id: 'Shovel' }, 'Shovel')).toEqual({ action: 'putAway', itemId: 'Shovel' });
  });
  it('D4: any held crystal of the type counts as held', () => {
    expect(planSelect(bag, { kind: 'tool', id: 'SnowWardShard' }, 'SnowWardShard'))
      .toEqual({ action: 'putAway', itemId: 'SnowWardShard' });
    expect(planSelect(bag, { kind: 'tool', id: 'SnowWardShard' }, 'c-1')).toEqual({ action: 'putAway', itemId: 'c-1' });
  });
  it('D5: missing when none is in the bag', () => {
    expect(planSelect(bag, { kind: 'egg', id: 'SpookyEgg' }, null)).toEqual({ action: 'missing' });
  });
});

describe('planFetch (INP-5 D6)', () => {
  const silo = { decorId: 'SeedSilo', items: [LEEK] };
  const shack = { decorId: 'ToolShack', items: [SHARDS, charged('s-long', 900), charged('s-short', 60)] };
  const hutch = { decorId: 'PetHutch', items: [{ id: 'pet-1', itemType: 'Pet', petSpecies: 'Bee' }] };
  it('finds the storage by the item type, with its id and type', () => {
    expect(planFetch([hutch, shack, silo], { kind: 'seed', id: 'Leek' }))
      .toEqual({ storageId: 'SeedSilo', itemId: 'Leek', itemType: 'Seed' });
  });
  it('a crystal: the shack one with the least time left', () => {
    expect(planFetch([silo, shack], { kind: 'tool', id: 'SnowWardShard' }))
      .toEqual({ storageId: 'ToolShack', itemId: 's-short', itemType: 'Tool' });
  });
  it('older builds name the storage by storageId', () => {
    expect(planFetch([{ storageId: 'SeedSilo', items: [LEEK] }], { kind: 'seed', id: 'Leek' })?.storageId).toBe('SeedSilo');
  });
  it('null when no storage holds it (eggs never stored)', () => {
    expect(planFetch([silo, shack, hutch], { kind: 'egg', id: 'SpookyEgg' })).toBeNull();
    expect(planFetch([{ decorId: 'SeedSilo', items: [{ ...LEEK, quantity: 0 }] }], { kind: 'seed', id: 'Leek' })).toBeNull();
  });
});
