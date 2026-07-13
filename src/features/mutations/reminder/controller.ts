import { onAdded } from '../../../utils/dom/dom';
import { log } from '../../../utils/logger';
import { storage } from '../../../utils/storage';
import { onWeatherSnapshot, refreshWeatherState, setWeatherOverride, startWeatherHub, WeatherSnapshot } from '../../../store/weatherHub';
import {
  publishMutationSummary,
  createEmptyMutationDebugMap,
  updateMutationDebugSnapshot,
  createMutationDebugMetadata,
  type MutationActiveWeather,
  type MutationDebugWeatherEntry,
} from '../../../store/mutationSummary';
import { INVENTORY_CONTAINER, INVENTORY_ITEM, MUTATION_CONFIG_KEY } from './constants';
import { reminderState, updateStatus } from './state';
import { deriveWeatherWindowFromSnapshot, getWeatherEmoji, mapSnapshotToWeather, weatherTypeToDetailed } from './weather';
import { scanInventoryForPlants } from './domScan';
import { filterPlantsForWeather, generatePlantId } from './evaluator';
import { buildMutationSummary } from './summary';
import { clearHighlights, highlightPlants, reapplyHighlights } from './highlights';
import { showMutationNotification, showSimpleNotification } from './notifications';
import type { MutationConfig, PlantData, WeatherType } from './types';

export function startMutationReminder(): void {
  reminderState.config = { ...reminderState.config, ...storage.get(MUTATION_CONFIG_KEY, {}) };

  log('🌱 Plant Mutation Reminder starting...');

  if (reminderState.config.enabled) {
    ensureWeatherSubscription();
    startInventoryObserver();
  }

  log('🌱 Plant Mutation Reminder started');
}

export function setMutationReminderEnabled(enabled: boolean): void {
  reminderState.config.enabled = enabled;
  saveConfig();

  if (enabled) {
    ensureWeatherSubscription();
    startInventoryObserver();
    updateStatus('Mutation reminder enabled');
  } else {
    tearDownWeatherSubscription();
    stopInventoryObserver();
    updateStatus('Mutation reminder disabled');
  }
}

export function setStatusCallback(callback: (status: string) => void): void {
  reminderState.statusUpdateCallback = callback;
}

export function getConfig(): MutationConfig {
  return { ...reminderState.config };
}

export function getCurrentWeather(): WeatherType {
  return reminderState.currentWeather;
}

/** Force a weather type for testing, bypassing normal weather detection. */
export async function simulateWeather(weather: WeatherType): Promise<void> {
  log(`🧪 [DEBUG] Simulating weather: ${weather}`);

  reminderState.isSimulatingWeather = true;
  ensureWeatherSubscription();
  const overrideKind = weatherTypeToDetailed(weather);
  if (overrideKind) {
    setWeatherOverride(overrideKind, 30000);
    refreshWeatherState();
  }

  reminderState.lastWeather = reminderState.currentWeather;
  reminderState.currentWeather = weather;

  clearHighlights();
  reminderState.currentWeatherForHighlights = 'unknown';

  updateStatus(`[DEBUG] Weather: ${getWeatherEmoji(weather)} ${weather}`);

  if (reminderState.config.enabled && weather !== 'sunny' && weather !== 'unknown') {
    await checkInventoryForMutations();
  } else {
    log('🌤️ Simulated weather is sunny or unknown - no mutations available');
    updateStatus(`[DEBUG] Weather: ${getWeatherEmoji(weather)} ${weather} (no mutations)`);
  }

  if (reminderState._simEndTimer !== null) clearTimeout(reminderState._simEndTimer);
  reminderState._simEndTimer = setTimeout(() => {
    reminderState._simEndTimer = null;
    reminderState.isSimulatingWeather = false;
    log('🧪 [DEBUG] Simulation mode ended, auto-detection resuming');
  }, 30000);
}

export async function checkForMutations(): Promise<void> {
  ensureWeatherSubscription();
  refreshWeatherState();
  // Forces an inventory check even if weather hasn't changed
  if (reminderState.config.enabled && reminderState.currentWeather !== 'sunny' && reminderState.currentWeather !== 'unknown') {
    await checkInventoryForMutations();
  } else if (reminderState.config.enabled) {
    log('🌤️ Current weather is sunny or unknown - no mutations available');
    updateStatus(`Weather: ${getWeatherEmoji(reminderState.currentWeather)} ${reminderState.currentWeather} (no mutations)`);
  }
}

export async function manualCheckMutations(): Promise<void> {
  log('🔍 Manual mutation check triggered');
  updateStatus('Checking for mutations...');
  await checkInventoryForMutations();
}

function saveConfig(): void {
  storage.set(MUTATION_CONFIG_KEY, reminderState.config);
}

/** Resets state so startInventoryObserver() can run again after disable/re-enable. */
function stopInventoryObserver(): void {
  reminderState.inventoryObserverStarted = false;
  if (reminderState._highlightTimer !== null) { clearTimeout(reminderState._highlightTimer); reminderState._highlightTimer = null; }
  if (reminderState._checkTimer !== null) { clearTimeout(reminderState._checkTimer); reminderState._checkTimer = null; }
}

/** Watches for inventory open/close to check for pending weather notifications. */
function startInventoryObserver(): void {
  if (reminderState.inventoryObserverStarted) return;
  reminderState.inventoryObserverStarted = true;

  onAdded(INVENTORY_CONTAINER, (inventoryEl) => {
    if (!reminderState.config.enabled) return;

    if (reminderState.highlightedPlantIds.size > 0) {
      log(`🔄 Inventory reopened, reapplying ${reminderState.highlightedPlantIds.size} plant highlights...`);

      if (reminderState._highlightTimer !== null) clearTimeout(reminderState._highlightTimer);
      reminderState._highlightTimer = setTimeout(() => {
        reminderState._highlightTimer = null;
        reapplyHighlights();
      }, 300);
    }

    if (reminderState.pendingWeatherNotification) {
      const { weather } = reminderState.pendingWeatherNotification;
      log(`📦 Inventory opened with pending ${weather} notification`);

      if (reminderState.config.showNotifications) {
        showSimpleNotification(
          `${getWeatherEmoji(weather)} ${weather.toUpperCase()} Weather Active`,
          'Checking your plants for mutation opportunities...',
          'info'
        );
      }

      const attemptCheck = (attempts = 0) => {
        const maxAttempts = 5;
        const delay = 300;

        const inventory = document.querySelector(INVENTORY_CONTAINER);
        if (!inventory) {
          log('⚠️ Inventory container disappeared');
          return;
        }

        const items = Array.from(inventory.querySelectorAll(INVENTORY_ITEM));
        const plantItems = items.filter(item => {
          const nameEl = item.querySelector('p.chakra-text');
          const name = nameEl?.textContent?.trim() || '';
          return name.toLowerCase().includes('plant');
        });

        if (plantItems.length > 0 || attempts >= maxAttempts) {
          reminderState._checkTimer = null;
          if (plantItems.length > 0) {
            log(`✅ Found ${plantItems.length} plant items after ${attempts * delay}ms`);
          } else {
            log(`⏰ Timeout waiting for plants after ${attempts * delay}ms`);
          }
          checkInventoryForMutations();
        } else {
          log(`⏳ No plants found yet, waiting... (attempt ${attempts + 1}/${maxAttempts})`);
          if (reminderState._checkTimer !== null) clearTimeout(reminderState._checkTimer);
          reminderState._checkTimer = setTimeout(() => attemptCheck(attempts + 1), delay);
        }
      };

      attemptCheck();
    }
  });
}

function ensureWeatherSubscription(): void {
  startWeatherHub();
  if (reminderState.weatherUnsubscribe) return;
  reminderState.weatherUnsubscribe = onWeatherSnapshot(handleWeatherSnapshot, true);
}

function tearDownWeatherSubscription(): void {
  reminderState.weatherUnsubscribe?.();
  reminderState.weatherUnsubscribe = null;
}

function handleWeatherSnapshot(snapshot: WeatherSnapshot): void {
  reminderState.latestWeatherSnapshot = snapshot;
  const nextWeather = mapSnapshotToWeather(snapshot);

  if (!reminderState.config.enabled && !reminderState.isSimulatingWeather) {
    reminderState.lastWeather = reminderState.currentWeather;
    reminderState.currentWeather = nextWeather;
    return;
  }

  if (nextWeather === reminderState.currentWeather) return;

  reminderState.lastWeather = reminderState.currentWeather;
  reminderState.currentWeather = nextWeather;

  log(`🌤️ Weather changed: ${reminderState.lastWeather} → ${reminderState.currentWeather}`);

  clearHighlights();
  reminderState.currentWeatherForHighlights = 'unknown';

  if (reminderState.currentWeather === 'sunny' || reminderState.currentWeather === 'unknown') {
    reminderState.pendingWeatherNotification = null;
    updateStatus(`Weather: ${getWeatherEmoji(reminderState.currentWeather)} ${reminderState.currentWeather} (no mutations)`);
    log('🌤️ Weather cleared - no mutations available');
  } else {
    updateStatus(`Weather: ${getWeatherEmoji(reminderState.currentWeather)} ${reminderState.currentWeather}`);
    void checkInventoryForMutations();
  }
}

async function checkInventoryForMutations(): Promise<void> {
  if (!reminderState.config.enabled) return;

  log(`🔍 Checking inventory for mutation opportunities (${reminderState.currentWeather})...`);

  const plants = await scanInventoryForPlants();
  const weatherWindow = deriveWeatherWindowFromSnapshot(reminderState.currentWeather, reminderState.latestWeatherSnapshot);
  const debugPerWeather = createEmptyMutationDebugMap();
  const collectDebug = (
    weather: MutationActiveWeather,
    plant: PlantData,
    stats: { pendingFruit: number; needsSnowFruit: number; tag?: string },
  ) => {
    const entry: MutationDebugWeatherEntry = {
      name: plant.name,
      pendingFruit: stats.pendingFruit,
      needsSnowFruit: stats.needsSnowFruit,
      fruitCount: plant.fruitCount,
      source: plant.slotSource,
    };
    if (stats.tag) {
      entry.tag = stats.tag;
    }
    debugPerWeather[weather].push(entry);
  };

  if (plants.length === 0) {
    const summary = buildMutationSummary([], reminderState.currentWeather, weatherWindow, collectDebug);
    publishMutationSummary('inventory', summary);
    updateMutationDebugSnapshot({
      source: 'inventory',
      generatedAt: summary.timestamp,
      summary,
      perWeather: debugPerWeather,
      metadata: createMutationDebugMetadata(summary, {
        scannedPlantCount: 0,
        highlightedPlantCount: 0,
        notes: 'Inventory empty',
      }),
    });
    log('📦 No plants found in inventory');

    if (reminderState.currentWeather !== 'sunny' && reminderState.currentWeather !== 'unknown') {
      reminderState.pendingWeatherNotification = { weather: reminderState.currentWeather, plantCount: 0 };
      const statusMsg = `⚠️ ${getWeatherEmoji(reminderState.currentWeather)} ${reminderState.currentWeather} weather! Open inventory (E) to check plants`;
      updateStatus(statusMsg);

      if (reminderState.config.showNotifications) {
        showSimpleNotification(
          `${getWeatherEmoji(reminderState.currentWeather)} ${reminderState.currentWeather.toUpperCase()} Weather!`,
          'Open your inventory (press E) to check which plants to place',
          'info'
        );
      }
    }
    return;
  }

  // Clear pending notification since inventory is open
  reminderState.pendingWeatherNotification = null;

  const plantsToPlace = filterPlantsForWeather(plants, reminderState.currentWeather);
  const summary = buildMutationSummary(plants, reminderState.currentWeather, weatherWindow, collectDebug);

  publishMutationSummary('inventory', summary);
  updateMutationDebugSnapshot({
    source: 'inventory',
    generatedAt: summary.timestamp,
    summary,
    perWeather: debugPerWeather,
    metadata: createMutationDebugMetadata(summary, {
      scannedPlantCount: plants.length,
      highlightedPlantCount: plantsToPlace.length,
    }),
  });

  if (plantsToPlace.length > 0) {
    log(`🌱 Found ${plantsToPlace.length} plants to place for ${reminderState.currentWeather}!`);

    if (reminderState.config.highlightPlants) {
      plantsToPlace.forEach(plant => {
        const plantId = generatePlantId(plant);
        reminderState.highlightedPlantIds.add(plantId);
      });

      highlightPlants(plantsToPlace);
      reminderState.currentWeatherForHighlights = reminderState.currentWeather;
    }

    if (reminderState.config.showNotifications) {
      showMutationNotification(plantsToPlace, reminderState.currentWeather);
    }

    updateStatus(`🌱 ${plantsToPlace.length} plants ready for ${reminderState.currentWeather}!`);
  } else {
    log(`✓ No mutation opportunities for ${reminderState.currentWeather}`);
    updateStatus(`Weather: ${getWeatherEmoji(reminderState.currentWeather)} ${reminderState.currentWeather} (no actions)`);
  }
}
