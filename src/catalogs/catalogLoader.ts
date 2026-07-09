// src/catalogs/catalogLoader.ts
// Runtime catalog capture system using Object.* method interception
// Based on proven MG Catalog Dumper pattern
// NOTE: Keep this module lightweight and early-init safe.
// It only imports local catalog logic helpers to avoid app-layer cycles.

import { DEFAULT_ABILITY_COLOR, getAbilityColorMap } from './logic/abilityColors';
import { getWeatherCatalogMap } from './logic/weatherCatalog';
import { getCosmeticCatalogFromBundle } from './logic/cosmeticCatalog';
import { pageWindow, readSharedGlobal, shareGlobal } from '../core/pageContext';
import { healthBus } from '../diagnostics/healthBus';
import { createNamedLogger } from '../diagnostics/logger';
import type { Subsystem, SubsystemHealth } from '../diagnostics/types';
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

// ── Diagnostics bus wiring (Phase 2 item 2.3) ──────────────────────────────
const CATALOGS_SUBSYSTEM: Subsystem = 'catalogs';
const diagLog = createNamedLogger('catalogs');

/** Watchdog: if essential catalogs do not arrive in this window, fire CATALOG-001. */
const READY_WATCHDOG_MS = 30_000;
/** Grace period after ready before non-essential gaps are reported as partial. */
const PARTIAL_GRACE_MS = 30_000;

let diagnosticsStarted = false;
let readyWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
let partialCheckTimer: ReturnType<typeof setTimeout> | null = null;
let diagnosticsStartedAt = 0;

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
  cosmeticCatalog: null,
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

// Hook lifecycle state — see initCatalogLoader for removal policy.
const HOOKS_HARD_DEADLINE_MS = 120_000;
const HOOKS_RECHECK_INTERVAL_MS = 5_000;
let hooksRemoved = false;
let hooksRecheckTimer: ReturnType<typeof setInterval> | null = null;
let hooksHardDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

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
const COSMETIC_CATALOG_POLL_INTERVAL_MS = 1000;
const MAX_COSMETIC_CATALOG_POLL_ATTEMPTS = 10;
let cosmeticCatalogPollTimer: ReturnType<typeof setInterval> | null = null;
let cosmeticCatalogPollAttempts = 0;
let cosmeticCatalogEnrichInFlight: Promise<boolean> | null = null;
let cosmeticOwnershipSet: Set<string> | null = null;
let cosmeticOwnershipFetchInFlight: Promise<void> | null = null;
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
    if (cosmeticOwnershipSet) {
      shareGlobal('__QPM_COSMETIC_OWNERSHIP', [...cosmeticOwnershipSet]);
    }
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
        if (diagnosticsStarted) {
          diagLog.warn('QPM-CATALOG-003', {
            what: 'abilityColors',
            attempts: abilityColorPollAttempts,
          });
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
        if (diagnosticsStarted) {
          diagLog.warn('QPM-CATALOG-003', {
            what: 'weatherCatalog',
            attempts: weatherCatalogPollAttempts,
          });
        }
        stopWeatherCatalogPolling();
      }
    })();
  }, WEATHER_CATALOG_POLL_INTERVAL_MS);
}

async function enrichCosmeticCatalog(): Promise<boolean> {
  if (capturedCatalogs.cosmeticCatalog) return true;
  if (cosmeticCatalogEnrichInFlight) return cosmeticCatalogEnrichInFlight;

  cosmeticCatalogEnrichInFlight = (async () => {
    const catalog = await getCosmeticCatalogFromBundle();
    if (!catalog) return false;

    capturedCatalogs.cosmeticCatalog = catalog as GameCatalogs['cosmeticCatalog'];
    catalogLog(`Enriched cosmetic catalog from bundle (${catalog.length} items).`);
    publishCatalogs();
    return true;
  })().finally(() => {
    cosmeticCatalogEnrichInFlight = null;
  });

  return cosmeticCatalogEnrichInFlight;
}

function stopCosmeticCatalogPolling(): void {
  if (!cosmeticCatalogPollTimer) return;
  clearInterval(cosmeticCatalogPollTimer);
  cosmeticCatalogPollTimer = null;
}

function startCosmeticCatalogPolling(): void {
  if (cosmeticCatalogPollTimer) return;
  cosmeticCatalogPollAttempts = 0;

  void enrichCosmeticCatalog();

  cosmeticCatalogPollTimer = setInterval(() => {
    void (async () => {
      const enriched = await enrichCosmeticCatalog();
      cosmeticCatalogPollAttempts += 1;
      if (enriched) {
        stopCosmeticCatalogPolling();
        return;
      }
      if (cosmeticCatalogPollAttempts >= MAX_COSMETIC_CATALOG_POLL_ATTEMPTS) {
        if (diagnosticsStarted) {
          diagLog.warn('QPM-CATALOG-003', {
            what: 'cosmeticCatalog',
            attempts: cosmeticCatalogPollAttempts,
          });
        }
        stopCosmeticCatalogPolling();
      }
    })();
  }, COSMETIC_CATALOG_POLL_INTERVAL_MS);
}

// ============================================================================
// COSMETIC OWNERSHIP (single fetch from /me/cosmetics API)
// ============================================================================

function getRoomApiBase(): string | null {
  try {
    const pathname = pageWindow.location?.pathname ?? '';
    const segments = pathname.split('/').filter(Boolean);
    const roomCode = segments[segments.length - 1];
    if (!roomCode) return null;
    return `/api/rooms/${roomCode}`;
  } catch {
    return null;
  }
}

async function fetchCosmeticOwnership(): Promise<void> {
  if (cosmeticOwnershipSet) return;
  if (cosmeticOwnershipFetchInFlight) return cosmeticOwnershipFetchInFlight;

  cosmeticOwnershipFetchInFlight = (async () => {
    const base = getRoomApiBase();
    if (!base) return;

    const fetchFn = typeof pageWindow.fetch === 'function'
      ? pageWindow.fetch.bind(pageWindow)
      : fetch;

    try {
      const res = await fetchFn(`${base}/me/cosmetics`, { credentials: 'include' });
      if (!res.ok) return;

      const data: unknown = await res.json();
      if (!Array.isArray(data)) return;

      const filenames = new Set<string>();
      for (const item of data) {
        if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).cosmeticFilename === 'string') {
          filenames.add((item as Record<string, unknown>).cosmeticFilename as string);
        }
      }

      cosmeticOwnershipSet = filenames;
      catalogLog(`Fetched cosmetic ownership: ${filenames.size} items acquired.`);
      publishCatalogs();
    } catch {
      catalogLog('Failed to fetch cosmetic ownership.');
    }
  })().finally(() => {
    cosmeticOwnershipFetchInFlight = null;
  });

  return cosmeticOwnershipFetchInFlight;
}

export function getCosmeticOwnership(): Set<string> | null {
  return cosmeticOwnershipSet;
}

export function isCosmeticOwned(filename: string): boolean | null {
  if (!cosmeticOwnershipSet) return null;
  return cosmeticOwnershipSet.has(filename);
}

export function isCosmeticAvailable(filename: string, availability: string): boolean | null {
  if (availability === 'default' || availability === 'authenticated') return true;
  return isCosmeticOwned(filename);
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

function looksLikeCosmeticArray(arr: unknown[]): boolean {
  if (arr.length < 10) return false;
  const sample = arr[0];
  return (
    sample !== null &&
    typeof sample === 'object' &&
    'id' in sample &&
    'type' in sample &&
    'filename' in sample &&
    'displayName' in sample &&
    'availability' in sample &&
    'price' in sample
  );
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

    if (!capturedCatalogs.cosmeticCatalog) {
      for (const v of Object.values(record)) {
        if (Array.isArray(v) && looksLikeCosmeticArray(v)) {
          capturedCatalogs.cosmeticCatalog = v as GameCatalogs['cosmeticCatalog'];
          catalogLog(`Captured cosmeticCatalog with ${v.length} items`);
          didCapture = true;
          break;
        }
      }
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

function areHookCapturableCatalogsAllCaptured(): boolean {
  return !!(
    capturedCatalogs.petCatalog &&
    capturedCatalogs.plantCatalog &&
    capturedCatalogs.eggCatalog &&
    capturedCatalogs.petAbilities &&
    capturedCatalogs.itemCatalog &&
    capturedCatalogs.decorCatalog &&
    capturedCatalogs.mutationCatalog
  );
}

function tryRemoveHooks(reason: string): void {
  if (hooksRemoved) return;
  hooksRemoved = true;
  removeHooks();
  catalogLog(`Hooks removed (${reason})`);
  if (hooksRecheckTimer !== null) {
    clearInterval(hooksRecheckTimer);
    hooksRecheckTimer = null;
  }
  if (hooksHardDeadlineTimer !== null) {
    clearTimeout(hooksHardDeadlineTimer);
    hooksHardDeadlineTimer = null;
  }
}

/**
 * Entry point for scanning an object
 */
function maybeCapture(obj: unknown): void {
  // Short-circuit once all hook-capturable catalogs are in — until the
  // deferred removal actually clears the hook, the intercept still costs
  // a function call per Object.keys/values/entries in the game.
  if (areHookCapturableCatalogsAllCaptured()) return;
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

    // Health-bus publish: ready. Watchdog can stand down.
    if (diagnosticsStarted) {
      if (readyWatchdogTimer !== null) {
        clearTimeout(readyWatchdogTimer);
        readyWatchdogTimer = null;
      }
      publishCatalogsHealth();
      schedulePartialCheck();
    }

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

function countLoadedCatalogs(): { loaded: number; total: number; missing: string[] } {
  const slots: Array<[string, unknown]> = [
    ['itemCatalog', capturedCatalogs.itemCatalog],
    ['decorCatalog', capturedCatalogs.decorCatalog],
    ['mutationCatalog', capturedCatalogs.mutationCatalog],
    ['eggCatalog', capturedCatalogs.eggCatalog],
    ['petCatalog', capturedCatalogs.petCatalog],
    ['petAbilities', capturedCatalogs.petAbilities],
    ['plantCatalog', capturedCatalogs.plantCatalog],
    ['weatherCatalog', capturedCatalogs.weatherCatalog],
    ['cosmeticCatalog', capturedCatalogs.cosmeticCatalog],
  ];
  const missing = slots.filter(([, slot]) => slot === null).map(([name]) => name);
  return { loaded: slots.length - missing.length, total: slots.length, missing };
}

function publishCatalogsHealth(): void {
  if (!diagnosticsStarted) return;
  const { loaded, total, missing } = countLoadedCatalogs();
  const missingSuffix = missing.length > 0 ? ` (missing: ${missing.join(', ')})` : '';
  const message = catalogsReady
    ? `${loaded}/${total} catalogs loaded${missingSuffix}`
    : `Capturing… (${loaded}/${total} so far)`;
  const status: SubsystemHealth['status'] | undefined = catalogsReady ? 'ok' : undefined;
  healthBus.publish({
    subsystem: CATALOGS_SUBSYSTEM,
    category: 'core',
    ...(status === undefined ? {} : { status }),
    message,
    metrics: { loaded, total, ready: catalogsReady ? 1 : 0 },
  });
}

function listMissingEssentials(): string[] {
  const missing: string[] = [];
  if (!capturedCatalogs.petCatalog) missing.push('petCatalog');
  if (!capturedCatalogs.plantCatalog) missing.push('plantCatalog');
  if (!capturedCatalogs.eggCatalog) missing.push('eggCatalog');
  if (!capturedCatalogs.petAbilities) missing.push('petAbilities');
  return missing;
}

function schedulePartialCheck(): void {
  if (!diagnosticsStarted) return;
  if (partialCheckTimer !== null) return;
  partialCheckTimer = setTimeout(() => {
    partialCheckTimer = null;
    if (!diagnosticsStarted) return;
    const missing = listMissingEssentials();
    if (missing.length > 0) {
      diagLog.warn('QPM-CATALOG-002', { missing });
    }
  }, PARTIAL_GRACE_MS);
}

function startReadyWatchdog(): void {
  if (readyWatchdogTimer !== null) return;
  readyWatchdogTimer = setTimeout(() => {
    readyWatchdogTimer = null;
    if (!diagnosticsStarted) return;
    if (catalogsReady) return;
    const elapsedMs = Date.now() - diagnosticsStartedAt;
    diagLog.error('QPM-CATALOG-001', {
      elapsedMs,
      capturedSoFar: countLoadedCatalogs().loaded,
    });
  }, READY_WATCHDOG_MS);
}

/**
 * Wire the catalogs subsystem into the diagnostics health bus. Idempotent.
 * Must run after initDiagnostics() so the bus exists. Safe to call before
 * initCatalogLoader() — the watchdog measures time-to-ready from this call.
 */
export function startCatalogsDiagnostics(): void {
  if (diagnosticsStarted) return;
  diagnosticsStarted = true;
  diagnosticsStartedAt = Date.now();

  healthBus.register(CATALOGS_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Waiting for game catalogs',
  });

  if (catalogsReady) {
    // Catalog capture finished before diagnostics started (unusual but harmless).
    publishCatalogsHealth();
    schedulePartialCheck();
    return;
  }

  startReadyWatchdog();
}

export function stopCatalogsDiagnostics(): void {
  if (!diagnosticsStarted) return;
  if (readyWatchdogTimer !== null) {
    clearTimeout(readyWatchdogTimer);
    readyWatchdogTimer = null;
  }
  if (partialCheckTimer !== null) {
    clearTimeout(partialCheckTimer);
    partialCheckTimer = null;
  }
  diagnosticsStarted = false;
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
  startCosmeticCatalogPolling();
  void fetchCosmeticOwnership();

  // Hook removal policy: interval re-check clears hooks as soon as every
  // hook-capturable catalog is in; hard deadline is an unconditional
  // upper bound so a never-arriving catalog can't keep the intercept
  // (and its per-Object.keys tax) installed for the whole session.
  hooksRecheckTimer = setInterval(() => {
    if (areHookCapturableCatalogsAllCaptured()) {
      tryRemoveHooks('all captured');
    }
  }, HOOKS_RECHECK_INTERVAL_MS);

  hooksHardDeadlineTimer = setTimeout(() => {
    hooksHardDeadlineTimer = null;
    tryRemoveHooks('hard deadline');
  }, HOOKS_HARD_DEADLINE_MS);
}

/**
 * Force cleanup - call when script unloads
 */
export function cleanupCatalogLoader(): void {
  if (hooksRecheckTimer !== null) {
    clearInterval(hooksRecheckTimer);
    hooksRecheckTimer = null;
  }
  if (hooksHardDeadlineTimer !== null) {
    clearTimeout(hooksHardDeadlineTimer);
    hooksHardDeadlineTimer = null;
  }
  removeHooks();
  hooksRemoved = true;
  stopAbilityColorPolling();
  stopWeatherCatalogPolling();
  stopCosmeticCatalogPolling();
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

