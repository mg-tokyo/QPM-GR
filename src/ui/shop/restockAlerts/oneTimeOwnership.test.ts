import { beforeEach, describe, expect, it, vi } from 'vitest';

type Facing = { kind: 'plant' | 'egg' | 'item' | 'decor'; entry: Record<string, unknown> };
const catalog = vi.hoisted(() => new Map<string, Facing>());

vi.mock('../../../catalogs/shopEligibility', () => ({
  getShopFacingCatalogEntry: (id: string) => catalog.get(id) ?? null,
}));
vi.mock('../../../core/gameState', () => ({ readSync: () => null }));

const { isOwnedOneTimeItem } = await import('./oneTimeOwnership');

function slot(over: { items?: unknown[]; storages?: unknown[]; garden?: Record<string, unknown> } = {}) {
  return {
    inventory: { items: over.items ?? [], storages: over.storages ?? [] },
    garden: { tileObjects: {}, boardwalkTileObjects: {}, edgeObjects: {}, ...over.garden },
  };
}

beforeEach(() => {
  catalog.clear();
  catalog.set('Shovel', { kind: 'item', entry: { isOneTimePurchase: true } });
  catalog.set('WateringCan', { kind: 'item', entry: { isOneTimePurchase: false } });
  catalog.set('SeedSilo', { kind: 'decor', entry: { isOneTimePurchase: true } });
  catalog.set('StringLights', { kind: 'decor', entry: { isOneTimePurchase: true } });
  catalog.set('Carrot', { kind: 'plant', entry: {} });
});

describe('isOwnedOneTimeItem (ALR-7.1)', () => {
  it('one-time tool in the bag is owned; absent is not', () => {
    expect(isOwnedOneTimeItem('Shovel', slot({ items: [{ itemType: 'Tool', toolId: 'Shovel', quantity: 1 }] }))).toBe(true);
    expect(isOwnedOneTimeItem('Shovel', slot())).toBe(false);
  });

  it('one-time tool in Tool Shack storage is owned', () => {
    const storages = [{ decorId: 'ToolShack', items: [{ itemType: 'Tool', toolId: 'Shovel', quantity: 1 }] }];
    expect(isOwnedOneTimeItem('Shovel', slot({ storages }))).toBe(true);
  });

  it('a charged crystal tool does not count', () => {
    const items = [{ itemType: 'Tool', toolId: 'Shovel', remainingActiveSeconds: 30 }];
    expect(isOwnedOneTimeItem('Shovel', slot({ items }))).toBe(false);
  });

  it('a tool that is not one-time is never suppressed', () => {
    expect(isOwnedOneTimeItem('WateringCan', slot({ items: [{ itemType: 'Tool', toolId: 'WateringCan', quantity: 5 }] }))).toBe(false);
  });

  it('one-time decor: bag, Decor Shed, placed tile, boardwalk tile, edge part', () => {
    const decor = { itemType: 'Decor', decorId: 'StringLights', quantity: 1 };
    expect(isOwnedOneTimeItem('StringLights', slot({ items: [decor] }))).toBe(true);
    expect(isOwnedOneTimeItem('StringLights', slot({ storages: [{ decorId: 'DecorShed', items: [decor] }] }))).toBe(true);
    const placed = { objectType: 'decor', decorId: 'StringLights' };
    expect(isOwnedOneTimeItem('StringLights', slot({ garden: { tileObjects: { 12: placed } } }))).toBe(true);
    expect(isOwnedOneTimeItem('StringLights', slot({ garden: { boardwalkTileObjects: { 3: placed } } }))).toBe(true);
    expect(isOwnedOneTimeItem('StringLights', slot({ garden: { edgeObjects: { e1: { hanging: { decorId: 'StringLights' } } } } }))).toBe(true);
    expect(isOwnedOneTimeItem('StringLights', slot())).toBe(false);
  });

  it('a placed tile of another object type does not count', () => {
    const garden = { tileObjects: { 1: { objectType: 'plant', decorId: 'StringLights' } } };
    expect(isOwnedOneTimeItem('StringLights', slot({ garden }))).toBe(false);
  });

  it('owned storage building is suppressed even with an upgrade left (PD1)', () => {
    const garden = { tileObjects: { 40: { objectType: 'decor', decorId: 'SeedSilo' } } };
    expect(isOwnedOneTimeItem('SeedSilo', slot({ garden }))).toBe(true);
  });

  it('catalog absent or unknown id: no suppression', () => {
    catalog.clear();
    expect(isOwnedOneTimeItem('Shovel', slot({ items: [{ itemType: 'Tool', toolId: 'Shovel', quantity: 1 }] }))).toBe(false);
  });

  it('seeds and missing slot data are never suppressed', () => {
    expect(isOwnedOneTimeItem('Carrot', slot({ items: [{ itemType: 'Seed', species: 'Carrot', quantity: 3 }] }))).toBe(false);
    expect(isOwnedOneTimeItem('Shovel', null)).toBe(false);
  });
});
