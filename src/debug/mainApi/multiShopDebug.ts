import { getShopPanelIds } from '../../catalogs/logic/gamePanelsCatalog';
import {
  checkModalHost, chosenShopNames, closeShops, describeShopPanels, dropShopBuilds, ensureShopConfigs, findModalHost, findWeatherAtom,
  getCachedShopBuilds, getLastPeek, getSavedShopLayout, getShopPick, inspectShops, isGatedShop, isMultiShopEnabled, isShopsOpen,
  liveGateDeps, openShops, raiseShopPanel, resetShopLayout, saveShopLayoutCells, setSimulatedHostMissing, shopGate, toggleShops,
  type ShopBuild,
} from '../../features/multiShop';

/** Each cached shop's gate as the next open would see it. Read-only. */
function describeGates(): Record<string, unknown> {
  const deps = liveGateDeps();
  return {
    weather: deps.weather,
    weatherAtom: findWeatherAtom() != null,
    shops: [...getCachedShopBuilds().values()].map(({ name, config }) => {
      const shopType = typeof config.shopType === 'string' ? config.shopType : null;
      return {
        name, shopType, needs: shopType ? deps.weatherOf(shopType) : null, hasIsOpenAtom: config.isOpenAtom != null,
        isOpen: config.isOpenAtom != null ? deps.isOpen(config.isOpenAtom) : null,
        gated: isGatedShop(config, deps), gate: shopGate(config, deps),
      };
    }),
  };
}

function describeBuild(build: ShopBuild): Record<string, unknown> {
  const { config } = build;
  return {
    name: build.name,
    modalName: config.modalName,
    shopType: config.shopType ?? null,
    headerColor: config.headerColor ?? null,
    keys: Object.keys(config),
    hasClass: typeof build.ViewClass === 'function',
    hasRiveBatchRenderer: build.riveBatchRenderer != null,
  };
}

/** QPM_DEBUG_API.multiShop: live checks for the multi-shop panels. */
export const multiShopDebugApi = {
  multiShop: {
    shopIds: getShopPanelIds,
    /** No argument: the saved pick; null: every shop; else these shop panel ids (seedShop, …). */
    open: (names?: readonly string[] | null) => openShops(names),
    close: closeShops,
    toggle: toggleShops,
    isOpen: isShopsOpen,
    /** Forgets saved places and order; open shops go back side by side. */
    reset: resetShopLayout,
    /** Saved places per shop, as screen shares with their front rank. */
    layout: getSavedShopLayout,
    /** Puts saved places back (merged per shop), e.g. what a live check found before it moved panels. */
    restoreLayout: saveShopLayoutCells,
    /** Open panels: cells, front order, and where each bar and grip sits in client pixels. */
    panels: describeShopPanels,
    /** Brings one open shop to the front, as a press on it does. */
    raise: raiseShopPanel,
    /** Hosts left in the UI, and whether the modal host and the real shop view carry their own methods again. */
    inspect: inspectShops,
    /**
     * Test double for a changed game: the next opens see these modal-host handles missing (`modals.read`
     * switches only the quiet build off); null clears it. Drops the cached shop configs either way.
     */
    simulateMissing: (names: readonly string[] | null) => {
      setSimulatedHostMissing(names);
      dropShopBuilds();
    },
    /** Reads the missing shop configs (one quiet peek at most); no argument means every shop. Opens nothing. */
    ensure: (names?: readonly string[]) => {
      const result = ensureShopConfigs(names ?? getShopPanelIds() ?? []);
      if (!result.ok) return result;
      return { ok: true, names: [...result.builds.keys()], skipped: result.skipped, peeked: result.peeked, lastPeek: getLastPeek() };
    },
    configs: () => [...getCachedShopBuilds().values()].map(describeBuild),
    /** Weather now, and each cached shop's weather/hours gate (open or closed) as the next open sees it. */
    gates: describeGates,
    state: () => {
      const check = checkModalHost(findModalHost());
      return {
        enabled: isMultiShopEnabled(),
        pick: getShopPick(),
        shopIds: getShopPanelIds(),
        chosen: chosenShopNames(),
        host: check.ok ? { ok: true, canPeek: check.canPeek, built: [...check.host.built.keys()] } : check,
        cached: [...getCachedShopBuilds().keys()],
        lastPeek: getLastPeek(),
      };
    },
  },
};
