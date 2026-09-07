// Trimmed QuinoaStateSnapshot shaped like the live one. Occupied slot at
// index 1 (not 0) so tests catch selectors that assume index 0.
import type { IdentityContext } from '../../types';
import type { QuinoaStateSnapshot } from '../../../../types/gameAtoms';

export const FIXTURE_IDENTITY: IdentityContext = { playerId: 'p1', myIdx: 1 };

export const FIXTURE_SNAPSHOT: QuinoaStateSnapshot = {
  scope: 'Room',
  data: {
    players: [{ id: 'p1', name: 'Player One' }],
  },
  child: {
    scope: 'Quinoa',
    data: {
      weather: null,
      shops: { seed: { inventory: [] } },
      userSlots: [
        null,
        {
          userId: 'p1',
          riddenPetId: 'pet1',
          petSlotInfos: { pet1: { motion: { kind: 'idle' } } },
          data: {
            coinsCount: 10,
            magicDustCount: 5,
            shopPurchases: { seed: {} },
            garden: { tileObjects: {} },
            petSlots: [{ id: 'pet1' }],
            inventory: {
              items: [
                { id: 'crop1', itemType: 'Produce' },
                { id: 'tool1', itemType: 'Tool' },
                { id: 'pet1i', itemType: 'Pet' },
                { id: 'seed1', itemType: 'Seed' },
                { id: 'egg1', itemType: 'Egg' },
              ],
              storages: [
                {
                  decorId: 'PetHutch',
                  capacitySlots: 100,
                  items: [
                    { id: 'p1', itemType: 'Pet' },
                    { id: 'p2', itemType: 'Pet' },
                  ],
                },
                {
                  decorId: 'SeedSilo',
                  capacitySlots: 70,
                  items: [{ id: 's1', itemType: 'Seed' }],
                },
                {
                  decorId: 'DecorShed',
                  capacitySlots: 50,
                  items: [
                    { id: 'd1', itemType: 'Decor' },
                    { id: 'pl1', itemType: 'Plant' },
                  ],
                },
                {
                  decorId: 'ToolShack',
                  capacitySlots: 25,
                  items: [{ id: 't1', itemType: 'Tool' }],
                },
                {
                  decorId: 'FeedingTrough',
                  capacitySlots: 9,
                  items: [],
                },
              ],
            },
          },
        },
      ],
    },
  },
};
