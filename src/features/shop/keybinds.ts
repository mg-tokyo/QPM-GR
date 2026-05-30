// Shop keybinds — keyboard shortcuts to open game shop modals.

import { storage } from '../../utils/storage';
import { isEditableTarget, normalizeKeybind } from '../../ui/pets/petsWindow/helpers';
import { getAtomByLabel, writeAtomValue, ensureJotaiStore } from '../../core/jotaiBridge';
import { log } from '../../utils/logger';

const STORAGE_KEY = 'qpm.shop-keybinds.v1';

export type ShopId = 'seedShop' | 'eggShop' | 'toolShop' | 'decorShop';

const SHOP_IDS: readonly ShopId[] = ['seedShop', 'eggShop', 'toolShop', 'decorShop'] as const;

export const SHOP_LABELS: Record<ShopId, string> = {
  seedShop: 'Seeds',
  eggShop: 'Eggs',
  toolShop: 'Tools',
  decorShop: 'Decor',
};

const DEFAULT_BINDS: Record<ShopId, string> = {
  seedShop: 'alt+s',
  eggShop: 'alt+e',
  toolShop: 'alt+t',
  decorShop: 'alt+d',
};

interface ShopKeybindState {
  enabled: boolean;
  binds: Record<string, string>;
}

function loadState(): ShopKeybindState {
  const raw = storage.get<ShopKeybindState>(STORAGE_KEY, { enabled: true, binds: {} });
  if (!raw || typeof raw !== 'object' || !raw.binds || typeof raw.binds !== 'object') {
    return { enabled: true, binds: {} };
  }
  return { enabled: raw.enabled !== false, binds: raw.binds };
}

function saveState(state: ShopKeybindState): void {
  storage.set(STORAGE_KEY, state);
}

export function isShopKeybindsEnabled(): boolean {
  return loadState().enabled;
}

export function setShopKeybindsEnabled(enabled: boolean): void {
  const state = loadState();
  state.enabled = enabled;
  saveState(state);
}

export function getShopKeybind(shopId: ShopId): string {
  const state = loadState();
  return state.binds[shopId] ?? DEFAULT_BINDS[shopId] ?? '';
}

export function setShopKeybind(shopId: ShopId, combo: string): void {
  const state = loadState();
  // Clear any other shop that has this combo to avoid conflicts.
  for (const id of SHOP_IDS) {
    if (state.binds[id] === combo) delete state.binds[id];
  }
  state.binds[shopId] = combo;
  saveState(state);
}

export function clearShopKeybind(shopId: ShopId): void {
  const state = loadState();
  delete state.binds[shopId];
  saveState(state);
}

export function getAllShopKeybinds(): Record<ShopId, string> {
  const state = loadState();
  const result = {} as Record<ShopId, string>;
  for (const id of SHOP_IDS) {
    result[id] = state.binds[id] ?? DEFAULT_BINDS[id] ?? '';
  }
  return result;
}

async function openShopModal(shopId: ShopId): Promise<void> {
  try {
    const store = await ensureJotaiStore();
    if (store.__polyfill) return; // no writable store available
    const atom = getAtomByLabel('activeModalAtom');
    if (!atom) return;
    await writeAtomValue(atom, shopId);
  } catch {
    // Fail silently — don't crash on keybind press.
  }
}

let handler: ((e: KeyboardEvent) => void) | null = null;

export function startShopKeybinds(): void {
  if (handler) return;
  handler = (e: KeyboardEvent) => {
    if (!isShopKeybindsEnabled()) return;
    if (isEditableTarget(e.target)) return;
    if (e.repeat) return;
    const combo = normalizeKeybind(e);
    if (!combo) return;

    const keybinds = getAllShopKeybinds();
    for (const id of SHOP_IDS) {
      if (keybinds[id] === combo) {
        e.preventDefault();
        e.stopPropagation();
        openShopModal(id).catch(() => {
          log('[ShopKeybinds] Failed to open modal', id);
        });
        return;
      }
    }
  };
  document.addEventListener('keydown', handler);
}

export function stopShopKeybinds(): void {
  if (handler) {
    document.removeEventListener('keydown', handler);
    handler = null;
  }
}
