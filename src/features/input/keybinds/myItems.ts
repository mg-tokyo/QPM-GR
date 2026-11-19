// INP-4.5 (D3): one key action per chosen seed, egg or decor, on the same select engine as the Tools rows.

import { getMyItems, MY_ITEM_KINDS, myItemKey, myItemLook, setMyItemChosen, type MyItem } from '../selectItem';
import { clearActionBind } from './actionBinds';
import { pressSelect } from './tools';
import type { RunnableAction } from './types';

const PREFIX = 'item:';

export function myItemActionId(item: MyItem): string {
  return `${PREFIX}${myItemKey(item)}`;
}

export function myItemOf(actionId: string): MyItem | null {
  if (!actionId.startsWith(PREFIX)) return null;
  const rest = actionId.slice(PREFIX.length);
  const cut = rest.indexOf(':');
  const kind = MY_ITEM_KINDS.find(k => k === rest.slice(0, cut));
  const id = rest.slice(cut + 1);
  return cut > 0 && kind && id ? { kind, id } : null;
}

export function buildMyItemActions(items: readonly MyItem[] = getMyItems()): RunnableAction[] {
  return items.map(item => ({ id: myItemActionId(item), section: 'myItems', run: () => pressSelect(item, myItemLook(item).name) }));
}

/** Leaving the list drops the key too, so no orphan key returns when the item is chosen again. */
export function setMyItemKeyed(item: MyItem, chosen: boolean): void {
  if (!chosen) clearActionBind(myItemActionId(item));
  setMyItemChosen(item, chosen);
}
