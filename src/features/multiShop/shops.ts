// Which of the game's shop windows the key opens.
import { getShopPanelIds } from '../../catalogs/logic/gamePanelsCatalog';
import { chooseStorageIds } from '../multiStorage/storages';
import { getShopPick } from './settings';

/** The pick limited to the game's shop list, in pick order; every shop when nothing picked is listed. */
export function chooseShopNames(shops: readonly string[], pick: readonly string[] | null): string[] {
  return chooseStorageIds(shops, pick);
}

/** Empty while the game's shop list is unread. */
export function chosenShopNames(): string[] {
  const shops = getShopPanelIds();
  return shops ? chooseShopNames(shops, getShopPick()) : [];
}
