// src/catalogs/catalogLoader.ts
// Runtime catalog capture system using Object.* method interception
// Based on proven MG Catalog Dumper pattern
// NOTE: Keep this module lightweight and early-init safe.
// It only imports local catalog logic helpers to avoid app-layer cycles.

import { DEFAULT_ABILITY_COLOR, getAbilityColorMap } from './logic/abilityColors';
import { getWeatherCatalogMap } from './logic/weatherCatalog';
import { pageWindow, readSharedGlobal, shareGlobal } from '../core/pageContext';
import type { GameCatalogs } from './types';

// Local log function to avoid circular imports
const CATALOG_PREFIX = '[QPM Catalog]';
function catalogLog(...args: unknown[]): void {
  const isVerbose = readSharedGlobal('__QPM_VERBOSE_LOGS') === true;
  const isCatalogDebug = readSharedGlobal('__QPM_DEBUG_CATALOGS') === true;
  const isAbilityColorDebug = readSharedGlobal('__QPM_DEBUG_ABILITY_COLORS') === true;
  const isWeatherCatalogDebug = readSharedGlobal('__QPM_DEBUG_WEATHER_CATALOG') === true;
  if (isVerbose || isCatalogDebug || isAbilityColorDebug || isWeatherCatalogDebug) {
    console.log(CATALOG_PREFIX, ...args);
  }
}

// ============================================================================
// GLOBAL STATE
// ============================================================================

/**
 * Storage for captured catalogs
 * Exposed globally as window.__QPM_CATALOGS for debugging
 */
const capturedCatalogs: GameCatalogs = {
  itemCatalog: null,
  decorCatalog: null,
  mutationCatalog: null,
  eggCatalog: null,
  petCatalog: null,
  petAbilities: null,
  plantCatalog: null,
  weatherCatalog: null,
};

// Track objects we've already scanned to avoid infinite loops
const seenObjects = new WeakSet<object>();

// Ready state tracking
let catalogsReady = false;
const readyCallbacks: Array<(catalogs: GameCatalogs) => void> = [];
const errorCallbacks: Array<(error: Error) => void> = [];

// Use the page window's Object constructor so hooks intercept game-context calls,
// not just sandbox-context calls (Tampermonkey isolates the userscript when @grant is used).
const NativeObject = (pageWindow as unknown as { Object: typeof Object }).Object;
const originalKeys = NativeObject.keys;
const originalValues = NativeObject.values;
const originalEntries = NativeObject.entries;

// Ability color enrichment poller state
const ABILITY_COLOR_POLL_INTERVAL_MS = 1000;
const MAX_ABILITY_COLOR_POLL_ATTEMPTS = 10;
const ABILITY_COLOR_ANCHORS = ['ProduceScaleBoost', 'RainbowGranter', 'GoldGranter'];
let abilityColorPollTimer: ReturnType<typeof setInterval> | null = null;
let abilityColorPollAttempts = 0;
let abilityColorEnrichInFlight: Promise<boolean> | null = null;
const WEATHER_CATALOG_POLL_INTERVAL_MS = 500;
const MAX_WEATHER_CATALOG_POLL_ATTEMPTS = 20;
let weatherCatalogPollTimer: ReturnType<typeof setInterval> | null = null;
let weatherCatalogPollAttempts = 0;
let weatherCatalogEnrichInFlight: Promise<boolean> | null = null;
const shouldLogAbilityColorDebug = (): boolean => {
  try {
    return readSharedGlobal('__QPM_DEBUG_ABILITY_COLORS') === true;
  } catch {
    return false;
  }
};

function publishCatalogs(): void {
  try {
    shareGlobal('__QPM_CATALOGS', capturedCatalogs);
  } catch (err) {
    catalogLog('Failed to expose __QPM_CATALOGS to window:', err);
  }
}

function readAbilityColorBg(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  const color = record.color;

  if (typeof color === 'string') {
    const trimmed = color.trim();
    return trimmed.length ? trimmed : null;
  }
  if (!color || typeof color !== 'object') return null;

  const bg = (color as Record<string, unknown>).bg;
  if (typeof bg === 'string') {
    const trimmed = bg.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function arePetAbilityColorsEnriched(abilities: Record<string, unknown>): boolean {
  return ABILITY_COLOR_ANCHORS.some(id => readAbilityColorBg(abilities[id]) !== null);
}

function isWeatherCatalogEnriched(catalog: GameCatalogs['weatherCatalog']): boolean {
  return !!catalog && typeof catalog === 'object' && Object.keys(catalog).length > 0;
}

async function enrichPetAbilityColors(): Promise<boolean> {
  if (!capturedCatalogs.petAbilities) return false;
  const abilities = capturedCatalogs.petAbilities as Record<string, unknown>;
  if (arePetAbilityColorsEnriched(abilities)) return true;
  if (abilityColorEnrichInFlight) return abilityColorEnrichInFlight;

  abilityColorEnrichInFlight = (async () => {
    const colorMap = await getAbilityColorMap();
    if (!colorMap) return false;

    const enriched: Record<string, unknown> = {};
    let updatedCount = 0;

    for (const [abilityId, abilityDef] of Object.entries(abilities)) {
      const entry = abilityDef && typeof abilityDef === 'object'
        ? { ...(abilityDef as Record<string, unknown>) }
        : {};

      if (readAbilityColorBg(entry) === null) {
        const mapped = colorMap[abilityId] || DEFAULT_ABILITY_COLOR;
        entry.color = {
          bg: mapped.bg,
          hover: mapped.hover || mapped.bg,
        };
        updatedCount += 1;
      }
      enriched[abilityId] = entry;
    }

    if (updatedCount > 0) {
      capturedCatalogs.petAbilities = enriched as GameCatalogs['petAbilities'];
      catalogLog(`Enriched ability colors from runtime bundle (${updatedCount} abilities).`);
      publishCatalogs();
    }

    return arePetAbilityColorsEnriched(enriched);
  })().finally(() => {
    abilityColorEnrichInFlight = null;
  });

  return abilityColorEnrichInFlight;
}

async function enrichWeatherCatalog(): Promise<boolean> {
  if (isWeatherCatalogEnriched(capturedCatalogs.weatherCatalog)) return true;
  if (weatherCatalogEnrichInFlight) return weatherCatalogEnrichInFlight;

  weatherCatalogEnrichInFlight = (async () => {
    const weatherCatalog = await getWeatherCatalogMap();
    if (!weatherCatalog) return false;

    capturedCatalogs.weatherCatalog = weatherCatalog as GameCatalogs['weatherCatalog'];
    catalogLog(`Enriched weather catalog from runtime bundle (${Object.keys(weatherCatalog).length} entries).`);
    publishCatalogs();
    return true;
  })().finally(() => {
    weatherCatalogEnrichInFlight = null;
  });

  return weatherCatalogEnrichInFlight;
}

function stopAbilityColorPolling(): void {
  if (!abilityColorPollTimer) return;
  clearInterval(abilityColorPollTimer);
  abilityColorPollTimer = null;
}

function stopWeatherCatalogPolling(): void {
  if (!weatherCatalogPollTimer) return;
  clearInterval(weatherCatalogPollTimer);
  weatherCatalogPollTimer = null;
}

function startAbilityColorPolling(): void {
  if (abilityColorPollTimer) return;
  abilityColorPollAttempts = 0;

  // Immediate attempt first, then bounded retry polling.
  void enrichPetAbilityColors();

  abilityColorPollTimer = setInterval(() => {
    void (async () => {
      // Gemini-style enrichment depends on having the ability catalog first.
      // Do not consume retry budget before abilities are captured.
      if (!capturedCatalogs.petAbilities) return;

      const enriched = await enrichPetAbilityColors();
      abilityColorPollAttempts += 1;
      if (enriched) {
        stopAbilityColorPolling();
        return;
      }
      if (abilityColorPollAttempts >= MAX_ABILITY_COLOR_POLL_ATTEMPTS) {
        if (shouldLogAbilityColorDebug()) {
          catalogLog('Ability color enrichment timed out, using fallback colors.');
        }
        stopAbilityColorPolling();
      }
    })();
  }, ABILITY_COLOR_POLL_INTERVAL_MS);
}

function startWeatherCatalogPolling(): void {
  if (weatherCatalogPollTimer) return;
  weatherCatalogPollAttempts = 0;

  // Immediate attempt first, then bounded retry polling.
  void enrichWeatherCatalog();

  weatherCatalogPollTimer = setInterval(() => {
    void (async () => {
      const enriched = await enrichWeatherCatalog();
      weatherCatalogPollAttempts += 1;
      if (enriched) {
        stopWeatherCatalogPolling();
        return;
      }
      if (weatherCatalogPollAttempts >= MAX_WEATHER_CATALOG_POLL_ATTEMPTS) {
        stopWeatherCatalogPolling();
      }
    })();
  }, WEATHER_CATALOG_POLL_INTERVAL_MS);
}

// ============================================================================
// CATALOG DETECTION FUNCTIONS
// These identify catalogs by their unique "fingerprint" properties
// ============================================================================

/**
 * Detect itemCatalog: has WateringCan, PlanterPot, Shovel, RainbowPotion
 * with coinPrice and creditPrice properties
 */
function looksLikeItemCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const required = ['WateringCan', 'PlanterPot', 'Shovel', 'RainbowPotion'];
  if (!required.every(k => keys.includes(k))) return false;

  const sample = obj.WateringCan;
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'coinPrice' in sample &&
    'creditPrice' in sample
  );
}

/**
 * Detect decorCatalog: has rock types with coinPrice/creditPrice
 */
function looksLikeDecorCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const required = ['SmallRock', 'MediumRock', 'LargeRock'];
  if (!required.every(k => keys.includes(k))) return false;

  const sample = obj.SmallRock;
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'coinPrice' in sample &&
    'creditPrice' in sample
  );
}

/**
 * Detect mutationCatalog: has Gold, Rainbow, Wet, etc. with baseChance/coinMultiplier
 */
function looksLikeMutationCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const required = ['Gold', 'Rainbow', 'Wet', 'Chilled', 'Frozen'];
  if (!required.every(k => keys.includes(k))) return false;

  const sample = obj.Gold;
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'baseChance' in sample &&
    'coinMultiplier' in sample
  );
}

/**
 * Detect eggCatalog: has egg types with faunaSpawnWeights and secondsToHatch
 */
function looksLikeEggCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const required = ['CommonEgg', 'UncommonEgg', 'RareEgg', 'LegendaryEgg'];
  if (!required.every(k => keys.includes(k))) return false;

  const sample = obj.CommonEgg;
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'faunaSpawnWeights' in sample &&
    'secondsToHatch' in sample
  );
}

/**
 * Detect petCatalog: has pet species with diet array and coinsToFullyReplenishHunger
 * RELAXED DETECTION: Only requires 3 of 5 common pets to allow for game updates
 */
function looksLikePetCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const commonPets = ['Worm', 'Snail', 'Bee', 'Chicken', 'Bunny', 'Turkey', 'Goat'];

  // Count how many common pets are present
  const matchCount = commonPets.filter(k => keys.includes(k)).length;

  // Require at least 3 common pets (more flexible for game updates)
  if (matchCount < 3) return false;

  // Find a sample pet to check structure
  const sampleKey = commonPets.find(k => keys.includes(k));
  if (!sampleKey) return false;

  const sample = obj[sampleKey];
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'coinsToFullyReplenishHunger' in sample &&
    'diet' in sample &&
    Array.isArray((sample as { diet: unknown }).diet)
  );
}

/**
 * Detect petAbilities: has ability names with trigger and baseParameters
 */
function looksLikePetAbilities(obj: Record<string, unknown>, keys: string[]): boolean {
  const required = ['ProduceScaleBoost', 'DoubleHarvest', 'SeedFinderI', 'CoinFinderI'];
  if (!required.every(k => keys.includes(k))) return false;

  const sample = obj.ProduceScaleBoost;
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'trigger' in sample &&
    'baseParameters' in sample
  );
}

/**
 * Detect plantCatalog: has plant species with seed/plant/crop sub-objects
 * RELAXED DETECTION: Only requires 3 of 5 common plants to allow for game updates
 */
function looksLikePlantCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const commonPlants = ['Carrot', 'Strawberry', 'Aloe', 'Blueberry', 'Apple', 'Tomato', 'Corn'];

  // Count how many common plants are present
  const matchCount = commonPlants.filter(k => keys.includes(k)).length;

  // Require at least 3 common plants (more flexible for game updates)
  if (matchCount < 3) return false;

  // Find a sample plant to check structure
  const sampleKey = commonPlants.find(k => keys.includes(k));
  if (!sampleKey) return false;

  const sample = obj[sampleKey];
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'seed' in sample &&
    'plant' in sample &&
    'crop' in sample
  );
}

/**
 * Detect weatherCatalog: weather IDs with mutator/iconSpriteKey metadata.
 */
function looksLikeWeatherCatalog(obj: Record<string, unknown>, keys: string[]): boolean {
  const hasRain = keys.includes('Rain');
  const hasDawn = keys.includes('Dawn');
  const hasThunderstorm = keys.includes('Thunderstorm');
  const hasAmber = keys.includes('AmberMoon');
  const hasSnowFamily = keys.includes('Frost') || keys.includes('Snow');

  if (!hasRain || !hasDawn || !hasThunderstorm || !hasAmber || !hasSnowFamily) {
    return false;
  }

  const rain = obj.Rain;
  if (!rain || typeof rain !== 'object') return false;

  const rainRecord = rain as Record<string, unknown>;
  const rainMutation = (rainRecord.mutator as Record<string, unknown> | undefined)?.mutation;
  const hasWeatherLikeShape =
    typeof rainRecord.iconSpriteKey === 'string' ||
    typeof rainRecord.name === 'string' ||
    typeof rainMutation === 'string';

  if (!hasWeatherLikeShape) return false;
  if (typeof rainMutation === 'string' && rainMutation !== 'Wet') return false;

  return true;
}

function normalizeWeatherCatalog(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ids = ['Rain', 'Frost', 'Snow', 'Thunderstorm', 'Dawn', 'AmberMoon'];

  for (const id of ids) {
    const entry = source[id];
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const spriteId = typeof raw.iconSpriteKey === 'string' ? raw.iconSpriteKey : null;
    out[id] = {
      weatherId: id,
      spriteId,
      ...raw,
    };
  }

  if (out.Frost && !out.Snow) {
    out.Snow = { ...(out.Frost as Record<string, unknown>), weatherId: 'Snow', name: 'Snow' };
  }
  if (out.Snow && !out.Frost) {
    out.Frost = { ...(out.Snow as Record<string, unknown>), weatherId: 'Frost', name: 'Frost' };
  }
  if (!out.Sunny) {
    out.Sunny = {
      weatherId: 'Sunny',
      name: 'Sunny',
      spriteId: 'sprite/ui/SunnyIcon',
      type: 'primary',
    };
  }

  return out;
}

// ============================================================================
// DEEP SCAN LOGIC
// ============================================================================

/**
 * Recursively scan an object and its children for catalog patterns
 * Limited to depth 3 to avoid performance issues
 */
function deepScan(obj: unknown, depth: number): void {
  if (!obj || typeof obj !== 'object') return;
  if (seenObjects.has(obj as object)) return;
  seenObjects.add(obj as object);

  let keys: string[] = [];
  try {
    keys = originalKeys.call(NativeObject, obj);
  } catch {
    return;
  }

  if (keys.length === 0) return;

  const record = obj as Record<string, unknown>;
  let didCapture = false;

  try {
    // Check each catalog type (only if not already captured)
    if (!capturedCatalogs.itemCatalog && looksLikeItemCatalog(record, keys)) {
      capturedCatalogs.itemCatalog = record as GameCatalogs['itemCatalog'];
      catalogLog('Captured itemCatalog');
      didCapture = true;
    }

    if (!capturedCatalogs.decorCatalog && looksLikeDecorCatalog(record, keys)) {
      capturedCatalogs.decorCatalog = record as GameCatalogs['decorCatalog'];
      catalogLog('Captured decorCatalog');
      didCapture = true;
    }

    if (!capturedCatalogs.mutationCatalog && looksLikeMutationCatalog(record, keys)) {
      capturedCatalogs.mutationCatalog = record as GameCatalogs['mutationCatalog'];
      catalogLog('Captured mutationCatalog');
      didCapture = true;
    }

    if (!capturedCatalogs.eggCatalog && looksLikeEggCatalog(record, keys)) {
      capturedCatalogs.eggCatalog = record as GameCatalogs['eggCatalog'];
      catalogLog('Captured eggCatalog');
      didCapture = true;
    }

    if (!capturedCatalogs.petCatalog && looksLikePetCatalog(record, keys)) {
      capturedCatalogs.petCatalog = record as GameCatalogs['petCatalog'];
      catalogLog(`Captured petCatalog with ${keys.length} species:`, keys.slice(0, 10).join(', '), '...');
      didCapture = true;
    }

    if (!capturedCatalogs.petAbilities && looksLikePetAbilities(record, keys)) {
      capturedCatalogs.petAbilities = record as GameCatalogs['petAbilities'];
      catalogLog('Captured petAbilities');
      didCapture = true;
      // Reset retry budget when abilities become available.
      abilityColorPollAttempts = 0;
      void enrichPetAbilityColors();
    }

    if (!capturedCatalogs.plantCatalog && looksLikePlantCatalog(record, keys)) {
      capturedCatalogs.plantCatalog = record as GameCatalogs['plantCatalog'];
      catalogLog(`Captured plantCatalog with ${keys.length} species:`, keys.slice(0, 10).join(', '), '...');
      didCapture = true;
    }

    if (!capturedCatalogs.weatherCatalog && looksLikeWeatherCatalog(record, keys)) {
      capturedCatalogs.weatherCatalog = normalizeWeatherCatalog(record) as GameCatalogs['weatherCatalog'];
      catalogLog(`Captured weatherCatalog with ${Object.keys(capturedCatalogs.weatherCatalog ?? {}).length} entries.`);
      didCapture = true;
      stopWeatherCatalogPolling();
    }

    if (didCapture) {
      publishCatalogs();
    }

    // Check if essential catalogs are ready and notify waiters
    checkAndNotifyReady();
  } catch (e) {
    // Silently ignore detection errors
  }

  // Don't recurse too deep - performance optimization
  if (depth >= 3) return;

  // Recursively scan child objects
  for (const key of keys) {
    try {
      const value = record[key];
      if (value && typeof value === 'object') {
        deepScan(value, depth + 1);
      }
    } catch {
      // Ignore access errors
    }
  }
}

/**
 * Entry point for scanning an object
 */
function maybeCapture(obj: unknown): void {
  try {
    deepScan(obj, 0);
  } catch {
    // Silently ignore
  }
}

// ============================================================================
// READY STATE MANAGEMENT
// ============================================================================

/**
 * Check if essential catalogs are loaded and notify waiting callbacks
 */
function checkAndNotifyReady(): void {
  if (catalogsReady) return;

  // Consider ready when petCatalog is available (most important for automation)
  // Other catalogs are nice-to-have but not blocking
  const hasEssentials = capturedCatalogs.petCatalog !== null;

  if (hasEssentials) {
    catalogsReady = true;
    catalogLog('Essential catalogs ready');

    // Expose globally for debugging
    publishCatalogs();

    // Notify all waiting callbacks
    for (const callback of readyCallbacks) {
      try {
        callback(capturedCatalogs);
      } catch (e) {
        console.error('[Catalog] Ready callback error:', e);
      }
    }
    readyCallbacks.length = 0;
  }
}

// ============================================================================
// OBJECT.* METHOD HOOKS
// ============================================================================

/**
 * Install hooks on Object.keys, Object.values, Object.entries
 * These intercept all iterations over objects in the game code
 */
function installHooks(): void {
  try {
    // Hook Object.keys
    NativeObject.keys = function hookedKeys(target: object): string[] {
      maybeCapture(target);
      return originalKeys.call(NativeObject, target);
    };

    // Hook Object.values
    if (originalValues) {
      NativeObject.values = function hookedValues<T>(target: Record<string, T>): T[] {
        maybeCapture(target);
        return originalValues.call(NativeObject, target);
      };
    }

    // Hook Object.entries
    if (originalEntries) {
      NativeObject.entries = function hookedEntries<T>(target: Record<string, T>): [string, T][] {
        maybeCapture(target);
        return originalEntries.call(NativeObject, target);
      };
    }

    catalogLog('Object.* hooks installed');
  } catch (e) {
    console.error('[Catalog] Failed to install hooks:', e);
  }
}

/**
 * Remove hooks and restore original Object methods
 */
function removeHooks(): void {
  try {
    NativeObject.keys = originalKeys;
    if (originalValues) {
      NativeObject.values = originalValues;
    }
    if (originalEntries) {
      NativeObject.entries = originalEntries;
    }
    catalogLog('Object.* hooks removed');
  } catch {
    // Ignore
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get current captured catalogs (may be partially loaded)
 */
export function getCatalogs(): GameCatalogs {
  return capturedCatalogs;
}

/**
 * Check if catalogs are ready
 */
export function areCatalogsReady(): boolean {
  return catalogsReady;
}

/**
 * Wait for catalogs to be ready
 * @param timeoutMs Maximum time to wait (default 15 seconds)
 * @returns Promise that resolves with catalogs or rejects on timeout
 */
export function waitForCatalogs(timeoutMs: number = 15000): Promise<GameCatalogs> {
  return new Promise((resolve, reject) => {
    // Already ready
    if (catalogsReady) {
      resolve(capturedCatalogs);
      return;
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      // Remove from callbacks
      const readyIdx = readyCallbacks.indexOf(onReady);
      if (readyIdx !== -1) readyCallbacks.splice(readyIdx, 1);
      const errorIdx = errorCallbacks.indexOf(onError);
      if (errorIdx !== -1) errorCallbacks.splice(errorIdx, 1);

      reject(new Error(`Catalogs not ready within ${timeoutMs}ms`));
    }, timeoutMs);

    const onReady = (catalogs: GameCatalogs) => {
      clearTimeout(timeoutId);
      resolve(catalogs);
    };

    const onError = (error: Error) => {
      clearTimeout(timeoutId);
      reject(error);
    };

    readyCallbacks.push(onReady);
    errorCallbacks.push(onError);
  });
}

/**
 * Register callback for when catalogs are ready
 * If already ready, callback is called immediately
 * @returns Unsubscribe function
 */
export function onCatalogsReady(callback: (catalogs: GameCatalogs) => void): () => void {
  if (catalogsReady) {
    try {
      callback(capturedCatalogs);
    } catch (e) {
      console.error('[Catalog] onCatalogsReady callback error:', e);
    }
    return () => {};
  }

  readyCallbacks.push(callback);
  return () => {
    const idx = readyCallbacks.indexOf(callback);
    if (idx !== -1) readyCallbacks.splice(idx, 1);
  };
}

/**
 * Initialize the catalog loader
 * MUST be called as early as possible (ideally at document-start)
 */
export function initCatalogLoader(): void {
  catalogLog('Initializing catalog loader...');
  installHooks();
  startAbilityColorPolling();
  startWeatherCatalogPolling();

  // Auto-remove hooks after catalogs are ready (optimization)
  // Keep them for longer to catch late-loading catalog updates
  onCatalogsReady(() => {
    setTimeout(() => {
      // Only remove if all important catalogs are captured
      if (
        capturedCatalogs.petCatalog &&
        capturedCatalogs.plantCatalog &&
        capturedCatalogs.eggCatalog
      ) {
        catalogLog('Removing hooks after successful capture');
        removeHooks();
      }
    }, 30000); // Increased from 5s to 30s to catch late-loading species
  });
}

/**
 * Force cleanup - call when script unloads
 */
export function cleanupCatalogLoader(): void {
  removeHooks();
  stopAbilityColorPolling();
  stopWeatherCatalogPolling();
  readyCallbacks.length = 0;
  errorCallbacks.length = 0;
}

/**
 * Force a weather-catalog enrichment attempt on demand (debug utility).
 */
export async function forceWeatherCatalogRefresh(): Promise<{ success: boolean; count: number }> {
  weatherCatalogPollAttempts = 0;
  let success = await enrichWeatherCatalog();

  if (!success && !capturedCatalogs.weatherCatalog) {
    // Force one direct scan pass over page globals to capture weather objects
    // that might never hit Object.* hooks after initial load.
    try {
      const keys = originalKeys.call(NativeObject, pageWindow as unknown as object);
      for (const key of keys) {
        maybeCapture((pageWindow as unknown as Record<string, unknown>)[key]);
      }
    } catch {
      // Ignore scan errors.
    }
    success = !!capturedCatalogs.weatherCatalog || await enrichWeatherCatalog();
  }

  if (!success) {
    startWeatherCatalogPolling();
  }

  const count = capturedCatalogs.weatherCatalog ? Object.keys(capturedCatalogs.weatherCatalog).length : 0;
  return { success, count };
}

/**
 * Diagnostic: Manually check and log current catalog status
 * Useful for debugging catalog loading issues
 */
export function diagnoseCatalogs(): void {
  console.log('[QPM Catalog Diagnostics]');
  console.log('Catalogs Ready:', catalogsReady);
  console.log('Hooks Active:', NativeObject.keys !== originalKeys);

  const catalogs = capturedCatalogs;

  console.log('\nPlant Catalog:',
    catalogs.plantCatalog ? `OK ${Object.keys(catalogs.plantCatalog).length} species` : 'NOT CAPTURED'
  );
  if (catalogs.plantCatalog) {
    console.log('  Species:', Object.keys(catalogs.plantCatalog).join(', '));
  }

  console.log('\nPet Catalog:',
    catalogs.petCatalog ? `OK ${Object.keys(catalogs.petCatalog).length} species` : 'NOT CAPTURED'
  );
  if (catalogs.petCatalog) {
    console.log('  Species:', Object.keys(catalogs.petCatalog).join(', '));
  }

  console.log('\nPet Abilities:',
    catalogs.petAbilities ? `OK ${Object.keys(catalogs.petAbilities).length} abilities` : 'NOT CAPTURED'
  );
  if (catalogs.petAbilities) {
    console.log('  Abilities:', Object.keys(catalogs.petAbilities).slice(0, 20).join(', '), '...');
  }

  console.log('\nMutation Catalog:',
    catalogs.mutationCatalog ? `OK ${Object.keys(catalogs.mutationCatalog).length} mutations` : 'NOT CAPTURED'
  );

  console.log('\nWeather Catalog:',
    catalogs.weatherCatalog ? `OK ${Object.keys(catalogs.weatherCatalog).length} entries` : 'NOT CAPTURED'
  );

  console.log('\nTip: Access catalogs directly via window.__QPM_CATALOGS');
  console.log('To check if specific species exist:');
  console.log('   window.__QPM_CATALOGS.plantCatalog["PineTree"]');
  console.log('   Object.keys(window.__QPM_CATALOGS.plantCatalog)');
}

// Expose diagnostic function globally for debugging
if (typeof window !== 'undefined') {
  (window as any).__QPM_DiagnoseCatalogs = diagnoseCatalogs;
}

