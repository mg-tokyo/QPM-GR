import { storage } from '../../utils/storage';
import { isEditableTarget, normalizeKeybind } from '../../ui/pets/petsWindow/helpers';

const STORAGE_KEY = 'qpm.panelHotkey.v1';
const DEFAULT_KEYBIND = 'alt+q';

interface PanelHotkeyState {
  keybind?: string;
}

const listeners: Array<(combo: string) => void> = [];
let handler: ((event: KeyboardEvent) => void) | null = null;

function loadState(): PanelHotkeyState {
  const raw = storage.get<PanelHotkeyState>(STORAGE_KEY, {});
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

function saveState(state: PanelHotkeyState): void {
  storage.set(STORAGE_KEY, state);
  notifyListeners();
}

function notifyListeners(): void {
  const combo = getPanelToggleKeybind();
  for (const listener of listeners) {
    try { listener(combo); } catch {}
  }
}

export function getPanelToggleKeybind(): string {
  const state = loadState();
  return typeof state.keybind === 'string' && state.keybind.trim() ? state.keybind : DEFAULT_KEYBIND;
}

export function setPanelToggleKeybind(combo: string): void {
  const next = combo.trim();
  if (!next) {
    resetPanelToggleKeybind();
    return;
  }
  saveState({ ...loadState(), keybind: next });
}

export function resetPanelToggleKeybind(): void {
  const state = loadState();
  delete state.keybind;
  saveState(state);
}

export function onPanelToggleKeybindChange(listener: (combo: string) => void): () => void {
  listeners.push(listener);
  listener(getPanelToggleKeybind());
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
}

export function startPanelHotkey(togglePanel: () => void): void {
  stopPanelHotkey();
  handler = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (isEditableTarget(event.target)) return;
    const combo = normalizeKeybind(event);
    if (!combo || combo !== getPanelToggleKeybind()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    togglePanel();
  };
  document.addEventListener('keydown', handler, true);
}

export function stopPanelHotkey(): void {
  if (!handler) return;
  document.removeEventListener('keydown', handler, true);
  handler = null;
}
