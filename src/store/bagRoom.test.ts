import { describe, expect, it, vi } from 'vitest';

vi.mock('../catalogs/shopEligibility', () => ({
  getShopFacingCatalogEntry: (id: string) => (id === 'Shovel'
    ? { kind: 'item', entry: { joinsToolRingOnAcquire: true } }
    : { kind: 'item', entry: {} }),
}));

import { isBagFullFor } from './bagRoom';

const seeds = (n: number): Array<Record<string, unknown>> =>
  Array.from({ length: n }, (_, i) => ({ itemType: 'Seed', species: `S${i}`, quantity: 1 }));
const pet = { itemType: 'Pet', id: 'pet-1', petSpecies: 'Bee' };

describe('isBagFullFor (ALR-7.3b)', () => {
  it('below the limit → not full', () => {
    expect(isBagFullFor({ items: seeds(3) }, { itemType: 'Seed', id: 'New' }, 4)).toBe(false);
  });

  it('full bag + new item → full; + existing stack → not full', () => {
    const inv = { items: [...seeds(3), pet] };
    expect(isBagFullFor(inv, { itemType: 'Seed', id: 'New' }, 4)).toBe(true);
    expect(isBagFullFor(inv, { itemType: 'Seed', id: 'S1' }, 4)).toBe(false);
  });

  it('a unique item with the same kind id is not a stack', () => {
    const inv = { items: [...seeds(3), { itemType: 'Tool', id: 'crystal-1', toolId: 'Crystal' }] };
    expect(isBagFullFor(inv, { itemType: 'Tool', id: 'Crystal' }, 4)).toBe(true);
  });

  it('ring-pinned items take no bag slot', () => {
    const inv = {
      items: [...seeds(3), { itemType: 'Tool', toolId: 'Camera', quantity: 1 }],
      toolRing: [{ itemType: 'Tool', id: 'Camera' }],
    };
    expect(isBagFullFor(inv, { itemType: 'Seed', id: 'New' }, 4)).toBe(false);
    expect(isBagFullFor({ ...inv, items: [...inv.items, pet] }, { itemType: 'Seed', id: 'New' }, 4)).toBe(true);
  });

  it('an item already on the ring, or a ring-joining tool not owned anywhere, fits', () => {
    const items = seeds(4);
    expect(isBagFullFor({ items, toolRing: [{ itemType: 'Egg', id: 'CommonEgg' }] }, { itemType: 'Egg', id: 'CommonEgg' }, 4)).toBe(false);
    expect(isBagFullFor({ items, storages: [] }, { itemType: 'Tool', id: 'Shovel' }, 4)).toBe(false);
    const stored = { items, storages: [{ items: [{ itemType: 'Tool', toolId: 'Shovel', quantity: 1 }] }] };
    expect(isBagFullFor(stored, { itemType: 'Tool', id: 'Shovel' }, 4)).toBe(true);
    expect(isBagFullFor({ items }, { itemType: 'Tool', id: 'WateringCan' }, 4)).toBe(true);
  });

  it('limit unparsed or no inventory → never full', () => {
    expect(isBagFullFor({ items: seeds(500) }, { itemType: 'Seed', id: 'New' }, null)).toBe(false);
    expect(isBagFullFor(null, { itemType: 'Seed', id: 'New' }, 4)).toBe(false);
  });
});
