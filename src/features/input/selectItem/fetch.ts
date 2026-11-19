// INP-5: a select key whose item is in no bag stack takes the whole stack from storage, then picks it (D1, D3–D6);
// the next press on that held stack sends it back (D2).

import { getBagLimit } from '../../../catalogs/logic/bagLimitCatalog';
import { readSync, subscribe } from '../../../core/gameState';
import { t } from '../../../i18n';
import { isBagFullFor } from '../../../store/bagRoom';
import { getInventoryItems } from '../../../store/inventory';
import { showToast } from '../../../ui/components';
import { storage } from '../../../utils/storage';
import { sendRoomAction } from '../../../websocket/api';
import { chooseItemId, planFetch, planSelect, type SelectTarget } from './core';
import { readReply, selectBagItem, sendSelect, type SelectResult } from './run';

const SETTING_KEY = 'qpm.keybinds.fetchFromStorage.v1';

export interface SelectLabels {
  readonly item: string;
  readonly storage: (storageId: string) => string;
}

// Session only (INP-5 P): a reload forgets, and the second press then only puts away.
const fetchedFrom = new Map<string, string>();
let fetchGen = 0;

/** D3: on unless the player switched it off. */
export function isFetchFromStorageEnabled(): boolean {
  const raw = storage.get<{ enabled?: unknown } | null>(SETTING_KEY, null);
  return !(raw && typeof raw === 'object' && raw.enabled === false);
}

export function setFetchFromStorageEnabled(enabled: boolean): void {
  storage.set(SETTING_KEY, { enabled });
}

/** The storage a key fetched this stack from, this session. */
export function getFetchedStorage(itemId: string): string | null {
  return fetchedFrom.get(itemId) ?? null;
}

const bagItems = (): unknown[] => getInventoryItems().map(item => item.raw);

/** D7: the storage a press would take the target from now (same lookup as the press), or null. */
export function storageHolding(target: SelectTarget): string | null {
  return planFetch(readSync('inventory')?.storages ?? [], target)?.storageId ?? null;
}

export function onStoragesChange(cb: () => void): () => void {
  const offs = (['seedSiloItems', 'toolShackItems', 'decorShedItems'] as const).map(key => subscribe(key, () => cb()));
  return () => { for (const off of offs) off(); };
}

// D2: put away, then send what is left of a stack the key fetched back to its storage (no quantity = whole stack).
async function returnFetched(target: SelectTarget, itemId: string, storageId: string, labels: SelectLabels): Promise<SelectResult> {
  const drop = sendSelect(itemId, false);
  if (drop.outcome === 'failed') return drop;
  const refused = (reason: string): SelectResult => {
    showToast(t('feature.keybinds.returnRefused', { item: labels.item, storage: labels.storage(storageId) }));
    return { outcome: 'returnRefused', itemId, reason };
  };
  const result = sendRoomAction('PutItemInStorage', { itemId, storageId });
  if (!result.ok) return refused(result.reason ?? 'send_failed');
  const reply = await readReply(result);
  const left = reply === 'ok' || (reply === 'none' && planSelect(bagItems(), target, itemId).action !== 'putAway');
  if (!left) return refused(reply);
  fetchedFrom.delete(itemId);
  return { outcome: 'returned', itemId };
}

/** One key press: the bag as INP-4; with none in the bag and the switch on, fetch from storage first. */
export async function pressSelectItem(target: SelectTarget, labels: SelectLabels): Promise<SelectResult> {
  const gen = ++fetchGen;
  const enabled = isFetchFromStorageEnabled();
  const bagPlan = planSelect(bagItems(), target, readSync('selectedItemId'));
  const from = bagPlan.action === 'putAway' && enabled ? fetchedFrom.get(bagPlan.itemId) : undefined;
  if (bagPlan.action === 'putAway' && from) return returnFetched(target, bagPlan.itemId, from, labels);
  if (bagPlan.action !== 'missing' || !enabled) return selectBagItem(target, labels.item);

  const inventory = readSync('inventory');
  const plan = planFetch(inventory?.storages ?? [], target);
  if (!plan) {
    showToast(t('feature.keybinds.notInBagOrStorage', { item: labels.item }));
    return { outcome: 'missing' };
  }
  // D5: the shop's bag-room rule; no eviction swap.
  if (isBagFullFor(inventory, { itemType: plan.itemType, id: plan.itemId }, getBagLimit())) {
    showToast(t('feature.keybinds.bagFull', { item: labels.item }));
    return { outcome: 'bagFull', itemId: plan.itemId };
  }
  const refused = (reason: string): SelectResult => {
    showToast(t('feature.keybinds.takeRefused', { item: labels.item, storage: labels.storage(plan.storageId) }));
    return { outcome: 'refused', itemId: plan.itemId, reason };
  };
  // No quantity: the whole stack, capped by the game at the bag stack's room (D1).
  const result = sendRoomAction('RetrieveItemFromStorage', { itemId: plan.itemId, storageId: plan.storageId });
  if (!result.ok) return refused(result.reason ?? 'send_failed');
  // D4: pick only after the server's yes; an unknown outcome counts when the stack is in the bag by then.
  const reply = await readReply(result);
  const arrived = reply === 'ok' || (reply === 'none' && chooseItemId(bagItems(), target) === plan.itemId);
  if (!arrived) return refused(reply);
  fetchedFrom.set(plan.itemId, plan.storageId);
  if (gen !== fetchGen) return { outcome: 'superseded', itemId: plan.itemId };
  return sendSelect(plan.itemId, true);
}

export function getFetchDebugState(): { enabled: boolean; fetched: Record<string, string> } {
  return { enabled: isFetchFromStorageEnabled(), fetched: Object.fromEntries(fetchedFrom) };
}
