import { storage } from '../../utils/storage';
import type {
  LockerConfig,
  HarvestFilterSettings, CropOverride, ScaleLockMode, FilterMode, WeatherFilterMode,
} from './types';
import { isRecord } from '../../utils/typeGuards';

const STORAGE_KEY = 'qpm.locker.config.v1';

const DEFAULT_HARVEST_FILTER: HarvestFilterSettings = {
  filterMode: 'LOCK',
  scaleLockMode: 'NONE',
  minScalePct: 50,
  maxScalePct: 100,
  colorGold: false,
  colorRainbow: false,
  colorNormal: false,
  weatherMode: 'ANY',
  weatherTags: [],
  weatherRecipes: [],
};

const DEFAULT_CONFIG: LockerConfig = {
  enabled: false,
  inventoryReserve: { enabled: false, minFreeSlots: 5 },
  hatchLock: false,
  eggLocks: {},
  plantLocks: {},
  mutationLocks: {},
  harvestLock: false,
  decorPickupLock: false,
  decorLocks: {},
  sellAllCropsLock: false,
  cropSellLocks: {},
  petSellGuard: false,
  harvestFilter: { ...DEFAULT_HARVEST_FILTER, weatherTags: [], weatherRecipes: [] },
  cropOverrides: {},
};

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.round(value)));
  }
  return fallback;
}

function sanitizeBooleanMap(raw: unknown): Record<string, boolean> {
  if (!isRecord(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.length > 0 && typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

const VALID_SCALE_LOCK_MODES = new Set<ScaleLockMode>(['RANGE', 'MINIMUM', 'MAXIMUM', 'NONE']);
const VALID_FILTER_MODES = new Set<FilterMode>(['LOCK', 'ALLOW']);
const VALID_WEATHER_MODES = new Set<WeatherFilterMode>(['ANY', 'ALL', 'RECIPES']);

function sanitizeHarvestFilter(raw: unknown): HarvestFilterSettings {
  if (!isRecord(raw)) return { ...DEFAULT_HARVEST_FILTER, weatherTags: [], weatherRecipes: [] };

  const filterMode = VALID_FILTER_MODES.has(raw.filterMode as FilterMode)
    ? (raw.filterMode as FilterMode) : 'LOCK';
  const scaleLockMode = VALID_SCALE_LOCK_MODES.has(raw.scaleLockMode as ScaleLockMode)
    ? (raw.scaleLockMode as ScaleLockMode) : 'NONE';

  let minScalePct = toNumber(raw.minScalePct, 50, 50, 100);
  let maxScalePct = toNumber(raw.maxScalePct, 100, 50, 100);
  if (scaleLockMode === 'RANGE' && maxScalePct <= minScalePct) {
    maxScalePct = Math.min(100, minScalePct + 1);
    if (maxScalePct <= minScalePct) { minScalePct = 99; maxScalePct = 100; }
  }

  const weatherMode = VALID_WEATHER_MODES.has(raw.weatherMode as WeatherFilterMode)
    ? (raw.weatherMode as WeatherFilterMode) : 'ANY';

  const weatherTags = Array.isArray(raw.weatherTags)
    ? raw.weatherTags.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : [];

  const weatherRecipes = Array.isArray(raw.weatherRecipes)
    ? raw.weatherRecipes
        .filter(Array.isArray)
        .map((recipe: unknown[]) => recipe.filter((t): t is string => typeof t === 'string' && t.length > 0))
    : [];

  return {
    filterMode, scaleLockMode, minScalePct, maxScalePct,
    colorGold: toBoolean(raw.colorGold, false),
    colorRainbow: toBoolean(raw.colorRainbow, false),
    colorNormal: toBoolean(raw.colorNormal, false),
    weatherMode, weatherTags, weatherRecipes,
  };
}

function sanitizeCropOverrides(raw: unknown): Record<string, CropOverride> {
  if (!isRecord(raw)) return {};
  const out: Record<string, CropOverride> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key || !isRecord(value)) continue;
    out[key] = {
      enabled: toBoolean(value.enabled, false),
      settings: sanitizeHarvestFilter(value.settings),
    };
  }
  return out;
}

function sanitizeConfig(raw: unknown): LockerConfig {
  if (!isRecord(raw)) return { ...DEFAULT_CONFIG };

  const reserve = isRecord(raw.inventoryReserve) ? raw.inventoryReserve : {};

  // Backward compat: harvestLock was { enabled: boolean }
  let harvestLock = DEFAULT_CONFIG.harvestLock;
  if (typeof raw.harvestLock === 'boolean') {
    harvestLock = raw.harvestLock;
  } else if (isRecord(raw.harvestLock) && typeof raw.harvestLock.enabled === 'boolean') {
    harvestLock = raw.harvestLock.enabled;
  }

  return {
    enabled: toBoolean(raw.enabled, DEFAULT_CONFIG.enabled),
    inventoryReserve: {
      enabled: toBoolean(reserve.enabled, DEFAULT_CONFIG.inventoryReserve.enabled),
      minFreeSlots: toNumber(reserve.minFreeSlots, DEFAULT_CONFIG.inventoryReserve.minFreeSlots, 0, 50),
    },
    hatchLock: toBoolean(raw.hatchLock, DEFAULT_CONFIG.hatchLock),
    eggLocks: sanitizeBooleanMap(raw.eggLocks),
    plantLocks: sanitizeBooleanMap(raw.plantLocks),
    mutationLocks: sanitizeBooleanMap(raw.mutationLocks),
    harvestLock,
    decorPickupLock: toBoolean(raw.decorPickupLock, DEFAULT_CONFIG.decorPickupLock),
    decorLocks: sanitizeBooleanMap(raw.decorLocks),
    sellAllCropsLock: toBoolean(raw.sellAllCropsLock, DEFAULT_CONFIG.sellAllCropsLock),
    cropSellLocks: sanitizeBooleanMap(raw.cropSellLocks),
    petSellGuard: toBoolean(raw.petSellGuard, DEFAULT_CONFIG.petSellGuard),
    harvestFilter: sanitizeHarvestFilter(raw.harvestFilter),
    cropOverrides: sanitizeCropOverrides(raw.cropOverrides),
  };
}

let config: LockerConfig = sanitizeConfig(storage.get<unknown>(STORAGE_KEY, null));

const listeners = new Set<() => void>();

export function subscribeLockerConfig(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notifyListeners(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* isolate listener failures */ }
  }
}

function persist(): void {
  storage.set(STORAGE_KEY, config);
  notifyListeners();
}

function deepCopyHarvestFilter(f: HarvestFilterSettings): HarvestFilterSettings {
  return {
    ...f,
    weatherTags: [...f.weatherTags],
    weatherRecipes: f.weatherRecipes.map(r => [...r]),
  };
}

function deepCopyCropOverrides(overrides: Record<string, CropOverride>): Record<string, CropOverride> {
  const out: Record<string, CropOverride> = {};
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = { enabled: value.enabled, settings: deepCopyHarvestFilter(value.settings) };
  }
  return out;
}

export function getLockerConfig(): LockerConfig {
  return {
    ...config,
    inventoryReserve: { ...config.inventoryReserve },
    eggLocks: { ...config.eggLocks },
    plantLocks: { ...config.plantLocks },
    mutationLocks: { ...config.mutationLocks },
    decorLocks: { ...config.decorLocks },
    cropSellLocks: { ...config.cropSellLocks },
    harvestFilter: deepCopyHarvestFilter(config.harvestFilter),
    cropOverrides: deepCopyCropOverrides(config.cropOverrides),
  };
}

export function updateLockerConfig(partial: Partial<LockerConfig>): LockerConfig {
  const merged = { ...config, ...partial };
  config = sanitizeConfig(merged);
  persist();
  return getLockerConfig();
}

export function resetLockerConfig(): LockerConfig {
  config = { ...DEFAULT_CONFIG };
  persist();
  return getLockerConfig();
}
