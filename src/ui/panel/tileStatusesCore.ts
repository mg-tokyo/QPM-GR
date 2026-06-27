// src/ui/panel/tileStatusesCore.ts
// Live status updaters for the original tile types.
// Per-tile providers receive a pre-resolved HTMLElement.
// startPetDerivedStatuses is a multi-tile provider (updates 3 tiles from shared subscriptions).

import type { AddLiveCleanup, GetStatusEl } from './tileStatusTypes';
import {
  setStatusText,
  formatCompactNumber,
  formatDurationShort,
  formatPercent,
  plural,
  truncateStatusText,
  uniqueMapValues,
  renderShopRestockSprites,
  getCurrentVersion,
} from './tileStatuses';
import { logTileAsyncFailed, logTileImportFailed, makeDepGuard } from './tileHealth';

// ---------------------------------------------------------------------------
// Multi-tile: pet-derived statuses (pet-teams + ability-tracker + xp-tracker)
// ---------------------------------------------------------------------------

export function startPetDerivedStatuses(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const petStatus = getStatusEl('pet-teams');
  const abilityStatus = getStatusEl('ability-tracker');
  const xpStatus = getStatusEl('xp-tracker');
  if (!petStatus && !abilityStatus && !xpStatus) return;

  Promise.all([
    import('../../store/pets'),
    import('../../store/petTeams'),
    import('../stats/trackerWindow'),
    import('../pets/xpTracker'),
    import('../../store/abilityLogs'),
    import('../../store/xpTracker'),
  ]).then(([petsStore, teamsStore, abilityTrackerWindow, xpTrackerWindow, abilityLogs, xpTracker]) => {
    if (version !== getCurrentVersion()) return;

    let latestPets = petsStore.getActivePetInfos();
    const render = (): void => {
      const pets = latestPets;
      if (!pets.length) {
        const teams = teamsStore.getTeamsConfig().teams;
        const savedSlots = teams.reduce((sum, team) => sum + team.slots.filter(Boolean).length, 0);
        setStatusText(petStatus, `0 active / ${teams.length} teams / ${savedSlots} slots`, 'muted');
        setStatusText(abilityStatus, '0.0 procs/hr / $0/hr', 'muted');
        setStatusText(xpStatus, '0 active / 0 XP/hr / 0 procs', 'muted');
        return;
      }

      const teams = teamsStore.getTeamsConfig().teams;
      const currentTeamId = teamsStore.detectCurrentTeam();
      const currentTeam = currentTeamId ? teams.find((team) => team.id === currentTeamId) : null;
      const savedSlots = teams.reduce((sum, team) => sum + team.slots.filter(Boolean).length, 0);
      const hungry = pets.filter((pet) => typeof pet.hungerPct === 'number' && pet.hungerPct < 30);
      if (hungry.length > 0) {
        const lowest = Math.min(...hungry.map((pet) => pet.hungerPct as number));
        setStatusText(petStatus, `${pets.length} active / ${hungry.length} hungry / ${teams.length} teams (${Math.round(lowest)}%)`, 'alert');
      } else if (currentTeam) {
        setStatusText(petStatus, `${pets.length} active / ${truncateStatusText(currentTeam.name)} / ${teams.length} teams`, 'positive');
      } else {
        setStatusText(petStatus, `${pets.length} active / ${teams.length} teams / ${savedSlots} slots`, teams.length > 0 ? 'positive' : 'muted');
      }

      const abilityTotals = abilityTrackerWindow.getAbilityTrackerTotals(pets);
      const xpSummary = xpTrackerWindow.getXpTrackerSummaryStats(pets);

      const recentAbilityEvents = uniqueMapValues(
        Array.from(abilityLogs.getAbilityHistorySnapshot().values())
          .flatMap((history) => history.events)
          .filter((event) => Date.now() - event.performedAt < 60 * 60 * 1000)
          .map((event) => `${event.abilityId}:${event.performedAt}`),
      ).length;
      if (abilityTotals.abilityCount > 0) {
        setStatusText(abilityStatus, `${abilityTotals.procsPerHour.toFixed(1)} procs/hr / $${formatCompactNumber(abilityTotals.coinsPerHour)}/hr`, 'positive');
        if (abilityStatus) {
          abilityStatus.title = `${abilityTotals.petCount} pets, ${abilityTotals.abilityCount} active ability rows, ${recentAbilityEvents} procs in the last hour`;
        }
      } else {
        setStatusText(abilityStatus, '0.0 procs/hr / $0/hr', 'muted');
      }

      const xpProcs = xpTracker.getXpProcHistory();
      const recentXpProcs = xpProcs.filter((proc) => Date.now() - proc.timestamp < 6 * 60 * 60 * 1000).length;
      if (xpSummary.abilityCount > 0) {
        setStatusText(
          xpStatus,
          `${formatCompactNumber(xpSummary.totalTeamXpPerHour)} XP/hr / +${formatCompactNumber(xpSummary.abilityXpPerHour)} ability / ${xpSummary.totalProcsPerHour.toFixed(1)} procs/hr`,
          'positive',
        );
        if (xpStatus) {
          xpStatus.title = `${xpSummary.abilityCount} XP abilities, ${recentXpProcs} XP proc logs in the last 6 hours`;
        }
      } else {
        setStatusText(xpStatus, `${pets.length} pets / ${formatCompactNumber(xpSummary.totalTeamXpPerHour)} XP/hr base / 0 XP abilities`, 'muted');
      }
    };

    void petsStore.startPetInfoStore().catch((err) => logTileAsyncFailed('pet-teams', 'startPetInfoStore', err));
    teamsStore.initPetTeamsStore();
    void abilityLogs.startAbilityTriggerStore().then(render).catch((err) => logTileAsyncFailed('ability-tracker', 'startAbilityTriggerStore', err));
    xpTracker.initializeXpTracker();

    const unsubPets = petsStore.onActivePetInfos((pets) => {
      latestPets = pets;
      render();
    });
    const unsubTeams = teamsStore.onTeamsChange(render);
    const unsubAbility = abilityLogs.onAbilityHistoryUpdate(render);
    const unsubXp = xpTracker.onXpTrackerUpdate(render);
    render();
    addLiveCleanup(version, () => {
      unsubPets();
      unsubTeams();
      unsubAbility();
      unsubXp();
    });
  }).catch((err) => logTileImportFailed('pet-derived', err));
}

// ---------------------------------------------------------------------------
// Per-tile providers (el: HTMLElement already resolved by the orchestrator)
// ---------------------------------------------------------------------------

export function startPublicRoomsStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  import('../../features/standalone/publicRooms').then((publicRooms) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      publicRooms.fetchRooms().then(() => {
        const rooms = Object.values(publicRooms.getState().allRooms || {});
        if (rooms.length === 0) {
          setStatusText(el, '0 rooms / 0 players', 'muted');
          return;
        }
        const players = rooms.reduce((sum, room) => sum + Math.max(0, room.playersCount ?? room.userSlots?.length ?? 0), 0);
        const busiest = rooms.reduce((max, room) => Math.max(max, room.playersCount ?? room.userSlots?.length ?? 0), 0);
        setStatusText(el, `${rooms.length} rooms / ${players} players / top ${busiest}`, 'positive');
      }).catch((err) => logTileAsyncFailed('public-rooms', 'fetchRooms', err));
    };
    render();
    const timer = window.setInterval(render, 60_000);
    addLiveCleanup(version, () => window.clearInterval(timer));
  }).catch((err) => logTileImportFailed('public-rooms', err));
}

export function startShopRestockStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  Promise.all([
    import('../../utils/storage'),
    import('../shop/restockAlerts/types'),
    import('../../utils/restock/dataService'),
    import('../shop/restockWindowMeta'),
  ]).then(([{ storage: s }, { TRACKED_KEY, TRACKED_UPDATED_EVENT }, restockData, meta]) => {
    if (version !== getCurrentVersion()) return;

    const readTracked = (): string[] => s.get<string[]>(TRACKED_KEY, []);
    const render = (items = restockData.getRestockDataSync() ?? []): void => {
      if (version !== getCurrentVersion()) return;
      const merged = meta.mergeToolFallbackRows(items);
      renderShopRestockSprites(
        el,
        readTracked(),
        merged,
        (item) => meta.getSpriteUrl(item as Parameters<typeof meta.getSpriteUrl>[0]),
        meta.getItemName,
      );
    };

    render();
    void restockData.fetchRestockData(false).then(render).catch((err) => logTileAsyncFailed('shop-restock', 'fetchRestockData', err));
    const offData = restockData.onRestockDataUpdated((detail) => render(detail.items ?? restockData.getRestockDataSync() ?? []));
    const onTrackedChanged = (): void => render(restockData.getRestockDataSync() ?? []);
    window.addEventListener(TRACKED_UPDATED_EVENT, onTrackedChanged);
    addLiveCleanup(version, () => {
      offData();
      window.removeEventListener(TRACKED_UPDATED_EVENT, onTrackedChanged);
    });
  }).catch((err) => logTileImportFailed('shop-restock', err));
}

export function startJournalStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  import('../../features/journal/checker').then(({ getJournalStats }) => {
    if (version !== getCurrentVersion()) return;
    const renderInner = (): void => {
      getJournalStats().then((stats) => {
        if (!stats || stats.overall.total === 0) {
          setStatusText(el, '0% / catalog loading', 'muted');
          return;
        }
        const pct = formatPercent(stats.overall.percentage);
        const missing = Math.max(0, stats.overall.total - stats.overall.collected);
        setStatusText(
          el,
          `${pct} / ${missing} missing / ${stats.produce.typesCollected}/${stats.produce.typesTotal} crops`,
          stats.overall.percentage >= 100 ? 'positive' : 'normal',
        );
      }).catch((err) => logTileAsyncFailed('journal', 'getJournalStats', err));
    };
    const { guardedRender, cleanup: depCleanup } = makeDepGuard(el, renderInner, ['catalogs'], 'catalogs');
    guardedRender();
    const timer = window.setInterval(guardedRender, 45_000);
    addLiveCleanup(version, () => {
      window.clearInterval(timer);
      depCleanup();
    });
  }).catch((err) => logTileImportFailed('journal', err));
}

export function startTurtleTimerStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  import('../../features/pets/turtleTimer').then(({ initializeTurtleTimer, onTurtleTimerState }) => {
    if (version !== getCurrentVersion()) return;
    initializeTurtleTimer();
    const render = (state: import('../../features/pets/turtleTimer').TurtleTimerState): void => {
      if (!state.enabled) {
        setStatusText(el, 'Timer disabled', 'muted');
        return;
      }
      const cropTargets = state.plant.trackedSlots || state.plant.growingSlots;
      const eggTargets = state.egg.trackedSlots || state.egg.growingSlots;
      const totalTargets = cropTargets + eggTargets;
      if (totalTargets === 0) {
        setStatusText(el, `${state.availableTurtles} turtles / 0 crops / 0 eggs`, 'muted');
      } else if (state.availableTurtles === 0) {
        setStatusText(el, `${plural(totalTargets, 'target')} / 0 turtles / no boost`, 'alert');
      } else {
        const nextRemaining = [
          state.plant.focusSlot?.remainingMs,
          state.plant.adjustedMsRemaining,
          state.egg.focusSlot?.remainingMs,
          state.egg.adjustedMsRemaining,
        ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0).sort((a, b) => a - b)[0] ?? null;
        const eta = nextRemaining ? ` / next ${formatDurationShort(nextRemaining)}` : '';
        setStatusText(el, `${state.availableTurtles} turtles / ${cropTargets} crops / ${eggTargets} eggs${eta}`, 'positive');
      }
    };
    const unsub = onTurtleTimerState(render);
    addLiveCleanup(version, unsub);
  }).catch((err) => logTileImportFailed('turtle-timer', err));
}

export function startCropBoostStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  import('../../features/pets/cropBoostTracker').then(({ startCropBoostTracker, getConfig, getCurrentAnalysis, manualRefresh, onAnalysisChange }) => {
    if (version !== getCurrentVersion()) return;
    startCropBoostTracker();
    const renderInner = (): void => {
      const config = getConfig();
      const analysis = getCurrentAnalysis();
      if (!config.enabled) {
        setStatusText(el, 'Boost tracker disabled', 'muted');
      } else if (!analysis) {
        setStatusText(el, 'Scanning garden boosts', 'muted');
      } else if (analysis.totalBoostPets === 0) {
        setStatusText(el, `${analysis.totalCropsNeedingBoost} crops / no boost pets`, analysis.totalCropsNeedingBoost > 0 ? 'alert' : 'muted');
      } else if (analysis.totalCropsNeedingBoost > 0) {
        const eta = analysis.overallEstimate.timeEstimateP50;
        setStatusText(el, `${analysis.totalBoostPets} boosters / ${analysis.totalCropsNeedingBoost} crops / ${formatDurationShort(eta * 60_000)}`);
      } else {
        setStatusText(el, `${analysis.totalBoostPets} boosters / ${analysis.totalCropsAtMax}/${analysis.totalMatureCrops} maxed`, 'positive');
      }
    };
    const { guardedRender, cleanup: depCleanup } = makeDepGuard(el, renderInner, ['catalogs'], 'catalogs');
    manualRefresh();
    guardedRender();
    const unsub = onAnalysisChange(guardedRender);
    const timer = window.setInterval(() => {
      manualRefresh();
      guardedRender();
    }, 30_000);
    addLiveCleanup(version, () => {
      unsub();
      window.clearInterval(timer);
      depCleanup();
    });
  }).catch((err) => logTileImportFailed('crop-boost', err));
}

export function startValueDisplayStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  Promise.all([
    import('../../features/economy/storageValue'),
    import('../../store/inventory'),
  ]).then(([storageValue, inventory]) => {
    if (version !== getCurrentVersion()) return;
    storageValue.startStorageValue();
    void inventory.startInventoryStore().catch((err) => logTileAsyncFailed('value-display', 'startInventoryStore', err));
    const renderInner = (): void => {
      const config = storageValue.getStorageValueConfig();
      const state = storageValue.getStorageValueState();
      const enabledCount = [config.seedSilo, config.petHutch, config.decorShed, config.inventory].filter(Boolean).length;
      if (enabledCount === 0) {
        setStatusText(el, '0/4 value surfaces / 0 coins', 'muted');
      } else if (state.status === 'ready' && state.activeModal && state.value > 0) {
        setStatusText(el, `${formatCompactNumber(state.value)} coins / ${state.activeModal}`, 'positive');
      } else {
        const items = inventory.getInventoryItems();
        const inventoryValue = storageValue.computeStorageItemsValue(items);
        setStatusText(el, `${enabledCount}/4 surfaces / ${items.length} inv / ${formatCompactNumber(inventoryValue)} coins`, inventoryValue > 0 ? 'positive' : 'normal');
      }
    };
    const { guardedRender, cleanup: depCleanup } = makeDepGuard(el, renderInner, ['storeInventory'], 'inventory');
    guardedRender();
    const offState = storageValue.onStorageValueChange(guardedRender);
    const offData = storageValue.onStorageDataChange(guardedRender);
    const offInventory = inventory.onInventoryChange(guardedRender);
    const timer = window.setInterval(guardedRender, 10_000);
    addLiveCleanup(version, () => {
      offState();
      offData();
      offInventory();
      window.clearInterval(timer);
      depCleanup();
    });
  }).catch((err) => logTileImportFailed('value-display', err));
}

export function startActivityLogStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  import('../../features/activity/activityLogNativeEnhancer').then(({ startActivityLogEnhancer, getActivityLogEnhancerStatus }) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const status = getActivityLogEnhancerStatus();
      if (!status.enabled) {
        setStatusText(el, 'Activity log disabled', 'muted');
      } else if (!status.started) {
        setStatusText(el, 'Starting event capture', 'muted');
      } else if (status.historyCount > 0) {
        const shown = status.totalFiltered > 0 ? status.totalFiltered : status.historyCount;
        setStatusText(el, `${status.historyCount} saved / ${status.replaySafeCount} replay / ${shown} shown`, 'positive');
      } else {
        setStatusText(el, '0 saved / 0 replay / watching', 'positive');
      }
    };
    void startActivityLogEnhancer().catch((err) => logTileAsyncFailed('activity-log', 'startActivityLogEnhancer', err)).finally(render);
    render();
    const timer = window.setInterval(render, 15_000);
    addLiveCleanup(version, () => window.clearInterval(timer));
  }).catch((err) => logTileImportFailed('activity-log', err));
}

export function startProtectionStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  Promise.all([
    import('../../features/economy/inventoryCapacity'),
    import('../../features/locker/index'),
    import('../../store/inventory'),
  ]).then(([capacity, locker, inventory]) => {
    if (version !== getCurrentVersion()) return;
    capacity.startInventoryCapacity();
    void inventory.startInventoryStore().catch((err) => logTileAsyncFailed('protection', 'startInventoryStore', err));

    const countEnabled = (flags: Record<string, boolean>): number => Object.values(flags).filter(Boolean).length;
    const renderInner = (): void => {
      const capacityState = capacity.getInventoryCapacityState();
      const capacityConfig = capacity.getInventoryCapacityConfig();
      const lockerConfig = locker.getLockerConfig();
      const favIds = inventory.getFavoritedItemIds();
      const ownedIds = new Set(inventory.getInventoryItems().map(i => i.id));
      const favoriteCount = [...favIds].filter(id => ownedIds.has(id)).length;
      const activeRules = [
        lockerConfig.hatchLock,
        lockerConfig.harvestLock,
        lockerConfig.decorPickupLock,
        lockerConfig.sellAllCropsLock,
        lockerConfig.petSellGuard,
        lockerConfig.inventoryReserve.enabled,
      ].filter(Boolean).length
        + countEnabled(lockerConfig.eggLocks)
        + countEnabled(lockerConfig.plantLocks)
        + countEnabled(lockerConfig.mutationLocks)
        + countEnabled(lockerConfig.decorLocks)
        + countEnabled(lockerConfig.cropSellLocks);

      const lockText = lockerConfig.enabled ? `${activeRules} rules` : 'locker off';
      const capacityText = capacityConfig.enabled ? `${capacityState.count}/${capacityState.max} slots` : 'capacity off';
      setStatusText(
        el,
        `${lockText} / ${capacityText} / ${favoriteCount} fav`,
        capacityState.level === 'full' || capacityState.level === 'warning' ? 'alert' : (lockerConfig.enabled ? 'positive' : 'muted'),
      );
    };

    const { guardedRender, cleanup: depCleanup } = makeDepGuard(el, renderInner, ['storeInventory'], 'inventory');
    guardedRender();
    const offCapacity = capacity.onInventoryCapacityChange(guardedRender);
    const offInventory = inventory.onInventoryChange(guardedRender);
    const timer = window.setInterval(guardedRender, 5_000);
    addLiveCleanup(version, () => {
      offCapacity();
      offInventory();
      window.clearInterval(timer);
      depCleanup();
    });
  }).catch((err) => logTileImportFailed('protection', err));
}

export function startCropCalculatorStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  import('../../catalogs/gameCatalogs').then((catalogs) => {
    if (version !== getCurrentVersion()) return;
    const renderInner = (): void => {
      const cropValues = catalogs.getAllPlantSpecies()
        .map((species) => {
          const entry = catalogs.getPlantSpecies(species);
          const price = typeof entry?.crop?.baseSellPrice === 'number' ? entry.crop.baseSellPrice : 0;
          return { species, price };
        })
        .filter((entry) => entry.price > 0);
      const petValues = catalogs.getAllPetSpecies()
        .map((species) => {
          const entry = catalogs.getPetSpecies(species);
          const price = typeof entry?.maturitySellPrice === 'number' ? entry.maturitySellPrice : 0;
          return { species, price };
        })
        .filter((entry) => entry.price > 0);
      if (cropValues.length === 0 && petValues.length === 0) {
        setStatusText(el, '0 crops / 0 pets / catalogs loading', 'muted');
        return;
      }
      setStatusText(el, `${cropValues.length} crops / ${petValues.length} pets / ${catalogs.getAllMutations().length} mutations`, 'positive');
    };

    const { guardedRender, cleanup: depCleanup } = makeDepGuard(el, renderInner, ['catalogs'], 'catalogs');
    guardedRender();
    const offCatalogs = catalogs.onCatalogsReady(guardedRender);
    addLiveCleanup(version, () => {
      offCatalogs();
      depCleanup();
    });
  }).catch((err) => logTileImportFailed('crop-calculator', err));
}

export function startControllerStatus(el: HTMLElement, addLiveCleanup: AddLiveCleanup, version: number): void {
  Promise.all([
    import('../../features/input/controller/index'),
    import('../../features/input/controller/bindings'),
  ]).then(([controller, bindings]) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const bindingCount = Object.keys(bindings.loadBindings()).length;
      const speed = bindings.loadCursorSpeed();
      if (!controller.isControllerEnabled()) {
        setStatusText(el, `${bindingCount} binds / ${speed} / disabled`, 'muted');
        return;
      }
      const profile = controller.getRunningPoller()?.getProfile();
      if (profile) {
        setStatusText(el, `${bindingCount} binds / ${speed} / ${truncateStatusText(profile.name, 14)}`, 'positive');
      } else {
        setStatusText(el, `${bindingCount} binds / ${speed} / no gamepad`, 'muted');
      }
    };
    render();
    const timer = window.setInterval(render, 3_000);
    addLiveCleanup(version, () => window.clearInterval(timer));
  }).catch((err) => logTileImportFailed('controller', err));
}
