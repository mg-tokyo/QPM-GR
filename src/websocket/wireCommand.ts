// Callers keep QPM's RoomActionType names; this maps the ones the live server
// no longer accepts onto the command it does, right before the wire.

const INVENTORY = 'inventory';

/**
 * v1419 folded PutItemInStorage / RetrieveItemFromStorage into one MoveItem
 * (QuinoaCanvas schema `{ from, to: 'inventory' | storageId, itemId, quantity?,
 * beforeItemId?, evictionItemId? }`); the old types now fail `invalid_message`.
 * Index fields are dropped: MoveItem appends, and no caller relies on placement.
 */
export function toWireCommand(
  type: string,
  payload: Record<string, unknown>,
): { type: string; payload: Record<string, unknown> } {
  if (type !== 'PutItemInStorage' && type !== 'RetrieveItemFromStorage') return { type, payload };
  const intoStorage = type === 'PutItemInStorage';
  const move: Record<string, unknown> = {
    from: intoStorage ? INVENTORY : payload.storageId,
    to: intoStorage ? payload.storageId : INVENTORY,
    itemId: payload.itemId,
  };
  if (payload.quantity != null) move.quantity = payload.quantity;
  return { type: 'MoveItem', payload: move };
}
