// src/features/mutationReminder.ts - Plant Mutation Reminder System
import { $, $$, onAdded, isVisible } from '../../utils/dom/dom';
import { log } from '../../utils/logger';
import { storage } from '../../utils/storage';
import { onWeatherSnapshot, refreshWeatherState, setWeatherOverride, startWeatherHub, WeatherSnapshot } from '../../store/weatherHub';
import {
  publishMutationSummary,
  createEmptyMutationDebugMap,
  updateMutationDebugSnapshot,
  createMutationDebugMetadata,
  type MutationActiveWeather,
  type MutationDebugWeatherEntry,
  type MutationSummary,
  type MutationWeatherSummary,
  type MutationWeatherWindow,
} from '../../store/mutationSummary';
import { DetailedWeather } from '../../utils/game/weatherDetection';
import { ensureJotaiStore, getAtomByLabel, readAtomValue } from '../../core/jotaiBridge';
import { readUserSlotsInventorySnapshot } from '../../store/userSlots';

export interface MutationConfig {
  enabled: boolean;
  showNotifications: boolean;
  highlightPlants: boolean;
}

export type MutationLetter = 'F' | 'W' | 'C' | 'D' | 'A' | 'R' | 'G';

interface MutationBadge {
  letter: MutationLetter;
  isBold: boolean;
}

const MUTATION_LETTERS: MutationLetter[] = ['F', 'W', 'C', 'D', 'A', 'R', 'G'];
const DEBUG_MUTATION_DECISIONS = false;

export type MutationStage = 'wet' | 'dawn' | 'amber';

export interface MutationStageProgress {
  complete: number;
  total: number;
}

export interface PlantSlotState {
  letters: MutationLetter[];
  hasFrozen: boolean;
  hasWet: boolean;
  hasChilled: boolean;
  hasDawnlit: boolean;
  hasAmberlit: boolean;
  hasDawnbound: boolean;
  hasAmberbound: boolean;
  hasRainbow: boolean;
  hasGold: boolean;
  progress: Partial<Record<MutationStage, MutationStageProgress>>;
  /** Any mutation names from the game catalog not matched by the known set above */
  unknownMutations: string[];
}

export interface PlantData {
  name: string;
  mutations: string; // e.g., "FC", "W", "DA", "", includes combined letters from all slots
  element: Element;
  fruitCount: number; // For multi-harvest plants (e.g., +9 means 9 fruits)
  slotStates: PlantSlotState[];
  slotSource: 'inventory' | 'fallback' | 'garden';
  domMutationCounts: Record<MutationLetter, number>;
  domBoldCounts: Record<'D' | 'A', number>;
}

export type WeatherType = 'rain' | 'snow' | 'dawn' | 'amber' | 'thunderstorm' | 'sunny' | 'unknown';

const MUTATION_CONFIG_KEY = 'quinoa-mutation-reminder-config';
const INVENTORY_CONTAINER = '.McFlex.css-zo8r2v'; // NEW - Graphics engine 2025-12-13
const INVENTORY_ITEM = 'div.css-79elbk'; // NEW - Graphics engine 2025-12-13
const CROP_INVENTORY_ATOM_LABEL = 'myCropInventoryAtom';

let config: MutationConfig = {
  enabled: true,
  showNotifications: true,
  highlightPlants: true,
};

let statusUpdateCallback: ((status: string) => void) | null = null;
let currentWeather: WeatherType = 'unknown';
let lastWeather: WeatherType = 'unknown';
let weatherUnsubscribe: (() => void) | null = null;
let latestWeatherSnapshot: WeatherSnapshot | null = null;
let pendingWeatherNotification: { weather: WeatherType; plantCount: number } | null = null;
let isSimulatingWeather = false; // Flag to prevent auto-detection from overriding simulated weather
let currentWeatherForHighlights: WeatherType = 'unknown'; // Track which weather the current highlights are for
let highlightedPlantIds: Set<string> = new Set(); // Track which plants are currently highlighted (by ID)
let inventoryObserverStarted = false;
let _simEndTimer: ReturnType<typeof setTimeout> | null = null;
let _highlightTimer: ReturnType<typeof setTimeout> | null = null;
let _checkTimer: ReturnType<typeof setTimeout> | null = null;
let inventoryAccessFailureLogged = false;
let inventoryLookupStatsLogged = false;
let inventoryDebugSamples = 0;
let sharedAtomsFailureLogged = false;
const SLOT_MUTATION_DEBUG_LIMIT = 5;
let slotMutationDebugSamples = 0;

interface PlantMutationEvaluation {
  decision: boolean;
  pendingFruits: number;
  totalFruits: number;
  needsSnow: number;
  detail: PlantDebugDetail;
}

const MUTATION_WEATHERS: MutationActiveWeather[] = ['rain', 'snow', 'dawn', 'amber'];

interface GlobalInventoryResult {
  items: any[];
  source: string;
  hasSlotData: boolean;
}

interface InventoryPlantEntry {
  baseIndex: number;
  id: string | null;
  slotStates: PlantSlotState[];
  raw: unknown;
  name: string | null;
  normalizedName: string | null;
  used: boolean;
}

interface InventoryLookups {
  byIndex: Map<number, InventoryPlantEntry>;
  byId: Map<string, InventoryPlantEntry>;
  byName: Map<string, InventoryPlantEntry[]>;
}

type PlantDebugDetail =
  | ({ strategy: 'inventory'; totalFruits: number; wetPending: number; wetFinished: number; wetNeedsSnow: number; wetProgressComplete: number; wetProgressTotal: number; domWetProgress: number; domWetNeedsSnow: number; dawnPending: number; dawnProgressComplete: number; dawnProgressTotal: number; domDawnComplete: number; amberPending: number; amberProgressComplete: number; amberProgressTotal: number; domAmberComplete: number; hasAnyDawn: boolean; hasAnyAmber: boolean; hasAnyRainbow: boolean; hasAnyGold: boolean })
  | ({ strategy: 'fallback'; fruitCount: number; frozenCount: number; wetCount: number; chilledCount: number; dawnCount: number; amberCount: number; dawnBoundCount: number; amberBoundCount: number; rainbowCount: number; goldCount: number });

function normalizePlantName(name: string): string {
  let normalized = name.toLowerCase().replace(/\+\d+$/, '').trim();
  // Remove " plant" suffix for matching (e.g., "lily plant" -> "lily")
  // This ensures "Lily" from DOM matches "Lily Plant" from inventory
  if (normalized.endsWith(' plant')) {
    normalized = normalized.slice(0, -6).trim();
  }
  return normalized;
}

export function startMutationReminder(): void {
  config = { ...config, ...storage.get(MUTATION_CONFIG_KEY, {}) };
  
  log('🌱 Plant Mutation Reminder starting...');
  
  if (config.enabled) {
    ensureWeatherSubscription();
    startInventoryObserver();
  }
  
  log('🌱 Plant Mutation Reminder started');
}

export function setMutationReminderEnabled(enabled: boolean): void {
  config.enabled = enabled;
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
  statusUpdateCallback = callback;
}

export function getConfig(): MutationConfig {
  return { ...config };
}

export function getCurrentWeather(): WeatherType {
  return currentWeather;
}

/**
 * Simulate a weather change for testing/debugging
 * This bypasses the weather detection and forces a weather type
 */
export async function simulateWeather(weather: WeatherType): Promise<void> {
  log(`🧪 [DEBUG] Simulating weather: ${weather}`);
  
  // Set flag to prevent auto-detection from reverting the simulation
  isSimulatingWeather = true;
  ensureWeatherSubscription();
  const overrideKind = weatherTypeToDetailed(weather);
  if (overrideKind) {
    setWeatherOverride(overrideKind, 30000);
    refreshWeatherState();
  }
  
  lastWeather = currentWeather;
  currentWeather = weather;
  
  // Clear highlights from previous weather
  clearHighlights();
  currentWeatherForHighlights = 'unknown';
  
  updateStatus(`[DEBUG] Weather: ${getWeatherEmoji(weather)} ${weather}`);
  
  // Trigger mutation check with the simulated weather
  if (config.enabled && weather !== 'sunny' && weather !== 'unknown') {
    await checkInventoryForMutations();
  } else {
    log('🌤️ Simulated weather is sunny or unknown - no mutations available');
    updateStatus(`[DEBUG] Weather: ${getWeatherEmoji(weather)} ${weather} (no mutations)`);
  }
  
  // Clear the simulation flag after a delay to allow testing
  if (_simEndTimer !== null) clearTimeout(_simEndTimer);
  _simEndTimer = setTimeout(() => {
    _simEndTimer = null;
    isSimulatingWeather = false;
    log('🧪 [DEBUG] Simulation mode ended, auto-detection resuming');
  }, 30000); // 30 seconds to test
}

export async function checkForMutations(): Promise<void> {
  ensureWeatherSubscription();
  refreshWeatherState();
  // Force an inventory check regardless of weather change
  if (config.enabled && currentWeather !== 'sunny' && currentWeather !== 'unknown') {
    await checkInventoryForMutations();
  } else if (config.enabled) {
    log('🌤️ Current weather is sunny or unknown - no mutations available');
    updateStatus(`Weather: ${getWeatherEmoji(currentWeather)} ${currentWeather} (no mutations)`);
  }
}

function saveConfig(): void {
  storage.set(MUTATION_CONFIG_KEY, config);
}

function updateStatus(status: string): void {
  if (statusUpdateCallback) {
    statusUpdateCallback(status);
  }
}

/**
 * Reset inventory observer state so startInventoryObserver() can run again after disable/re-enable
 */
function stopInventoryObserver(): void {
  inventoryObserverStarted = false;
  if (_highlightTimer !== null) { clearTimeout(_highlightTimer); _highlightTimer = null; }
  if (_checkTimer !== null) { clearTimeout(_checkTimer); _checkTimer = null; }
}

/**
 * Watch for inventory opening/closing to check for pending notifications
 */
function startInventoryObserver(): void {
  if (inventoryObserverStarted) return;
  inventoryObserverStarted = true;

  onAdded(INVENTORY_CONTAINER, (inventoryEl) => {
    if (!config.enabled) return;
    
    // Always reapply highlights if we have tracked plants
    if (highlightedPlantIds.size > 0) {
      log(`🔄 Inventory reopened, reapplying ${highlightedPlantIds.size} plant highlights...`);

      // Wait for plant items to render, then reapply highlights
      if (_highlightTimer !== null) clearTimeout(_highlightTimer);
      _highlightTimer = setTimeout(() => {
        _highlightTimer = null;
        reapplyHighlights();
      }, 300);
    }
    
    // Check for pending weather notification
    if (pendingWeatherNotification) {
      const { weather } = pendingWeatherNotification;
      log(`📦 Inventory opened with pending ${weather} notification`);
      
      // Show reminder that there was a weather change
      if (config.showNotifications) {
        showSimpleNotification(
          `${getWeatherEmoji(weather)} ${weather.toUpperCase()} Weather Active`,
          'Checking your plants for mutation opportunities...',
          'info'
        );
      }
      
      // Wait for plant items to fully render before scanning
      // Use longer delay and check for plant elements
      const attemptCheck = (attempts = 0) => {
        const maxAttempts = 5;
        const delay = 300;
        
        // Try to find plant items
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
          _checkTimer = null;
          if (plantItems.length > 0) {
            log(`✅ Found ${plantItems.length} plant items after ${attempts * delay}ms`);
          } else {
            log(`⏰ Timeout waiting for plants after ${attempts * delay}ms`);
          }
          checkInventoryForMutations();
        } else {
          log(`⏳ No plants found yet, waiting... (attempt ${attempts + 1}/${maxAttempts})`);
          if (_checkTimer !== null) clearTimeout(_checkTimer);
          _checkTimer = setTimeout(() => attemptCheck(attempts + 1), delay);
        }
      };
      
      attemptCheck();
    }
  });
}

/**
 * Check current weather and trigger notifications if weather changed
 */
function ensureWeatherSubscription(): void {
  startWeatherHub();
  if (weatherUnsubscribe) return;
  weatherUnsubscribe = onWeatherSnapshot(handleWeatherSnapshot, true);
}

function tearDownWeatherSubscription(): void {
  weatherUnsubscribe?.();
  weatherUnsubscribe = null;
}

function handleWeatherSnapshot(snapshot: WeatherSnapshot): void {
  latestWeatherSnapshot = snapshot;
  const nextWeather = mapSnapshotToWeather(snapshot);

  if (!config.enabled && !isSimulatingWeather) {
    lastWeather = currentWeather;
    currentWeather = nextWeather;
    return;
  }

  if (nextWeather === currentWeather) return;

  lastWeather = currentWeather;
  currentWeather = nextWeather;

  log(`🌤️ Weather changed: ${lastWeather} → ${currentWeather}`);
  
  clearHighlights();
  currentWeatherForHighlights = 'unknown';

  if (currentWeather === 'sunny' || currentWeather === 'unknown') {
    // Weather cleared - clear any pending notifications and update status
    pendingWeatherNotification = null;
    updateStatus(`Weather: ${getWeatherEmoji(currentWeather)} ${currentWeather} (no mutations)`);
    log('🌤️ Weather cleared - no mutations available');
  } else {
    // Active weather - check for mutations
    updateStatus(`Weather: ${getWeatherEmoji(currentWeather)} ${currentWeather}`);
    void checkInventoryForMutations();
  }
}

function mapSnapshotToWeather(snapshot: WeatherSnapshot): WeatherType {
  switch (snapshot.kind) {
    case 'rain':
      return 'rain';
    case 'snow':
      return 'snow';
    case 'dawn':
      return 'dawn';
    case 'amber':
      return 'amber';
    case 'sunny':
      return 'sunny';
    default:
      return snapshot.raw === 'weather' ? 'rain' : 'sunny';
  }
}

export function resolveWeatherDurationMs(weather: WeatherType): number | null {
  switch (weather) {
    case 'rain':
    case 'snow':
      return 5 * 60 * 1000;
    case 'dawn':
    case 'amber':
      return 10 * 60 * 1000;
    default:
      return null;
  }
}

export function deriveWeatherWindowFromSnapshot(
  weather: WeatherType,
  snapshot: WeatherSnapshot | null,
): MutationWeatherWindow | null {
  if (weather === 'sunny' || weather === 'unknown') {
    return null;
  }

  const durationMs = resolveWeatherDurationMs(weather);
  const startedAt = snapshot?.startedAt ?? snapshot?.timestamp ?? null;

  const expectedEndAt = snapshot?.expectedEndAt
    ?? (startedAt != null && durationMs != null ? startedAt + durationMs : null)
    ?? (durationMs != null ? Date.now() + durationMs : null);

  const remainingMs = expectedEndAt != null ? Math.max(0, expectedEndAt - Date.now()) : null;
  const normalizedDuration = expectedEndAt != null && startedAt != null
    ? Math.max(0, expectedEndAt - startedAt)
    : durationMs;

  return {
    weather,
    startedAt,
    expectedEndAt,
    durationMs: normalizedDuration,
    remainingMs,
  };
}

function weatherTypeToDetailed(weather: WeatherType): DetailedWeather | null {
  switch (weather) {
    case 'rain':
      return 'rain';
    case 'snow':
      return 'snow';
    case 'dawn':
      return 'dawn';
    case 'amber':
      return 'amber';
    case 'thunderstorm':
      return 'thunderstorm';
    case 'sunny':
      return 'sunny';
    default:
      return null;
  }
}

/**
 * Check inventory for plants that should be placed based on current weather
 */
async function checkInventoryForMutations(): Promise<void> {
  if (!config.enabled) return;
  
  log(`🔍 Checking inventory for mutation opportunities (${currentWeather})...`);
  
  const plants = await scanInventoryForPlants();
  const weatherWindow = deriveWeatherWindowFromSnapshot(currentWeather, latestWeatherSnapshot);
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
    const summary = buildMutationSummary([], currentWeather, weatherWindow, collectDebug);
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
    
    // Store pending notification and show immediate visual notification
    if (currentWeather !== 'sunny' && currentWeather !== 'unknown') {
      pendingWeatherNotification = { weather: currentWeather, plantCount: 0 };
      const statusMsg = `⚠️ ${getWeatherEmoji(currentWeather)} ${currentWeather} weather! Open inventory (E) to check plants`;
      updateStatus(statusMsg);
      
      // Show visual notification immediately
      if (config.showNotifications) {
        showSimpleNotification(
          `${getWeatherEmoji(currentWeather)} ${currentWeather.toUpperCase()} Weather!`,
          'Open your inventory (press E) to check which plants to place',
          'info'
        );
      }
    }
    return;
  }
  
  // Clear pending notification since inventory is open
  pendingWeatherNotification = null;
  
  const plantsToPlace = filterPlantsForWeather(plants, currentWeather);
  const summary = buildMutationSummary(plants, currentWeather, weatherWindow, collectDebug);

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
    log(`🌱 Found ${plantsToPlace.length} plants to place for ${currentWeather}!`);
    
    if (config.highlightPlants) {
      // Add plant IDs to tracking set
      plantsToPlace.forEach(plant => {
        const plantId = generatePlantId(plant);
        highlightedPlantIds.add(plantId);
      });
      
      highlightPlants(plantsToPlace);
      currentWeatherForHighlights = currentWeather; // Track which weather these highlights are for
    }
    
    if (config.showNotifications) {
      showMutationNotification(plantsToPlace, currentWeather);
    }
    
    updateStatus(`🌱 ${plantsToPlace.length} plants ready for ${currentWeather}!`);
  } else {
    log(`✓ No mutation opportunities for ${currentWeather}`);
    updateStatus(`Weather: ${getWeatherEmoji(currentWeather)} ${currentWeather} (no actions)`);
  }
}

/**
 * Generate a unique ID for a plant based on its properties
 */
function generatePlantId(plant: PlantData): string {
  const slotSignature = buildSlotSignature(plant.slotStates);
  return `${plant.name}|${plant.mutations}|${plant.fruitCount}|${slotSignature}`;
}

function buildSlotSignature(slotStates: PlantSlotState[]): string {
  if (!slotStates.length) {
    return 'no-slots';
  }

  return slotStates
    .map((slot) => {
      const letters = slot.letters.join('');
      const boundFlags = `${slot.hasDawnbound ? 'd' : ''}${slot.hasAmberbound ? 'a' : ''}`;
      const base = letters || '_';
      return boundFlags ? `${base}+${boundFlags}` : base;
    })
    .join(',');
}

function debugPlantDecision(plant: PlantData, weather: WeatherType, decision: boolean, detail: PlantDebugDetail): void {
  if (!DEBUG_MUTATION_DECISIONS) return;

  const slotSummary = plant.slotStates.map((slot, index) => ({
    index,
    letters: slot.letters.join(''),
    wet: slot.hasWet,
    frozen: slot.hasFrozen,
    chilled: slot.hasChilled,
    dawn: slot.hasDawnlit,
    amber: slot.hasAmberlit,
    dawnbound: slot.hasDawnbound,
    amberbound: slot.hasAmberbound,
    rainbow: slot.hasRainbow,
    gold: slot.hasGold,
    progress: slot.progress,
  }));

  log(
    `[Mutations] ${decision ? '✅ highlight' : '⏭️ skip'} ${plant.name} for ${weather}`,
    {
      slotSource: plant.slotSource,
      fruitCount: plant.fruitCount,
      domCounts: plant.domMutationCounts,
      domBold: plant.domBoldCounts,
      slotSummary,
      detail,
    }
  );
}

/**
 * Scan inventory for plant items
 */
async function scanInventoryForPlants(): Promise<PlantData[]> {
  const inventory = $(INVENTORY_CONTAINER);
  if (!inventory || !isVisible(inventory)) {
    log('❌ Inventory not open');
    updateStatus('⚠️ Please open your inventory (press E)');
    return [];
  }
  
  const items = Array.from(inventory.querySelectorAll(INVENTORY_ITEM));
  const inventoryLookups = await buildInventoryLookups();
  const plants: PlantData[] = [];
  
  items.forEach((item, index) => {
    const plantData = extractPlantData(item, inventoryLookups, index);
    if (plantData) {
      plants.push(plantData);
    }
  });
  
  log(`📦 Scanned ${plants.length} plants from inventory`);
  return plants;
}

/**
 * Extract plant data from inventory item
 */
function extractPlantData(
  element: Element,
  inventoryLookups: InventoryLookups | null,
  fallbackIndex: number
): PlantData | null {
  try {
    // Get plant name
    const nameSelectors = [
      'p.chakra-text.css-8xfasz',
      '.McFlex.css-1gd1uup p.chakra-text',
      'p.chakra-text.css-rbbzu5',
      'p.chakra-text',
    ];
    
    const candidates: string[] = [];
    let name = '';
    for (const selector of nameSelectors) {
      const elements = Array.from(element.querySelectorAll(selector));
      for (const nameEl of elements) {
        const text = nameEl.textContent?.trim();
        if (!text) continue;
        candidates.push(text);
        if (!name && /plant/i.test(text)) {
          name = text;
        }
      }
      if (name) break;
    }

    if (!name && candidates.length) {
      const fallback = candidates.find((text) => /[a-z]/i.test(text)) ?? '';
      name = fallback;
    }
    
    if (!name || !isPlantCrop(name)) {
      return null;
    }
    
    // Extract mutation badges (letter + style) from the item
    // Mutations appear as small letter badges on the plant icon
    const mutationBadges = extractMutationBadges(element);
    const domMutationCounts = countMutationBadges(mutationBadges);
    const domBoldCounts = countBoldMutationBadges(mutationBadges);
    
    // Parse fruit count from name (e.g., "Pepper Plant+9" has 9 fruits)
    const fruitCountMatch = name.match(/\+(\d+)/);
    const parsedFruitCount = fruitCountMatch ? parseInt(fruitCountMatch[1] || '1', 10) : 0;
    
    let slotStates: PlantSlotState[] = [];
  let slotSource: PlantData['slotSource'] = 'fallback';

    if (inventoryLookups) {
      const baseIndex = readInventoryBaseIndex(element, fallbackIndex);
      let entry = inventoryLookups.byIndex.get(baseIndex) ?? null;

      if (!entry || entry.used) {
        const inventoryId = readInventoryId(element);
        if (inventoryId) {
          const byIdEntry = inventoryLookups.byId.get(inventoryId) ?? null;
          if (byIdEntry && !byIdEntry.used) {
            entry = byIdEntry;
          }
        }
      }

      if (!entry || entry.used) {
        const normalizedName = normalizePlantName(name);
        const candidates = inventoryLookups.byName.get(normalizedName);
        if (candidates) {
          while (candidates.length > 0 && candidates[0] && candidates[0].used) {
            candidates.shift();
          }
          if (candidates.length > 0) {
            const candidate = candidates.shift();
            if (candidate) {
              entry = candidate;
            }
          }
        }
      }

      if (entry && !entry.used) {
        entry.used = true;
        slotStates = entry.slotStates.map(cloneSlotState);
        slotSource = 'inventory';
      }
    }

    const combinedMutations = combineMutationSources(slotStates, domMutationCounts, domBoldCounts);

  const fruitCount = parsedFruitCount > 0 ? parsedFruitCount : slotStates.length;
    if (fruitCount === 0) {
      log(`⏭️ Skipping ungrown plant: ${name} (${slotSource === 'inventory' ? 'no slots yet' : 'no fruit count'})`);
      return null;
    }

    return {
      name,
      mutations: combinedMutations,
      element,
      fruitCount,
      slotStates,
      slotSource,
      domMutationCounts,
      domBoldCounts,
    };
  } catch (error) {
    log('❌ Error extracting plant data:', error);
    return null;
  }
}

async function buildInventoryLookups(): Promise<InventoryLookups | null> {
  inventoryLookupStatsLogged = false;
  inventoryDebugSamples = 0;
  slotMutationDebugSamples = 0;
  const items = await fetchCropInventoryItems();
  if (items.length === 0) {
    if (!inventoryLookupStatsLogged) {
      log('[Mutations] Inventory lookup unavailable (no items)');
      inventoryLookupStatsLogged = true;
    }
    return null;
  }

  const byIndex = new Map<number, InventoryPlantEntry>();
  const byId = new Map<string, InventoryPlantEntry>();
  const byName = new Map<string, InventoryPlantEntry[]>();

  items.forEach((rawItem, index) => {
    const entry = mapInventoryItem(rawItem, index);
    if (!entry) return;
    byIndex.set(entry.baseIndex, entry);
    if (entry.id) {
      byId.set(entry.id, entry);
    }
    if (entry.normalizedName) {
      const list = byName.get(entry.normalizedName) ?? [];
      list.push(entry);
      byName.set(entry.normalizedName, list);
    }
  });

  if (byIndex.size === 0) {
    if (!inventoryLookupStatsLogged) {
      log('[Mutations] Inventory lookup construction produced zero entries');
      inventoryLookupStatsLogged = true;
    }
    return null;
  }

  if (!inventoryLookupStatsLogged) {
    log('[Mutations] Inventory lookup ready', {
      items: items.length,
      byIndex: byIndex.size,
      byId: byId.size,
      byName: byName.size,
    });
    inventoryLookupStatsLogged = true;
  }

  return { byIndex, byId, byName };
}

async function fetchCropInventoryItems(): Promise<any[]> {
  const fallback = async (): Promise<any[]> => {
    const sharedAtoms = await readInventoryFromSharedAtoms();
    if (sharedAtoms) {
      if (!inventoryLookupStatsLogged) {
        log('[Mutations] Using shared atoms inventory source', {
          source: sharedAtoms.source,
          items: sharedAtoms.items.length,
          hasSlotData: sharedAtoms.hasSlotData,
        });
        inventoryLookupStatsLogged = true;
      }
      return sharedAtoms.items;
    }

    const globalInventory = readGlobalInventoryItems();
    if (globalInventory) {
      if (!inventoryLookupStatsLogged) {
        log('[Mutations] Using global inventory source', {
          source: globalInventory.source,
          items: globalInventory.items.length,
          hasSlotData: globalInventory.hasSlotData,
        });
        inventoryLookupStatsLogged = true;
      }
      return globalInventory.items;
    }

    return [];
  };

  const ensureSlotDataOrFallback = async (items: any[] | null | undefined, source: string): Promise<any[]> => {
    if (!items || items.length === 0) {
      return await fallback();
    }

    const hasSlotData = items.some((item) => extractSlotsFromInventoryItem(item).length > 0);
    if (hasSlotData) {
      if (!inventoryLookupStatsLogged) {
        log(`[Mutations] Read crop inventory atom (${source})`, { count: items.length, hasSlotData: true });
        inventoryLookupStatsLogged = true;
      }
      return items;
    }

    if (!inventoryLookupStatsLogged) {
      const samples = items.slice(0, 3).map((item, index) => ({ index, summary: summarizeInventoryItem(item) }));
      log('[Mutations] Crop inventory atom lacks slot data, trying fallback', { source, count: items.length, samples });
    }

    const fallbackItems = await fallback();
    if (fallbackItems.length > 0) {
      return fallbackItems;
    }

    if (!inventoryLookupStatsLogged) {
      log('[Mutations] Crop inventory atom fallback unavailable, proceeding without slot data', { source, count: items.length });
      inventoryLookupStatsLogged = true;
    }

    return items;
  };

  try {
    await ensureJotaiStore();
  } catch (error) {
    if (!inventoryAccessFailureLogged) {
      log('⚠️ Unable to capture jotai store for crop inventory', error);
      inventoryAccessFailureLogged = true;
    }
    return await fallback();
  }

  const userSlotsSnapshot = await readUserSlotsInventorySnapshot();
  if (userSlotsSnapshot && userSlotsSnapshot.items.length > 0) {
    if (!inventoryLookupStatsLogged) {
      log('[Mutations] Using userSlotsAtom inventory source', {
        source: userSlotsSnapshot.source,
        items: userSlotsSnapshot.items.length,
        hasSlotData: userSlotsSnapshot.hasSlotData,
      });
      inventoryLookupStatsLogged = true;
    }

    if (userSlotsSnapshot.hasSlotData) {
      return userSlotsSnapshot.items;
    }

    return await ensureSlotDataOrFallback(userSlotsSnapshot.items, userSlotsSnapshot.source);
  }

  const atom = getAtomByLabel(CROP_INVENTORY_ATOM_LABEL);
  if (!atom) {
    if (!inventoryAccessFailureLogged) {
      log('⚠️ Could not locate myCropInventoryAtom in jotai cache');
      inventoryAccessFailureLogged = true;
    }
    return await fallback();
  }

  try {
    const value = await readAtomValue<any>(atom);
    inventoryAccessFailureLogged = false;
    if (Array.isArray(value)) {
      return await ensureSlotDataOrFallback(value, 'array');
    }
    if (value && Array.isArray((value as Record<string, unknown>).items)) {
      return await ensureSlotDataOrFallback((value as Record<string, any>).items as any[], 'items array');
    }
    if (!inventoryLookupStatsLogged) {
      log('[Mutations] Crop inventory atom value not array-like', { sample: value });
    }
    return await fallback();
  } catch (error) {
    if (!inventoryAccessFailureLogged) {
      log('⚠️ Failed reading myCropInventoryAtom', error);
      inventoryAccessFailureLogged = true;
    }
    return await fallback();
  }

  return [];
}

function normalizeInventoryArray(input: unknown): any[] | null {
  if (Array.isArray(input)) {
    return input;
  }
  if (input && typeof input === 'object') {
    const items = (input as Record<string, unknown>).items;
    if (Array.isArray(items)) {
      return items;
    }
  }
  return null;
}

function readGlobalInventoryItems(): GlobalInventoryResult | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const globalAny = window as unknown as Record<string, any>;
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: 'UnifiedState.atoms.inventory.items', value: globalAny?.UnifiedState?.atoms?.inventory?.items },
    { source: 'UnifiedState.atoms.inventory', value: globalAny?.UnifiedState?.atoms?.inventory },
    { source: 'myData.inventory.items', value: globalAny?.myData?.inventory?.items },
    { source: '__mga_cachedInventory', value: globalAny?.__mga_cachedInventory },
    { source: 'MGTOOLS.UnifiedState.atoms.inventory.items', value: globalAny?.MGTOOLS?.UnifiedState?.atoms?.inventory?.items },
  ];

  let fallback: GlobalInventoryResult | null = null;

  for (const candidate of candidates) {
    let items = normalizeInventoryArray(candidate.value);
    let resolvedSource = candidate.source;

    if ((!items || items.length === 0) && candidate.value && typeof candidate.value === 'object') {
      const nestedPaths: Array<{ key: string; label: string }> = [
        { key: 'myCropInventory', label: `${candidate.source}.myCropInventory` },
        { key: 'cropInventory', label: `${candidate.source}.cropInventory` },
        { key: 'inventory', label: `${candidate.source}.inventory` },
        { key: 'items', label: `${candidate.source}.items` },
      ];

      for (const nested of nestedPaths) {
        const nestedValue = (candidate.value as Record<string, unknown>)[nested.key];
        const nestedItems = normalizeInventoryArray(nestedValue);
        if (nestedItems && nestedItems.length > 0) {
          items = nestedItems;
          resolvedSource = nested.label;
          break;
        }
      }
    }

    if (!items || items.length === 0) continue;
    const hasSlotData = items.some((item) => extractSlotsFromInventoryItem(item).length > 0);
    const result: GlobalInventoryResult = {
      items,
      source: resolvedSource,
      hasSlotData,
    };
    if (hasSlotData) {
      return result;
    }
    if (!fallback) {
      fallback = result;
    }
  }

  return fallback;
}

async function readInventoryFromSharedAtoms(): Promise<GlobalInventoryResult | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const globalAny = window as unknown as Record<string, any>;
  const atomCandidates: Array<{ source: string; atom: any }> = [
    { source: 'MGTools.Core.Atoms.inventory.myCropInventory', atom: globalAny?.MGTools?.Core?.Atoms?.inventory?.myCropInventory },
    { source: 'MGTOOLS.Core.Atoms.inventory.myCropInventory', atom: globalAny?.MGTOOLS?.Core?.Atoms?.inventory?.myCropInventory },
    { source: 'Atoms.inventory.myCropInventory', atom: globalAny?.Atoms?.inventory?.myCropInventory },
    { source: '__tmAtoms.inventory.myCropInventory', atom: globalAny?.__tmAtoms?.inventory?.myCropInventory },
  ];

  for (const candidate of atomCandidates) {
    const atom = candidate.atom;
    if (!atom) continue;

    const tryNormalize = (input: unknown): any[] | null => {
      const normalized = normalizeInventoryArray(input);
      if (normalized && normalized.length > 0) {
        return normalized;
      }
      if (input && typeof input === 'object') {
        const nestedCandidates = [
          (input as Record<string, unknown>).items,
          (input as Record<string, unknown>).value,
          (input as Record<string, unknown>).current,
          (input as Record<string, unknown>).state,
        ];
        for (const nested of nestedCandidates) {
          const nestedNormalized = normalizeInventoryArray(nested);
          if (nestedNormalized && nestedNormalized.length > 0) {
            return nestedNormalized;
          }
        }
      }
      return null;
    };

    try {
      if (typeof atom.get === 'function') {
        const value = await atom.get();
        const items = tryNormalize(value);
        if (items && items.length > 0) {
          return {
            items,
            source: `${candidate.source}.get()`,
            hasSlotData: items.some((item) => extractSlotsFromInventoryItem(item).length > 0),
          };
        }
      }

      const fallbackValues = tryNormalize(atom);
      if (fallbackValues && fallbackValues.length > 0) {
        return {
          items: fallbackValues,
          source: `${candidate.source}`,
          hasSlotData: fallbackValues.some((item) => extractSlotsFromInventoryItem(item).length > 0),
        };
      }
    } catch (error) {
      if (!sharedAtomsFailureLogged) {
        log('⚠️ Unable to read shared atoms inventory source', { source: candidate.source, error });
        sharedAtomsFailureLogged = true;
      }
    }
  }

  return null;
}

function mapInventoryItem(rawItem: any, index: number): InventoryPlantEntry | null {
  if (!rawItem || typeof rawItem !== 'object') return null;

  const itemType = readInventoryItemType(rawItem);
  if (itemType !== 'plant') {
    if (inventoryDebugSamples < 5) {
      log('[Mutations] Inventory item skipped (type mismatch)', {
        index,
        itemType,
        keys: Object.keys(rawItem).slice(0, 10),
        sample: summarizeInventoryItem(rawItem),
      });
      inventoryDebugSamples += 1;
    }
    return null;
  }
  const slots = extractSlotsFromInventoryItem(rawItem);
  const slotStates = slots.map(buildSlotStateFromInventorySlot);

  const id = typeof rawItem.id === 'string' ? rawItem.id : null;
  const species = typeof rawItem.species === 'string' ? rawItem.species : null;
  const itemName = typeof rawItem.itemName === 'string' ? rawItem.itemName : null;
  const displayName = typeof rawItem.displayName === 'string' ? rawItem.displayName : null;
  let name = typeof rawItem.name === 'string' ? rawItem.name : null;

  if (!name) name = itemName || displayName;
  if (!name && species) {
    name = species.toLowerCase().includes('plant') ? species : `${species} Plant`;
  }

  const normalizedName = name ? normalizePlantName(name) : null;

  return {
    baseIndex: index,
    id,
    slotStates,
    raw: rawItem,
    name,
    normalizedName,
    used: false,
  };
}

function readInventoryItemType(rawItem: any): 'plant' | 'other' {
  if (!rawItem || typeof rawItem !== 'object') return 'other';

  if (extractSlotsFromInventoryItem(rawItem).length > 0) {
    return 'plant';
  }

  const candidates: Array<string | undefined | null> = [
    rawItem?.itemType,
    rawItem?.type,
    rawItem?.category,
    rawItem?.kind,
    rawItem?.item?.itemType,
    rawItem?.item?.type,
    rawItem?.plant?.itemType,
    rawItem?.plant?.type,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.toLowerCase();
    if (
      normalized === 'plant' ||
      normalized === 'crop' ||
      normalized.endsWith('plant') ||
      normalized.includes('plant')
    ) {
      return 'plant';
    }
  }

  return 'other';
}

function summarizeInventoryItem(rawItem: any): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const fields = ['id', 'name', 'species', 'itemType', 'type', 'category', 'kind'];
  for (const field of fields) {
    if (rawItem && typeof rawItem === 'object' && field in rawItem) {
      summary[field] = rawItem[field];
    }
  }

  if (rawItem?.item && typeof rawItem.item === 'object') {
    summary.item = {};
    for (const field of fields) {
      if (field in rawItem.item) {
        (summary.item as Record<string, unknown>)[field] = rawItem.item[field];
      }
    }
  }

  if (rawItem?.plant && typeof rawItem.plant === 'object') {
    summary.plant = {};
    for (const field of fields) {
      if (field in rawItem.plant) {
        (summary.plant as Record<string, unknown>)[field] = rawItem.plant[field];
      }
    }
  }

  if (rawItem?.itemName) {
    summary.itemName = rawItem.itemName;
  }

  summary.hasSlots = !!extractSlotsFromInventoryItem(rawItem).length;

  return summary;
}

function coerceStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  return null;
}

function coerceNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractProgressFromObject(value: unknown, seen: WeakSet<object>): MutationStageProgress | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (seen.has(value as object)) {
    return null;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const progress = extractProgressFromObject(entry, seen);
      if (progress) {
        return progress;
      }
    }
    return null;
  }

  const obj = value as Record<string, unknown>;
  const candidatePairs: Array<[unknown, unknown]> = [
    [obj.complete, obj.total],
    [obj.completed, obj.total],
    [obj.completed, obj.goal],
    [obj.count, obj.total],
    [obj.count, obj.required],
    [obj.current, obj.max],
    [obj.value, obj.max],
  ];

  for (const [completeRaw, totalRaw] of candidatePairs) {
    const complete = coerceNumberValue(completeRaw);
    const total = coerceNumberValue(totalRaw);
    if (complete != null && total != null && total > 0 && complete >= 0) {
      return { complete, total };
    }
  }

  const nestedKeys = ['progress', 'state', 'status', 'data', 'info', 'details', 'counts'];
  for (const key of nestedKeys) {
    const nested = obj[key];
    if (!nested) continue;
    const progress = extractProgressFromObject(nested, seen);
    if (progress) {
      return progress;
    }
  }

  return null;
}

function normalizeMutationEntry(entry: unknown, seen: WeakSet<object> = new WeakSet()): string | null {
  if (typeof entry === 'string') {
    return entry;
  }
  if (typeof entry === 'number' && Number.isFinite(entry)) {
    return entry.toString();
  }
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  if (seen.has(entry as object)) {
    return null;
  }
  seen.add(entry as object);

  const obj = entry as Record<string, unknown>;
  const candidateFields = ['name', 'displayName', 'display_name', 'mutationName', 'mutation', 'label', 'title', 'text', 'type', 'kind', 'state', 'status', 'key'];
  let text: string | null = null;
  for (const field of candidateFields) {
    const value = obj[field];
    const str = coerceStringValue(value);
    if (str) {
      text = str;
      break;
    }
  }

  if (!text) {
    const nestedCandidates = ['mutation', 'mut', 'data', 'info', 'details', 'entry', 'node', 'item'];
    for (const nestedKey of nestedCandidates) {
      const nested = obj[nestedKey];
      if (!nested) continue;
      const nestedText = normalizeMutationEntry(nested, seen);
      if (nestedText) {
        text = nestedText;
        break;
      }
    }
  }

  const progress = extractProgressFromObject(obj, seen);
  if (progress) {
    if (text) {
      if (!/\d+\s*\/\s*\d+/.test(text)) {
        text = `${text} ${progress.complete}/${progress.total}`;
      }
    } else {
      text = `${progress.complete}/${progress.total}`;
    }
  }

  return text;
}

function summarizeSlotForDebug(rawSlot: any): Record<string, unknown> {
  if (!rawSlot || typeof rawSlot !== 'object') {
    return {};
  }

  const slotRecord = rawSlot as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  const keys = Object.keys(slotRecord).slice(0, 10);

  for (const key of keys) {
    const value = slotRecord[key];
    if (value == null) continue;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      summary[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      summary[key] = value.slice(0, 3).map((entry) => {
        if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
          return entry;
        }
        if (entry && typeof entry === 'object') {
          const nestedRecord = entry as Record<string, unknown>;
          const nestedKey = Object.keys(nestedRecord).find((candidate) => {
            const nestedValue = nestedRecord[candidate];
            return typeof nestedValue === 'string' || typeof nestedValue === 'number';
          });
          if (nestedKey) {
            return nestedRecord[nestedKey];
          }
          return Object.keys(nestedRecord).slice(0, 3);
        }
        return typeof entry;
      });
      continue;
    }

    if (typeof value === 'object') {
      const nestedRecord = value as Record<string, unknown>;
      const nestedSummary: Record<string, unknown> = {};
      for (const nestedKey of Object.keys(nestedRecord).slice(0, 5)) {
        const nestedValue = nestedRecord[nestedKey];
        if (typeof nestedValue === 'string' || typeof nestedValue === 'number' || typeof nestedValue === 'boolean') {
          nestedSummary[nestedKey] = nestedValue;
        }
      }
      if (Object.keys(nestedSummary).length > 0) {
        summary[key] = nestedSummary;
      }
    }
  }

  return summary;
}

function extractMutationStringsFromSlot(rawSlot: any): string[] {
  if (!rawSlot || typeof rawSlot !== 'object') {
    return [];
  }

  const slotRecord = rawSlot as Record<string, unknown>;
  const results: string[] = [];
  const seen = new Set<string>();
  const push = (text: string | null): void => {
    if (!text) return;
    const normalized = text.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    results.push(normalized);
  };

  const candidateCollections = [
    slotRecord['mutations'],
    slotRecord['mutationStates'],
    slotRecord['mutation_states'],
    slotRecord['mutationHistory'],
    slotRecord['appliedMutations'],
    slotRecord['pendingMutations'],
    slotRecord['mutationsList'],
  ];

  for (const collection of candidateCollections) {
    if (!collection) continue;
    if (Array.isArray(collection)) {
      for (const entry of collection) {
        push(normalizeMutationEntry(entry));
      }
      continue;
    }

    if (typeof collection === 'object') {
      for (const entry of Object.values(collection as Record<string, unknown>)) {
        push(normalizeMutationEntry(entry));
      }
    }
  }

  const candidateFields = [
    'mutation',
    'mutationName',
    'mutationType',
    'currentMutation',
    'activeMutation',
    'latestMutation',
  ];

  for (const field of candidateFields) {
    push(normalizeMutationEntry(slotRecord[field]));
  }

  if (results.length === 0) {
    const stageKeys: Array<[string, MutationStage]> = [
      ['wet', 'wet'],
      ['water', 'wet'],
      ['rain', 'wet'],
      ['freeze', 'wet'],
      ['frozen', 'wet'],
      ['chill', 'wet'],
      ['dawn', 'dawn'],
      ['amber', 'amber'],
    ];

    for (const [key, value] of Object.entries(slotRecord)) {
      const lowerKey = key.toLowerCase();
      const stageEntry = stageKeys.find(([needle]) => lowerKey.includes(needle));
      if (!stageEntry) continue;
      const [, stage] = stageEntry;
      const progress = extractProgressFromObject(value, new WeakSet<object>());
      if (progress) {
        push(`${stage} ${progress.complete}/${progress.total}`);
      }
    }
  }

  return results;
}

function extractSlotsFromInventoryItem(rawItem: any): any[] {
  if (!rawItem || typeof rawItem !== 'object') return [];

  const candidatePaths = [
    (rawItem as Record<string, unknown>).slots,
    (rawItem as Record<string, any>).plant?.slots,
    (rawItem as Record<string, any>).item?.slots,
    (rawItem as Record<string, any>).data?.slots,
    (rawItem as Record<string, any>).slots?.slots,
    (rawItem as Record<string, any>).growSlots,
  ];

  for (const candidate of candidatePaths) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];

}

function buildSlotStateFromInventorySlot(rawSlot: any): PlantSlotState {
  const mutations = extractMutationStringsFromSlot(rawSlot);
  if (mutations.length === 0 && slotMutationDebugSamples < SLOT_MUTATION_DEBUG_LIMIT) {
    const slotKeys = rawSlot && typeof rawSlot === 'object' ? Object.keys(rawSlot).slice(0, 10) : [];
    log('[Mutations] Inventory slot missing mutation text', {
      keys: slotKeys,
      sample: summarizeSlotForDebug(rawSlot),
    });
    slotMutationDebugSamples += 1;
  }
  return computeSlotStateFromMutationNames(mutations);
}

export function computeSlotStateFromMutationNames(mutations: string[]): PlantSlotState {
  const letters = new Set<MutationLetter>();

  let hasFrozen = false;
  let hasWet = false;
  let hasChilled = false;
  let hasDawnlit = false;
  let hasAmberlit = false;
  let hasDawnbound = false;
  let hasAmberbound = false;
  let hasRainbow = false;
  let hasGold = false;
  const unknownMutations: string[] = [];
  const progress: Partial<Record<MutationStage, MutationStageProgress>> = {};
  let wetOccurrences = 0;
  let dawnOccurrences = 0;
  let amberOccurrences = 0;

  const recordProgress = (stage: MutationStage, complete: number, total: number): void => {
    if (!Number.isFinite(complete) || !Number.isFinite(total)) return;
    if (total <= 0 || complete < 0) return;
    const existing = progress[stage];
    if (!existing || total > existing.total || (total === existing.total && complete > existing.complete)) {
      progress[stage] = { complete, total };
    }
  };

  for (const raw of mutations) {
    const normalized = String(raw ?? '').toLowerCase();

    const frozenLike = normalized.includes('frozen') || normalized.includes('freeze');
    if (frozenLike) {
      hasFrozen = true;
      letters.add('F');
    }

    const wetLike = normalized.includes('wet');
    if (wetLike) {
      hasWet = true;
      letters.add('W');
    }

    const chilledLike = normalized.includes('chill');
    if (chilledLike) {
      hasChilled = true;
      letters.add('C');
    }

    if (frozenLike || wetLike || chilledLike) {
      wetOccurrences += 1;
    }

    const isDawnbound = normalized.includes('dawnbound');
    if (isDawnbound) {
      hasDawnbound = true;
      letters.add('D');
    }

    const isAmberbound = normalized.includes('amberbound');
    if (isAmberbound) {
      hasAmberbound = true;
      letters.add('A');
    }

    const dawnLike = (normalized.includes('dawnlit') || normalized.includes('dawnlight') || normalized.includes('dawn')) && !isDawnbound;
    if (dawnLike) {
      hasDawnlit = true;
      letters.add('D');
    }

    if (dawnLike || isDawnbound) {
      dawnOccurrences += 1;
    }

    const amberLike = (normalized.includes('amberlit') || normalized.includes('amberlight') || normalized.includes('amber')) && !isAmberbound;
    if (amberLike) {
      hasAmberlit = true;
      letters.add('A');
    }

    if (amberLike || isAmberbound) {
      amberOccurrences += 1;
    }

    const rainbowLike = normalized.includes('rainbow');
    if (rainbowLike) {
      hasRainbow = true;
      letters.add('R');
    }

    const goldLike = normalized.includes('gold');
    if (goldLike) {
      hasGold = true;
      letters.add('G');
    }

    // Track any mutation names not matched by the known set above
    const isKnown = frozenLike || wetLike || chilledLike || isDawnbound || isAmberbound || dawnLike || amberLike || rainbowLike || goldLike;
    if (!isKnown && raw && typeof raw === 'string') {
      unknownMutations.push(raw);
    }

    const progressMatch = normalized.match(/(\d+)\s*\/\s*(\d+)/);
    if (progressMatch) {
      const complete = Number.parseInt(progressMatch[1] ?? '0', 10);
      const total = Number.parseInt(progressMatch[2] ?? '0', 10);
      if (frozenLike || wetLike || chilledLike) {
        recordProgress('wet', complete, total);
      }
      if (dawnLike || isDawnbound) {
        recordProgress('dawn', complete, total);
      }
      if (amberLike || isAmberbound) {
        recordProgress('amber', complete, total);
      }
    }
  }

  const orderedLetters = Array.from(letters).sort();

  if (!progress.wet && wetOccurrences > 0) {
    progress.wet = { complete: wetOccurrences, total: wetOccurrences };
  }
  if (!progress.dawn && dawnOccurrences > 0) {
    progress.dawn = { complete: dawnOccurrences, total: dawnOccurrences };
  }
  if (!progress.amber && amberOccurrences > 0) {
    progress.amber = { complete: amberOccurrences, total: amberOccurrences };
  }

  return {
    letters: orderedLetters,
    hasFrozen,
    hasWet,
    hasChilled,
    hasDawnlit,
    hasAmberlit,
    hasDawnbound,
    hasAmberbound,
    hasRainbow,
    hasGold,
    unknownMutations,
    progress,
  };
}

function cloneSlotState(slot: PlantSlotState): PlantSlotState {
  return {
    letters: [...slot.letters],
    hasFrozen: slot.hasFrozen,
    hasWet: slot.hasWet,
    hasChilled: slot.hasChilled,
    hasDawnlit: slot.hasDawnlit,
    hasAmberlit: slot.hasAmberlit,
    hasDawnbound: slot.hasDawnbound,
    hasAmberbound: slot.hasAmberbound,
    hasRainbow: slot.hasRainbow,
    hasGold: slot.hasGold,
    unknownMutations: [...(slot.unknownMutations ?? [])],
    progress: { ...(slot.progress ?? {}) },
  };
}

function extractMutationBadges(element: Element): MutationBadge[] {
  const badges: MutationBadge[] = [];
  const textElements = element.querySelectorAll('span, div, p');

  for (const el of textElements) {
    const rawText = el.textContent?.trim();
    if (!rawText || rawText.length !== 1) continue;
    const letter = rawText.toUpperCase();
    if (!isMutationLetter(letter)) continue;

    let isBold = false;
    if (el instanceof HTMLElement) {
      const computed = window.getComputedStyle(el);
      const weight = computed.fontWeight;
      const numericWeight = Number.parseInt(weight, 10);
      isBold = weight === 'bold' || Number.isFinite(numericWeight) && numericWeight >= 700;
    }

    badges.push({ letter: letter as MutationLetter, isBold });
  }

  return badges;
}

export function createMutationCountMap(initial = 0): Record<MutationLetter, number> {
  return {
    F: initial,
    W: initial,
    C: initial,
    D: initial,
    A: initial,
    R: initial,
    G: initial,
  };
}

function countMutationBadges(badges: MutationBadge[]): Record<MutationLetter, number> {
  const counts = createMutationCountMap();
  for (const badge of badges) {
    counts[badge.letter] += 1;
  }
  return counts;
}

function countBoldMutationBadges(badges: MutationBadge[]): Record<'D' | 'A', number> {
  return {
    D: badges.filter((badge) => badge.letter === 'D' && badge.isBold).length,
    A: badges.filter((badge) => badge.letter === 'A' && badge.isBold).length,
  };
}

export function combineMutationSources(
  slotStates: PlantSlotState[],
  domCounts: Record<MutationLetter, number>,
  domBoldCounts: Record<'D' | 'A', number>
): string {
  const combined = new Set<MutationLetter>();

  for (const slot of slotStates) {
    slot.letters.forEach((letter) => combined.add(letter));
    if (slot.hasDawnbound) combined.add('D');
    if (slot.hasAmberbound) combined.add('A');
  }

  for (const letter of MUTATION_LETTERS) {
    if (domCounts[letter] > 0) {
      combined.add(letter);
    }
  }

  if (domBoldCounts.D > 0) combined.add('D');
  if (domBoldCounts.A > 0) combined.add('A');

  return Array.from(combined).sort().join('');
}

function isMutationLetter(char: string): char is MutationLetter {
  return char === 'F' || char === 'W' || char === 'C' || char === 'D' || char === 'A' || char === 'R' || char === 'G';
}

const INVENTORY_BASE_INDEX_ATTRS = [
  'data-tm-inventory-base-index',
  'data-tm-inventory-baseindex',
  'data-tm-base-index',
  'data-base-index',
];

const INVENTORY_ID_ATTRS = [
  'data-tm-inventory-id',
  'data-inventory-id',
  'data-item-id',
  'data-itemid',
  'data-itemId',
  'data-item-uuid',
  'data-itemuuid',
  'data-item-guid',
  'data-uuid',
  'data-guid',
  'data-entity-id',
  'data-entityid',
  'data-record-id',
  'data-recordid',
  'data-row-id',
  'data-rowid',
  'data-tm-item-id',
  'data-tm-itemid',
  'data-id',
];

function readInventoryBaseIndex(element: Element, fallbackIndex: number): number {
  const directAttr = readAttributeValue(element, INVENTORY_BASE_INDEX_ATTRS);
  const parsedDirect = parseIndex(directAttr);
  if (parsedDirect != null) {
    return parsedDirect;
  }

  const datasetValue = readDatasetValue(element, (key) => key.toLowerCase().includes('inventorybaseindex'));
  const parsedDataset = parseIndex(datasetValue);
  if (parsedDataset != null) {
    return parsedDataset;
  }

  const nested = element.querySelector('[data-tm-inventory-base-index]');
  if (nested) {
    const nestedAttr = readAttributeValue(nested, INVENTORY_BASE_INDEX_ATTRS);
    const parsedNested = parseIndex(nestedAttr);
    if (parsedNested != null) {
      return parsedNested;
    }

    const nestedDataset = readDatasetValue(nested, (key) => key.toLowerCase().includes('inventorybaseindex'));
    const parsedNestedDataset = parseIndex(nestedDataset);
    if (parsedNestedDataset != null) {
      return parsedNestedDataset;
    }
  }

  return fallbackIndex;
}

function readInventoryId(element: Element): string | null {
  const candidateSelectors = [
    '[data-tm-inventory-id]',
    '[data-inventory-id]',
    '[data-item-id]',
    '[data-itemid]',
    '[data-item-uuid]',
    '[data-uuid]',
    '[data-guid]',
    '[data-entity-id]',
    '[data-record-id]',
    '[data-row-id]'
  ];

  const datasetPredicate = (key: string) => {
    const lower = key.toLowerCase();
    return lower.includes('inventoryid') || lower.includes('itemid') || /(?:uuid|guid)$/.test(lower);
  };

  const searchNodes: Element[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < 5; depth++) {
    searchNodes.push(current);
    current = current.parentElement;
  }

  for (const node of searchNodes) {
    const direct = readAttributeValue(node, INVENTORY_ID_ATTRS);
    if (direct) {
      return direct;
    }

    const datasetValue = readDatasetValue(node, datasetPredicate);
    if (datasetValue) {
      return datasetValue;
    }
  }

  for (const node of searchNodes) {
    for (const selector of candidateSelectors) {
      const nested = node.querySelector(selector);
      if (!nested) {
        continue;
      }

      const nestedAttr = readAttributeValue(nested, INVENTORY_ID_ATTRS);
      if (nestedAttr) {
        return nestedAttr;
      }

      const nestedDataset = readDatasetValue(nested, datasetPredicate);
      if (nestedDataset) {
        return nestedDataset;
      }
    }
  }

  return null;
}

function readAttributeValue(element: Element, names: string[]): string | null {
  for (const name of names) {
    const value = element.getAttribute(name);
    if (value != null) {
      return value;
    }
  }

  const lowerNames = names.map((name) => name.toLowerCase());
  for (const { name, value } of Array.from(element.attributes)) {
    if (lowerNames.includes(name.toLowerCase()) && value != null) {
      return value;
    }
  }

  return null;
}

function readDatasetValue(element: Element, predicate: (key: string) => boolean): string | null {
  const htmlElement = element as HTMLElement;
  const dataset = htmlElement.dataset;
  if (!dataset) return null;

  for (const [key, value] of Object.entries(dataset)) {
    if (predicate(key) && value != null && value !== '') {
      return value;
    }
  }

  return null;
}

function parseIndex(value: string | null | undefined): number | null {
  if (value == null) return null;
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Check if item name is a PLANT (not crop/harvested item, seed, tool, etc.)
 * Plants have names like "Lily Plant", "Pepper Plant+9", etc.
 */
function isPlantCrop(name: string): boolean {
  const lowerName = name.toLowerCase().trim();

  // Remove fruit count suffix for checking (e.g., "Pepper Plant+9" -> "Pepper Plant")
  const hasFruitCount = /\+\d+$/.test(name);
  const baseNameMatch = name.match(/^(.+?)(?:\+\d+)?$/);
  const baseName = (baseNameMatch?.[1] || name).toLowerCase().trim();

  // Exclude non-plant items first
  const exclusions = ['seed', 'spore', 'cutting', 'pod', 'kernel', 'pit', 'shovel', 'pot', 'watering can', 'tool', 'fertilizer', 'egg', 'decor', 'furniture', 'planter'];
  for (const exclusion of exclusions) {
    if (baseName.includes(exclusion)) return false;
  }

  // Accept if it contains "plant" (e.g., "Lily Plant", "Pepper Plant+9")
  if (baseName.includes('plant')) {
    return true;
  }

  // Also accept if it has a fruit count suffix (e.g., "Lily+1")
  // This handles cases where the game shows species name with count but no "Plant" word
  if (hasFruitCount) {
    return true;
  }

  // Otherwise, reject (harvested crops like "Lily", "Pepper", etc.)
  return false;
}

/**
 * Extract mutation letters from plant item element
 * Mutation badges are typically small text overlays on the plant icon
 */
/**
 * Filter plants that should be placed based on current weather
 */
function filterPlantsForWeather(plants: PlantData[], weather: WeatherType): PlantData[] {
  const toPlace: PlantData[] = [];

  for (const plant of plants) {
    const evaluation = evaluatePlantForWeather(plant, weather, true);
    if (evaluation.decision) {
      toPlace.push(plant);
    }
  }

  return toPlace;
}

function evaluatePlantForWeather(
  plant: PlantData,
  weather: WeatherType,
  emitDebug = true,
): PlantMutationEvaluation {
  if (weather === 'sunny' || weather === 'unknown') {
    const detail: PlantDebugDetail = {
      strategy: 'fallback',
      fruitCount: Math.max(plant.fruitCount, 0),
      frozenCount: 0,
      wetCount: 0,
      chilledCount: 0,
      dawnCount: 0,
      amberCount: 0,
      dawnBoundCount: 0,
      amberBoundCount: 0,
      rainbowCount: 0,
      goldCount: 0,
    };
    if (emitDebug) {
      debugPlantDecision(plant, weather, false, detail);
    }
    return {
      decision: false,
      pendingFruits: 0,
      totalFruits: Math.max(plant.fruitCount, 0),
      needsSnow: 0,
      detail,
    };
  }

  if (plant.slotStates.length > 0 && (plant.slotSource === 'inventory' || plant.slotSource === 'garden')) {
    return evaluatePlantFromInventory(plant, weather, emitDebug);
  }

  return evaluatePlantFallback(plant, weather, emitDebug);
}

function evaluatePlantFromInventory(
  plant: PlantData,
  weather: WeatherType,
  emitDebug: boolean,
): PlantMutationEvaluation {
  const { slotStates } = plant;
  const hasAnyAmber = slotStates.some((slot) => slot.hasAmberlit || slot.hasAmberbound);
  const hasAnyDawn = slotStates.some((slot) => slot.hasDawnlit || slot.hasDawnbound);
  const hasAnyRainbow = slotStates.some((slot) => slot.hasRainbow);
  const hasAnyGold = slotStates.some((slot) => slot.hasGold);

  const hasSlotMutationInfo = slotStates.some((slot) =>
    slot.letters.length > 0 ||
    slot.hasWet ||
    slot.hasFrozen ||
    slot.hasChilled ||
    slot.hasDawnlit ||
    slot.hasAmberlit ||
    slot.hasDawnbound ||
    slot.hasAmberbound ||
    slot.hasRainbow ||
    slot.hasGold ||
    (slot.unknownMutations?.length ?? 0) > 0,
  );

  if (!hasSlotMutationInfo) {
    return evaluatePlantFallback(plant, weather, emitDebug);
  }

  // Multi-fruit plants CAN have different fruits with different color mutations
  // Check for conflicts at the individual fruit level, not the plant level
  const slotsWithConflicts = slotStates.filter((slot) => {
    const hasBothColors = (slot.hasAmberlit || slot.hasAmberbound) && (slot.hasDawnlit || slot.hasDawnbound);
    const hasBothRarity = slot.hasRainbow && slot.hasGold;
    return hasBothColors || hasBothRarity;
  });

  if (slotsWithConflicts.length > 0) {
    log(`⚠️ ${plant.name} has ${slotsWithConflicts.length} fruit(s) with conflicting mutations (same fruit cannot be both amber+dawn or rainbow+gold)`);
  }

  // For multi-fruit plants: Log if the plant has BOTH color types across different fruits (this is valid and expected)
  // Commented out to reduce console spam - uncomment for debugging
  // if (hasAnyAmber && hasAnyDawn && slotStates.length > 1) {
  //   const amberCount = slotStates.filter((slot) => slot.hasAmberlit || slot.hasAmberbound).length;
  //   const dawnCount = slotStates.filter((slot) => slot.hasDawnlit || slot.hasDawnbound).length;
  //   log(`📊 ${plant.name} multi-fruit: ${amberCount} amber fruit(s), ${dawnCount} dawn fruit(s) - highlighting for both weather types`);
  // }

  let wetFinished = 0;
  let wetNeedsSnow = 0;
  let chilledFinished = 0;
  let chilledNeedsRain = 0;
  let dawnFinished = 0;
  let amberFinished = 0;
  let totalFruits = Math.max(plant.fruitCount, 1);
  let wetProgressTotal = 0;
  let wetProgressComplete = 0;
  let dawnProgressTotal = 0;
  let dawnProgressComplete = 0;
  let amberProgressTotal = 0;
  let amberProgressComplete = 0;

  for (const slot of slotStates) {
    const wetMutated = slot.hasWet || slot.hasFrozen;
    if (wetMutated) {
      wetFinished += 1;
    }
    if (slot.hasWet && !slot.hasFrozen) {
      wetNeedsSnow += 1;
    }
    const chilledMutated = slot.hasChilled || slot.hasFrozen;
    if (chilledMutated) {
      chilledFinished += 1;
    }
    if (slot.hasChilled && !slot.hasFrozen) {
      chilledNeedsRain += 1;
    }
    if (slot.hasDawnlit || slot.hasDawnbound) {
      dawnFinished += 1;
    }
    if (slot.hasAmberlit || slot.hasAmberbound) {
      amberFinished += 1;
    }

    const wetProgress = slot.progress?.wet;
    if (wetProgress) {
      wetProgressTotal = Math.max(wetProgressTotal, wetProgress.total);
      wetProgressComplete = Math.max(wetProgressComplete, wetProgress.complete);
    }
    const dawnProgress = slot.progress?.dawn;
    if (dawnProgress) {
      dawnProgressTotal = Math.max(dawnProgressTotal, dawnProgress.total);
      dawnProgressComplete = Math.max(dawnProgressComplete, dawnProgress.complete);
    }
    const amberProgress = slot.progress?.amber;
    if (amberProgress) {
      amberProgressTotal = Math.max(amberProgressTotal, amberProgress.total);
      amberProgressComplete = Math.max(amberProgressComplete, amberProgress.complete);
    }
  }
  totalFruits = Math.max(totalFruits, wetFinished, chilledFinished, dawnFinished, amberFinished);

  const clampDom = (value: number): number => Math.max(0, Math.min(totalFruits, value));
  const domFrozen = clampDom(plant.domMutationCounts.F);
  const domWetOnly = clampDom(plant.domMutationCounts.W);
  const domWetProgress = clampDom(domFrozen + domWetOnly);
  const domWetNeedsSnow = clampDom(Math.max(0, domWetProgress - domFrozen));
  const domChilledOnly = clampDom(plant.domMutationCounts.C);
  const domChilledProgress = clampDom(domFrozen + domChilledOnly);
  const domChilledNeedsRain = clampDom(Math.max(0, domChilledProgress - domFrozen));
  const domDawnComplete = clampDom(plant.domMutationCounts.D + plant.domBoldCounts.D);
  const domAmberComplete = clampDom(plant.domMutationCounts.A + plant.domBoldCounts.A);

  wetFinished = Math.max(wetFinished, domWetProgress);
  wetNeedsSnow = Math.max(wetNeedsSnow, domWetNeedsSnow);
  chilledFinished = Math.max(chilledFinished, domChilledProgress);
  chilledNeedsRain = Math.max(chilledNeedsRain, domChilledNeedsRain);
  dawnFinished = Math.max(dawnFinished, domDawnComplete);
  amberFinished = Math.max(amberFinished, domAmberComplete);

  if (wetProgressTotal > 0) {
    totalFruits = Math.max(totalFruits, wetProgressTotal);
    wetFinished = Math.max(wetFinished, wetProgressComplete);
  }
  if (dawnProgressTotal > 0) {
    totalFruits = Math.max(totalFruits, dawnProgressTotal);
    dawnFinished = Math.max(dawnFinished, dawnProgressComplete);
  }
  if (amberProgressTotal > 0) {
    totalFruits = Math.max(totalFruits, amberProgressTotal);
    amberFinished = Math.max(amberFinished, amberProgressComplete);
  }

  const wetPending = Math.max(0, totalFruits - wetFinished);
  const chilledPending = Math.max(0, totalFruits - chilledFinished);
  const dawnPending = Math.max(0, totalFruits - dawnFinished);
  const amberPending = Math.max(0, totalFruits - amberFinished);

  const inventoryDetail: PlantDebugDetail = {
    strategy: 'inventory',
    totalFruits,
    wetPending,
    wetFinished,
    wetNeedsSnow,
    wetProgressComplete,
    wetProgressTotal,
    domWetProgress,
    domWetNeedsSnow,
    dawnPending,
    dawnProgressComplete,
    dawnProgressTotal,
    domDawnComplete,
    amberPending,
    amberProgressComplete,
    amberProgressTotal,
    domAmberComplete,
    hasAnyDawn,
    hasAnyAmber,
    hasAnyRainbow,
    hasAnyGold,
  };

  let decision = false;
  let pendingFruits = 0;
  let needsSnow = wetNeedsSnow;

  switch (weather) {
    case 'rain':
      decision = wetPending > 0;
      pendingFruits = wetPending;
      break;
    case 'snow':
      if (chilledPending > 0) {
        // Priority 1: Highlight unmutated crops for new "Chilled" mutations
        decision = true;
        pendingFruits = chilledPending;
      } else {
        // Priority 2: Highlight "Wet" crops to upgrade to "Frozen"
        decision = wetNeedsSnow > 0;
        pendingFruits = wetNeedsSnow;
      }
      break;
    case 'dawn':
      // Allow dawn weather if there are dawn-pending fruits, even if some other fruits have amber
      // (multi-fruit plants can have different fruits needing different colors)
      decision = dawnPending > 0;
      pendingFruits = dawnPending;
      needsSnow = 0;
      break;
    case 'amber':
      // Allow amber weather if there are amber-pending fruits, even if some other fruits have dawn
      // (multi-fruit plants can have different fruits needing different colors)
      decision = amberPending > 0;
      pendingFruits = amberPending;
      needsSnow = 0;
      break;
    default:
      decision = false;
      pendingFruits = 0;
      needsSnow = 0;
      break;
  }

  const evaluation: PlantMutationEvaluation = {
    decision,
    pendingFruits: Math.max(0, pendingFruits),
    totalFruits: Math.max(1, totalFruits),
    needsSnow: Math.max(0, needsSnow),
    detail: { ...inventoryDetail },
  };

  if (emitDebug) {
    debugPlantDecision(plant, weather, evaluation.decision, evaluation.detail);
  }

  return evaluation;
}

function evaluatePlantFallback(
  plant: PlantData,
  weather: WeatherType,
  emitDebug: boolean,
): PlantMutationEvaluation {
  const { fruitCount, domMutationCounts, domBoldCounts } = plant;

  const totalFruits = Math.max(fruitCount, 0);
  if (totalFruits <= 0) {
    const emptyDetail: PlantDebugDetail = {
      strategy: 'fallback',
      fruitCount: totalFruits,
      frozenCount: 0,
      wetCount: 0,
      chilledCount: 0,
      dawnCount: 0,
      amberCount: 0,
      dawnBoundCount: 0,
      amberBoundCount: 0,
      rainbowCount: 0,
      goldCount: 0,
    };
    if (emitDebug) {
      debugPlantDecision(plant, weather, false, emptyDetail);
    }
    return {
      decision: false,
      pendingFruits: 0,
      totalFruits,
      needsSnow: 0,
      detail: emptyDetail,
    };
  }

  const clamp = (value: number): number => Math.max(0, Math.min(value, totalFruits));

  const frozenCount = clamp(domMutationCounts.F);
  const wetCount = clamp(domMutationCounts.W);
  const chilledCount = clamp(domMutationCounts.C);
  const dawnCount = clamp(domMutationCounts.D);
  const amberCount = clamp(domMutationCounts.A);
  const rainbowCount = clamp(domMutationCounts.R);
  const goldCount = clamp(domMutationCounts.G);
  const dawnBoundCount = clamp(domBoldCounts.D);
  const amberBoundCount = clamp(domBoldCounts.A);

  const detail: PlantDebugDetail = {
    strategy: 'fallback',
    fruitCount: totalFruits,
    frozenCount,
    wetCount,
    chilledCount,
    dawnCount,
    amberCount,
    dawnBoundCount,
    amberBoundCount,
    rainbowCount,
    goldCount,
  };

  let decision = false;
  let pendingFruits = 0;
  let needsSnow = Math.max(0, wetCount - frozenCount);

  switch (weather) {
    case 'rain': {
      const wetProgress = wetCount + frozenCount;
      if (wetProgress < totalFruits) {
        decision = true;
        pendingFruits = Math.max(0, totalFruits - wetProgress);
      } else {
        const chilledDeficit = chilledCount - frozenCount;
        decision = chilledDeficit > 0;
        pendingFruits = Math.max(0, chilledDeficit);
      }
      break;
    }
    case 'snow': {
      const chilledProgress = chilledCount + frozenCount;
      if (chilledProgress < totalFruits) {
        // Priority 1: Highlight unmutated crops for new "Chilled" mutations
        decision = true;
        pendingFruits = Math.max(0, totalFruits - chilledProgress);
      } else {
        // Priority 2: Highlight "Wet" crops to upgrade to "Frozen"
        const wetDeficit = wetCount - frozenCount;
        decision = wetDeficit > 0;
        pendingFruits = Math.max(0, wetDeficit);
      }
      // Update needsSnow for tracking (wet crops that need snow to freeze)
      needsSnow = Math.max(0, wetCount - frozenCount);
      break;
    }
    case 'dawn': {
      if (amberCount + amberBoundCount > 0) {
        decision = false;
        pendingFruits = 0;
        break;
      }
      const dawnProgress = dawnCount + dawnBoundCount;
      pendingFruits = Math.max(0, totalFruits - dawnProgress);
      decision = pendingFruits > 0;
      needsSnow = 0;
      break;
    }
    case 'amber': {
      if (dawnCount + dawnBoundCount > 0) {
        decision = false;
        pendingFruits = 0;
        break;
      }
      const amberProgress = amberCount + amberBoundCount;
      pendingFruits = Math.max(0, totalFruits - amberProgress);
      decision = pendingFruits > 0;
      needsSnow = 0;
      break;
    }
    default:
      decision = false;
      pendingFruits = 0;
      needsSnow = 0;
      break;
  }

  const evaluation: PlantMutationEvaluation = {
    decision,
    pendingFruits: Math.max(0, pendingFruits),
    totalFruits,
    needsSnow: Math.max(0, needsSnow),
    detail,
  };

  if (emitDebug) {
    debugPlantDecision(plant, weather, evaluation.decision, evaluation.detail);
  }

  return evaluation;
}

export type MutationSummaryCollector = (
  weather: MutationActiveWeather,
  plant: PlantData,
  stats: { pendingFruit: number; needsSnowFruit: number; tag?: string },
) => void;

export function buildMutationSummary(
  plants: PlantData[],
  activeWeather: WeatherType,
  weatherWindow: MutationWeatherWindow | null = null,
  collect?: MutationSummaryCollector,
): MutationSummary {
  const totals: Record<MutationActiveWeather, MutationWeatherSummary> = {
    rain: { weather: 'rain', plantCount: 0, pendingFruitCount: 0 },
    snow: { weather: 'snow', plantCount: 0, pendingFruitCount: 0, needsSnowFruitCount: 0 },
    dawn: { weather: 'dawn', plantCount: 0, pendingFruitCount: 0 },
    amber: { weather: 'amber', plantCount: 0, pendingFruitCount: 0 },
    thunderstorm: { weather: 'thunderstorm', plantCount: 0, pendingFruitCount: 0 },
  };

  const uniqueEligible = new Set<string>();
  const uniqueTracked = new Set<string>();
  const lunarTracked = new Set<string>();
  const lunarPending = new Set<string>();
  let lunarTotalFruitCount = 0;
  let lunarPendingFruitCount = 0;

  type EvaluationMap = Record<MutationActiveWeather, PlantMutationEvaluation>;

  const plantEvaluations: Array<{ plant: PlantData; evaluations: EvaluationMap; lunarTag: 'amber-preferred' | null }> = [];

  for (const plant of plants) {
    const evaluations = {
      rain: evaluatePlantForWeather(plant, 'rain', false),
      snow: evaluatePlantForWeather(plant, 'snow', false),
      dawn: evaluatePlantForWeather(plant, 'dawn', false),
      amber: evaluatePlantForWeather(plant, 'amber', false),
      thunderstorm: evaluatePlantForWeather(plant, 'thunderstorm', false),
    } satisfies EvaluationMap;

    // For multi-fruit plants: ALLOW both dawn and amber to be true simultaneously
    // Each evaluation has pendingFruits count - both can have pending fruits
    // Tag the plant so we can track it's eligible for both lunar weather types
    let lunarTag: 'amber-preferred' | null = null;
    const dawnEval = evaluations.dawn;
    const amberEval = evaluations.amber;
    if (dawnEval.decision && amberEval.decision) {
      // Both weather types have pending fruits - this is VALID for multi-fruit plants
      // Tag as amber-preferred for stats tracking, but DON'T disable dawn highlighting
      lunarTag = 'amber-preferred';
      // NOTE: We DO NOT modify evaluations.dawn here - both should remain active
    }

    plantEvaluations.push({ plant, evaluations, lunarTag });
  }

  for (const { plant, evaluations, lunarTag } of plantEvaluations) {
    const plantId = generatePlantId(plant);
    uniqueTracked.add(plantId);

    const amberEval = evaluations.amber;
    const dawnEval = evaluations.dawn;
    const amberPendingRaw = Math.max(0, Math.round(amberEval.pendingFruits));
    const dawnPendingRaw = Math.max(0, Math.round(dawnEval.pendingFruits));
    const amberTotalRaw = Math.max(0, Math.round(amberEval.totalFruits ?? 0));
    const dawnTotalRaw = Math.max(0, Math.round(dawnEval.totalFruits ?? 0));

    if (amberTotalRaw > 0 || dawnTotalRaw > 0) {
      lunarTracked.add(plantId);
    }

    let chosenEvaluation: PlantMutationEvaluation | null = null;
    if (amberTotalRaw > 0 || amberPendingRaw > 0) {
      chosenEvaluation = amberEval;
    } else if (dawnTotalRaw > 0 || dawnPendingRaw > 0) {
      chosenEvaluation = dawnEval;
    }

    if (chosenEvaluation) {
      const totalFruits = Math.max(0, Math.round(chosenEvaluation.totalFruits ?? 0));
      const pendingFruits = Math.max(0, Math.round(chosenEvaluation.pendingFruits));
      if (totalFruits > 0) {
        lunarTotalFruitCount += totalFruits;
        lunarPendingFruitCount += pendingFruits;
        if (pendingFruits > 0) {
          lunarPending.add(plantId);
        }
      }
    }

    for (const weather of MUTATION_WEATHERS) {
      const evaluation = evaluations[weather];
      if (!evaluation.decision) {
        continue;
      }

      const pendingFruit = Math.max(0, Math.round(evaluation.pendingFruits));
      const needsSnowFruit = weather === 'snow' ? Math.max(0, Math.round(evaluation.needsSnow)) : 0;
      const tag = weather === 'amber' && lunarTag === 'amber-preferred' ? 'lunar-any' : undefined;

      totals[weather].plantCount += 1;
      totals[weather].pendingFruitCount += pendingFruit;
      if (weather === 'snow') {
        totals[weather].needsSnowFruitCount =
          (totals[weather].needsSnowFruitCount ?? 0) + needsSnowFruit;
      }

      const stats: { pendingFruit: number; needsSnowFruit: number; tag?: string } = {
        pendingFruit,
        needsSnowFruit,
      };
      if (tag) {
        stats.tag = tag;
      }
      collect?.(weather, plant, stats);

      uniqueEligible.add(plantId);
    }
  }

  const overallPendingFruitCount = MUTATION_WEATHERS.reduce(
    (sum, weather) => sum + totals[weather].pendingFruitCount,
    0,
  );

  const overallTrackedPlantCount = uniqueTracked.size;
  const lunarTrackedPlantCount = lunarTracked.size;
  const lunarPendingPlantCount = lunarPending.size;
  const lunarMutatedPlantCount = Math.max(0, lunarTrackedPlantCount - lunarPendingPlantCount);
  const lunarMutatedFruitCount = Math.max(0, lunarTotalFruitCount - lunarPendingFruitCount);

  const normalizedWindow = weatherWindow
    ? {
        ...weatherWindow,
        remainingMs:
          weatherWindow.expectedEndAt != null
            ? Math.max(0, weatherWindow.expectedEndAt - Date.now())
            : weatherWindow.remainingMs ?? null,
      }
    : null;

  return {
    timestamp: Date.now(),
    activeWeather,
    totals,
    overallEligiblePlantCount: uniqueEligible.size,
    overallPendingFruitCount,
    overallTrackedPlantCount,
    lunar: {
      trackedPlantCount: lunarTrackedPlantCount,
      pendingPlantCount: lunarPendingPlantCount,
      mutatedPlantCount: lunarMutatedPlantCount,
      totalFruitCount: lunarTotalFruitCount,
      pendingFruitCount: lunarPendingFruitCount,
      mutatedFruitCount: lunarMutatedFruitCount,
    },
    weatherWindow: normalizedWindow,
  };
}

/**
 * Reapply highlights to plants that are in the tracking set
 * Called when inventory reopens to restore highlights after DOM recreation
 */
async function reapplyHighlights(): Promise<void> {
  if (highlightedPlantIds.size === 0) {
    log('⏭️ No highlights to reapply');
    return;
  }
  
  log(`🔍 Reapplying highlights for ${highlightedPlantIds.size} tracked plants...`);
  
  // Scan current inventory
  const plants = await scanInventoryForPlants();
  if (plants.length === 0) {
    log('⚠️ No plants found in inventory for reapply');
    return;
  }
  
  // Filter to only plants that should be highlighted (in tracking set)
  const plantsToHighlight = plants.filter(plant => {
    const plantId = generatePlantId(plant);
    return highlightedPlantIds.has(plantId);
  });
  
  if (plantsToHighlight.length > 0) {
    log(`✨ Reapplying ${plantsToHighlight.length} highlights`);
    highlightPlants(plantsToHighlight);
  } else {
    log('⚠️ None of the tracked plants found in current inventory');
  }
}

/**
 * Highlight plants in inventory
 */
function highlightPlants(plants: PlantData[]): void {
  // Highlight plants that are in our tracking set
  
  for (const plant of plants) {
    const plantId = generatePlantId(plant);
    
    // Only highlight if this plant is in our tracking set
    if (!highlightedPlantIds.has(plantId)) {
      continue;
    }
    
    // Check if this plant already has a highlight
    const parent = plant.element.parentElement;
    if (!parent) continue;
    
    const existingHighlight = parent.querySelector('.quinoa-mutation-highlight');
    if (existingHighlight) {
      // Already highlighted, skip
      continue;
    }
    
    const highlight = document.createElement('div');
    highlight.className = 'quinoa-mutation-highlight';
    highlight.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border: 3px solid #4CAF50;
      border-radius: 8px;
      pointer-events: auto;
      z-index: 10;
      animation: quinoa-pulse 1.5s infinite;
      box-shadow: 0 0 15px rgba(76, 175, 80, 0.8);
      cursor: pointer;
    `;
    
    // Store plant ID on the highlight element for removal
    (highlight as any).__plantId = plantId;
    
    // Add click handler to remove highlight for this specific plant
    highlight.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (highlight as any).__plantId;
      if (id) {
        highlightedPlantIds.delete(id);
        log(`✅ Manually removed highlight from ${plant.name}`);
      }
      highlight.remove();
    });
    
    parent.style.position = 'relative';
    parent.appendChild(highlight);
  }
  
  // Add animation CSS if not already added
  if (!document.getElementById('quinoa-mutation-styles')) {
    const style = document.createElement('style');
    style.id = 'quinoa-mutation-styles';
    style.textContent = `
      @keyframes quinoa-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Clear all plant highlights
 */
function clearHighlights(): void {
  const existingHighlights = $$('.quinoa-mutation-highlight');
  existingHighlights.forEach(el => el.remove());
  highlightedPlantIds.clear(); // Clear the tracking set
  log('✨ Cleared plant highlights');
}

/**
 * Show mutation notification
 */
function showMutationNotification(plants: PlantData[], weather: WeatherType): void {
  const message = getMutationMessage(plants, weather);
  
  showSimpleNotification(
    `${getWeatherEmoji(weather)} ${weather.toUpperCase()} Weather!`,
    `Place ${plants.length} plant${plants.length > 1 ? 's' : ''} ${getMutationAction(weather)}`,
    'success'
  );
}

/**
 * Show a simple notification banner
 */
function showSimpleNotification(title: string, message: string, type: 'success' | 'info' | 'warning' = 'info'): void {
  const colors = {
    success: 'rgba(76, 175, 80, 0.95)',
    info: 'rgba(33, 150, 243, 0.95)',
    warning: 'rgba(255, 152, 0, 0.95)',
  };
  
  // Find existing notifications to stack properly
  const existingNotifications = document.querySelectorAll('.quinoa-notification');
  let topOffset = 20;
  existingNotifications.forEach((notif: Element) => {
    const rect = (notif as HTMLElement).getBoundingClientRect();
    topOffset = Math.max(topOffset, rect.bottom - document.documentElement.getBoundingClientRect().top + 10);
  });
  
  // Create notification element
  const notification = document.createElement('div');
  notification.classList.add('quinoa-notification');
  notification.style.cssText = `
    position: fixed;
    top: ${topOffset}px;
    right: 20px;
    background: ${colors[type]};
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    font-family: Arial, sans-serif;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 999999;
    max-width: 320px;
    animation: slideInRight 0.3s ease-out;
    transition: top 0.3s ease-out;
  `;
  
  notification.innerHTML = '';
  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'font-size: 16px; font-weight: bold; margin-bottom: 4px;';
  titleDiv.textContent = title;
  const msgDiv = document.createElement('div');
  msgDiv.style.cssText = 'font-size: 13px; opacity: 0.95;';
  msgDiv.textContent = message;
  notification.append(titleDiv, msgDiv);
  
  // Add animation CSS if not already added
  if (!document.getElementById('quinoa-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'quinoa-notification-styles';
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(notification);
  
  // Auto-remove after 6 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => {
      notification.remove();
      // Reposition remaining notifications
      repositionNotifications();
    }, 300);
  }, 6000);
}

/**
 * Reposition stacked notifications after one is removed
 */
function repositionNotifications(): void {
  const notifications = document.querySelectorAll('.quinoa-notification');
  let topOffset = 20;
  notifications.forEach((notif: Element) => {
    (notif as HTMLElement).style.top = `${topOffset}px`;
    const rect = (notif as HTMLElement).getBoundingClientRect();
    topOffset = rect.bottom - document.documentElement.getBoundingClientRect().top + 10;
  });
}

/**
 * Get mutation notification message
 */
function getMutationMessage(plants: PlantData[], weather: WeatherType): string {
  const weatherEmoji = getWeatherEmoji(weather);
  const count = plants.length;
  
  const action = getMutationAction(weather);
  
  return `${weatherEmoji} ${weather.toUpperCase()}! Place ${count} plant${count > 1 ? 's' : ''} ${action}`;
}

/**
 * Get mutation action description
 */
function getMutationAction(weather: WeatherType): string {
  switch (weather) {
    case 'rain':
      return 'to freeze (C→F)';
    case 'snow':
      return 'to freeze (W→F)';
    case 'dawn':
      return 'to get Dawnlit';
    case 'amber':
      return 'to get Amberlit';
    default:
      return 'for mutations';
  }
}

/**
 * Get weather emoji
 */
function getWeatherEmoji(weather: WeatherType): string {
  switch (weather) {
    case 'rain':
      return '🌧️';
    case 'snow':
      return '❄️';
    case 'dawn':
      return '🌅';
    case 'amber':
      return '🌆';
    case 'sunny':
      return '☀️';
    default:
      return '❓';
  }
}

/**
 * Manual check for mutations (triggered by UI button)
 */
export async function manualCheckMutations(): Promise<void> {
  log('🔍 Manual mutation check triggered');
  updateStatus('Checking for mutations...');
  await checkInventoryForMutations();
}
