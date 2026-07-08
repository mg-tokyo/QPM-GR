// src/ui/panel/tileStatusesNew.ts
// Status providers extracted from tileStatuses.ts and converted to per-tile signature.
// Also includes new providers for tiles that previously had none.

import {
  setStatusText,
  formatCompactNumber,
  getCurrentVersion,
} from './tileStatuses';
import type { PerTileStatusProvider } from './tileStatusTypes';
import { t } from '../../i18n';
import { logTileAsyncFailed, logTileImportFailed, makeDepGuard } from './tileHealth';
import { visibleInterval } from '../../utils/scheduling/timerManager';

// ── Providers moved from tileStatuses.ts ────────────────────────────────────

export const startGardenFiltersStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  import('../../features/garden/filters').then(({ getGardenFiltersConfig, subscribeToGardenFiltersConfig }) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const cfg = getGardenFiltersConfig();
      if (!cfg.enabled) {
        setStatusText(el, t('common.off'), 'muted');
        return;
      }
      const count = cfg.mutations.length + cfg.cropSpecies.length + cfg.eggTypes.length + cfg.growthStates.length;
      setStatusText(el, t('tile.status.enabledFilterCount', { count }), 'positive');
    };
    render();
    const unsub = subscribeToGardenFiltersConfig(render);
    addLiveCleanup(version, unsub);
  }).catch((err) => logTileImportFailed('garden-filters', err));
};

export const startRemindersStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  Promise.all([
    import('../../features/garden/harvestReminder'),
    import('../../store/mutationSummary'),
  ]).then(([harvest, mutation]) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const summary = harvest.getHarvestSummary();
      const mutSummary = mutation.getMutationSummary();
      const readyCount = summary.readyCount;
      const pendingCount = mutSummary?.overallPendingFruitCount ?? 0;
      if (readyCount > 0) {
        setStatusText(el, `${readyCount} ready / ${formatCompactNumber(summary.totalValue)} coins`, 'positive');
      } else if (pendingCount > 0) {
        setStatusText(el, `0 ready / ${pendingCount} pending`, 'normal');
      } else {
        setStatusText(el, '0 ready / 0 pending', 'muted');
      }
    };
    render();
    const unsubHarvest = harvest.onHarvestSummary(render, false);
    const unsubMutation = mutation.onMutationSummary(render, false);
    addLiveCleanup(version, () => { unsubHarvest(); unsubMutation(); });
  }).catch((err) => logTileImportFailed('reminders', err));
};

export const startGardenStatsStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  Promise.all([
    import('../../features/garden/bridge'),
    import('../stats/statsHubWindow/tileHelpers'),
  ]).then(([gardenBridge, tileHelpers]) => {
    if (version !== getCurrentVersion()) return;
    const render = (snapshot: import('../../features/garden/bridge').GardenSnapshot): void => {
      if (!snapshot) {
        setStatusText(el, '0 species / $0', 'muted');
        return;
      }
      const tiles = tileHelpers.extractTiles(snapshot);
      const speciesSet = new Set(tiles.flatMap(t => t.slots.map(s => s.species)).filter(Boolean));
      const gardenValue = tiles.reduce((sum, t) => sum + tileHelpers.tileValue(t), 0);
      const valueStr = formatCompactNumber(gardenValue);
      setStatusText(el, `${speciesSet.size} species / $${valueStr}`, speciesSet.size > 0 ? 'positive' : 'muted');
    };
    const unsub = gardenBridge.onGardenSnapshot(render);
    addLiveCleanup(version, unsub);
  }).catch((err) => logTileImportFailed('garden-stats', err));
};

export const startFavoritesStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  import('../../features/standalone/autoFavorite').then(({ getAutoFavoriteConfig, subscribeToAutoFavoriteConfig }) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const cfg = getAutoFavoriteConfig();
      if (!cfg.enabled) {
        setStatusText(el, t('tile.status.offRuleCount', { count: 0 }), 'muted');
        return;
      }
      const count = cfg.species.length + cfg.mutations.length + cfg.petAbilities.length;
      setStatusText(el, t('tile.status.enabledRuleCount', { count }), 'positive');
    };
    render();
    const unsub = subscribeToAutoFavoriteConfig(render);
    addLiveCleanup(version, unsub);
  }).catch((err) => logTileImportFailed('favorites', err));
};

export const startShopKeybindsStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  import('../../features/shop/keybinds').then(({ isShopKeybindsEnabled, getAllShopKeybinds }) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      if (!isShopKeybindsEnabled()) {
        setStatusText(el, t('common.off'), 'muted');
        return;
      }
      const count = Object.keys(getAllShopKeybinds()).length;
      setStatusText(el, t('tile.status.enabledBindCount', { count }), 'positive');
    };
    render();
    const stop = visibleInterval(`tile-shop-keybinds-v${version}`, render, 5_000);
    addLiveCleanup(version, stop);
  }).catch((err) => logTileImportFailed('shop-keybinds', err));
};

export const startPanelShortcutStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  Promise.all([
    import('../../features/input/panelHotkey'),
    import('../pets/petsWindow/helpers'),
  ]).then(([hotkey, helpers]) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const combo = hotkey.getPanelToggleKeybind();
      setStatusText(el, helpers.formatKeybind(combo));
    };
    render();
    const unsub = hotkey.onPanelToggleKeybindChange(() => render());
    addLiveCleanup(version, unsub);
  }).catch((err) => logTileImportFailed('panel-shortcut', err));
};

export const startTextureManipulatorStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  import('../../features/standalone/textureSwapper').then(({ getTextureSwapperState }) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const state = getTextureSwapperState();
      const total = state.rules.length;
      const active = state.rules.filter(r => r.enabled).length;
      if (active > 0) {
        setStatusText(el, t('tile.status.ruleCountActive', { total, active }), 'positive');
      } else if (total > 0) {
        setStatusText(el, t('tile.status.ruleCountActive', { total, active: 0 }), 'normal');
      } else {
        setStatusText(el, t('tile.status.ruleCountActive', { total: 0, active: 0 }), 'muted');
      }
    };
    render();
    const handler = (): void => render();
    window.addEventListener('qpm:texture-manipulator-updated', handler);
    addLiveCleanup(version, () => window.removeEventListener('qpm:texture-manipulator-updated', handler));
  }).catch((err) => logTileImportFailed('texture-manipulator', err));
};

// ── New providers for tiles that previously had none ────────────────────────

export const startInstaHarvestStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  import('../../features/gardenQol/index').then(({ getGardenQolConfig }) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const cfg = getGardenQolConfig();
      const parts: string[] = [];
      if (cfg.instaHarvestRainbow) parts.push('Rainbow');
      if (cfg.instaHarvestGold) parts.push('Gold');
      if (cfg.ariesHold) parts.push('Hold');
      setStatusText(el, parts.length > 0 ? parts.join(' / ') : t('common.off'), parts.length > 0 ? 'positive' : 'muted');
    };
    render();
    const stop = visibleInterval(`tile-insta-harvest-v${version}`, render, 5_000);
    addLiveCleanup(version, stop);
  }).catch((err) => logTileImportFailed('insta-harvest', err));
};

export const startHoldSettingsStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  import('../../features/gardenQol/index').then(({ getGardenQolConfig }) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const cfg = getGardenQolConfig();
      const enabledCount = Object.values(cfg.holdContexts).filter(Boolean).length;
      setStatusText(el, `${cfg.holdRateHz} Hz / ${enabledCount} ctx`, enabledCount > 0 ? 'positive' : 'muted');
    };
    render();
    const stop = visibleInterval(`tile-hold-settings-v${version}`, render, 5_000);
    addLiveCleanup(version, stop);
  }).catch((err) => logTileImportFailed('hold-settings', err));
};

export const startInventoryCapacityStatus: PerTileStatusProvider = (el, addLiveCleanup, version) => {
  Promise.all([
    import('../../features/economy/inventoryCapacity'),
    import('../../store/inventory'),
  ]).then(([capacity, inventory]) => {
    if (version !== getCurrentVersion()) return;
    capacity.startInventoryCapacity();
    void inventory.startInventoryStore().catch((err) => logTileAsyncFailed('inventory-capacity', 'startInventoryStore', err));
    const renderInner = (): void => {
      const state = capacity.getInventoryCapacityState();
      const config = capacity.getInventoryCapacityConfig();
      if (!config.enabled) {
        setStatusText(el, 'Capacity off', 'muted');
        return;
      }
      setStatusText(
        el,
        `${state.count}/${state.max} slots`,
        state.level === 'full' || state.level === 'warning' ? 'alert' : 'positive',
      );
    };
    const { guardedRender, cleanup: depCleanup } = makeDepGuard(el, renderInner, ['storeInventory'], 'inventory');
    guardedRender();
    const offCapacity = capacity.onInventoryCapacityChange(guardedRender);
    const offInventory = inventory.onInventoryChange(guardedRender);
    addLiveCleanup(version, () => { offCapacity(); offInventory(); depCleanup(); });
  }).catch((err) => logTileImportFailed('inventory-capacity', err));
};

export const startBloblingCustomiserStatus: PerTileStatusProvider = (el, _addLiveCleanup, version) => {
  import('../../utils/game/catalogHelpers').then(({ getCosmeticItemsSafe }) => {
    if (version !== getCurrentVersion()) return;
    const items = getCosmeticItemsSafe();
    if (items.length > 0) {
      setStatusText(el, `${items.length} cosmetics`, 'normal');
    } else {
      setStatusText(el, t('tile.status.bloblingCustomiser.catalogLoading'), 'muted');
    }
  }).catch((err) => logTileImportFailed('blobling-customiser', err));
};
