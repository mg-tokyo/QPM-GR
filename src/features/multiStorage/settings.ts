import { storage } from '../../utils/storage';
import { isRecord } from '../../utils/typeGuards';
import type { SavedCell, SavedLayout } from './layout';

export const MULTI_STORAGE_ENABLED_KEY = 'qpm.multiStorage.enabled.v1';
export const MULTI_STORAGE_PICK_KEY = 'qpm.multiStorage.pick.v1';
export const MULTI_STORAGE_LAYOUT_KEY = 'qpm.multiStorage.layout.v1';

export interface PanelSettingsKeys { enabled: string; pick: string; layout: string }

export interface PanelSettings {
  /** Fires after any write here: on/off, the pick, a saved place, a reset. */
  onChange(cb: () => void): () => void;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  /** Null means every panel on offer. */
  getPick(): string[] | null;
  setPick(ids: readonly string[] | null): void;
  getSavedLayout(): SavedLayout;
  /** Merges into what is saved, so panels that are not open keep their place. */
  saveLayoutCells(cells: SavedLayout): void;
  clearSavedLayout(): void;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function savedCell(raw: unknown): SavedCell | null {
  if (!isRecord(raw)) return null;
  const { x, y, w, h, z } = raw;
  if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || !(w > 0) || !(h > 0)) return null;
  return finite(z) ? { x, y, w, h, z } : { x, y, w, h };
}

/** On/off, pick and saved layout for one family of floating game panels (storages, shops). */
export function createPanelSettings(keys: PanelSettingsKeys): PanelSettings {
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const cb of [...listeners]) {
      try { cb(); } catch { /* a broken listener must not block the others */ }
    }
  };

  const getSavedLayout = (): SavedLayout => {
    const raw = storage.get<unknown>(keys.layout, null);
    const layout: SavedLayout = {};
    if (!isRecord(raw)) return layout;
    for (const [id, value] of Object.entries(raw)) {
      const cell = savedCell(value);
      if (cell) layout[id] = cell;
    }
    return layout;
  };

  return {
    onChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    isEnabled: () => storage.get<unknown>(keys.enabled, true) !== false,
    setEnabled(enabled) {
      storage.set(keys.enabled, enabled);
      emit();
    },
    getPick() {
      const raw = storage.get<unknown>(keys.pick, null);
      if (!Array.isArray(raw)) return null;
      const ids = [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0))];
      return ids.length > 0 ? ids : null;
    },
    setPick(ids) {
      const clean = ids ? [...new Set(ids.filter(id => id.length > 0))] : [];
      if (clean.length === 0) storage.remove(keys.pick);
      else storage.set(keys.pick, clean);
      emit();
    },
    getSavedLayout,
    saveLayoutCells(cells) {
      const layout = getSavedLayout();
      for (const [id, value] of Object.entries(cells)) {
        const cell = savedCell(value);
        if (cell) layout[id] = cell;
      }
      storage.set(keys.layout, layout);
      emit();
    },
    clearSavedLayout() {
      storage.remove(keys.layout);
      emit();
    },
  };
}

const settings = createPanelSettings({
  enabled: MULTI_STORAGE_ENABLED_KEY, pick: MULTI_STORAGE_PICK_KEY, layout: MULTI_STORAGE_LAYOUT_KEY,
});

export const onMultiStorageSettingsChange = settings.onChange;
export const isMultiStorageEnabled = settings.isEnabled;
export const setMultiStorageEnabled = settings.setEnabled;
/** Null means every owned storage. */
export const getStoragePick = settings.getPick;
export const setStoragePick = settings.setPick;
export const getSavedLayout = settings.getSavedLayout;
export const saveLayoutCells = settings.saveLayoutCells;
export const clearSavedLayout = settings.clearSavedLayout;
