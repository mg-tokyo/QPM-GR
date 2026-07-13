import { getInventoryItems, getFavoritedItemIds } from '../../../store/inventory';
import { sendRoomAction, type WebSocketSendResult } from '../../../websocket/api';
import { notify } from '../../../core/notifications';
import { FEATURE_NAME, log, warnFeature } from './state';
import { getItemUUID } from './groups';
import { renderSidebar } from './sidebar';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendFavoriteToggle(itemId: string): WebSocketSendResult {
  // The WS layer already emits the appropriate WS-* code on failure (no_connection,
  // invalid_payload, send_failed, locker_blocked). We return the full result so
  // handleToggle can aggregate per-reason counts for the user-visible summary.
  return sendRoomAction('ToggleLockItem', { itemId }, { throttleMs: 50 });
}

export async function handleToggle(species: string): Promise<void> {
  const items = getInventoryItems();
  const favoritedIds = getFavoritedItemIds();
  const itemUUIDs: string[] = [];

  for (const item of items) {
    const raw = item.raw as Record<string, unknown> | undefined;
    const itemType = raw?.itemType ?? item.itemType;
    const itemSpecies = (raw?.species ?? item.species) as string | undefined;
    if (itemType !== 'Produce' || itemSpecies !== species) continue;
    const uuid = getItemUUID(item);
    if (uuid) itemUUIDs.push(uuid);
  }

  if (itemUUIDs.length === 0) {
    log.debug(`No items found for species: ${species}`);
    return;
  }

  const lockedCount = itemUUIDs.filter((uuid) => favoritedIds.has(uuid)).length;
  const allLocked = lockedCount === itemUUIDs.length;

  const uuidsToToggle = allLocked
    ? itemUUIDs.filter((uuid) => favoritedIds.has(uuid))
    : itemUUIDs.filter((uuid) => !favoritedIds.has(uuid));

  const verb = allLocked ? 'Unlock' : 'Lock';
  const total = uuidsToToggle.length;
  let ok = 0;
  let throttled = 0;
  let failed = 0;
  for (const uuid of uuidsToToggle) {
    const result = sendFavoriteToggle(uuid);
    if (result.ok) {
      ok += 1;
      await delay(40);
    } else if (result.reason === 'throttled') {
      throttled += 1;
    } else {
      failed += 1;
    }
  }

  setTimeout(() => renderSidebar(true), 250);

  if (failed === 0 && throttled === 0) {
    notify({
      feature: FEATURE_NAME,
      level: 'success',
      message: `${verb}ed ${ok}/${total} ${species}`,
    });
    return;
  }

  // Partial-failure path — aggregate the per-reason counts into one bus
  // degrade + one user-visible summary. Per-item WS-* codes were already
  // emitted by the WS layer; FEATURE-002 attributes the aggregate to this
  // feature's bus row.
  warnFeature('QPM-FEATURE-002', { species, verb, ok, failed, throttled, total });
  notify({
    feature: FEATURE_NAME,
    level: failed > 0 ? 'warn' : 'info',
    message: `${verb}ed ${ok}/${total} ${species}${failed > 0 ? ` — ${failed} failed` : ''}${throttled > 0 ? ` (${throttled} throttled)` : ''}`,
  });
}
