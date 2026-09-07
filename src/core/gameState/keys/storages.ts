// Building storages under inventory.storages.
import { atomSource, defineKey, stateSource } from '../define';
import type { QuinoaInventoryItem, QuinoaStorageEntry } from '../../../types/gameAtoms';
import { selectStorage, selectStorageCapacity, selectStorageItems, type StorageId } from './selectors';

const STORAGES = '/child/data/userSlots/{myIdx}/data/inventory/storages';
const itemArray = (v: unknown): QuinoaInventoryItem[] | undefined => (Array.isArray(v) ? (v as QuinoaInventoryItem[]) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function items(storage: StorageId, itemType: string | undefined, label: RegExp, doc: string) {
  return defineKey<QuinoaInventoryItem[]>({
    policy: 'authoritative', tier: 'state', doc,
    sources: [stateSource(STORAGES, selectStorageItems(storage, itemType)), atomSource(label, 'predicted', { project: itemArray })],
  });
}
function capacity(storage: StorageId, label: RegExp, doc: string) {
  return defineKey<number | null>({
    policy: 'authoritative', tier: 'state', doc,
    sources: [stateSource(STORAGES, selectStorageCapacity(storage)), atomSource(label, 'predicted', { project: num })],
  });
}

export const STORAGE_KEYS = {
  petHutch: defineKey<QuinoaStorageEntry | null>({
    policy: 'authoritative', tier: 'state', doc: 'PetHutch storage entry (null until the building exists)',
    sources: [
      stateSource(STORAGES, selectStorage('PetHutch')),
      atomSource(/^myPetHutchStoragesAtom$/, 'predicted', { project: (v) => (Array.isArray(v) ? ((v[0] as QuinoaStorageEntry | undefined) ?? null) : undefined) }),
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
};
