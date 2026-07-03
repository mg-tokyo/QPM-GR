// src/main.ts
import { ready, sleep, getGameHudRoot, getSharedDomObserverStats, initDomObserverDebugBridge } from './utils/dom/dom';
import { healthBus } from './diagnostics/healthBus';
import { waitForAriesDetection, getAriesDetectionInfo } from './integrations/ariesDetection';
import { log, importantLog, isVerboseLogsEnabled, setVerboseLogsEnabled } from './utils/logger';
import { yieldToBrowser } from './utils/scheduling/scheduling';
import { startMutationReminder } from './features/mutations/reminder';
import { startMutationTracker } from './features/mutations/tracker';
import { initializeHarvestReminder, configureHarvestReminder } from './features/garden/harvestReminder';
import { initializeTurtleTimer, configureTurtleTimer } from './features/pets/turtleTimer';
import { createOriginalUI, setCfg, openPublicRoomsWindow, openJournalCheckerWindow } from './ui/core/originalPanel';
import { startGardenBridge } from './features/garden/bridge';
import { initializeStatsStore, getStatsSnapshot } from './store/stats';
import { initializePetXpTracker } from './store/petXpTracker';
import { initializeXpTracker } from './store/xpTracker';
import { initializeMutationValueTracking } from './features/mutations/valueTracking';
import { initializeAutoFavorite } from './features/standalone/autoFavorite';
import { startBulkFavorite } from './features/standalone/bulkFavorite';
import { initializeFoodRules } from './features/pets/foodRules';
import { initializeGardenFilters } from './features/garden/filters';
import { getActivePetsDebug, startPetInfoStore, stopPetInfoStore } from './store/pets';
import { startInventoryStore, readInventoryDirect, getInventoryItems, stopInventoryStore } from './store/inventory';
import { startHutchStore, stopHutchStore } from './store/hutch';
import { stopWeatherHub } from './store/weatherHub';
import { destroyEconomyTracker, initEconomyTracker } from './store/economyTracker';
import { startSeedSiloStore, stopSeedSiloStore } from './store/seedSilo';
import { startSellSnapshotWatcher } from './store/sellSnapshot';
import { shareGlobal } from './core/pageContext';
import { estimatePetLevel, getPetXPHistory } from './store/petLevelCalculator';
import { feedPetInstantly, feedPetByIds, feedAllPetsInstantly, isInstantFeedAvailable } from './features/pets/instantFeed';
import { startVersionChecker, stopVersionChecker } from './utils/versionChecker';
import { startCropBoostTracker } from './features/pets/cropBoostTracker';
import { initPublicRooms } from './features/standalone/publicRooms';
// New sprite system (sprite-v2)
import {
  initSpriteSystem,
  getSpriteBootReport,
  spriteProbe,
  startSpriteV2Diagnostics,
  stopSpriteV2Diagnostics,
  reportSpriteV2InitFailed,
} from './sprite-v2/index';
import type { SpriteService } from './sprite-v2/types';
import { setSpriteService, spriteExtractor, inspectPetSprites, renderSpriteGridOverlay, renderAllSpriteSheetsOverlay, listTrackedSpriteResources, loadTrackedSpriteSheets, scheduleWarmup } from './sprite-v2/compat';
import { isSpriteLogsEnabled, printSpriteLogDump, setSpriteLogsEnabled } from './sprite-v2/diagnostics';
import { initTooltipInjection } from './features/standalone/tooltipInjection';
import { startNativeFeedIntercept, stopNativeFeedIntercept } from './features/pets/nativeFeedIntercept';
import { initializeAntiAfk, stopAntiAfk } from './features/standalone/antiAfk';
import {
  startActivityLogEnhancer,
  stopActivityLogEnhancer,
  listActivityLogEnhancerEntries,
  exportActivityLogEnhancerEntries,
  clearActivityLogEnhancerEntries,
  setActivityLogEnhancerSummaryVisible,
  getActivityLogEnhancerStatus,
  forceActivityLogEnhancerReplay,
  verifyActivityLogEnhancerEntries,
  isActivityLogEnhancerEnabled,
  setActivityLogEnhancerEnabled,
} from './features/activity/activityLogNativeEnhancer';
import { startAbilityTriggerStore, stopAbilityTriggerStore } from './store/abilityLogs';
import { initLocale } from './i18n';

import { testPetData, testComparePets, testAbilityDefinitions } from './utils/petDataTester';
import { initPetHutchWindow, togglePetHutchWindow, openPetHutchWindow, closePetHutchWindow } from './ui/pets/hutchWindow';
import { initPetTeamsStore, stopPetTeamsStore } from './store/petTeams';
import { initPetTeamsLogs, stopPetTeamsLogs } from './store/petTeamsLogs';
import { initPetsWindow, stopPetsWindow, togglePetsWindow } from './ui/pets/petsWindow';
import { toggleWindow, registerWindowOpener, restoreOpenWindows } from './ui/core/modalWindow';
import { openShopRestockWindow } from './ui/shop/restockWindow';
import { openPetOptimizerWindow } from './ui/pets/optimizerWindow';
import { openCropBoostTrackerWindow } from './ui/pets/cropBoostTrackerWindow';
import { openStatsHubWindow } from './ui/stats/statsHubWindow';
import { registerHubGroups, toggleHub, HUB_WINDOW_ID } from './ui/hub';
import { migrateHubStorage } from './ui/hub/migration';
import { getTrackersGroup } from './ui/hub/groups/trackersGroup';
import { getItemsGroup } from './ui/hub/groups/itemsGroup';
import { getGardenGroup } from './ui/hub/groups/gardenGroup';
import { getConfigGroup } from './ui/hub/groups/configGroup';
import { getToolsGroup } from './ui/hub/groups/toolsGroup';
import { registerPersistedItemRestockDetailOpeners } from './ui/shop/itemRestockDetailWindow';
import {
  getOptimizerDebugSnapshot,
  getOptimizerDebugFamily,
  getOptimizerDebugExplain,
  startPetOptimizer,
} from './features/pets/optimizer';
import { exposeAriesBridge } from './integrations/ariesBridge';
import { startNativeCardViewDiagnostics } from './integrations/nativeCardView';
import { getAtomByLabel, readAtomValue, startJotaiBridgeDiagnostics, stopJotaiBridgeDiagnostics } from './core/jotaiBridge';
import { runAtomHealthCheck, startAtomRegistryDiagnostics } from './core/atomRegistry';
import { initStateTree, startStateTreeDiagnostics } from './core/stateTree';
import { openInspectorDirect, setupGardenInspector } from './ui/standalone/publicRoomsWindow';
import { resetFriendsCache } from './services/ariesPlayers';
import { exposeValidationCommands } from './utils/validationCommands';
import { initializeStorage, storage } from './utils/storage';
import { DEBUG_GLOBALS_OPT_IN_KEY, isDebugGlobalsEnabled } from './utils/debugGlobals';
import { registerDebugBootstrap } from './debug/debugBootstrap';
import { registerUniversalProbe } from './debug/universalProbe';
import { createWsMonitor } from './debug/wsMonitor';
import { timerManager, visibleInterval } from './utils/scheduling/timerManager';
import { startController, stopController } from './features/input/controller/index';
import { startStorageValue, stopStorageValue } from './features/economy/storageValue';
import { startStorageValueOverlay, stopStorageValueOverlay } from './ui/economy/storageValueOverlay';
import { startInventoryCapacity, stopInventoryCapacity } from './features/economy/inventoryCapacity';
import { startInventoryCapacityOverlay, stopInventoryCapacityOverlay } from './ui/economy/inventoryCapacityOverlay';
import { initTextureSwapper, TEXTURE_MANIPULATOR_ENABLED } from './features/standalone/textureSwapper';
import { initCustomSkins } from './features/bloblingCustomiser/customSkins';
import { initBloblingPresets, stopBloblingPresets } from './features/bloblingCustomiser/presets/store';
import { initGardenPainterPresets, stopGardenPainterPresets } from './features/standalone/textureSwapper/presets/store';
import { initRiveEngine, initRivFetchInterceptor, initCanvasRuntimeTrap } from './rive-engine';
import { openTextureSwapperWindow } from './ui/standalone/textureSwapperWindow';
import { startShopRestockAlerts } from './ui/shop/restockAlerts';
import { fetchWeatherPredictions, startRestockDataDiagnostics, stopRestockDataDiagnostics } from './utils/restock/dataService';
import { initNotifications } from './core/notifications';
import { startDawnShopTracker, stopDawnShopTracker } from './features/dawn/shop';
import { startCapsuleTracker, stopCapsuleTracker } from './features/dawn/capsule';
import { startDawnCaptureTracker, stopDawnCaptureTracker } from './features/dawn/capture';
import { startThunderchargerTracker, stopThunderchargerTracker } from './features/thunder/charger';
import { startChargedAbilities, stopChargedAbilities } from './features/chargedAbilities';
import { initDawnEconomy, destroyDawnEconomy } from './store/dawnEconomy';
import { initGmExportBridge } from './utils/gmExportBridge';
import { stopNativeSendObserver } from './websocket/nativeSendObserver';
import { startWebsocketDiagnostics, stopWebsocketDiagnostics } from './websocket/api';
import { startMountStateTracker, stopMountStateTracker } from './store/mountState';
import { startLocker } from './features/locker/index';
import { startGardenQol } from './features/gardenQol/index';
import { startShopKeybinds, stopShopKeybinds } from './features/shop/keybinds';
import { stopPanelHotkey } from './features/input/panelHotkey';
import { startShopEnhancer, stopShopEnhancer } from './features/shop/enhancer/index';
// Data Catalog Loader
import {
  initCatalogLoader,
  logCatalogStatus,
  diagnoseCatalogs,
  getCatalogs,
  areCatalogsReady,
  waitForCatalogs,
  onCatalogsReady,
  forceWeatherCatalogRefresh,
} from './catalogs/gameCatalogs';
import { startCatalogsDiagnostics, stopCatalogsDiagnostics } from './catalogs/catalogLoader';
// Diagnostics (Phase 1 foundation — no subsystems publish yet)
import { initDiagnostics, mountDiagnosticsBadge, teardownDiagnostics } from './diagnostics/init';

declare const unsafeWindow: (Window & typeof globalThis) | undefined;
let DEBUG_GLOBALS_ENABLED = false;

// RiveEngine is started during init() and stopped in beforeunload. We hold
// the disposer at module scope because initRiveEngine() returns a one-shot
// closure rather than exposing a named stop fn the way other subsystems do.
let stopRiveEngine: (() => void) | null = null;

// Blobling custom skins — same pattern as stopRiveEngine. Installed early in
// init so the fetch interceptor catches startup cosmetic requests; torn down
// in the shutdown chain near stopRiveEngine.
let stopCustomSkins: (() => void) | null = null;

// The .riv fetch interceptor installs MUCH earlier than initRiveEngine —
// before the game's own startup fetches its avatar/currency .riv bundles.
// Tracked separately because its lifetime starts before the engine and ends
// in the same beforeunload pass.
let stopRivFetchInterceptor: (() => void) | null = null;

// The Object.prototype.runtime setter trap that catches the
// @rive-app/canvas-advanced rive instance the moment a RiveFile constructor
// runs. Must install before the game's first RiveFile creation. Auto-removes
// itself once both expected runtimes are wrapped or after a timeout.
let stopCanvasRuntimeTrap: (() => void) | null = null;

// Expose debug API globally (using shareGlobal for userscript sandbox compatibility)
const QPM_DEBUG_API = {
  setVerboseLogs: (enabled: boolean) => {
    setVerboseLogsEnabled(Boolean(enabled));
    return { verboseLogs: isVerboseLogsEnabled() };
  },
  getVerboseLogs: () => isVerboseLogsEnabled(),
  spriteLogs: (enabled?: boolean) => {
    if (typeof enabled === 'boolean') {
      setSpriteLogsEnabled(enabled);
      setVerboseLogsEnabled(enabled);
    }
    return {
      spriteLogs: isSpriteLogsEnabled(),
      verboseLogs: isVerboseLogsEnabled(),
    };
  },
  spriteLogDump: (limit?: number) => printSpriteLogDump(limit),
  activityLogList: () => listActivityLogEnhancerEntries(),
  activityLogExport: () => exportActivityLogEnhancerEntries(),
  activityLogClear: () => clearActivityLogEnhancerEntries(),
  activityLogSummary: (enabled?: boolean) => setActivityLogEnhancerSummaryVisible(enabled),
  activityLogVerify: () => verifyActivityLogEnhancerEntries(),
  optimizerSnapshot: (mode?: 'specialist' | 'slot_efficiency') => getOptimizerDebugSnapshot(mode),
  optimizerFamily: (familyKeyOrAbility: string, mode?: 'specialist' | 'slot_efficiency') =>
    getOptimizerDebugFamily(familyKeyOrAbility, mode),
  optimizerExplain: (petIdOrName: string, mode?: 'specialist' | 'slot_efficiency') =>
    getOptimizerDebugExplain(petIdOrName, mode),
  activityLogEnabled: async (enabled?: boolean) => {
    if (typeof enabled === 'boolean') {
      await setActivityLogEnhancerEnabled(enabled);
    }
    return {
      enabled: isActivityLogEnhancerEnabled(),
      status: getActivityLogEnhancerStatus(),
    };
  },
  debugPets: () => {
    const pets = getActivePetsDebug();
    console.log('=== Active Pets Debug (v2024-11-13-DOM-STRENGTH) ===');
    console.table(pets.map(p => ({
      Slot: p.slotIndex,
      Name: p.name || p.species,
      Species: p.species,
      Level: p.level,
      Strength: p.strength,
      TargetScale: p.targetScale,
      Abilities: p.abilities.join(', '),
      Hunger: p.hungerPct ? `${p.hungerPct.toFixed(1)}%` : 'N/A',
    })));
    console.log('Full normalized data:', pets);
    console.log('\n=== Raw Data Inspection ===');
    pets.forEach((p, i) => {
      console.log(`\nPet ${i} (${p.name}):`);
      console.log('Raw object:', p.raw);
      if (p.raw && typeof p.raw === 'object') {
        const raw = p.raw as Record<string, unknown>;
        console.log('Available fields:', Object.keys(raw));
        if (raw.slot && typeof raw.slot === 'object') {
          console.log('slot fields:', Object.keys(raw.slot as Record<string, unknown>));
          console.log('slot.xp:', (raw.slot as Record<string, unknown>).xp);
        }
        if (raw.pet && typeof raw.pet === 'object') {
          console.log('pet fields:', Object.keys(raw.pet as Record<string, unknown>));
        }
      }
    });
    return pets;
  },

  debugAllAtoms: () => {
    try {
      const cache = (window as any).__qpmJotaiAtomCache__;
      if (!cache || typeof cache.entries !== 'function') {
        console.error('Jotai atom cache not available');
        return null;
      }

      console.log('=== All Available Atoms ===');
      const atomList: Array<{label: string, hasValue: boolean}> = [];
      for (const [atom, meta] of cache.entries()) {
        if (meta && typeof meta === 'object' && 'debugLabel' in meta) {
          const label = (meta as any).debugLabel;
          if (typeof label === 'string') {
            atomList.push({
              label,
              hasValue: cache.has(atom)
            });
          }
        }
      }
      console.table(atomList);

      // Also check for pet-related atoms specifically
      console.log('\n=== Pet-related Atoms ===');
      const petAtoms = atomList.filter(a => a.label.toLowerCase().includes('pet'));
      console.table(petAtoms);

      return atomList;
    } catch (error) {
      console.error('Failed to list atoms:', error);
      return null;
    }
  },

  showPetSpriteGrid: (sheet = 'pets', maxTiles = 80) => renderSpriteGridOverlay(sheet, maxTiles),
  showAllSpriteSheets: (maxTilesPerSheet = 120) => renderAllSpriteSheetsOverlay(maxTilesPerSheet),
  listSpriteResources: (category: 'plants' | 'pets' | 'unknown' | 'all' = 'all') => listTrackedSpriteResources(category),
  loadTrackedSpriteSheets: (maxSheets = 8, category: 'plants' | 'pets' | 'unknown' | 'all' = 'all') => loadTrackedSpriteSheets(maxSheets, category),
  spriteBootReport: () => getSpriteBootReport(),
  spriteProbe: (keys?: Array<string | { key?: string; category?: string; id?: string; mutations?: string[] }>) => {
    const rows = spriteProbe(keys as any);
    console.table(rows.map((r) => ({
      input: r.input,
      ok: r.ok ? 'yes' : 'no',
      category: r.category,
      id: r.id,
      mutations: r.mutations.join(','),
      width: r.width,
      height: r.height,
      error: r.error ?? '',
    })));
    return rows;
  },

  // Expose sprite extractor for debugging
  spriteExtractor: spriteExtractor,
  
  // Debug function to view all sprite tiles
  viewAllSprites: () => {
    console.log('=== Exporting all sprite tiles ===');
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      top: 50px;
      right: 50px;
      background: rgba(0,0,0,0.9);
      padding: 20px;
      max-width: 800px;
      max-height: 80vh;
      overflow: auto;
      z-index: 999999;
      display: grid;
      grid-template-columns: repeat(10, 1fr);
      gap: 5px;
    `;
    
    for (let i = 0; i < 60; i++) {
      const tile = spriteExtractor.getTile('plants', i);
      if (tile) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position: relative; text-align: center;';
        
        const label = document.createElement('div');
        label.textContent = `${i}`;
        label.style.cssText = 'font-size: 10px; color: #fff; background: rgba(0,0,0,0.7); padding: 2px;';
        
        const img = new Image();
        img.src = tile.toDataURL();
        img.style.cssText = 'width: 64px; height: 64px; image-rendering: pixelated; border: 1px solid #444;';
        img.title = `Tile ${i}`;
        
        wrapper.appendChild(label);
        wrapper.appendChild(img);
        container.appendChild(wrapper);
      }
    }
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'position: sticky; top: 0; left: 0; z-index: 1; grid-column: 1 / -1;';
    closeBtn.onclick = () => container.remove();
    container.insertBefore(closeBtn, container.firstChild);
    
    document.body.appendChild(container);
    console.log('Sprite viewer opened. Click tiles to see index.');
  },

  checkTargetScale: () => {
    const pets = getActivePetsDebug();
    console.log('=== TargetScale Analysis ===');
    console.log('Checking if targetScale might be strength-related...\n');

    pets.forEach((p, i) => {
      const targetScale = p.targetScale ?? 0;
      const xp = p.xp ?? 0;

      // Try common formulas to convert targetScale to strength (0-100+ range)
      const possibleStrength1 = Math.round(targetScale * 50); // Scale up by 50
      const possibleStrength2 = Math.round((targetScale - 1) * 100); // Offset and scale
      const possibleStrength3 = Math.round(targetScale * 45 + 5); // Linear transform

      console.log(`Pet ${i}: ${p.name}`);
      console.log(`  XP: ${xp}`);
      console.log(`  TargetScale: ${targetScale.toFixed(6)}`);
      console.log(`  Possible STR (×50): ${possibleStrength1}`);
      console.log(`  Possible STR ((x-1)×100): ${possibleStrength2}`);
      console.log(`  Possible STR (×45+5): ${possibleStrength3}\n`);
    });

    return pets;
  },

  debugSlotInfos: () => {
    try {
      const cache = (window as any).__qpmJotaiAtomCache__;
      const store = (window as any).__qpmJotaiStore__;

      if (!cache || !store) {
        console.error('Jotai cache/store not available');
        return null;
      }

      console.log('=== myPetSlotInfosAtom Data ===');

      // Find the atom
      let slotInfosAtom = null;
      for (const [atom, meta] of cache.entries()) {
        if (meta && typeof meta === 'object' && 'debugLabel' in meta) {
          const label = (meta as any).debugLabel;
          if (label === 'myPetSlotInfosAtom') {
            slotInfosAtom = atom;
            break;
          }
        }
      }

      if (!slotInfosAtom) {
        console.error('myPetSlotInfosAtom not found in cache');
        return null;
      }

      // Get the value
      const value = store.get(slotInfosAtom);
      console.log('Raw value:', value);

      // Try to extract entries
      if (Array.isArray(value)) {
        console.log(`\nFound ${value.length} entries:\n`);
        value.forEach((entry, i) => {
          console.log(`Entry ${i}:`, entry);
          if (entry && typeof entry === 'object') {
            console.log(`  Fields:`, Object.keys(entry));
            if ('slot' in entry && entry.slot && typeof entry.slot === 'object') {
              console.log(`  slot fields:`, Object.keys(entry.slot));
            }
            if ('pet' in entry && entry.pet && typeof entry.pet === 'object') {
              console.log(`  pet fields:`, Object.keys(entry.pet));
            }
            if ('stats' in entry && entry.stats && typeof entry.stats === 'object') {
              console.log(`  stats fields:`, Object.keys(entry.stats));
              console.log(`  stats content:`, entry.stats);
            }
          }
        });
      }

      return value;
    } catch (error) {
      console.error('Failed to inspect myPetSlotInfosAtom:', error);
      return null;
    }
  },

  debugPetInventory: () => {
    try {
      const cache = (window as any).__qpmJotaiAtomCache__;
      const store = (window as any).__qpmJotaiStore__;

      if (!cache || !store) {
        console.error('Jotai cache/store not available');
        return null;
      }

      console.log('=== Pet Inventory & Hutch Atoms ===\n');

      const atomsToCheck = [
        'myPetInventoryAtom',
        'myPetHutchPetItemsAtom',
        'myPrimitivePetSlotsAtom',
        'petInfosAtom'
      ];

      const results: Record<string, any> = {};

      for (const atomLabel of atomsToCheck) {
        console.log(`\n--- ${atomLabel} ---`);

        // Find the atom
        let targetAtom = null;
        for (const [atom, meta] of cache.entries()) {
          if (meta && typeof meta === 'object' && 'debugLabel' in meta) {
            const label = (meta as any).debugLabel;
            if (label === atomLabel) {
              targetAtom = atom;
              break;
            }
          }
        }

        if (!targetAtom) {
          console.log(`${atomLabel} not found`);
          continue;
        }

        try {
          const value = store.get(targetAtom);
          results[atomLabel] = value;
          console.log('Value:', value);

          if (Array.isArray(value) && value.length > 0) {
            const first = value[0];
            if (first && typeof first === 'object') {
              console.log('First entry fields:', Object.keys(first));

              // Check for nested pet/stats/slot
              if ('pet' in first && first.pet && typeof first.pet === 'object') {
                console.log('  pet fields:', Object.keys(first.pet));
                console.log('  pet sample:', first.pet);
              }
              if ('stats' in first && first.stats && typeof first.stats === 'object') {
                console.log('  stats fields:', Object.keys(first.stats));
                console.log('  stats sample:', first.stats);
              }
              if ('slot' in first && first.slot && typeof first.slot === 'object') {
                console.log('  slot fields:', Object.keys(first.slot));
              }
            }
          }
        } catch (error) {
          console.error(`Error reading ${atomLabel}:`, error);
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to inspect pet atoms:', error);
      return null;
    }
  },

  searchPageWindow: () => {
    try {
      const pageWin = (window as any).unsafeWindow || window;
      console.log('=== Searching Page Window for Pet Data ===\n');

      // Check common locations
      const locations = [
        'myData',
        'myPets',
        'activePets',
        'petData',
        'pets',
        'UnifiedState',
        'gameState',
        'quinoaData'
      ];

      const found: Record<string, any> = {};

      for (const loc of locations) {
        if (loc in pageWin) {
          console.log(`\nFound: ${loc}`);
          const value = pageWin[loc];
          console.log('Type:', typeof value);

          if (value && typeof value === 'object') {
            console.log('Keys:', Object.keys(value).slice(0, 20));
            found[loc] = value;

            // Look for pet-related nested data
            if ('pets' in value) {
              console.log('  → has pets property:', value.pets);
            }
            if ('activePets' in value) {
              console.log('  → has activePets property:', value.activePets);
            }
            if ('inventory' in value && value.inventory) {
              console.log('  → has inventory property');
              const inv = value.inventory;
              if (inv && typeof inv === 'object' && 'items' in inv) {
                const items = (inv as any).items;
                if (Array.isArray(items)) {
                  console.log(`  → inventory has ${items.length} items`);
                  // Look for pets in inventory
                  const petItems = items.filter((item: any) =>
                    item && typeof item === 'object' &&
                    (item.itemType === 'Pet' || item.type === 'Pet' || 'petSpecies' in item || 'species' in item)
                  );
                  if (petItems.length > 0) {
                    console.log(`  → Found ${petItems.length} pet items in inventory`);
                    console.log('  → First pet item:', petItems[0]);
                    console.log('  → First pet fields:', Object.keys(petItems[0]));
                  }
                }
              }
            }
          }
        }
      }

      // Search all window properties for pet-related data
      console.log('\n=== Searching all window properties ===');
      const allKeys = Object.keys(pageWin).filter(k =>
        k.toLowerCase().includes('pet') ||
        k.toLowerCase().includes('animal') ||
        k.toLowerCase().includes('creature')
      );
      console.log('Pet-related keys:', allKeys);

      return found;
    } catch (error) {
      console.error('Failed to search page window:', error);
      return null;
    }
  },

  inspectPetCards: () => {
    try {
      console.log('=== Inspecting Pet Card UI Elements ===\n');

      // Look for pet cards on the left side of screen
      const petCardSelectors = [
        '[data-pet-slot]',
        '[data-pet-id]',
        '[data-slot-index]',
        '.pet-card',
        '.pet-slot',
        '[class*="pet"]',
        '[class*="Pet"]'
      ];

      const foundElements: HTMLElement[] = [];

      for (const selector of petCardSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`Found ${elements.length} elements with selector: ${selector}`);
          elements.forEach(el => {
            if (el instanceof HTMLElement && !foundElements.includes(el)) {
              foundElements.push(el);
            }
          });
        }
      }

      console.log(`\nTotal unique pet card elements found: ${foundElements.length}\n`);

      foundElements.slice(0, 10).forEach((el, idx) => {
        console.log(`\n--- Element ${idx} ---`);
        console.log('Tag:', el.tagName);
        console.log('Classes:', el.className);
        console.log('Text content:', el.textContent?.substring(0, 200));
        console.log('Data attributes:', Object.keys(el.dataset));

        // Try to extract level/strength from text
        const text = el.textContent || '';
        const levelMatch = text.match(/(?:level|lvl|lv)[:\s]*(\d+)/i);
        const strMatch = text.match(/(?:str|strength)[:\s]*(\d+)/i);
        const ageMatch = text.match(/(?:age)[:\s]*(\d+)/i);

        if (levelMatch) console.log('  → Found level:', levelMatch[1]);
        if (strMatch) console.log('  → Found strength:', strMatch[1]);
        if (ageMatch) console.log('  → Found age:', ageMatch[1]);
      });

      return foundElements;
    } catch (error) {
      console.error('Failed to inspect pet cards:', error);
      return null;
    }
  },

  findPetDataInDOM: () => {
    try {
      console.log('=== Searching DOM for Pet Level/Strength Data ===\n');

      const pets = getActivePetsDebug();
      const petNames = pets.map(p => p.name).filter(Boolean);

      console.log('Looking for pets:', petNames);

      // Search for elements containing pet names or level/strength keywords
      const allElements = document.querySelectorAll('*');
      const relevantElements: Array<{el: Element, reason: string}> = [];

      for (const el of allElements) {
        const text = el.textContent?.toLowerCase() || '';

        // Skip if too much text (likely container)
        if (text.length > 500) continue;

        // Check for pet names
        for (const name of petNames) {
          if (name && text.includes(name.toLowerCase())) {
            relevantElements.push({el, reason: `Contains pet name: ${name}`});
            break;
          }
        }

        // Check for level/age/strength keywords
        if (/\b(age|level|lvl|lv|str|strength|max str)\b/i.test(text)) {
          relevantElements.push({el, reason: 'Contains level/strength keywords'});
        }
      }

      console.log(`\nFound ${relevantElements.length} potentially relevant elements\n`);

      // Show up to 15 most relevant elements
      relevantElements.slice(0, 15).forEach(({el, reason}, idx) => {
        console.log(`\n--- Element ${idx} ---`);
        console.log('Reason:', reason);
        console.log('Tag:', el.tagName);
        console.log('Classes:', el.className);
        console.log('Text (first 300 chars):', el.textContent?.substring(0, 300));

        // Try to extract numeric values
        const text = el.textContent || '';
        const ageMatch = text.match(/age[:\s]*(\d+)/i);
        const strMatch = text.match(/(?:max\s+)?str[:\s]*(\d+)/i);
        const levelMatch = text.match(/(?:level|lvl|lv)[:\s]*(\d+)/i);

        if (ageMatch) console.log('  ✓ Age:', ageMatch[1]);
        if (strMatch) console.log('  ✓ Strength:', strMatch[1]);
        if (levelMatch) console.log('  ✓ Level:', levelMatch[1]);
      });

      return relevantElements;
    } catch (error) {
      console.error('Failed to search DOM:', error);
      return null;
    }
  },

  extractStrengthFromUI: () => {
    try {
      console.log('=== Extracting Strength from Pet Card UI ===\n');

      const pets = getActivePetsDebug();
      const results: Array<{pet: string, strength: number | null, element: Element | null}> = [];

      // Search for elements containing "STR XX" pattern
      const allElements = Array.from(document.querySelectorAll('*'));

      for (const pet of pets) {
        const petName = pet.name || pet.species || `Pet ${pet.slotIndex}`;
        let foundStrength: number | null = null;
        let foundElement: Element | null = null;

        // Look for elements with text matching "STR \d+"
        for (const el of allElements) {
          const text = el.textContent || '';

          // Skip containers with too much text
          if (text.length > 100) continue;

          // Look for "STR XX" pattern
          const strMatch = text.match(/\bSTR\s+(\d+)\b/i);
          if (strMatch && strMatch[1]) {
            const strength = parseInt(strMatch[1], 10);

            // Check if this element is near the pet's position/slot
            // For now, just collect all STR values and log them
            console.log(`Found STR ${strength} in element:`, el);
            console.log('  Tag:', el.tagName);
            console.log('  Classes:', el.className);
            console.log('  Text:', text.trim());
            console.log('  Parent:', el.parentElement?.className);

            // Try to match by order (first STR found = first pet, etc)
            if (!foundStrength) {
              foundStrength = strength;
              foundElement = el;
            }
          }
        }

        results.push({
          pet: petName,
          strength: foundStrength,
          element: foundElement
        });
      }

      console.log('\n=== Extracted Strength Values ===');
      console.table(results.map(r => ({
        Pet: r.pet,
        Strength: r.strength ?? 'Not found'
      })));

      return results;
    } catch (error) {
      console.error('Failed to extract strength from UI:', error);
      return null;
    }
  },

  debugLevels: () => {
    try {
      console.log('=== Pet Level Calculation Debug ===\n');

      const pets = getActivePetsDebug();

      pets.forEach((pet, idx) => {
        console.log(`\n--- Pet ${idx}: ${pet.name} (${pet.species}) ---`);
        console.log(`XP: ${pet.xp ?? 'N/A'}`);
        console.log(`Strength: ${pet.strength ?? 'N/A'}`);
        console.log(`Level (Jotai): ${pet.level ?? 'null'}`);

        if (pet.petId) {
          const history = getPetXPHistory(pet.petId);
          console.log(`XP History: ${history.length} samples`);

          if (history.length >= 2) {
            const first = history[0]!;
            const last = history[history.length - 1]!;
            const xpGained = last.xp - first.xp;
            const timeElapsed = (last.timestamp - first.timestamp) / 1000;
            const xpRate = xpGained / timeElapsed;

            console.log(`  First sample: ${first.xp} XP at ${new Date(first.timestamp).toLocaleTimeString()}`);
            console.log(`  Last sample: ${last.xp} XP at ${new Date(last.timestamp).toLocaleTimeString()}`);
            console.log(`  XP gained: ${xpGained.toFixed(0)} over ${timeElapsed.toFixed(0)}s`);
            console.log(`  XP rate: ${xpRate.toFixed(2)} XP/sec`);
          }

          const levelEstimate = estimatePetLevel(pet);
          console.log(`\nLevel Estimate:`);
          console.log(`  Current Level: ${levelEstimate.currentLevel ?? 'N/A'} / ${levelEstimate.maxLevel}`);
          console.log(`  Confidence: ${levelEstimate.confidence}`);
          console.log(`  Total XP Needed: ${levelEstimate.totalXPNeeded?.toFixed(0) ?? 'N/A'}`);
          console.log(`  XP Rate: ${levelEstimate.xpGainRate?.toFixed(2) ?? 'N/A'} XP/sec`);

          if (levelEstimate.totalXPNeeded && pet.xp) {
            const progress = (pet.xp / levelEstimate.totalXPNeeded) * 100;
            console.log(`  Progress: ${progress.toFixed(1)}%`);
          }
        }
      });

      return pets;
    } catch (error) {
      console.error('Failed to debug levels:', error);
      return null;
    }
  },

  // Instant Feed Functions (WebSocket-based)
  feedPet: async (petIndex: number) => {
    console.log(`🍖 Feeding pet at index ${petIndex}...`);
    const result = await feedPetInstantly(petIndex);
    if (result.success) {
      console.log(`✅ Successfully fed ${result.petName || result.petSpecies} with ${result.foodSpecies}`);
    } else {
      console.error(`❌ Failed to feed pet: ${result.error}`);
    }
    return result;
  },

  feedPetByIds: async (petId: string, cropId: string) => {
    console.log(`🍖 Feeding pet ${petId} with crop ${cropId}...`);
    const result = await feedPetByIds(petId, cropId);
    if (result.success) {
      console.log(`✅ Successfully fed pet`);
    } else {
      console.error(`❌ Failed to feed pet: ${result.error}`);
    }
    return result;
  },

  feedAllPets: async (hungerThreshold = 40) => {
    console.log(`🍖 Feeding all pets below ${hungerThreshold}% hunger...`);
    const results = await feedAllPetsInstantly(hungerThreshold);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`✅ Fed ${successful} pets, ${failed} failed`);
    return results;
  },

  isInstantFeedAvailable: () => {
    const available = isInstantFeedAvailable();
    console.log(available ? '✅ Instant feed is available' : '❌ Instant feed is NOT available (RoomConnection missing)');
    return available;
  },

  debugInventory: async () => {
    try {
      const { getAtomByLabel, readAtomValue } = await import('./core/jotaiBridge');

      console.log('=== Inventory Debug ===\n');

      // Try userSlotsAtom first
      const userSlotsAtom = getAtomByLabel('userSlotsAtom');
      if (userSlotsAtom) {
        const inventory = await readAtomValue(userSlotsAtom);
        console.log('userSlotsAtom inventory:', inventory);

        const plantItems = Array.isArray(inventory) ? inventory.filter((item: any) =>
          item.itemType === 'Plant' ||
          (item.slots && item.slots.length > 0)
        ) : [];
        console.log(`\nFound ${plantItems?.length || 0} plant items:`);
        console.table(plantItems?.map((item: any, i: number) => ({
          Index: i,
          Species: item.species || 'N/A',
          Name: item.name || 'N/A',
          ItemType: item.itemType,
          HasSlots: !!(item.slots && item.slots.length > 0),
          NumSlots: item.slots?.length || 0,
          Keys: Object.keys(item).join(', ')
        })));

        // Show first plant in detail
        if (plantItems && plantItems.length > 0) {
          console.log('\n=== First Plant Item (Full Structure) ===');
          console.log(plantItems[0]);
          if (plantItems[0].slots) {
            console.log('\n=== Slots Detail ===');
            console.log(plantItems[0].slots);
          }
        }

        return { userSlots: inventory, plantItems };
      }

      console.error('❌ userSlotsAtom not found');
      return null;
    } catch (error) {
      console.error('Failed to debug inventory:', error);
      return null;
    }
  },

  // === PET DATA TESTER (for Comparison Hub development) ===
  testPetData: testPetData,
  testComparePets: testComparePets,
  testAbilityDefinitions: testAbilityDefinitions,

  // === ARIES MOD INTEGRATION DEBUG ===
  debugAriesIntegration: () => {
    console.log('=== Aries Mod Integration Debug ===\n');

    // Check different global locations
    const checks = [
      { name: 'window.PetsService', value: (window as any).PetsService },
      { name: 'window.QWS', value: (window as any).QWS },
      { name: 'window.QWS?.PetsService', value: (window as any).QWS?.PetsService },
      { name: 'unsafeWindow.PetsService', value: (typeof unsafeWindow !== 'undefined' ? (unsafeWindow as any).PetsService : undefined) },
      { name: 'unsafeWindow.QWS', value: (typeof unsafeWindow !== 'undefined' ? (unsafeWindow as any).QWS : undefined) },
    ];

    console.log('Checking for PetsService in various locations:\n');
    checks.forEach(check => {
      if (check.value !== undefined) {
        console.log(`✅ ${check.name}:`, check.value);
        if (check.value && typeof check.value === 'object') {
          console.log(`   Properties:`, Object.keys(check.value));
          if (typeof check.value.getTeams === 'function') {
            try {
              const teams = check.value.getTeams();
              console.log(`   Teams (${Array.isArray(teams) ? teams.length : 'N/A'}):`, teams);
            } catch (e) {
              console.log(`   Error calling getTeams():`, e);
            }
          }
        }
      } else {
        console.log(`❌ ${check.name}: Not found`);
      }
    });

    console.log('\n=== Instructions ===');
    console.log('If PetsService is not detected:');
    console.log('1. Make sure Aries mod is installed and running');
    console.log('2. Check that both scripts are loaded (QPM and Aries)');
    console.log('3. Try reloading the page');
    console.log('4. Check console for "[Aries]" prefixed logs from QPM');
    console.log('\nIf you see PetsService but it\'s not working:');
    console.log('• Open Pet Hub (QPM menu) and go to "3v3 Compare" tab');
    console.log('• Click the "🔄 Refresh" button in the Aries section');
    console.log('• Check console for detection logs');
  },

  // Debug helpers (inventory + seeds + rainbow + Pet Hub)
  debugInventoryAtoms: async (labels: string[] = ['myInventoryAtom', 'myCropInventoryAtom', 'seedInventoryAtom']) => {
    const cache = (window as any).__qpmJotaiAtomCache__;
    const store = (window as any).__qpmJotaiStore__;
    console.log('Atom cache present:', !!cache, 'Store present:', !!store);
    const found: Array<{ label: string; hasValue: boolean }> = [];
    labels.forEach((label) => {
      const atom = getAtomByLabel(label);
      if (atom) {
        const hasValue = !!cache?.has?.(atom);
        found.push({ label, hasValue });
      }
    });
    console.table(found);

    for (const label of labels) {
      const atom = getAtomByLabel(label);
      if (!atom) continue;
      try {
        const value = await readAtomValue<any>(atom);
        console.log(`Value for ${label}:`, value);
      } catch (error) {
        console.error(`Failed reading ${label}`, error);
      }
    }
    return found;
  },

  scanSeeds: async () => {
    const direct = await readInventoryDirect();
    const cached = getInventoryItems();

    const pickQty = (item: any): number | null => {
      const raw = item?.raw ?? {};
      const candidates: Array<unknown> = [
        item.quantity,
        item.count,
        item.amount,
        item.stackSize,
        item.qty,
        item.owned,
        item.quantityOwned,
        raw.quantity,
        raw.count,
        raw.amount,
        raw.stackSize,
        raw.qty,
        raw.owned,
        raw.quantityOwned,
      ];
      for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return null;
    };

    const isSeed = (item: any): boolean => {
      const raw = item?.raw ?? {};
      const textFields: Array<unknown> = [
        item.itemType,
        item.name,
        item.displayName,
        item.id,
        item.species,
        raw.itemType,
        raw.type,
        raw.category,
        raw.subType,
        raw.itemCategory,
        raw.itemSubType,
        raw.kind,
      ];
      if (textFields.some((f) => `${f ?? ''}`.toLowerCase().includes('seed'))) return true;
      const tagFields: Array<unknown> = [raw.tags, raw.tagList, raw.itemTags, raw.labels];
      for (const t of tagFields) {
        if (Array.isArray(t) && t.some((v) => `${v ?? ''}`.toLowerCase().includes('seed'))) return true;
      }
      return raw.isSeed === true;
    };

    const scan = (items: any[]) => {
      const seeds = [] as Array<{ id: string; qty: number; name?: string | null }>;
      let max = 0;
      for (const item of items) {
        if (!isSeed(item)) continue;
        const qty = pickQty(item);
        if (!Number.isFinite(qty) || (qty as number) <= 0) continue;
        const id = String(item.id ?? item.itemId ?? item.species ?? item.name ?? 'unknown');
        seeds.push({ id, qty: qty as number, name: item.displayName ?? item.name ?? null });
        max = Math.max(max, qty as number);
      }
      seeds.sort((a, b) => b.qty - a.qty);
      return { max, seeds };
    };

    const directScan = scan(direct?.items ?? []);
    const cachedScan = scan(cached);

    console.log('Seed scan (direct atom read): max', directScan.max, directScan.seeds.slice(0, 10));
    console.log('Seed scan (cached store): max', cachedScan.max, cachedScan.seeds.slice(0, 10));
    return { directScan, cachedScan };
  },

  auditRainbowPets: async () => {
    const readPetAtom = async (label: string): Promise<any[] | null> => {
      const atom = getAtomByLabel(label);
      if (!atom) return null;
      try {
        const value = await readAtomValue<any>(atom);
        if (Array.isArray(value)) return value;
        if (value && Array.isArray((value as any).items)) return (value as any).items;
      } catch (error) {
        console.error(`Failed to read ${label}`, error);
      }
      return null;
    };

    const petAtoms = ['myPetInventoryAtom', 'myPetHutchPetItemsAtom'];
    const results: Record<string, any[]> = {};

    const isRainbow = (item: any) => {
      const raw = item?.raw ?? {};
      const textFields: Array<unknown> = [
        item.rarity,
        item.petRarity,
        item.rarityName,
        item.quality,
        item.variant,
        item.mutation,
        item.name,
        item.petVariant,
        raw.rarity,
        raw.petRarity,
        raw.rarityName,
        raw.quality,
        raw.variant,
        raw.mutation,
        raw.name,
      ];
      if (textFields.some((f) => `${f ?? ''}`.toLowerCase().includes('rainbow'))) return true;
      return item.isRainbow === true || raw.isRainbow === true;
    };

    for (const label of petAtoms) {
      const items = await readPetAtom(label);
      if (!items) continue;
      const hits = [] as Array<{ id: string; targetScale?: number | null; fields: unknown[] }>;
      items.forEach((it: any, idx: number) => {
        const raw = it?.raw ?? {};
        if (isRainbow(it)) {
          hits.push({
            id: String(it.id ?? it.itemId ?? `idx-${idx}`),
            targetScale: Number(it.targetScale ?? raw.targetScale ?? null) || null,
            fields: [it.rarity, it.petRarity, it.rarityName, it.quality, it.variant, it.mutation, it.name, it.petVariant, raw.rarity, raw.petRarity, raw.rarityName, raw.quality, raw.variant, raw.mutation, raw.name],
          });
        }
      });
      results[label] = hits;
      console.log(`Rainbow hits for ${label}:`, hits);
    }
    return results;
  },

  openPetHub3v3: async () => {
    try {
      // Prefer clicking the existing Pet Hub button so the window opens in the normal QPM chrome
      const btn = document.querySelector('button[data-window-id="pet-hub"]') as HTMLButtonElement | null;
      if (btn) {
        btn.click();
        setTimeout(() => {
          const tab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('3v3 Compare')) as HTMLButtonElement | undefined;
          tab?.click();
        }, 300);
        return true;
      }

      // Fallback: open via toggleWindow so it still mounts inside the QPM window system
      const render = (root: HTMLElement) => import('./ui/pets/hubWindow').then(({ renderPetHubWindow }) => renderPetHubWindow(root));
      toggleWindow('pet-hub', '🐾 Pet Hub', render, '1600px', '92vh');
      setTimeout(() => {
        const tab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('3v3 Compare')) as HTMLButtonElement | undefined;
        tab?.click();
      }, 400);
      return true;
    } catch (error) {
      console.error('Failed to open Pet Hub 3v3', error);
      return false;
    }
  },
  resetTutorials: async () => {
    const { resetAllTours } = await import('./ui/tour');
    resetAllTours();
    console.log('All tour progress reset. Reload to see tours again.');
  },

  showTour: async (windowId?: string) => {
    const { checkTour } = await import('./ui/tour');
    const target = document.querySelector('.qpm-panel') as HTMLElement | null;
    if (target) {
      checkTour(windowId ?? 'welcome', target);
    }
  },

  // Pet Teams debug helpers
  togglePetsWindow,
  getPetTeams: async () => {
    const { getTeamsConfig } = await import('./store/petTeams');
    return getTeamsConfig();
  },
  applyPetTeam: async (teamId: string) => {
    const { applyTeam } = await import('./store/petTeams');
    return applyTeam(teamId);
  },
  getPetPool: async () => {
    const { getAllPooledPets } = await import('./store/petTeams');
    return getAllPooledPets();
  },
};

const QPM_ACTIVITY_LOG_API = {
  list: () => listActivityLogEnhancerEntries(),
  export: () => exportActivityLogEnhancerEntries(),
  clear: () => clearActivityLogEnhancerEntries(),
  summary: (enabled?: boolean) => setActivityLogEnhancerSummaryVisible(enabled),
  verify: () => verifyActivityLogEnhancerEntries(),
  status: () => getActivityLogEnhancerStatus(),
  replay: () => forceActivityLogEnhancerReplay(),
  enabled: async (enabled?: boolean) => {
    if (typeof enabled === 'boolean') {
      await setActivityLogEnhancerEnabled(enabled);
    }
    return isActivityLogEnhancerEnabled();
  },
};

function initializeGlobalApis(): void {
  try {
    shareGlobal('QPM_ACTIVITY_LOG', QPM_ACTIVITY_LOG_API);
    (window as any).QPM_ACTIVITY_LOG = QPM_ACTIVITY_LOG_API;
  } catch (error) {
    log('[Main] Failed to expose QPM_ACTIVITY_LOG API', error);
  }

  if (DEBUG_GLOBALS_ENABLED) {
    registerInspectFriendHelper();
    registerInspectPlayerHelper();
  }

  if (DEBUG_GLOBALS_ENABLED) {
    shareGlobal('QPM', QPM_DEBUG_API);
    shareGlobal('QPM_DEBUG_API', QPM_DEBUG_API);
    const globalDebugTarget = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    (globalDebugTarget as any).QPM_DEBUG_API = QPM_DEBUG_API;
    (globalDebugTarget as any).QPM = QPM_DEBUG_API;
    log('QPM debug API registered');
  } else {
    log(`[Main] Debug globals disabled. Set ${DEBUG_GLOBALS_OPT_IN_KEY}=true to enable.`);
  }
}

// Simple console helper to force inspector self playerId for friend-level testing
function registerInspectFriendHelper(): void {
  const fn = (playerId: string): void => {
    const pid = (playerId || '').trim();
    if (!pid) {
      console.warn('[QPM Inspector] Provide a playerId string.');
      return;
    }
    try {
      storage.set('quinoa:selfPlayerId', pid);
      resetFriendsCache();
      console.log('[QPM Inspector] self playerId set to', pid, 'friend cache cleared.');
    } catch (err) {
      console.warn('[QPM Inspector] Unable to persist self playerId', err);
    }
  };

  if (!(window as any).QPM_INSPECT_FRIEND) {
    (window as any).QPM_INSPECT_FRIEND = fn;
  }

  try {
    shareGlobal('QPM_INSPECT_FRIEND', fn);
  } catch (err) {
    console.warn('[QPM Inspector] Failed to share helper globally', err);
  }
}

function registerInspectPlayerHelper(): void {
  const fn = (playerId: string, playerName?: string): void => {
    const pid = (playerId || '').trim();
    if (!pid) {
      console.warn('[PublicRooms] Provide a playerId string.');
      return;
    }
    openInspectorDirect(pid, playerName || pid);
  };

  if (!(window as any).QPM_INSPECT_PLAYER) {
    (window as any).QPM_INSPECT_PLAYER = fn;
  }

  try {
    shareGlobal('QPM_INSPECT_PLAYER', fn);
  } catch (err) {
    console.warn('[PublicRooms] Failed to share QPM_INSPECT_PLAYER globally', err);
  }
}
// Load configuration similar to original
const LS_KEY = 'quinoa-pet-manager';
const defaultCfg = {
  enabled: false,
  threshold: 40,
  pollMs: 3000,
  clickCooldownMs: 4000,
  retryDelaySeconds: 15,
  logs: true,
  ui: {
    preventScrollClicks: true,
  },
  inventoryLocker: {
    syncMode: true,
  },
  mutationReminder: {
    enabled: true,
    showNotifications: true,
    highlightPlants: true,
  },
  harvestReminder: {
    enabled: false,
    highlightEnabled: true,
    toastEnabled: true,
    minSize: 80,
    selectedMutations: {
      Rainbow: true,
      Gold: false,
      Frozen: false,
      Wet: false,
      Chilled: false,
      Dawnlit: false,
      Amberlit: false,
      Amberbound: false,
      Dawnbound: false,
    },
  },
  turtleTimer: {
    enabled: true,
    includeBoardwalk: false,
    minActiveHungerPct: 2,
    fallbackTargetScale: 1.5,
    focus: 'latest' as const,
  },
};

type QpmConfig = typeof defaultCfg;

function loadCfg(): Partial<QpmConfig> {
  return storage.get<Partial<QpmConfig>>(LS_KEY, {});
}

function buildCfg(): QpmConfig {
  const loadedCfg = loadCfg();
  return {
    ...defaultCfg,
    ...loadedCfg,
    ui: { ...defaultCfg.ui, ...(loadedCfg.ui || {}) },
    inventoryLocker: { ...defaultCfg.inventoryLocker, ...(loadedCfg.inventoryLocker || {}) },
    mutationReminder: { ...defaultCfg.mutationReminder, ...(loadedCfg.mutationReminder || {}) },
    harvestReminder: {
      ...defaultCfg.harvestReminder,
      ...(loadedCfg.harvestReminder || {}),
      selectedMutations: {
        ...defaultCfg.harvestReminder.selectedMutations,
        ...(loadedCfg.harvestReminder?.selectedMutations || {}),
      },
    },
    turtleTimer: {
      ...defaultCfg.turtleTimer,
      ...(loadedCfg.turtleTimer || {}),
    },
  };
}

// Global error filter to silence noisy external proxy errors
const _errorHandler = (event: ErrorEvent): boolean => {
  try {
    const message = String(event?.message || '');
    if (message.includes("Failed to execute 'contains' on 'Node'")) {
      event.stopImmediatePropagation?.();
      event.preventDefault?.();
      return false;
    }
  } catch {}
  return true;
};
window.addEventListener('error', _errorHandler, true);
window.addEventListener('beforeunload', () => {
  window.removeEventListener('error', _errorHandler, true);
  stopController();
  stopShopKeybinds();
  stopShopEnhancer();
  stopPanelHotkey();
  // stopAutoReconnect() — auto reconnect disabled
  stopAntiAfk();
  stopActivityLogEnhancer();
  stopAbilityTriggerStore();
  timerManager.destroy();
  stopNativeFeedIntercept();
  stopPetTeamsStore();
  stopPetTeamsLogs();
  stopPetsWindow();
  stopInventoryCapacityOverlay();
  stopInventoryCapacity();
  stopStorageValueOverlay();
  stopStorageValue();
  stopSeedSiloStore();
  stopDawnShopTracker();
  stopCapsuleTracker();
  stopChargedAbilities();
  stopDawnCaptureTracker();
  stopThunderchargerTracker();
  destroyDawnEconomy();
  stopMountStateTracker();
  stopPetInfoStore();
  stopInventoryStore();
  stopHutchStore();
  stopWeatherHub();
  destroyEconomyTracker();
  stopNativeSendObserver();
  stopWebsocketDiagnostics();
  stopCatalogsDiagnostics();
  stopJotaiBridgeDiagnostics();
  stopSpriteV2Diagnostics();
  stopRestockDataDiagnostics();
  stopVersionChecker();
  try { stopRiveEngine?.(); } catch { /* best effort */ }
  stopRiveEngine = null;
  // Custom skins interceptor tears down before the rive fetch interceptor
  // since it installed AFTER it (LIFO chain — spec §2.4).
  try { stopCustomSkins?.(); } catch { /* best effort */ }
  stopCustomSkins = null;
  try { stopBloblingPresets(); } catch { /* best effort */ }
  try { stopGardenPainterPresets(); } catch { /* best effort */ }
  try { stopRivFetchInterceptor?.(); } catch { /* best effort */ }
  stopRivFetchInterceptor = null;
  try { stopCanvasRuntimeTrap?.(); } catch { /* best effort */ }
  stopCanvasRuntimeTrap = null;
  teardownDiagnostics();
}, { once: true });

async function waitForGame(): Promise<void> {
  log('Waiting for game to load...');
  
  // Wait for body
  await ready;
  await sleep(100);
  
  // Wait for QuinoaUI (SPA-ready indicator)
  const maxWait = 30000;
  const interval = 500;
  const deadline = Date.now() + maxWait;
  
  while (Date.now() < deadline) {
    const hudRoot = getGameHudRoot();
    if (hudRoot) {
      const hudContent = hudRoot.querySelector('canvas, button, [data-tm-main-interface], [data-tm-hud-root], [data-tm-player-id]');
      if (hudContent) {
        log('Game UI detected');
        return;
      }
    }

    const anyCanvas = document.querySelector('#App canvas');
    if (anyCanvas) {
      log('Game UI detected');
      return;
    }

    await sleep(interval);
  }
  
  log('Game UI not detected within timeout, proceeding anyway');
}

async function initialize(): Promise<void> {
  importantLog('Quinoa Pet Manager initializing...');

  // Install the canvas-runtime trap FIRST. It must be in place before the
  // game's first RiveFile constructor runs (otherwise we miss the only
  // assignment that ever exposes the canvas-advanced runtime instance).
  // The trap auto-removes once both expected rive runtimes are wrapped.
  try {
    stopCanvasRuntimeTrap = initCanvasRuntimeTrap();
  } catch (error) {
    log('[Main] canvas-runtime trap install failed (non-fatal)', error);
  }

  // Install the .riv fetch hook next — must be in place before the game's
  // initial bundle loads run, otherwise we miss every .riv request and
  // setAssetInterceptor can't reverse-resolve bytes back to a URL.
  // initRivFetchInterceptor is idempotent and has no init dependencies.
  try {
    stopRivFetchInterceptor = initRivFetchInterceptor();
  } catch (error) {
    log('[Main] .riv fetch interceptor install failed (non-fatal)', error);
  }

  registerDebugBootstrap();
  DEBUG_GLOBALS_ENABLED = isDebugGlobalsEnabled();
  initializeGlobalApis();

  // Diagnostics layer (Phase 1 foundation). Must be up before any subsystem
  // could call into the health bus or named-logger pipeline.
  initDiagnostics();
  initNotifications();
  startWebsocketDiagnostics();
  startAtomRegistryDiagnostics();
  startStateTreeDiagnostics();
  startCatalogsDiagnostics();
  startJotaiBridgeDiagnostics();
  startSpriteV2Diagnostics();
  startRestockDataDiagnostics();

  const cfg = buildCfg();

  // Initialize catalog loader (hooks Object.* methods to capture game data)
  // MUST be called early, before game code runs
  initCatalogLoader();
  log('[Main] Catalog loader initialized');

  // RiveEngine — start it as soon as the catalog loader is running so the
  // load wrapper has a chance to install before the game's first
  // rive.load() call. Catalog loader is what populates the Jotai bridge's
  // cached store; once that's running we can poll for lowLevelRiveAtom.
  // Phase 8 (the old call site) is far too late — the game has already
  // loaded all .riv bundles into its shared cache by then, and no future
  // pet-card open will trigger a fresh rive.load(). Errors are non-fatal.
  try {
    stopRiveEngine = initRiveEngine();
  } catch (error) {
    log('[Main] RiveEngine init failed (non-fatal)', error);
  }

  // Blobling custom skins — fetch interceptor must install before the game
  // requests cosmetic PNGs at startup (otherwise the per-session decoded-image
  // cache in setAvatarImage.ts locks in vanilla bytes for the rest of the
  // session). See spec 2026-06-26-blobling-custom-skins-design.md Phase 0
  // and §2.4. Errors are non-fatal — the feature is purely visual.
  try {
    stopCustomSkins = initCustomSkins();
  } catch (error) {
    log('[Main] customSkins init failed (non-fatal)', error);
  }

  void initBloblingPresets().catch((error) => {
    log('[Main] bloblingPresets init failed (non-fatal)', error);
  });
  void initGardenPainterPresets().catch((error) => {
    log('[Main] gardenPainterPresets init failed (non-fatal)', error);
  });
  // Auto reconnect disabled — no longer permitted by the game.
  // Force-disable for existing users who had it enabled.
  storage.set('qpm.autoReconnect.enabled.v1', false);

  // Log when catalogs become ready (for timing analysis)
  onCatalogsReady(() => {
    const timeMs = performance.now();
    log(`[Catalog] Catalogs ready at ${(timeMs / 1000).toFixed(1)}s after page load`);
    if (isVerboseLogsEnabled()) {
      logCatalogStatus();
    }
  });

  // Initialize sprite system (sprite-v2) - must be done early to hook PIXI
  // OPTIMIZATION: Don't block other initialization on sprite loading
  let spriteService: SpriteService | null = null;
  const spriteInit = initSpriteSystem().then((service) => {
    spriteService = service;
    setSpriteService(service);
    if (DEBUG_GLOBALS_ENABLED) {
      shareGlobal('Sprites', service);
    }
    log('Sprite system v2 initialized');
    
    // Export sprite inspector after sprites are ready
    if (DEBUG_GLOBALS_ENABLED && typeof window !== 'undefined') {
      const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      (targetWindow as any).inspectPetSprites = inspectPetSprites;
      log('inspectPetSprites() available in console');
    }
  }).catch((err) => {
    reportSpriteV2InitFailed(err);
  });

  // Wait for game to be ready (parallel with sprite init)
  await waitForGame();

  // Kick off Aries co-existence detection — resolves in the background via the
  // shared DOM observer. Timeout well before startShopEnhancer() runs in Phase 8,
  // so isAriesInstalled() is authoritative by then. See ariesDetection.ts and
  // features/shop/enhancer for the gate that consumes this.
  void waitForAriesDetection(3000).then((detected) => {
    const info = getAriesDetectionInfo();
    log(`[Main] Aries detection resolved: detected=${detected} via=${info.detectedVia ?? 'n/a'}`);
  });

  // Install the __QPM_DOM_OBSERVER__ debug bridge for console-driven inspection
  // of the shared-observer stats (predicates, mutationsRate, coalesceRatio).
  initDomObserverDebugBridge();

  // Register the domObserver subsystem + sample every 2s. Thresholds match
  // design doc §4: mutationsRate>300/s or lastFlushMs>5ms → degraded.
  healthBus.register('domObserver', {
    category: 'core',
    status: 'starting',
    message: 'Awaiting first sample',
  });
  visibleInterval('qpm-dom-observer-sample', () => {
    const stats = getSharedDomObserverStats();
    const degraded = stats.mutationsRate > 300 || stats.lastFlushMs > 5;
    healthBus.publish({
      subsystem: 'domObserver',
      category: 'core',
      status: degraded ? 'degraded' : 'ok',
      message: degraded
        ? `Elevated: ${stats.mutationsRate}/s, flush=${stats.lastFlushMs}ms`
        : `${stats.mutationsRate}/s`,
      metrics: {
        predicates: stats.predicates,
        mutationsRate: stats.mutationsRate,
        flushRate: stats.flushRate,
        coalesceRatio: stats.coalesceRatio,
        lastFlushMs: stats.lastFlushMs,
      },
    });
  }, 2000);

  // Atom registry health check — diagnostic only, non-blocking
  try { runAtomHealthCheck(); } catch (e) { log('Atom health check failed', e); }

  // State-tree init: subscribe once to stateAtom so shop/weather/userSlots
  // reads and hutch subscribe through a memoizing fan-out. Non-fatal — if this
  // fails, atomRegistry reads fall through to the legacy label/atom paths.
  await initStateTree().catch((error) => {
    log('State tree init failed (non-fatal)', error);
  });

  await initializeAntiAfk().catch((error) => {
    log('Anti-AFK initialization failed', error);
  });
  await startInventoryStore().catch((error) => {
    log('Inventory store pre-init failed', error);
  });
  await startHutchStore().catch((error) => {
    log('Hutch store pre-init failed', error);
  });
  await startSeedSiloStore().catch((error) => {
    log('Seed silo store pre-init failed', error);
  });
  await startPetInfoStore().catch((error) => {
    log('Pet info store pre-init failed', error);
  });
  await startAbilityTriggerStore().catch((error) => {
    log('Ability trigger store pre-init failed', error);
  });
  if (isActivityLogEnhancerEnabled()) {
    await startActivityLogEnhancer().catch((error) => {
      log('Activity Log enhancer initialization failed', error);
    });
  } else {
    log('[Main] Activity Log enhancer disabled by config');
  }
  // OPTIMIZATION: Initialize core stores in batches with yields to prevent main thread blocking
  // Phase 1: Critical stores that other features depend on
  initializeStatsStore();
  initializePetXpTracker();
  const { startFriendBonusStore } = await import('./store/friendBonus');
  startFriendBonusStore();
  await yieldToBrowser(); // Let browser paint

  // Phase 2: XP tracking and inventory
  initializeXpTracker();
  initializeMutationValueTracking();
  const { initHatchStatsStore } = await import('./store/hatchStatsStore');
  initHatchStatsStore();
  initEconomyTracker().catch((error) => {
    log('Economy tracker init failed', error);
  });
  await yieldToBrowser();
  const { startPetHatchingTracker } = await import('./store/petHatchingTracker');
  await startPetHatchingTracker().catch((error) => {
    log('Pet hatching tracker start failed', error);
  });
  await yieldToBrowser();

  // Phase 3: Auto-favorite and bulk operations
  initializeAutoFavorite();
  startBulkFavorite();
  initializeFoodRules();
  await startSellSnapshotWatcher();
  await yieldToBrowser();

  // Phase 3b: Pet Teams (needs inventory + pet stores ready)
  initPetTeamsLogs();
  initPetTeamsStore();
  await yieldToBrowser();

  // Phase 4: Garden bridge (needed for reminders)
  await startGardenBridge();
  await yieldToBrowser();

  // Phase 4b: Initialize garden filters (needs PIXI and game loaded)
  initializeGardenFilters();
  await yieldToBrowser();

  // Phase 5: Initialize harvest and turtle timer
  initializeHarvestReminder({
    enabled: cfg.harvestReminder.enabled,
    highlightEnabled: cfg.harvestReminder.highlightEnabled,
    toastEnabled: cfg.harvestReminder.toastEnabled,
    minSize: cfg.harvestReminder.minSize,
    selectedMutations: cfg.harvestReminder.selectedMutations,
  });
  initializeTurtleTimer(cfg.turtleTimer);
  await yieldToBrowser();

  // Phase 6: Mutation tracking
  startMutationReminder();
  startMutationTracker();
  await yieldToBrowser();

  // Phase 7: Configure features
  configureHarvestReminder({
    enabled: cfg.harvestReminder.enabled,
    highlightEnabled: cfg.harvestReminder.highlightEnabled,
    toastEnabled: cfg.harvestReminder.toastEnabled,
    minSize: cfg.harvestReminder.minSize,
    selectedMutations: cfg.harvestReminder.selectedMutations,
  });
  configureTurtleTimer(cfg.turtleTimer);
  await yieldToBrowser();

  // Phase 7b: nativeSendObserver starts on-demand via first onNativeSend() call
  startMountStateTracker();

  // Phase 7c: Action guard
  startLocker();
  startGardenQol();
  await yieldToBrowser();

  // Phase 8: Non-critical features (can load after UI is visible)
  startCropBoostTracker();
  startPetOptimizer();
  initTooltipInjection();
  startNativeFeedIntercept();
  startController();
  startShopKeybinds();
  startShopEnhancer();
  startStorageValue();
  startStorageValueOverlay();
  startInventoryCapacity();
  startInventoryCapacityOverlay();
  // RiveEngine: started above, right after initCatalogLoader, to race
  // ahead of the game's first rive.load(). Texture swapper depends on the
  // engine being initialized — it is, by this phase.
  if (TEXTURE_MANIPULATOR_ENABLED) {
    initTextureSwapper();
    // Expose the gating diagnostic command for catalog↔journal comparison.
    void import('./ui/standalone/textureSwapperWindow/gatingDiagnostic').then(m => m.exposeGatingDiagnosticGlobal());
  }
  await yieldToBrowser();

  // Phase 8b: Stats recorder (subscribes to myDataAtom activity log → stats.ts)
  const { startStatsRecorder } = await import('./store/statsRecorder');
  startStatsRecorder();
  await yieldToBrowser();

  // Phase 9: Expose Aries bridge + register native card view diagnostics
  exposeAriesBridge();
  startNativeCardViewDiagnostics();
  await yieldToBrowser();

  // Phase 10: Public rooms and garden inspector
  initPublicRooms();
  if (DEBUG_GLOBALS_ENABLED) {
    const gardenCommands = setupGardenInspector();
    shareGlobal('QPM_INSPECT_GARDEN', gardenCommands.QPM_INSPECT_GARDEN);
    shareGlobal('QPM_EXPOSE_GARDEN', gardenCommands.QPM_EXPOSE_GARDEN);
    shareGlobal('QPM_CURRENT_TILE', gardenCommands.QPM_CURRENT_TILE);
    (QPM_DEBUG_API as any).inspectGarden = gardenCommands.QPM_INSPECT_GARDEN;
    (QPM_DEBUG_API as any).exposeGarden = gardenCommands.QPM_EXPOSE_GARDEN;
    (QPM_DEBUG_API as any).currentTile = gardenCommands.QPM_CURRENT_TILE;
  }

  // Expose shop stock for debugging
  const { getShopStockState } = await import('./store/shopStock');
  (QPM_DEBUG_API as any).shopStock = getShopStockState;

  // Expose stats + hatch stats for debugging
  (QPM_DEBUG_API as any).stats = getStatsSnapshot;
  const { getHatchStatsSnapshot, resetHatchStats } = await import('./store/hatchStatsStore');
  (QPM_DEBUG_API as any).hatchStats = getHatchStatsSnapshot;
  (QPM_DEBUG_API as any).resetHatchStats = resetHatchStats;
  const { resetStats } = await import('./store/stats');
  (QPM_DEBUG_API as any).resetStats = resetStats;
  const { getStatsRecorderStatus } = await import('./store/statsRecorder');
  (QPM_DEBUG_API as any).statsRecorder = { status: getStatsRecorderStatus };

  // Expose jotai debug namespace (lazy — loads full debug API on first method call)
  const jotaiNs: Record<string, unknown> = {};
  for (const method of ['listAtoms', 'readAtom', 'shopStock', 'captureInfo'] as const) {
    Object.defineProperty(jotaiNs, method, {
      get() {
        return async (...args: unknown[]) => {
          const { getDebugApi } = await import('./debug/debugApi');
          const api = await getDebugApi();
          const fn = (api.jotai as Record<string, unknown>)[method];
          return typeof fn === 'function' ? (fn as Function)(...args) : fn;
        };
      },
      configurable: true,
      enumerable: true,
    });
  }
  (QPM_DEBUG_API as any).jotai = jotaiNs;

  // Expose atoms debug namespace (lazy — loads full debug API on first method call)
  const atomsNs: Record<string, unknown> = {};
  for (const method of ['discover', 'health', 'read', 'list', 'status'] as const) {
    Object.defineProperty(atomsNs, method, {
      get() {
        return async (...args: unknown[]) => {
          const { getDebugApi } = await import('./debug/debugApi');
          const api = await getDebugApi();
          const fn = (api.atoms as Record<string, unknown>)[method];
          return typeof fn === 'function' ? (fn as Function)(...args) : fn;
        };
      },
      configurable: true,
      enumerable: true,
    });
  }
  (QPM_DEBUG_API as any).atoms = atomsNs;

  // Expose catalog functions to global debug API
  (QPM_DEBUG_API as any).getCatalogs = getCatalogs;
  (QPM_DEBUG_API as any).areCatalogsReady = areCatalogsReady;
  (QPM_DEBUG_API as any).waitForCatalogs = waitForCatalogs;
  (QPM_DEBUG_API as any).logCatalogStatus = logCatalogStatus;
  (QPM_DEBUG_API as any).diagnoseCatalogs = diagnoseCatalogs;
  (QPM_DEBUG_API as any).forceWeatherCatalogRefresh = forceWeatherCatalogRefresh;

  // Expose flora blueprint + stitcher diagnostics
  const { diagnoseFloraBlueprints, testStitch, testStitchAll } = await import('./sprite-v2/stitcher');
  (QPM_DEBUG_API as any).floraBlueprint = diagnoseFloraBlueprints;
  (QPM_DEBUG_API as any).testStitch = testStitch;
  (QPM_DEBUG_API as any).testStitchAll = testStitchAll;

  // Expose garden snapshot for debugging
  const { getGardenSnapshot, getMapSnapshot, isGardenBridgeReady } = await import('./features/garden/bridge');
  (QPM_DEBUG_API as any).getGardenSnapshot = getGardenSnapshot;
  (QPM_DEBUG_API as any).getMapSnapshot = getMapSnapshot;
  (QPM_DEBUG_API as any).isGardenBridgeReady = isGardenBridgeReady;

  // Also expose to __QPM_INTERNAL__ for legacy/diagnostic access
  const { getGardenFiltersConfig, updateGardenFiltersConfig, applyGardenFiltersNow } = await import('./features/garden/filters');
  const globalTarget = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  (globalTarget as any).__QPM_INTERNAL__ = {
    ...(globalTarget as any).__QPM_INTERNAL__,
    getGardenSnapshot,
    getMapSnapshot,
    isGardenBridgeReady,
    getGardenFiltersConfig,
    updateGardenFiltersConfig,
    applyGardenFiltersNow,
  };


  // Also expose to window for easy console access
  if (DEBUG_GLOBALS_ENABLED && typeof window !== 'undefined') {
    (window as any).__QPM_DiagnoseCatalogs = diagnoseCatalogs;
    log('__QPM_DiagnoseCatalogs() available in console');
  }

  // Expose validation commands for testing
  if (DEBUG_GLOBALS_ENABLED) {
    registerUniversalProbe(QPM_DEBUG_API as Record<string, unknown>);
    (QPM_DEBUG_API as Record<string, unknown>).ws = createWsMonitor();
    shareGlobal('QPM_DEBUG_API', QPM_DEBUG_API);
    shareGlobal('QPM', QPM_DEBUG_API);
    exposeValidationCommands();
  }

  // Set configuration for UI
  setCfg(cfg);

  // Initialise locale detection before any UI renders
  try {
    initLocale();
  } catch (err) {
    console.error('[QPM][i18n] initLocale failed (non-fatal, defaulting to English):', err);
  }

  // OPTIMIZATION: Wait for sprite system ONLY before creating UI
  // This allows other features to initialize while sprites load in background
  await spriteInit;

  // Create UI (needs sprites to be ready)
  await createOriginalUI();

  // Mount the Diagnostics titlebar badge once the panel DOM exists.
  // Invisible-when-ok, so no visual change during a healthy boot.
  mountDiagnosticsBadge();
  // Keep alerts non-blocking: never let this feature break core UI bootstrap.
  try {
    startShopRestockAlerts();
  } catch (error) {
    console.error('[QPM][ShopRestockAlerts] failed to start (non-fatal):', error);
  }

  // Phase 11 — Dawn features (weather-gated shop, capsule tracker, capture cooldowns)
  try {
    startDawnShopTracker();
    startCapsuleTracker();
    startDawnCaptureTracker();
    startThunderchargerTracker();
    initDawnEconomy();
  } catch (error) {
    console.error('[QPM][Dawn] Dawn features failed to start (non-fatal):', error);
  }

  // Phase 11a — Charged Abilities (depends on pets store, garden bridge,
  // sprites, mount state, and the Thunder + Dawn trackers above).
  try {
    startChargedAbilities();
  } catch (error) {
    console.error('[QPM][ChargedAbilities] failed to start (non-fatal):', error);
  }

  // Phase 11b — Weather predictions (lightweight, non-blocking)
  await yieldToBrowser();
  fetchWeatherPredictions().catch((error) => {
    log('[Main] Weather predictions fetch failed (non-fatal)', error);
  });
  visibleInterval('weather-predictions-poll', () => {
    fetchWeatherPredictions().catch(() => { /* silent retry */ });
  }, 5 * 60 * 1000);

  initPetsWindow();

  // Register window openers and restore previously open windows
  registerWindowOpener('public-rooms', openPublicRoomsWindow);
  registerWindowOpener('journal-checker-window', openJournalCheckerWindow);
  registerWindowOpener('qpm-pets-window', togglePetsWindow);
  registerWindowOpener('shop-restock', openShopRestockWindow);
  registerWindowOpener('pet-optimizer', openPetOptimizerWindow);
  registerWindowOpener('crop-boost-tracker', openCropBoostTrackerWindow);
  registerWindowOpener(HUB_WINDOW_ID, toggleHub);
  registerWindowOpener('stats-hub', openStatsHubWindow);
  registerWindowOpener('calculator', () => import('./ui/economy/cropCalculatorWindow').then(({ openCalculatorWindow }) => openCalculatorWindow()));
  if (TEXTURE_MANIPULATOR_ENABLED) {
    registerWindowOpener('texture-swapper', openTextureSwapperWindow);
  }
  registerWindowOpener('pet-hub', () => {
    const render = (root: HTMLElement) => import('./ui/pets/hubWindow').then(({ renderPetHubWindow }) => renderPetHubWindow(root));
    toggleWindow('pet-hub', '🐾 Pet Hub', render, '1600px', '92vh');
  });

  // Migrate old hub storage and register unified hub groups
  migrateHubStorage();
  registerHubGroups([
    getTrackersGroup(),
    getItemsGroup(),
    getGardenGroup(),
    getConfigGroup(),
    getToolsGroup(),
  ]);

  registerPersistedItemRestockDetailOpeners();

  // Initialize tour system BEFORE restoring windows so that tour definitions
  // are registered when restored windows call checkTour.
  const { initTourSystem, checkTour } = await import('./ui/tour');
  await initTourSystem();

  restoreOpenWindows();

  // Start version checker (checks for updates periodically)
  startVersionChecker();

  // Check welcome tour after UI settles (same timing as old tutorialPopup)
  setTimeout(() => {
    const panel = document.querySelector('.qpm-panel') as HTMLElement | null;
    if (panel) {
      checkTour('welcome', panel);
    }
  }, 1500);

  importantLog('Quinoa Pet Manager initialized successfully');

  // Schedule sprite cache warmup during idle time (Aries Mod pattern)
  // Delays 2 seconds, then pre-renders sprites in background batches
  scheduleWarmup(2000);
}

async function bootstrap(): Promise<void> {
  await initializeStorage();
  initGmExportBridge();
  await initialize();
}

bootstrap().catch(error => {
  console.error('[QuinoaPetMgr] Initialization failed:', error);
});
