import { describe, expect, it, vi } from 'vitest';

const mockStorage = new Map<string, unknown>();
let mockEligible: Record<string, string[]> = {};

vi.mock('../utils/storage', () => ({
  storage: {
    get: <T>(key: string, fallback: T): T => (mockStorage.has(key) ? (mockStorage.get(key) as T) : fallback),
    set: (key: string, value: unknown): void => { mockStorage.set(key, value); },
  },
}));

vi.mock('../utils/restock/dataService', async () => {
  const parser = await import('../utils/restock/parser');
  return { canonicalItemId: parser.canonicalItemId, getItemIdVariants: parser.getItemIdVariants };
});

vi.mock('../catalogs/shopEligibility', () => ({
  getItemEligibleShops: (itemId: string): string[] => mockEligible[itemId] ?? [],
}));

const { rekeyStalePins, migrateStaleRestockPins, TRACKED_KEY } = await import('./restockTracked');

const eligibleFor = (map: Record<string, string[]>) => (id: string): string[] => map[id] ?? [];

describe('rekeyStalePins', () => {
  it('moves a pin to the shop the item is now sold in', () => {
    const next = rekeyStalePins(['seed:MoonCelestial', 'seed:Carrot'], eligibleFor({ MoonCelestial: ['amber'], Carrot: ['seed'] }));
    expect(next).toEqual(['amber:MoonCelestial', 'seed:Carrot']);
  });

  it('canonicalises legacy seed aliases before looking up eligibility', () => {
    const next = rekeyStalePins(['seed:Dawnbinder'], eligibleFor({ DawnCelestial: ['dawn'] }));
    expect(next).toEqual(['dawn:DawnCelestial']);
  });

  it('dedupes when the target pin already exists', () => {
    const next = rekeyStalePins(['seed:MoonCelestial', 'amber:MoonCelestial'], eligibleFor({ MoonCelestial: ['amber'] }));
    expect(next).toEqual(['amber:MoonCelestial']);
  });

  it('leaves unknown items, weather pins and malformed keys alone', () => {
    const keys = ['seed:NotInCatalog', 'weather:AmberMoon', 'garbage', ':x'];
    expect(rekeyStalePins(keys, eligibleFor({}))).toBeNull();
  });

  it('returns null when every pin is still eligible', () => {
    expect(rekeyStalePins(['dawn:DawnCelestial'], eligibleFor({ DawnCelestial: ['dawn'] }))).toBeNull();
  });
});

describe('migrateStaleRestockPins', () => {
  it('persists the re-keyed list once and is a no-op afterwards', () => {
    mockEligible = { MoonCelestial: ['amber'], DawnCelestial: ['dawn'] };
    mockStorage.set(TRACKED_KEY, ['seed:MoonCelestial', 'seed:DawnCelestial', 'egg:CommonEgg']);
    expect(migrateStaleRestockPins()).toBe(true);
    expect(mockStorage.get(TRACKED_KEY)).toEqual(['amber:MoonCelestial', 'dawn:DawnCelestial', 'egg:CommonEgg']);
    expect(migrateStaleRestockPins()).toBe(false);
  });
});
