import { describe, expect, it, vi } from 'vitest';
import type { QuinoaInventory } from '../../types/gameAtoms';

let inventory: QuinoaInventory | null = null;
vi.mock('../../core/gameState', () => ({ readSync: () => inventory, subscribe: () => () => {} }));

const { chooseStorageIds, nextPick, ownedStorageIds, readOwnedStorageIds } = await import('./storages');

describe('multi-storage owned storages', () => {
  it('lists each storage building once, in the game order', () => {
    const inv: QuinoaInventory = { storages: [{ decorId: 'PetHutch' }, { decorId: 'SeedSilo', items: [] }, { decorId: 'PetHutch' }] };
    expect(ownedStorageIds(inv)).toEqual(['PetHutch', 'SeedSilo']);
  });

  it('is empty when the inventory is unread or malformed', () => {
    expect(ownedStorageIds(null)).toEqual([]);
    expect(ownedStorageIds({})).toEqual([]);
    expect(ownedStorageIds({ storages: [{}, { decorId: '' }, { decorId: 7 as unknown as string }] })).toEqual([]);
  });

  it('reads through the inventory state key', () => {
    inventory = { storages: [{ decorId: 'DecorShed' }] };
    expect(readOwnedStorageIds()).toEqual(['DecorShed']);
    inventory = null;
    expect(readOwnedStorageIds()).toEqual([]);
  });
});

describe('multi-storage pick', () => {
  const owned = ['PetHutch', 'SeedSilo', 'DecorShed'];

  it('opens everything owned when nothing is picked', () => {
    expect(chooseStorageIds(owned, null)).toEqual(owned);
  });

  it('keeps the pick order, drops unowned and repeated ids', () => {
    expect(chooseStorageIds(owned, ['DecorShed', 'ToolShack', 'PetHutch'])).toEqual(['DecorShed', 'PetHutch']);
    expect(chooseStorageIds(owned, ['SeedSilo', 'SeedSilo'])).toEqual(['SeedSilo']);
  });

  it('falls back to everything owned when no picked storage is owned', () => {
    expect(chooseStorageIds(owned, ['ToolShack'])).toEqual(owned);
    expect(chooseStorageIds([], ['ToolShack'])).toEqual([]);
  });
});

describe('multi-storage pick presses', () => {
  const owned = ['PetHutch', 'DecorShed', 'SeedSilo'];

  it('turns one storage off from "every owned storage"', () => {
    expect(nextPick(owned, null, 'DecorShed')).toEqual(['PetHutch', 'SeedSilo']);
  });

  it('goes back to null when the press picks every owned storage again', () => {
    expect(nextPick(owned, ['PetHutch', 'SeedSilo'], 'DecorShed')).toBeNull();
  });

  it('keeps the game order, not the press order', () => {
    expect(nextPick(owned, ['SeedSilo'], 'PetHutch')).toEqual(['PetHutch', 'SeedSilo']);
  });

  it('refuses to turn off the last picked storage, and storages not owned', () => {
    expect(nextPick(owned, ['SeedSilo'], 'SeedSilo')).toBe('refused');
    expect(nextPick(owned, null, 'ToolShack')).toBe('refused');
  });

  it('treats a pick of storages no longer owned as every owned storage', () => {
    expect(nextPick(owned, ['ToolShack'], 'PetHutch')).toEqual(['DecorShed', 'SeedSilo']);
  });
});
