import { storage, registerDynamicKey } from '../../../../utils/storage';
import { getPlayerId } from '../../../../core/playerContext';
import { log } from '../../../../utils/logger';
import {
  PRESETS_STORAGE_KEY, PRESETS_SOFT_CAP, createDefaultPresetsConfig,
  type GardenPainterPreset, type GardenPainterPresetsConfig,
} from './types';

const state = {
  config: createDefaultPresetsConfig(),
  resolvedKey: PRESETS_STORAGE_KEY,
  listeners: new Set<(presets: readonly GardenPainterPreset[]) => void>(),
  initialized: false,
};

function notifyListeners(): void {
  const snapshot: readonly GardenPainterPreset[] = state.config.presets.map(p => ({
    ...p,
    snapshot: { ...p.snapshot, rules: [...p.snapshot.rules], uploadedAssets: { ...p.snapshot.uploadedAssets } },
  }));
  for (const cb of state.listeners) {
    try { cb(snapshot); } catch (e) { log('[gardenPainterPresets] listener threw', e); }
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

export async function initGardenPainterPresets(): Promise<void> {
  if (state.initialized) return;
  state.initialized = true;

  const unscoped = storage.get<GardenPainterPresetsConfig | null>(PRESETS_STORAGE_KEY, null);
  if (unscoped) state.config = unscoped;

  const playerId = await getPlayerId();
  if (!playerId) {
    log('[gardenPainterPresets] No playerId — using unscoped key');
    return;
  }

  const scopedKey = `${PRESETS_STORAGE_KEY}.${playerId}`;
  const existingScoped = storage.get<GardenPainterPresetsConfig | null>(scopedKey, null);

  if (existingScoped === null) {
    if (state.config.presets.length > 0) {
      storage.set(scopedKey, state.config);
      log(`[gardenPainterPresets] Migrated ${state.config.presets.length} preset(s) to scoped key`);
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
}

export function stopGardenPainterPresets(): void {
  state.listeners.clear();
  state.initialized = false;
  state.resolvedKey = PRESETS_STORAGE_KEY;
  state.config = createDefaultPresetsConfig();
}

export function getGardenPainterPresets(): readonly GardenPainterPreset[] {
  return state.config.presets;
}

export function isGardenPainterPresetsAtCap(): boolean {
  return state.config.presets.length >= PRESETS_SOFT_CAP;
}

function nextPresetName(): string {
  const existing = state.config.presets.map(p => p.name);
  for (let i = 1; ; i++) {
    const candidate = `Preset ${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

export function saveGardenPainterPreset(
  input: Omit<GardenPainterPreset, 'id' | 'createdAt' | 'name'>,
): GardenPainterPreset | null {
  if (isGardenPainterPresetsAtCap()) return null;
  const preset: GardenPainterPreset = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    name: nextPresetName(),
    ...input,
  };
  state.config.presets.push(preset);
  saveConfig();
  return preset;
}

export function deleteGardenPainterPreset(id: string): boolean {
  const idx = state.config.presets.findIndex(p => p.id === id);
  if (idx < 0) return false;
  state.config.presets.splice(idx, 1);
  saveConfig();
  return true;
}

export function onGardenPainterPresetsChange(
  cb: (presets: readonly GardenPainterPreset[]) => void,
): () => void {
  state.listeners.add(cb);
  return () => { state.listeners.delete(cb); };
}
