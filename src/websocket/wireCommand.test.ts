import { describe, expect, it } from 'vitest';
import { toWireCommand } from './wireCommand';

describe('toWireCommand', () => {
  it('maps PutItemInStorage to an inventory → storage MoveItem', () => {
    expect(toWireCommand('PutItemInStorage', { itemId: 'Cactus', storageId: 'SeedSilo' })).toEqual({
      type: 'MoveItem',
      payload: { from: 'inventory', to: 'SeedSilo', itemId: 'Cactus' },
    });
  });

  it('maps RetrieveItemFromStorage to a storage → inventory MoveItem', () => {
    expect(toWireCommand('RetrieveItemFromStorage', { itemId: 'pet-1', storageId: 'PetHutch' })).toEqual({
      type: 'MoveItem',
      payload: { from: 'PetHutch', to: 'inventory', itemId: 'pet-1' },
    });
  });

  it('keeps quantity and drops the index fields MoveItem has no slot for', () => {
    expect(toWireCommand('PutItemInStorage', { itemId: 'pet-1', storageId: 'PetHutch', toStorageIndex: 4, quantity: 3 }).payload)
      .toEqual({ from: 'inventory', to: 'PetHutch', itemId: 'pet-1', quantity: 3 });
    expect(toWireCommand('RetrieveItemFromStorage', { itemId: 'pet-1', storageId: 'PetHutch', toInventoryIndex: 2 }).payload)
      .toEqual({ from: 'PetHutch', to: 'inventory', itemId: 'pet-1' });
  });

  it('passes every other type through untouched', () => {
    const payload = { itemId: 'x' };
    const out = toWireCommand('ToggleLockItem', payload);
    expect(out.type).toBe('ToggleLockItem');
    expect(out.payload).toBe(payload);
  });
});
