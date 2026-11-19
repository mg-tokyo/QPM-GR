// Each existing bind stays in its feature's own storage (INP-1 D1); these adapters only call the feature setters.

import { getPanelToggleKeybind, onPanelToggleKeybindChange, resetPanelToggleKeybind, setPanelToggleKeybind } from '../panelHotkey';
import { getAllShopKeybinds, setShopKeybind, unbindShopKeybind } from '../../shop/keybinds';
import type { ShopId } from '../../shop/keybinds';
import { getAllFeedKeybinds, setFeedKeybind, unbindFeedKeybind } from '../../pets/feedKeybinds';
import { getSellAllPetsKeybind, setSellAllPetsKeybind } from '../../pets/sellAll';
import { clearKeybind, getKeybinds, getTeamsConfig, onTeamsChange, setKeybind } from '../../../store/petTeams';
import { onCatalogsReady } from '../../../catalogs/gameCatalogs';
import { onGamePanelsChange } from '../../../catalogs/logic/gamePanelsCatalog';
import { onMyItemsChange } from '../selectItem';
import { clearActionBind, getActionBind, setActionBind } from './actionBinds';
import { buildRunnableActions } from './runnable';
import type { KeybindAction } from './types';

function single(read: () => string): Pick<KeybindAction, 'read' | 'holds'> {
  return { read, holds: (combo) => combo !== '' && read() === combo };
}

function panelAction(): KeybindAction {
  return {
    id: 'panel',
    section: 'general',
    canUnbind: false,
    ...single(getPanelToggleKeybind),
    set: setPanelToggleKeybind,
    clear: resetPanelToggleKeybind,
  };
}

function shopActions(): KeybindAction[] {
  return (Object.keys(getAllShopKeybinds()) as ShopId[]).map((shopId) => ({
    id: `shop:${shopId}`,
    section: 'shops',
    canUnbind: true,
    ...single(() => getAllShopKeybinds()[shopId] ?? ''),
    set: (combo: string) => setShopKeybind(shopId, combo),
    clear: () => unbindShopKeybind(shopId),
  }));
}

function feedActions(): KeybindAction[] {
  return Object.keys(getAllFeedKeybinds()).map(Number).map((slot) => ({
    id: `feed:${slot}`,
    section: 'pets',
    canUnbind: true,
    ...single(() => getAllFeedKeybinds()[slot] ?? ''),
    set: (combo: string) => setFeedKeybind(slot, combo),
    clear: () => unbindFeedKeybind(slot),
  }));
}

function teamCombos(teamId: string): string[] {
  return Object.entries(getKeybinds()).filter(([, id]) => id === teamId).map(([combo]) => combo);
}

function teamActions(): KeybindAction[] {
  return getTeamsConfig().teams.map((team) => {
    const clear = (): void => { for (const combo of teamCombos(team.id)) clearKeybind(combo); };
    return {
      id: `team:${team.id}`,
      section: 'pets',
      teamId: team.id,
      canUnbind: true,
      read: () => teamCombos(team.id)[0] ?? '',
      holds: (combo: string) => getKeybinds()[combo] === team.id,
      set: (combo: string) => { clear(); setKeybind(combo, team.id); },
      clear,
    };
  });
}

function sellAllAction(): KeybindAction {
  return {
    id: 'sellAll',
    section: 'pets',
    canUnbind: true,
    ...single(getSellAllPetsKeybind),
    set: setSellAllPetsKeybind,
    clear: () => setSellAllPetsKeybind(''),
  };
}

function runnableActions(): KeybindAction[] {
  return buildRunnableActions().map(({ id, section, panelId }) => {
    const action: KeybindAction = {
      id,
      section,
      canUnbind: true,
      ...single(() => getActionBind(id)),
      set: (combo: string) => setActionBind(id, combo),
      clear: () => clearActionBind(id),
    };
    if (panelId !== undefined) action.panelId = panelId;
    return action;
  });
}

export function buildKeybindActions(): KeybindAction[] {
  return [panelAction(), ...shopActions(), ...runnableActions(), ...feedActions(), ...teamActions(), sellAllAction()];
}

/** Changes made outside the registry: panel key and team list (Pets window, Config card), game panel list read, tool catalog captured, My items chosen in the picker. */
export function watchExternalKeybindChanges(fire: () => void): () => void {
  let primed = false;
  const offPanel = onPanelToggleKeybindChange(() => { if (primed) fire(); });
  const offCatalogs = onCatalogsReady(() => { if (primed) fire(); });
  primed = true;
  const offTeams = onTeamsChange(() => fire());
  const offPanels = onGamePanelsChange(() => fire());
  const offMyItems = onMyItemsChange(() => fire());
  return () => { offPanel(); offCatalogs(); offTeams(); offPanels(); offMyItems(); };
}
