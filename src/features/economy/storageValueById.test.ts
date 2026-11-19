import { beforeEach, describe, expect, it, vi } from 'vitest';

let catalogsReady = true;
let storages: unknown[] = [];
let config = { seedSilo: true, petHutch: true, decorShed: true, inventory: true };

vi.mock('../../catalogs/gameCatalogs', () => ({
  areCatalogsReady: () => catalogsReady,
  onCatalogsReady: () => () => {},
  // Every seed costs 10 coins; every decor 100.
  getSeedPrice: () => ({ coins: 10 }),
  getDecor: () => ({ coinPrice: 100 }),
  getPlantSpecies: () => null,
  getPetSpecies: () => null,
  getPetMaxScale: () => null,
  getPetHoursToMature: () => null,
  getEggType: () => null,
  getItemPrice: () => null,
}));
vi.mock('../../store/friendBonus', () => ({ getFriendBonusMultiplier: () => 1 }));
vi.mock('../../store/inventory', () => ({ getInventoryItems: () => [], onInventoryChange: () => () => {} }));
vi.mock('../../store/pets', () => ({ getActivePetInfos: () => [] }));
vi.mock('./storageValue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./storageValue')>()),
  getCachedStorages: () => storages,
  getStorageValueConfig: () => ({ ...config }),
}));

const { computeStorageValueById, computeStorageItemsValue } = await import('./storageValue');
const { formatStorageValue, readStorageValue } = await import('./storageValueById');

const silo = { decorId: 'SeedSilo', items: [{ species: 'Carrot', quantity: 3 }, { species: 'Tomato', quantity: 2 }] };
const shed = { decorId: 'DecorShed', items: [{ decorId: 'Bench', quantity: 2 }] };

beforeEach(() => {
  catalogsReady = true;
  storages = [silo, shed];
  config = { seedSilo: true, petHutch: true, decorShed: true, inventory: true };
});

describe('computeStorageValueById', () => {
  it('sums only the named storage, without the building price', () => {
    expect(computeStorageValueById(storages, 'SeedSilo')).toBe(50);
    expect(computeStorageValueById(storages, 'DecorShed')).toBe(200);
  });

  it('equals the item sum the single storage window uses', () => {
    expect(computeStorageValueById(storages, 'SeedSilo')).toBe(computeStorageItemsValue(silo.items));
  });

  it('is null for a storage not in the list, 0 for one without items', () => {
    expect(computeStorageValueById(storages, 'PetHutch')).toBeNull();
    expect(computeStorageValueById([{ decorId: 'PetHutch' }], 'PetHutch')).toBe(0);
  });
});

describe('readStorageValue', () => {
  it('reads each storage on its own', () => {
    expect(readStorageValue('SeedSilo', 'seedSilo')).toEqual({ status: 'ready', value: 50 });
    expect(readStorageValue('DecorShed', 'decorShed')).toEqual({ status: 'ready', value: 200 });
  });

  it('is null when that storage is switched off', () => {
    config.seedSilo = false;
    expect(readStorageValue('SeedSilo', 'seedSilo')).toBeNull();
    expect(readStorageValue('DecorShed', 'decorShed')).not.toBeNull();
  });

  it('is null for a storage the value feature does not cover, or one not owned', () => {
    storages = [...storages, { decorId: 'ToolShack', items: [] }];
    expect(readStorageValue('ToolShack', 'toolShack')).toBeNull();
    expect(readStorageValue('PetHutch', 'petHutch')).toBeNull();
    expect(readStorageValue('SeedSilo', 'inventory')).toBeNull();
  });

  it('is loading until the catalogs are ready', () => {
    catalogsReady = false;
    expect(readStorageValue('SeedSilo', 'seedSilo')).toEqual({ status: 'loading' });
  });
});

describe('formatStorageValue', () => {
  it('matches the storage window label', () => {
    expect(formatStorageValue(999)).toBe('999');
    expect(formatStorageValue(1234)).toBe('1.23k');
    expect(formatStorageValue(2_500_000)).toBe('2.50M');
    expect(formatStorageValue(3_000_000_000)).toBe('3.00B');
    expect(formatStorageValue(4_000_000_000_000)).toBe('4.00T');
    expect(formatStorageValue(Number.NaN)).toBe('—');
  });
});
