// The game's panel ids as two catalog parts (INP-1.4a). Panel keys check each name QPM offers against the
// game's own list (PD2, user 2026-11-17: a name missing from it hides the row); storage panels come from it.

import { createBundlePartSource } from './bundlePartSource';
import type { BundlePartStatus } from './bundlePartSource';
import {
  PANEL_IDS_MARKER, SHOP_PANELS_MARKER, STORAGE_PANELS_MARKER, parsePanelIds, parseShopPanels, parseStoragePanels,
} from './gamePanelsParsing';

export interface GamePanelsStatus {
  panels: BundlePartStatus & { ids: string[] | null };
  storages: BundlePartStatus & { ids: string[] | null };
  shops: BundlePartStatus & { ids: string[] | null };
}

const panelSource = createBundlePartSource('game-panels', PANEL_IDS_MARKER, parsePanelIds);
const storageSource = createBundlePartSource('storage-panels', STORAGE_PANELS_MARKER, parseStoragePanels);
const shopSource = createBundlePartSource('shop-panels', SHOP_PANELS_MARKER, parseShopPanels);
const sources = [panelSource, storageSource, shopSource];

let started = false;

export function startGamePanelsSource(): void {
  if (started) return;
  started = true;
  for (const source of sources) source.start();
}

export function stopGamePanelsSource(): void {
  started = false;
  for (const source of sources) source.stop();
}

/** Every panel id the game can open; null while unread. */
export function getGamePanelIds(): readonly string[] | null {
  return panelSource.get();
}

/** Storage-building panel ids; null while unread. */
export function getStoragePanelIds(): readonly string[] | null {
  return storageSource.get();
}

/** Shop-window panel ids in the game's order; null while unread. */
export function getShopPanelIds(): readonly string[] | null {
  return shopSource.get();
}

/** Fires when a list resolves and once per list when its first load finishes. */
export function onGamePanelsChange(cb: () => void): () => void {
  const offs = sources.flatMap(s => [s.onChange(cb), s.onSettled(cb)]);
  return () => { for (const off of offs) off(); };
}

export function getGamePanelsStatus(): GamePanelsStatus {
  return {
    panels: { ...panelSource.status(), ids: panelSource.get() },
    storages: { ...storageSource.status(), ids: storageSource.get() },
    shops: { ...shopSource.status(), ids: shopSource.get() },
  };
}
