// What the Shop panels card shows: every shop in the game's list with the pick, whether it is open now, and where
// the shops the key would open sit. A shop's open state needs its config, read by one quiet build when the card
// opens (plan U3); a shop without one shows no state and counts as openable.
import { getShopPanelIds, onGamePanelsChange } from '../../catalogs/logic/gamePanelsCatalog';
import { subscribe } from '../../core/gameState';
import { petSidebarRightEdge, type PixiNode } from '../multiStorage/gameHooks';
import { previewCells, type PreviewCell } from '../multiStorage/layout';
import { SIDEBAR_GAP_PX } from '../multiStorage/session';
import { nextPick } from '../multiStorage/storages';
import { liveGateDeps, shopGate, type GateDeps } from './gate';
import { currentModal } from './panels';
import { ensureShopConfigs, getCachedShopBuilds, type ShopBuild } from './quietBuild';
import { getSavedShopLayout, getShopPick, onMultiShopSettingsChange, setShopPick } from './settings';
import { SHOP_FIT, shopTitle } from './shopChrome';
import { chooseShopNames } from './shops';

export interface ShopChoice {
  name: string;
  title: string;
  picked: boolean;
  /** Null while the shop's config is unread. */
  status: 'open' | 'closed' | null;
  /** The weather kind the shop opens in (`rain`, `snow`, …); null for a shop no weather gates or one unread. */
  weather: string | null;
}

export interface ShopLayoutPreview { aspect: number; cells: PreviewCell[]; saved: number }

type BuildsLike = ReadonlyMap<string, Pick<ShopBuild, 'config'>>;

export function shopChoicesFrom(shops: readonly string[], pick: readonly string[] | null, builds: BuildsLike, deps: GateDeps): ShopChoice[] {
  const chosen = chooseShopNames(shops, pick);
  return shops.map((name) => {
    const config = builds.get(name)?.config ?? null;
    const shopType = config && typeof config.shopType === 'string' ? config.shopType : null;
    return {
      name,
      title: shopTitle(name),
      picked: chosen.includes(name),
      status: config ? shopGate(config, deps) : null,
      weather: shopType ? deps.weatherOf(shopType) : null,
    };
  });
}

/** The shops the key would open now, in pick order: picked and not known to be closed. */
export function openableShopNames(choices: readonly ShopChoice[], pick: readonly string[] | null): string[] {
  const usable = new Set(choices.filter(c => c.picked && c.status !== 'closed').map(c => c.name));
  return chooseShopNames(choices.map(c => c.name), pick).filter(name => usable.has(name));
}

export function listShopChoices(): ShopChoice[] {
  const shops = getShopPanelIds();
  return shops ? shopChoicesFrom(shops, getShopPick(), getCachedShopBuilds(), liveGateDeps()) : [];
}

/** False when the press would leave no shop picked. */
export function toggleShopChoice(name: string): boolean {
  const next = nextPick(getShopPanelIds() ?? [], getShopPick(), name);
  if (next === 'refused') return false;
  setShopPick(next);
  return true;
}

function previewSurface(): { screen: { w: number; h: number }; left: number } {
  const build = [...getCachedShopBuilds().values()][0];
  const renderer = build?.renderer as { width?: unknown; height?: unknown } | null | undefined;
  const w = renderer?.width;
  const h = renderer?.height;
  if (typeof w !== 'number' || typeof h !== 'number' || !(w > 0) || !(h > 0)) {
    return { screen: { w: window.innerWidth, h: window.innerHeight }, left: 0 };
  }
  let left = 0;
  try { left = petSidebarRightEdge(build?.ui as PixiNode, SIDEBAR_GAP_PX); } catch { /* sidebar not built */ }
  return { screen: { w, h }, left };
}

export function getShopLayoutPreview(choices: readonly ShopChoice[] = listShopChoices()): ShopLayoutPreview {
  const ids = openableShopNames(choices, getShopPick());
  const saved = getSavedShopLayout();
  const { screen, left } = previewSurface();
  return {
    aspect: screen.h > 0 ? screen.w / screen.h : 16 / 9,
    cells: previewCells(ids, saved, left, screen, SHOP_FIT),
    saved: ids.filter(id => saved[id]).length,
  };
}

const readListeners = new Set<() => void>();
// Names with a final answer for this cache (a build or a skip that a retry would not change), so a render does not
// peek for them again. A new engine generation replaces the cache map, which clears this.
let answered: { cache: unknown; names: Set<string> } = { cache: null, names: new Set() };
let peeking = false;

/**
 * Plan U3: one quiet build of every listed shop without a config, only while no game modal is open. True when it
 * read something new; the card's listeners hear of it on the next microtask (never inside the caller's paint).
 */
export function ensureShopChoiceConfigs(): boolean {
  if (peeking) return false;
  const shops = getShopPanelIds();
  if (!shops) return false;
  const cached = getCachedShopBuilds();
  if (answered.cache !== cached) answered = { cache: cached, names: new Set() };
  const missing = shops.filter(name => !cached.has(name) && !answered.names.has(name));
  if (missing.length === 0 || currentModal() !== null) return false;
  peeking = true;
  let result;
  try { result = ensureShopConfigs(missing); } finally { peeking = false; }
  if (!result.ok) return false;
  // The ensure may have started a new generation: key the answers to the map it filled.
  const after = getCachedShopBuilds();
  if (answered.cache !== after) answered = { cache: after, names: new Set() };
  for (const name of missing) {
    const skip = result.skipped[name];
    if (result.builds.has(name) || (skip !== undefined && !skip.startsWith('peek:'))) answered.names.add(name);
  }
  if (result.builds.size === 0) return false;
  queueMicrotask(() => { for (const cb of readListeners) cb(); });
  return true;
}

/** Pick, on/off, saved places, the shop list, the weather, or shop configs read by the card. */
export function onShopChoicesChange(cb: () => void): () => void {
  const onRead = (): void => cb();
  readListeners.add(onRead);
  const offs = [onMultiShopSettingsChange(cb), onGamePanelsChange(cb), subscribe('weather', () => cb())];
  return () => {
    readListeners.delete(onRead);
    for (const off of offs) off();
  };
}
