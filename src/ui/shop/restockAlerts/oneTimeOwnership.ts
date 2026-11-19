// One-time shop items (catalog `isOneTimePurchase`) the player already owns, counted
// as the game does: beta common/games/Quinoa/utils/getNumItemOwned.ts:29-50 (Tool), :92-125 (Decor).

import { readSync } from '../../../core/gameState';
import { getShopFacingCatalogEntry } from '../../../catalogs/shopEligibility';
import { isRecord } from '../../../utils/typeGuards';

const recordValues = (value: unknown): unknown[] => (isRecord(value) ? Object.values(value) : []);
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : recordValues(value));

// Charged crystals are paused unique objects, not stacks; the game never counts them (beta systems/crystals/index.ts:135-139).
function holdsTool(item: unknown, toolId: string): boolean {
  return isRecord(item) && item.itemType === 'Tool' && item.toolId === toolId && !('remainingActiveSeconds' in item);
}

function holdsDecor(item: unknown, decorId: string): boolean {
  return isRecord(item) && item.itemType === 'Decor' && item.decorId === decorId;
}

function storageItems(inventory: Record<string, unknown>): unknown[] {
  return listOf(inventory.storages).flatMap((storage) => (isRecord(storage) ? listOf(storage.items) : []));
}

function hasPlacedDecor(garden: unknown, decorId: string): boolean {
  if (!isRecord(garden)) return false;
  const tiles = [...recordValues(garden.tileObjects), ...recordValues(garden.boardwalkTileObjects)];
  if (tiles.some((tile) => isRecord(tile) && tile.objectType === 'decor' && tile.decorId === decorId)) return true;
  // Each edge holds independent parts (line / hanging / backdrop), each a decor object.
  return recordValues(garden.edgeObjects).some((edge) =>
    recordValues(edge).some((part) => isRecord(part) && part.decorId === decorId));
}

/** False when the catalog has no entry for the id: no catalog, no suppression. */
export function isOwnedOneTimeItem(itemId: string, myData: unknown): boolean {
  const facing = getShopFacingCatalogEntry(itemId);
  if (!facing || facing.entry.isOneTimePurchase !== true || !isRecord(myData)) return false;
  const inventory = isRecord(myData.inventory) ? myData.inventory : {};
  const held = [...listOf(inventory.items), ...storageItems(inventory)];
  if (facing.kind === 'item') return held.some((item) => holdsTool(item, itemId));
  if (facing.kind === 'decor') {
    return held.some((item) => holdsDecor(item, itemId)) || hasPlacedDecor(myData.garden, itemId);
  }
  return false;
}

export function readOwnershipData(): unknown {
  return readSync('myData');
}
