// src/features/bloblingCustomiser/presets/store.ts
// Player-scoped preset persistence. Mirrors src/store/petTeams/state.ts:116
// for the unscoped→scoped key migration pattern.

import { storage, registerDynamicKey } from '../../../utils/storage';
import { getPlayerId } from '../../../core/playerContext';
import { createNamedLogger } from '../../../diagnostics/logger';
import { healthBus } from '../../../diagnostics/healthBus';
import { buildError } from '../../../diagnostics/result';
import type { ErrorCode, Subsystem } from '../../../diagnostics/types';
import {
  PRESETS_STORAGE_KEY, PRESETS_SOFT_CAP, createDefaultPresetsConfig,
  type BloblingPreset, type BloblingPresetsConfig,
} from './types';

const FEATURE_SUBSYSTEM: Subsystem = 'feature:bloblingCustomiser';
const FEATURE_NAME = 'bloblingCustomiser';
const presetsLog = createNamedLogger(FEATURE_SUBSYSTEM);

let busRegistered = false;

function ensureBusRegistered(): void {
  if (busRegistered) return;
  busRegistered = true;
  healthBus.register(FEATURE_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
    message: 'Loading presets',
  });
}

function publishReady(): void {
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message: 'Ready',
    metrics: { presets: state.config.presets.length },
  });
}

function warnBlobling(code: ErrorCode, ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  presetsLog.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

const state = {
  config: createDefaultPresetsConfig(),
  resolvedKey: PRESETS_STORAGE_KEY,
  listeners: new Set<(presets: readonly BloblingPreset[]) => void>(),
  initialized: false,
};

function notifyListeners(): void {
  const snapshot: readonly BloblingPreset[] = state.config.presets.map(p => ({
    ...p,
    slots: { ...p.slots },
  }));
  for (const cb of state.listeners) {
    try { cb(snapshot); } catch (e) { warnBlobling('QPM-BLOBLING-006', { what: 'presets:listener' }, e); }
  }
}

function saveConfig(): void {
  state.config.updatedAt = Date.now();
  storage.set(state.resolvedKey, state.config);
  if (state.resolvedKey !== PRESETS_STORAGE_KEY) {
    storage.set(PRESETS_STORAGE_KEY, state.config);
  }
  notifyListeners();
}

export async function initBloblingPresets(): Promise<void> {
  ensureBusRegistered();
  if (state.initialized) { publishReady(); return; }
  state.initialized = true;

  const unscoped = storage.get<BloblingPresetsConfig | null>(PRESETS_STORAGE_KEY, null);
  if (unscoped) state.config = unscoped;

  const playerId = await getPlayerId();
  if (!playerId) {
    presetsLog.debug('No playerId — using unscoped key');
    publishReady();
    return;
  }

  const scopedKey = `${PRESETS_STORAGE_KEY}.${playerId}`;
  const existingScoped = storage.get<BloblingPresetsConfig | null>(scopedKey, null);

  if (existingScoped === null) {
    if (state.config.presets.length > 0) {
      storage.set(scopedKey, state.config);
      presetsLog.debug(`Migrated ${state.config.presets.length} preset(s) to scoped key`);
    }
  } else {
    if (state.config.presets.length > existingScoped.presets.length) {
      storage.set(scopedKey, state.config);
    } else {
      state.config = existingScoped;
      notifyListeners();
    }
  }

  state.resolvedKey = scopedKey;
  registerDynamicKey(scopedKey);
  publishReady();
}

export function stopBloblingPresets(): void {
  state.listeners.clear();
  state.initialized = false;
  state.resolvedKey = PRESETS_STORAGE_KEY;
  state.config = createDefaultPresetsConfig();
}

export function getPresets(): readonly BloblingPreset[] {
  return state.config.presets;
}

export function isAtCap(): boolean {
  return state.config.presets.length >= PRESETS_SOFT_CAP;
}

export function savePreset(
  input: Omit<BloblingPreset, 'id' | 'createdAt'>,
): BloblingPreset | null {
  if (isAtCap()) return null;
  const preset: BloblingPreset = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...input,
  };
  state.config.presets.push(preset);
  saveConfig();
  return preset;
}

export function deletePreset(id: string): boolean {
  const idx = state.config.presets.findIndex(p => p.id === id);
  if (idx < 0) return false;
  state.config.presets.splice(idx, 1);
  saveConfig();
  return true;
}

export function onPresetsChange(
  cb: (presets: readonly BloblingPreset[]) => void,
): () => void {
  state.listeners.add(cb);
  return () => { state.listeners.delete(cb); };
}
