import { BAG_ATOM_TARGET, gameKeysFor, isGameHotkey, onGameHotkeysChange } from '../../../catalogs/logic/gameHotkeysCatalog';
import { isShopKeybindsEnabled, setShopKeybindsEnabled } from '../../shop/keybinds';
import { buildKeybindActions, watchExternalKeybindChanges } from './adapters';
import { isFetchFromStorageEnabled, setFetchFromStorageEnabled, type MyItem } from '../selectItem';
import { setMyItemKeyed } from './myItems';
import { createKeybindRegistry } from './registry';
import type { AssignResult, KeybindActionInfo, KeybindRegistry } from './types';

export type { AssignRefusal, AssignResult, KeybindActionInfo, KeybindSection } from './types';
export { normalizeCombo } from './registry';
export { startKeybindDispatcher, stopKeybindDispatcher } from './dispatcher';
export { storagePanelLook, type PanelLook } from './panelLook';
export { onToolBagChange, toolIdOf, toolLook, toolsInBag, type ToolLook } from './tools';
export { myItemOf } from './myItems';

let registry: KeybindRegistry | null = null;

function getRegistry(): KeybindRegistry {
  registry ??= createKeybindRegistry({
    actions: buildKeybindActions,
    isGameHotkey,
    watchExternal: watchExternalKeybindChanges,
  });
  return registry;
}

export function listKeybindActions(): KeybindActionInfo[] {
  return getRegistry().list();
}

export function assignKeybind(actionId: string, combo: string): AssignResult {
  return getRegistry().assign(actionId, combo);
}

/** No key afterwards, except the panel toggle, which returns to its default. */
export function clearKeybindAction(actionId: string): boolean {
  return getRegistry().clear(actionId);
}

export function areShopKeysEnabled(): boolean {
  return isShopKeybindsEnabled();
}

export function setShopKeysEnabled(enabled: boolean): void {
  getRegistry().update(() => setShopKeybindsEnabled(enabled));
}

/** INP-5 D3: Tools and My items keys take the stack from storage when none is in the bag. */
export function isFetchFromStorageOn(): boolean {
  return isFetchFromStorageEnabled();
}

export function setFetchFromStorageOn(enabled: boolean): void {
  getRegistry().update(() => setFetchFromStorageEnabled(enabled));
}

/** Picker tick or a My items row's Remove: one change event, and an item leaving the list loses its key. */
export function chooseMyItem(item: MyItem, chosen: boolean): void {
  getRegistry().update(() => setMyItemKeyed(item, chosen));
}

export function onKeybindsChange(cb: () => void): () => void {
  return getRegistry().onChange(cb);
}

/** The game's own keys for what this action opens (INP-1.6b), read from game code; [] when none or unread. */
export function gameKeysForAction(info: KeybindActionInfo): string[] {
  const target = info.id === 'bag' ? BAG_ATOM_TARGET
    : info.panelId ?? (info.id.startsWith('shop:') ? info.id.slice('shop:'.length) : null);
  return target ? gameKeysFor(target) : [];
}

export function onGameKeysChange(cb: () => void): () => void {
  return onGameHotkeysChange(cb);
}
