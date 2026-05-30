// Per-slot feed keybind storage + global keydown handler.

import { storage } from '../../utils/storage';
import { enqueueFeed } from './instantFeed';
import { isEditableTarget, normalizeKeybind } from '../../ui/pets/petsWindow/helpers';

const STORAGE_KEY = 'qpm.feed-keybinds.v1';
const MAX_SLOTS = 3;
const DEFAULT_KEYBINDS: Record<number, string> = { 0: 'alt+1', 1: 'alt+2', 2: 'alt+3' };

interface FeedKeybindState {
  /** Maps slot index (0–2) → keybind combo string. */
  slots: Record<number, string>;
}

function loadState(): FeedKeybindState {
  const raw = storage.get<FeedKeybindState>(STORAGE_KEY, { slots: {} });
  if (!raw || typeof raw !== 'object' || !raw.slots || typeof raw.slots !== 'object') {
    return { slots: {} };
  }
  return raw;
}

function saveState(state: FeedKeybindState): void {
  storage.set(STORAGE_KEY, state);
}

export function getFeedKeybind(slotIndex: number): string {
  const state = loadState();
  return state.slots[slotIndex] ?? DEFAULT_KEYBINDS[slotIndex] ?? '';
}

export function setFeedKeybind(slotIndex: number, combo: string): void {
  if (slotIndex < 0 || slotIndex >= MAX_SLOTS) return;
  const state = loadState();
  // Clear any other slot that has this combo to avoid conflicts.
  for (let i = 0; i < MAX_SLOTS; i++) {
    if (state.slots[i] === combo) delete state.slots[i];
  }
  state.slots[slotIndex] = combo;
  saveState(state);
}

export function clearFeedKeybind(slotIndex: number): void {
  const state = loadState();
  delete state.slots[slotIndex];
  saveState(state);
}

export function getAllFeedKeybinds(): Record<number, string> {
  const state = loadState();
  const result: Record<number, string> = {};
  for (let i = 0; i < MAX_SLOTS; i++) {
    result[i] = state.slots[i] ?? DEFAULT_KEYBINDS[i] ?? '';
  }
  return result;
}

let handler: ((e: KeyboardEvent) => void) | null = null;

export function startFeedKeybinds(): void {
  if (handler) return;
  handler = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;
    if (e.repeat) return;
    const combo = normalizeKeybind(e);
    if (!combo) return;

    const keybinds = getAllFeedKeybinds();
    for (let i = 0; i < MAX_SLOTS; i++) {
      if (keybinds[i] === combo) {
        e.preventDefault();
        e.stopPropagation();
        enqueueFeed(i);
        return;
      }
    }
  };
  document.addEventListener('keydown', handler);
}

export function stopFeedKeybinds(): void {
  if (handler) {
    document.removeEventListener('keydown', handler);
    handler = null;
  }
}
