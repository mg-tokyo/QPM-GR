// Whether a bought item would find no bag slot, as the game's shop preflight decides it:
// beta common/games/Quinoa/utils/inventory.ts:236-249 `getIsInventoryFull` with
// systems/toolRing/toolRing.ts:122-128 `getBagSlotCount` (ring-pinned items take no bag slot).

import { getShopFacingCatalogEntry } from '../catalogs/shopEligibility';
import { isRecord } from '../utils/typeGuards';

export interface BagItemRef {
  itemType: string;
  id: string;
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// beta utils/inventory.ts:383-402 `getInventoryItemId`: stacks by kind id, unique items by instance id.
function inventoryItemId(item: Record<string, unknown>): unknown {
  if ('id' in item) return item.id;
  switch (item.itemType) {
    case 'Seed': return item.species;
    case 'Tool': return item.toolId;
    case 'Egg': return item.eggId;
    case 'Decor': return item.decorId;
    default: return undefined;
  }
}

const refKey = (itemType: unknown, id: unknown): string => `${String(itemType)}:${String(id)}`;

function ringKeys(inventory: Record<string, unknown>): Set<string> {
  return new Set(listOf(inventory.toolRing).flatMap((pin) => (isRecord(pin) ? [refKey(pin.itemType, pin.id)] : [])));
}

function holdsStack(items: unknown[], ref: BagItemRef): boolean {
  return items.some((item) => isRecord(item) && !('id' in item)
    && item.itemType === ref.itemType && inventoryItemId(item) === ref.id);
}

// The game also needs a free ring slot (TOOL_RING_CAPACITY, toolRingPins.ts:11); QPM skips that test so
// it never blocks a buy the game allows. A stricter game answer comes back as a refusal on the card.
function mayJoinToolRing(inventory: Record<string, unknown>, ref: BagItemRef): boolean {
  if (ref.itemType !== 'Tool') return false;
  const facing = getShopFacingCatalogEntry(ref.id);
  if (facing?.kind !== 'item' || facing.entry.joinsToolRingOnAcquire !== true) return false;
  const stored = listOf(inventory.storages).flatMap((s) => (isRecord(s) ? listOf(s.items) : []));
  return !holdsStack(listOf(inventory.items), ref) && !holdsStack(stored, ref);
}

/** False whenever the limit or the inventory is unknown: no data, no refusal. */
export function isBagFullFor(inventory: unknown, ref: BagItemRef, limit: number | null): boolean {
  if (limit == null || !isRecord(inventory)) return false;
  const items = listOf(inventory.items);
  const pinned = ringKeys(inventory);
  const bagSlots = items.filter((item) => isRecord(item) && !pinned.has(refKey(item.itemType, inventoryItemId(item)))).length;
  if (bagSlots < limit) return false;
  if (pinned.has(refKey(ref.itemType, ref.id)) || mayJoinToolRing(inventory, ref)) return false;
  return !holdsStack(items, ref);
}
