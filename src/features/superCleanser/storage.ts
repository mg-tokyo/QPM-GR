import { storage } from '../../utils/storage';
import type { FilterMode, SuperCleanseSettings } from './types';

const K_ENABLED = 'qpm.superCleanser.enabled.v1';
const K_AUTO_OPEN = 'qpm.superCleanser.autoOpenPanel.v1';
const K_FILTER_MODE = 'qpm.superCleanser.filterMode.v1';
const K_FILTER_MUTATIONS = 'qpm.superCleanser.filterMutations.v1';

type Listener = (settings: SuperCleanseSettings) => void;
const listeners = new Set<Listener>();

function isFilterMode(v: unknown): v is FilterMode {
  return v === 'any' || v === 'all';
}

export function getSuperCleanseSettings(): SuperCleanseSettings {
  const rawMutations = storage.get<unknown>(K_FILTER_MUTATIONS, null);
  const mutations: readonly string[] = Array.isArray(rawMutations)
    ? rawMutations.filter((v): v is string => typeof v === 'string')
    : [];
  const modeRaw = storage.get<unknown>(K_FILTER_MODE, null);
  const enabledRaw = storage.get<unknown>(K_ENABLED, null);
  const autoOpenRaw = storage.get<unknown>(K_AUTO_OPEN, null);
  return {
    enabled: enabledRaw === true,
    autoOpenPanel: autoOpenRaw !== false,
    filterMode: isFilterMode(modeRaw) ? modeRaw : 'any',
    filterMutations: mutations,
  };
}

function notifyListeners(): void {
  const snap = getSuperCleanseSettings();
  for (const cb of listeners) {
    try { cb(snap); } catch { /* listener errors are non-fatal */ }
  }
}

export function setSuperCleanseEnabled(v: boolean): void {
  storage.set(K_ENABLED, v);
  notifyListeners();
}

export function setAutoOpenPanel(v: boolean): void {
  storage.set(K_AUTO_OPEN, v);
  notifyListeners();
}

export function setFilterMode(v: FilterMode): void {
  storage.set(K_FILTER_MODE, v);
  notifyListeners();
}

export function setFilterMutations(v: readonly string[]): void {
  storage.set(K_FILTER_MUTATIONS, [...v]);
  notifyListeners();
}

export function subscribeSuperCleanseSettings(cb: Listener): () => void {
  listeners.add(cb);
  try { cb(getSuperCleanseSettings()); } catch { /* non-fatal */ }
  return () => { listeners.delete(cb); };
}
