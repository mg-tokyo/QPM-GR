// What the settings card shows: the owned storages with the pick, value and art, and where each would open.
import { getDecor } from '../../catalogs/gameCatalogs';
import { getStoragePanelIds } from '../../catalogs/logic/gamePanelsCatalog';
import { formatStorageValue, onStorageValueInputsChange, readStorageValue } from '../economy/storageValueById';
import { storageTitle } from './chromeArt';
import { checkStorageSystem, findStorageSystem, panelIdFor, petSidebarRightEdge } from './gameHooks';
import { previewCells, type PreviewCell } from './layout';
import { SIDEBAR_GAP_PX } from './session';
import { getSavedLayout, getStoragePick, onMultiStorageSettingsChange, setStoragePick } from './settings';
import { chooseStorageIds, nextPick, onOwnedStorageIdsChange, readOwnedStorageIds } from './storages';

export interface StorageChoice {
  storageId: string;
  title: string;
  spriteKey: string | null;
  picked: boolean;
  /** The storage value label's text; null when that storage shows none (plan D7). */
  value: string | null;
}

export interface LayoutPreview { aspect: number; cells: PreviewCell[]; saved: number }

export function listStorageChoices(): StorageChoice[] {
  const owned = readOwnedStorageIds();
  const chosen = chooseStorageIds(owned, getStoragePick());
  const panelIds = getStoragePanelIds() ?? [];
  return owned.map((storageId) => {
    const art = getDecor(storageId)?.art;
    const panelId = panelIdFor(storageId, panelIds);
    const reading = panelId ? readStorageValue(storageId, panelId) : null;
    return {
      storageId,
      title: storageTitle(storageId),
      spriteKey: typeof art === 'string' && art.length > 0 ? art : null,
      picked: chosen.includes(storageId),
      value: reading?.status === 'ready' ? formatStorageValue(reading.value) : null,
    };
  });
}

/** False when the press would leave no storage picked. */
export function toggleStorageChoice(storageId: string): boolean {
  const next = nextPick(readOwnedStorageIds(), getStoragePick(), storageId);
  if (next === 'refused') return false;
  setStoragePick(next);
  return true;
}

export function getLayoutPreview(): LayoutPreview {
  const ids = chooseStorageIds(readOwnedStorageIds(), getStoragePick());
  const saved = getSavedLayout();
  const check = checkStorageSystem(findStorageSystem());
  const screen = check.ok ? { w: check.sys.renderer.width, h: check.sys.renderer.height } : { w: window.innerWidth, h: window.innerHeight };
  let left = 0;
  try { if (check.ok) left = petSidebarRightEdge(check.sys.uiContainer, SIDEBAR_GAP_PX); } catch { /* sidebar not built */ }
  return {
    aspect: screen.h > 0 ? screen.w / screen.h : 16 / 9,
    cells: previewCells(ids, saved, left, screen),
    saved: ids.filter(id => saved[id]).length,
  };
}

/** Pick, on/off, saved places, owned storages or their values changed. */
export function onStorageChoicesChange(cb: () => void): () => void {
  const offs = [onMultiStorageSettingsChange(cb), onOwnedStorageIdsChange(() => cb()), onStorageValueInputsChange(cb)];
  return () => { for (const off of offs) off(); };
}
