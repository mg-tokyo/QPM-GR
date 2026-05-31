// src/features/gardenQol/state.ts
// Persisted config for garden QOL features (insta-harvest, aries hold).
// Migrates QOL fields from the old locker config on first read.

import { storage } from '../../utils/storage';
import type { GardenQolConfig, HoldContexts } from './types';
import { isRecord } from '../../utils/typeGuards';

const STORAGE_KEY = 'qpm.gardenQol.config.v1';
const LOCKER_KEY = 'qpm.locker.config.v1';

const DEFAULT_HOLD_CONTEXTS: HoldContexts = {
  harvest: true,
  plant: true,
  shovel: true,
  sell: true,
  hatch: true,
  other: true,
};

const DEFAULT_CONFIG: GardenQolConfig = {
  instaHarvestRainbow: false,
  instaHarvestGold: false,
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
    instaHarvestRainbow: toBoolean(raw.instaHarvestRainbow, DEFAULT_CONFIG.instaHarvestRainbow),
    instaHarvestGold: toBoolean(raw.instaHarvestGold, DEFAULT_CONFIG.instaHarvestGold),
    ariesHold: toBoolean(raw.ariesHold, DEFAULT_CONFIG.ariesHold),
    holdRateHz: toNumber(raw.holdRateHz, DEFAULT_CONFIG.holdRateHz, 5, 20),
    holdContexts: sanitizeHoldContexts(raw.holdContexts),
  };
}

function migrateFromLocker(): GardenQolConfig | null {
  const lockerRaw = storage.get<unknown>(LOCKER_KEY, null);
  if (!isRecord(lockerRaw)) return null;

  // Only migrate if old config has QOL fields
  const hasQol = 'instaHarvestRainbow' in lockerRaw
    || 'instaHarvestGold' in lockerRaw
    || 'ariesHold' in lockerRaw
    || 'holdRateHz' in lockerRaw
    || 'holdContexts' in lockerRaw;

  if (!hasQol) return null;

  return sanitizeConfig({
    instaHarvestRainbow: lockerRaw.instaHarvestRainbow,
    instaHarvestGold: lockerRaw.instaHarvestGold,
    ariesHold: lockerRaw.ariesHold,
    holdRateHz: lockerRaw.holdRateHz,
    holdContexts: lockerRaw.holdContexts,
  });
}

function loadConfig(): GardenQolConfig {
  const stored = storage.get<unknown>(STORAGE_KEY, null);
  if (stored != null) return sanitizeConfig(stored);

  // First read — try to migrate from old locker config
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
