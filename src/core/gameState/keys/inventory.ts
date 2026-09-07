// Per-type atoms read the game's PREDICTED items (beta inventoryAtoms.ts:56-84);
// the state tree is authoritative. Same T on both rungs: QuinoaInventoryItem[].
import { atomSource, defineKey, stateSource } from '../define';
import { isRecord } from '../../../utils/typeGuards';
import type { QuinoaInventory, QuinoaInventoryItem } from '../../../types/gameAtoms';
import { selectInventory, selectItems, selectItemsOfType } from './selectors';

const ITEMS = '/child/data/userSlots/{myIdx}/data/inventory/items';
const itemArray = (v: unknown): QuinoaInventoryItem[] | undefined => (Array.isArray(v) ? (v as QuinoaInventoryItem[]) : undefined);

function typed(key: string, type: string, label: RegExp) {
  return defineKey<QuinoaInventoryItem[]>({
    policy: 'authoritative', tier: 'state', doc: `${key}: loose inventory items with itemType === '${type}'`,
    sources: [stateSource(ITEMS, selectItemsOfType(type)), atomSource(label, 'predicted', { project: itemArray })],
  });
}

export const INVENTORY_KEYS = {
  inventory: defineKey<QuinoaInventory>({
    policy: 'authoritative', tier: 'state', doc: 'Loose inventory {items, storages, favoritedItemIds}',
    sources: [
      stateSource('/child/data/userSlots/{myIdx}/data/inventory', selectInventory),
      atomSource(/^my(?:Main)?Inventory(?:Data)?Atom$/, 'authoritative', { structure: (v) => isRecord(v) && ('storages' in v || 'items' in v) }),
    ],
  }),
  inventoryItems: defineKey<QuinoaInventoryItem[]>({
    policy: 'authoritative', tier: 'state', doc: 'All loose inventory items',
    sources: [stateSource(ITEMS, selectItems), atomSource(/^myPredictedInventoryItemsAtom$/, 'predicted', { project: itemArray })],
  }),
  cropInventory: typed('cropInventory', 'Produce', /^myCropInventoryAtom$/),
  toolInventory: typed('toolInventory', 'Tool', /^myToolInventoryAtom$/),
  petInventory: typed('petInventory', 'Pet', /^myPetInventoryAtom$/),
  seedInventory: typed('seedInventory', 'Seed', /^mySeedInventoryAtom$/),
  eggInventory: typed('eggInventory', 'Egg', /^myEggInventoryAtom$/),
};
