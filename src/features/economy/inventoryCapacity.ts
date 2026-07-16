import { getInventoryItems, onInventoryChange } from '../../store/inventory';
import { storage } from '../../utils/storage';
import { createNamedLogger } from '../../diagnostics/logger';
import { healthBus } from '../../diagnostics/healthBus';
import { buildError } from '../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../diagnostics/types';
import {
  playSound,
  playCustomSound,
  startLoop,
  stopLoop,
  isBuiltinSound,
} from '../../ui/shop/restockAlerts/soundEngine';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:inventoryCapacity';
const FEATURE_NAME = 'inventoryCapacity';
const diag = createNamedLogger(FEATURE_SUBSYSTEM);
let busRegistered = false;

function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(FEATURE_SUBSYSTEM, { category: 'feature', status: 'starting' });
}

function publishOk(message: string, metrics?: Record<string, number | string>): void {
  ensureBusRegistered();
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message,
    ...(metrics ? { metrics } : {}),
  });
}

function warnFeature(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  ensureBusRegistered();
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  diag.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

export interface SoundAlertConfig {
  soundId: string;
  mode: 'once' | 'loop';
  volume: number;        // 0-1, default 0.7
  intervalMs: number;    // loop repeat interval in ms, default 3000
}

// Custom sounds use a separate storage key — base64 can be large.
export interface CustomSoundEntry {
  name: string;
  dataUrl: string;
}

const CUSTOM_SOUNDS_KEY = 'qpm.inventoryCapacity.customSounds.v1';
const MAX_CUSTOM_SOUNDS = 10;
const MAX_CUSTOM_SOUND_BYTES = 500 * 1024;

export function getInvCapacityCustomSounds(): Record<string, CustomSoundEntry> {
  return storage.get<Record<string, CustomSoundEntry>>(CUSTOM_SOUNDS_KEY, {});
}

function writeCustomSounds(sounds: Record<string, CustomSoundEntry>): void {
  storage.set(CUSTOM_SOUNDS_KEY, sounds);
}

export function addInvCapacityCustomSound(name: string, dataUrl: string): string {
  if (dataUrl.length > MAX_CUSTOM_SOUND_BYTES) {
    throw new Error(`Custom sound exceeds ${MAX_CUSTOM_SOUND_BYTES / 1024}KB limit`);
  }
  const all = getInvCapacityCustomSounds();
  if (Object.keys(all).length >= MAX_CUSTOM_SOUNDS) {
    throw new Error(`Maximum of ${MAX_CUSTOM_SOUNDS} custom sounds reached`);
  }
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  all[id] = { name, dataUrl };
  writeCustomSounds(all);
  return id;
}

export function removeInvCapacityCustomSound(id: string): void {
  const all = getInvCapacityCustomSounds();
  if (!(id in all)) return;
  delete all[id];
  writeCustomSounds(all);
}

export interface InventoryCapacityConfig {
  enabled: boolean;
  warningThreshold: number;
  warningColor: string;
  fullColor: string;
  warningSound: SoundAlertConfig | null;
  fullSound: SoundAlertConfig | null;
}

type ConfigPatch = Partial<InventoryCapacityConfig>;
type ConfigListener = (config: InventoryCapacityConfig) => void;

const STORAGE_KEY = 'qpm.inventoryCapacity.v1';
const INVENTORY_MAX = 100;

const DEFAULT_CONFIG: InventoryCapacityConfig = {
  enabled: true,
  warningThreshold: 85,
  warningColor: '#ff9800',
  fullColor: '#ff1744',
  warningSound: null,
  fullSound: null,
};

function clampThreshold(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.warningThreshold;
  return Math.min(INVENTORY_MAX, Math.max(1, Math.round(n)));
}

function sanitizeSoundConfig(raw: unknown): SoundAlertConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.soundId !== 'string' || !obj.soundId) return null;
  return {
    soundId: obj.soundId,
    mode: obj.mode === 'loop' ? 'loop' : 'once',
    volume: typeof obj.volume === 'number' && Number.isFinite(obj.volume)
      ? Math.max(0, Math.min(1, obj.volume)) : 0.7,
    intervalMs: typeof obj.intervalMs === 'number' && Number.isFinite(obj.intervalMs)
      ? Math.max(1000, Math.min(15000, obj.intervalMs)) : 3000,
  };
}

function sanitizeConfig(raw: unknown): InventoryCapacityConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  const obj = raw as Record<string, unknown>;
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULT_CONFIG.enabled,
    warningThreshold: clampThreshold(obj.warningThreshold),
    warningColor: typeof obj.warningColor === 'string' && obj.warningColor ? obj.warningColor : DEFAULT_CONFIG.warningColor,
    fullColor: typeof obj.fullColor === 'string' && obj.fullColor ? obj.fullColor : DEFAULT_CONFIG.fullColor,
    warningSound: sanitizeSoundConfig(obj.warningSound),
    fullSound: sanitizeSoundConfig(obj.fullSound),
  };
}

function loadConfig(): InventoryCapacityConfig {
  return sanitizeConfig(storage.get<unknown>(STORAGE_KEY, null));
}

function saveConfig(cfg: InventoryCapacityConfig): void {
  storage.set(STORAGE_KEY, cfg);
}

let config: InventoryCapacityConfig = loadConfig();
const configListeners = new Set<ConfigListener>();

function notifyConfigListeners(): void {
  const snapshot = { ...config };
  for (const listener of configListeners) {
    try { listener(snapshot); } catch (err) { warnFeature('QPM-FEATURE-004', { what: 'listener:config' }, err); }
  }
}

export function getInventoryCapacityConfig(): InventoryCapacityConfig {
  return { ...config };
}

export function updateInventoryCapacityConfig(patch: ConfigPatch): InventoryCapacityConfig {
  config = sanitizeConfig({
    ...config,
    ...patch,
  });
  saveConfig(config);
  notifyConfigListeners();
  recompute();
  return getInventoryCapacityConfig();
}

export function subscribeToInventoryCapacityConfig(listener: ConfigListener): () => void {
  configListeners.add(listener);
  try { listener(getInventoryCapacityConfig()); } catch (err) { warnFeature('QPM-FEATURE-004', { what: 'listener:config:initial' }, err); }
  return () => { configListeners.delete(listener); };
}

export type InventoryCapacityLevel = 'ok' | 'warning' | 'full';

export interface InventoryCapacityState {
  count: number;
  max: number;
  level: InventoryCapacityLevel;
}

type StateListener = (state: InventoryCapacityState) => void;

let currentState: InventoryCapacityState = { count: 0, max: INVENTORY_MAX, level: 'ok' };
const stateListeners = new Set<StateListener>();

function computeLevel(count: number, cfg: InventoryCapacityConfig): InventoryCapacityLevel {
  if (!cfg.enabled) return 'ok';
  if (count >= INVENTORY_MAX) return 'full';
  if (count >= cfg.warningThreshold) return 'warning';
  return 'ok';
}

const LOOP_KEY_WARNING = 'inv-capacity-warning';
const LOOP_KEY_FULL = 'inv-capacity-full';

function stopAllCapacitySounds(): void {
  stopLoop(LOOP_KEY_WARNING);
  stopLoop(LOOP_KEY_FULL);
}

function triggerSound(soundCfg: SoundAlertConfig, loopKey: string): void {
  const custom = !isBuiltinSound(soundCfg.soundId);
  const customs = getInvCapacityCustomSounds();
  const dataUrl = custom ? customs[soundCfg.soundId]?.dataUrl : undefined;

  if (custom && dataUrl) {
    void playCustomSound(dataUrl, soundCfg.volume);
  } else if (!custom) {
    void playSound(soundCfg.soundId, soundCfg.volume);
  }

  if (soundCfg.mode === 'loop') {
    startLoop(loopKey, soundCfg.soundId, soundCfg.volume, custom, dataUrl, soundCfg.intervalMs);
  }
}

function handleSoundOnLevelChange(prevLevel: InventoryCapacityLevel, newLevel: InventoryCapacityLevel): void {
  stopAllCapacitySounds();

  if (newLevel === 'ok') return;

  const soundCfg = newLevel === 'full' ? config.fullSound : config.warningSound;
  if (!soundCfg) return;

  const loopKey = newLevel === 'full' ? LOOP_KEY_FULL : LOOP_KEY_WARNING;
  triggerSound(soundCfg, loopKey);
}

function recompute(): void {
  const count = getInventoryItems().length;
  const level = computeLevel(count, config);
  const prev = currentState;
  currentState = { count, max: INVENTORY_MAX, level };

  if (prev.level !== currentState.level) {
    handleSoundOnLevelChange(prev.level, currentState.level);
    notifyStateListeners();
  } else if (prev.count !== currentState.count) {
    notifyStateListeners();
  }
}

function notifyStateListeners(): void {
  const snapshot = { ...currentState };
  for (const listener of stateListeners) {
    try { listener(snapshot); } catch (err) { warnFeature('QPM-FEATURE-004', { what: 'listener:state' }, err); }
  }
}

export function getInventoryCapacityState(): InventoryCapacityState {
  return { ...currentState };
}

export function onInventoryCapacityChange(listener: StateListener): () => void {
  stateListeners.add(listener);
  try { listener(getInventoryCapacityState()); } catch (err) { warnFeature('QPM-FEATURE-004', { what: 'listener:state:initial' }, err); }
  return () => { stateListeners.delete(listener); };
}

let unsubInventory: (() => void) | null = null;

export function startInventoryCapacity(): void {
  if (unsubInventory) return;
  ensureBusRegistered();
  config = loadConfig();
  // fireImmediately ensures recompute runs with current cache even if the
  // inventory atom already fired its initial value before this subscription.
  unsubInventory = onInventoryChange(() => recompute(), true);
  publishOk('Started', {
    enabled: config.enabled ? 1 : 0,
    warningThreshold: config.warningThreshold,
    warningSound: config.warningSound ? 1 : 0,
    fullSound: config.fullSound ? 1 : 0,
  });
}

export function stopInventoryCapacity(): void {
  unsubInventory?.();
  unsubInventory = null;
  stopAllCapacitySounds();
  currentState = { count: 0, max: INVENTORY_MAX, level: 'ok' };
}
