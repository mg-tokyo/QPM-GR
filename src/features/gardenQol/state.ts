// Persisted config for garden QOL features; migrates QOL fields from the old locker config on first read.

import { storage } from '../../utils/storage';
import type { GardenQolConfig, HoldContexts } from './types';
import { isRecord } from '../../utils/typeGuards';
import { seedToggles } from './holdHarvestKinds';

const STORAGE_KEY = 'qpm.gardenQol.config.v1';
const LOCKER_KEY = 'qpm.locker.config.v1';
const TOGGLES_KEY = 'qpm.gardenQol.instaHarvestActions.v1';

const DEFAULT_HOLD_CONTEXTS: HoldContexts = {
  harvest: true,
  plant: true,
  shovel: true,
  sell: true,
  hatch: true,
  other: true,
};

const DEFAULT_CONFIG: GardenQolConfig = {
  ariesHold: false,
  holdRateHz: 10,
  holdContexts: { ...DEFAULT_HOLD_CONTEXTS },
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

function sanitizeHoldContexts(raw: unknown): HoldContexts {
  if (!isRecord(raw)) return { ...DEFAULT_HOLD_CONTEXTS };
  return {
    harvest: toBoolean(raw.harvest, true),
    plant:   toBoolean(raw.plant, true),
    shovel:  toBoolean(raw.shovel, true),
    sell:    toBoolean(raw.sell, true),
    hatch:   toBoolean(raw.hatch, true),
    other:   toBoolean(raw.other, true),
  };
}

function sanitizeConfig(raw: unknown): GardenQolConfig {
  if (!isRecord(raw)) return { ...DEFAULT_CONFIG, holdContexts: { ...DEFAULT_HOLD_CONTEXTS } };
  return {
    ariesHold: toBoolean(raw.ariesHold, DEFAULT_CONFIG.ariesHold),
    holdRateHz: toNumber(raw.holdRateHz, DEFAULT_CONFIG.holdRateHz, 5, 20),
    holdContexts: sanitizeHoldContexts(raw.holdContexts),
  };
}

// Legacy `instaHarvestRainbow` / `instaHarvestGold` booleans → keyed toggle map.
// Left in stored config as breadcrumbs for one release (deleted in a follow-up).
function migrateLegacyInstaHarvest(raw: Record<string, unknown>): void {
  const existing = storage.get<unknown>(TOGGLES_KEY, null);
  if (existing != null) return;
  const seed: Record<string, boolean> = {};
  if (raw.instaHarvestRainbow === true) seed.rainbowHarvest = true;
  if (raw.instaHarvestGold === true) seed.goldHarvest = true;
  if (Object.keys(seed).length > 0) seedToggles(seed);
}

function migrateFromLocker(): GardenQolConfig | null {
  const lockerRaw = storage.get<unknown>(LOCKER_KEY, null);
  if (!isRecord(lockerRaw)) return null;

  const hasQol = 'instaHarvestRainbow' in lockerRaw
    || 'instaHarvestGold' in lockerRaw
    || 'ariesHold' in lockerRaw
    || 'holdRateHz' in lockerRaw
    || 'holdContexts' in lockerRaw;

  if (!hasQol) return null;

  migrateLegacyInstaHarvest(lockerRaw);

  return sanitizeConfig({
    ariesHold: lockerRaw.ariesHold,
    holdRateHz: lockerRaw.holdRateHz,
    holdContexts: lockerRaw.holdContexts,
  });
}

function loadConfig(): GardenQolConfig {
  const stored = storage.get<unknown>(STORAGE_KEY, null);
  if (stored != null) {
    if (isRecord(stored)) migrateLegacyInstaHarvest(stored);
    return sanitizeConfig(stored);
  }

  const migrated = migrateFromLocker();
  if (migrated) {
    storage.set(STORAGE_KEY, migrated);
    return migrated;
  }

  return { ...DEFAULT_CONFIG, holdContexts: { ...DEFAULT_HOLD_CONTEXTS } };
}

let config: GardenQolConfig = loadConfig();

function persist(): void {
  storage.set(STORAGE_KEY, config);
}

export function getGardenQolConfig(): GardenQolConfig {
  return {
    ...config,
    holdContexts: { ...config.holdContexts },
  };
}

export function updateGardenQolConfig(partial: Partial<GardenQolConfig>): GardenQolConfig {
  const merged = { ...config, ...partial };
  config = sanitizeConfig(merged);
  persist();
  return getGardenQolConfig();
}
