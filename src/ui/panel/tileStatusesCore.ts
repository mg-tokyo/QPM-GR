// src/ui/panel/tileStatusesCore.ts
// Live status updaters for the original 13 tile types (pet-teams, shop-restock, etc.).

import {
  setStatusText,
  formatCompactNumber,
  formatDurationShort,
  formatPercent,
  plural,
  truncateStatusText,
  uniqueMapValues,
  renderShopRestockSprites,
  type TileStatusTone,
  getCurrentVersion,
  type GetStatusEl,
  type AddLiveCleanup,
} from './tileStatuses';

export function startPetDerivedStatuses(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const petStatus = getStatusEl('pet-teams');
  const abilityStatus = getStatusEl('ability-tracker');
  const xpStatus = getStatusEl('xp-tracker');
  if (!petStatus && !abilityStatus && !xpStatus) return;

  Promise.all([
    import('../../store/pets'),
    import('../../store/petTeams'),
    import('../trackerWindow'),
    import('../xpTracker'),
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

    void petsStore.startPetInfoStore().catch(() => {});
    teamsStore.initPetTeamsStore();
    void abilityLogs.startAbilityTriggerStore().then(render).catch(() => {});
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
  }).catch(() => {});
}

export function startPublicRoomsStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const roomsStatus = getStatusEl('public-rooms');
  if (!roomsStatus) return;

  import('../../features/publicRooms').then((publicRooms) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      publicRooms.fetchRooms().then(() => {
        const rooms = Object.values(publicRooms.getState().allRooms || {});
        if (rooms.length === 0) {
          setStatusText(roomsStatus, '0 rooms / 0 players', 'muted');
          return;
        }
        const players = rooms.reduce((sum, room) => sum + Math.max(0, room.playersCount ?? room.userSlots?.length ?? 0), 0);
        const busiest = rooms.reduce((max, room) => Math.max(max, room.playersCount ?? room.userSlots?.length ?? 0), 0);
        setStatusText(roomsStatus, `${rooms.length} rooms / ${players} players / top ${busiest}`, 'positive');
      }).catch(() => {});
    };
    render();
    const timer = window.setInterval(render, 60_000);
    addLiveCleanup(version, () => window.clearInterval(timer));
  }).catch(() => {});
}

export function startShopRestockStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const shopStatus = getStatusEl('shop-restock');
  if (!shopStatus) return;

  Promise.all([
    import('../../utils/storage'),
    import('../shopRestockAlerts/types'),
    import('../../utils/restockDataService'),
    import('../shopRestockWindowMeta'),
  ]).then(([{ storage: s }, { TRACKED_KEY, TRACKED_UPDATED_EVENT }, restockData, meta]) => {
    if (version !== getCurrentVersion()) return;

    const readTracked = (): string[] => s.get<string[]>(TRACKED_KEY, []);
    const render = (items = restockData.getRestockDataSync() ?? []): void => {
      if (version !== getCurrentVersion()) return;
      const merged = meta.mergeToolFallbackRows(items);
      renderShopRestockSprites(
        shopStatus,
        readTracked(),
        merged,
        (item) => meta.getSpriteUrl(item as Parameters<typeof meta.getSpriteUrl>[0]),
        meta.getItemName,
      );
    };

    render();
    void restockData.fetchRestockData(false).then(render).catch(() => {});
    const offData = restockData.onRestockDataUpdated((detail) => render(detail.items ?? restockData.getRestockDataSync() ?? []));
    const onTrackedChanged = (): void => render(restockData.getRestockDataSync() ?? []);
    window.addEventListener(TRACKED_UPDATED_EVENT, onTrackedChanged);
    addLiveCleanup(version, () => {
      offData();
      window.removeEventListener(TRACKED_UPDATED_EVENT, onTrackedChanged);
    });
  }).catch(() => {});
}

export function startJournalStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const journalStatus = getStatusEl('journal-checker');
  if (!journalStatus) return;

  import('../../features/journalChecker').then(({ getJournalStats }) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      getJournalStats().then((stats) => {
        if (!stats || stats.overall.total === 0) {
          setStatusText(journalStatus, '0% / catalog loading', 'muted');
          return;
        }
        const pct = formatPercent(stats.overall.percentage);
        const missing = Math.max(0, stats.overall.total - stats.overall.collected);
        setStatusText(
          journalStatus,
          `${pct} / ${missing} missing / ${stats.produce.typesCollected}/${stats.produce.typesTotal} crops`,
          stats.overall.percentage >= 100 ? 'positive' : 'normal',
        );
      }).catch(() => {});
    };
    render();
    const timer = window.setInterval(render, 45_000);
    addLiveCleanup(version, () => window.clearInterval(timer));
  }).catch(() => {});
}

export function startTurtleTimerStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const turtleStatus = getStatusEl('turtle-timer');
  if (!turtleStatus) return;

  import('../../features/turtleTimer').then(({ initializeTurtleTimer, onTurtleTimerState }) => {
    if (version !== getCurrentVersion()) return;
    initializeTurtleTimer();
    const render = (state: import('../../features/turtleTimer').TurtleTimerState): void => {
      if (!state.enabled) {
        setStatusText(turtleStatus, 'Timer disabled', 'muted');
        return;
      }
      const cropTargets = state.plant.trackedSlots || state.plant.growingSlots;
      const eggTargets = state.egg.trackedSlots || state.egg.growingSlots;
      const totalTargets = cropTargets + eggTargets;
      if (totalTargets === 0) {
        setStatusText(turtleStatus, `${state.availableTurtles} turtles / 0 crops / 0 eggs`, 'muted');
      } else if (state.availableTurtles === 0) {
        setStatusText(turtleStatus, `${plural(totalTargets, 'target')} / 0 turtles / no boost`, 'alert');
      } else {
        const nextRemaining = [
          state.plant.focusSlot?.remainingMs,
          state.plant.adjustedMsRemaining,
          state.egg.focusSlot?.remainingMs,
          state.egg.adjustedMsRemaining,
        ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0).sort((a, b) => a - b)[0] ?? null;
        const eta = nextRemaining ? ` / next ${formatDurationShort(nextRemaining)}` : '';
        setStatusText(turtleStatus, `${state.availableTurtles} turtles / ${cropTargets} crops / ${eggTargets} eggs${eta}`, 'positive');
      }
    };
    const unsub = onTurtleTimerState(render);
    addLiveCleanup(version, unsub);
  }).catch(() => {});
}

export function startCropBoostStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const cropBoostStatus = getStatusEl('crop-boosts');
  if (!cropBoostStatus) return;

  import('../../features/cropBoostTracker').then(({ startCropBoostTracker, getConfig, getCurrentAnalysis, manualRefresh, onAnalysisChange }) => {
    if (version !== getCurrentVersion()) return;
    startCropBoostTracker();
    const render = (): void => {
      const config = getConfig();
      const analysis = getCurrentAnalysis();
      if (!config.enabled) {
        setStatusText(cropBoostStatus, 'Boost tracker disabled', 'muted');
      } else if (!analysis) {
        setStatusText(cropBoostStatus, 'Scanning garden boosts', 'muted');
      } else if (analysis.totalBoostPets === 0) {
        setStatusText(cropBoostStatus, `${analysis.totalCropsNeedingBoost} crops / no boost pets`, analysis.totalCropsNeedingBoost > 0 ? 'alert' : 'muted');
      } else if (analysis.totalCropsNeedingBoost > 0) {
        const eta = analysis.overallEstimate.timeEstimateP50;
        setStatusText(cropBoostStatus, `${analysis.totalBoostPets} boosters / ${analysis.totalCropsNeedingBoost} crops / ${formatDurationShort(eta * 60_000)}`);
      } else {
        setStatusText(cropBoostStatus, `${analysis.totalBoostPets} boosters / ${analysis.totalCropsAtMax}/${analysis.totalMatureCrops} maxed`, 'positive');
      }
    };
    manualRefresh();
    render();
    const unsub = onAnalysisChange(render);
    const timer = window.setInterval(() => {
      manualRefresh();
      render();
    }, 30_000);
    addLiveCleanup(version, () => {
      unsub();
      window.clearInterval(timer);
    });
  }).catch(() => {});
}

export function startValueDisplayStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const valueStatus = getStatusEl('value-display');
  if (!valueStatus) return;

  Promise.all([
    import('../../features/storageValue'),
    import('../../store/inventory'),
  ]).then(([storageValue, inventory]) => {
    if (version !== getCurrentVersion()) return;
    storageValue.startStorageValue();
    void inventory.startInventoryStore().catch(() => {});
    const render = (): void => {
      const config = storageValue.getStorageValueConfig();
      const state = storageValue.getStorageValueState();
      const enabledCount = [config.seedSilo, config.petHutch, config.decorShed, config.inventory].filter(Boolean).length;
      if (enabledCount === 0) {
        setStatusText(valueStatus, '0/4 value surfaces / 0 coins', 'muted');
      } else if (state.status === 'ready' && state.activeModal && state.value > 0) {
        setStatusText(valueStatus, `${formatCompactNumber(state.value)} coins / ${state.activeModal}`, 'positive');
      } else {
        const items = inventory.getInventoryItems();
        const inventoryValue = storageValue.computeStorageItemsValue(items);
        setStatusText(valueStatus, `${enabledCount}/4 surfaces / ${items.length} inv / ${formatCompactNumber(inventoryValue)} coins`, inventoryValue > 0 ? 'positive' : 'normal');
      }
    };
    render();
    const offState = storageValue.onStorageValueChange(render);
    const offData = storageValue.onStorageDataChange(render);
    const offInventory = inventory.onInventoryChange(render);
    const timer = window.setInterval(render, 10_000);
    addLiveCleanup(version, () => {
      offState();
      offData();
      offInventory();
      window.clearInterval(timer);
    });
  }).catch(() => {});
}

export function startActivityLogStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const activityStatus = getStatusEl('activity-log');
  if (!activityStatus) return;

  import('../../features/activityLogNativeEnhancer').then(({ startActivityLogEnhancer, getActivityLogEnhancerStatus }) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const status = getActivityLogEnhancerStatus();
      if (!status.enabled) {
        setStatusText(activityStatus, 'Activity log disabled', 'muted');
      } else if (!status.started) {
        setStatusText(activityStatus, 'Starting event capture', 'muted');
      } else if (status.historyCount > 0) {
        const shown = status.totalFiltered > 0 ? status.totalFiltered : status.historyCount;
        setStatusText(activityStatus, `${status.historyCount} saved / ${status.replaySafeCount} replay / ${shown} shown`, 'positive');
      } else {
        setStatusText(activityStatus, '0 saved / 0 replay / watching', 'positive');
      }
    };
    void startActivityLogEnhancer().finally(render).catch(() => {});
    render();
    const timer = window.setInterval(render, 15_000);
    addLiveCleanup(version, () => window.clearInterval(timer));
  }).catch(() => {});
}

export function startProtectionStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const protectionStatus = getStatusEl('locker');
  if (!protectionStatus) return;

  Promise.all([
    import('../../features/inventoryCapacity'),
    import('../../features/locker/index'),
    import('../../store/inventory'),
  ]).then(([capacity, locker, inventory]) => {
    if (version !== getCurrentVersion()) return;
    capacity.startInventoryCapacity();
    void inventory.startInventoryStore().catch(() => {});

    const countEnabled = (flags: Record<string, boolean>): number => Object.values(flags).filter(Boolean).length;
    const render = (): void => {
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
        protectionStatus,
        `${lockText} / ${capacityText} / ${favoriteCount} fav`,
        capacityState.level === 'full' || capacityState.level === 'warning' ? 'alert' : (lockerConfig.enabled ? 'positive' : 'muted'),
      );
    };

    render();
    const offCapacity = capacity.onInventoryCapacityChange(render);
    const offInventory = inventory.onInventoryChange(render);
    const timer = window.setInterval(render, 5_000);
    addLiveCleanup(version, () => {
      offCapacity();
      offInventory();
      window.clearInterval(timer);
    });
  }).catch(() => {});
}

export function startCropCalculatorStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const calculatorStatus = getStatusEl('crop-calculator');
  if (!calculatorStatus) return;

  import('../../catalogs/gameCatalogs').then((catalogs) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
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
        setStatusText(calculatorStatus, '0 crops / 0 pets / catalogs loading', 'muted');
        return;
      }
      setStatusText(calculatorStatus, `${cropValues.length} crops / ${petValues.length} pets / ${catalogs.getAllMutations().length} mutations`, 'positive');
    };

    render();
    const offCatalogs = catalogs.onCatalogsReady(render);
    addLiveCleanup(version, offCatalogs);
  }).catch(() => {});
}

export function startControllerStatus(getStatusEl: GetStatusEl, addLiveCleanup: AddLiveCleanup, version: number): void {
  const controllerStatus = getStatusEl('controller');
  if (!controllerStatus) return;

  Promise.all([
    import('../../features/controller/index'),
    import('../../features/controller/bindings'),
  ]).then(([controller, bindings]) => {
    if (version !== getCurrentVersion()) return;
    const render = (): void => {
      const bindingCount = Object.keys(bindings.loadBindings()).length;
      const speed = bindings.loadCursorSpeed();
      if (!controller.isControllerEnabled()) {
        setStatusText(controllerStatus, `${bindingCount} binds / ${speed} / disabled`, 'muted');
        return;
      }
      const profile = controller.getRunningPoller()?.getProfile();
      if (profile) {
        setStatusText(controllerStatus, `${bindingCount} binds / ${speed} / ${truncateStatusText(profile.name, 14)}`, 'positive');
      } else {
        setStatusText(controllerStatus, `${bindingCount} binds / ${speed} / no gamepad`, 'muted');
      }
    };
    render();
    const timer = window.setInterval(render, 3_000);
    addLiveCleanup(version, () => window.clearInterval(timer));
  }).catch(() => {});
}
