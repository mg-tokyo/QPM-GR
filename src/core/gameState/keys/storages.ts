// Building storages under inventory.storages.
import { atomSource, defineKey, stateSource } from '../define';
import type { QuinoaInventoryItem, QuinoaStorageEntry } from '../../../types/gameAtoms';
import { selectStorage, selectStorageCapacity, selectStorageItems, type StorageId } from './selectors';

const STORAGES = '/child/data/userSlots/{myIdx}/data/inventory/storages';
const itemArray = (v: unknown): QuinoaInventoryItem[] | undefined => (Array.isArray(v) ? (v as QuinoaInventoryItem[]) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function items(storage: StorageId, itemType: string | undefined, label: RegExp | null, doc: string) {
  const state = stateSource(STORAGES, selectStorageItems(storage, itemType));
  return defineKey<QuinoaInventoryItem[]>({
    policy: 'authoritative', tier: 'state', doc,
    sources: label ? [state, atomSource(label, 'predicted', { project: itemArray, requiresSeat: true })] : [state],
  });
}
function capacity(storage: StorageId, label: RegExp | null, doc: string) {
  const state = stateSource(STORAGES, selectStorageCapacity(storage));
  return defineKey<number | null>({
    policy: 'authoritative', tier: 'state', doc,
    sources: label ? [state, atomSource(label, 'predicted', { project: num, requiresSeat: true })] : [state],
  });
}

export const STORAGE_KEYS = {
  petHutch: defineKey<QuinoaStorageEntry | null>({
    policy: 'authoritative', tier: 'state', doc: 'PetHutch storage entry (null until the building exists)',
    sources: [
      stateSource(STORAGES, selectStorage('PetHutch')),
      atomSource(/^myPetHutchStoragesAtom$/, 'predicted', {
        project: (v) => (Array.isArray(v) ? ((v[0] as QuinoaStorageEntry | undefined) ?? null) : undefined),
        requiresSeat: true,
      }),
    ],
  }),
  hutchPets: items('PetHutch', 'Pet', /^myPetHutchPetItemsAtom$/, 'Pets stored in the hutch'),
  hutchCapacity: capacity('PetHutch', /^myPetHutchCapacitySlotsAtom$/, 'Hutch capacitySlots (null => caller default)'),
  seedSiloItems: items('SeedSilo', 'Seed', /^mySeedSiloSeedItemsAtom$/, 'Seeds in the silo'),
  seedSiloCapacity: capacity('SeedSilo', /^mySeedSiloCapacitySlotsAtom$/, 'Silo capacitySlots'),
  decorShedItems: items('DecorShed', undefined, /^myDecorShedDecorItemsAtom$/, 'Items in the decor shed (mixed types)'),
  decorShedCapacity: capacity('DecorShed', /^myDecorShedCapacitySlotsAtom$/, 'Shed capacitySlots'),
  toolShackItems: items('ToolShack', 'Tool', /^myToolShackToolItemsAtom$/, 'Tools in the shack'),
  toolShackCapacity: capacity('ToolShack', /^myToolShackCapacitySlotsAtom$/, 'Shack capacitySlots'),
  // State tree only: beta myFeedingTroughProduceItemsAtom has no label on build 2022 (live 2026-11-13).
  feedingTroughItems: items('FeedingTrough', 'Produce', null, 'Crops in the feeding trough (one crop per slot, no quantity)'),
  feedingTroughCapacity: capacity('FeedingTrough', null, 'Trough capacitySlots'),
};
