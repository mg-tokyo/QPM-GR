// src/features/locker/instaAction.ts
// Bypass the game's 500ms press-and-hold delay for tool actions.
//
// The game requires a 500ms sustained hold for certain actions
// (removeGardenObject, cropCleanser, mutationPotion, etc.).
// When ariesHold is enabled, its rapid tap cycle (20ms keydown->keyup)
// never reaches the 500ms threshold, so actions never fire.
//
// This module intercepts Space keydowns and sends the WS message directly,
// bypassing the game's hold-to-act timer. The guard layer still runs
// (sendMessage is the hooked version), so Locker rules still apply.
//
// Handled actions:
//   removeGardenObject (shovel)
//   cropCleanser
//   mutationPotion
//
// NOT handled:
//   rainbowHarvest / goldHarvest  — handled by instaHarvest.ts
//   instaGrow                     — uses RPC (not WS), costs premium credits
//   wish                          — disabled in game (hidden)

import { pageWindow } from '../../core/pageContext';
import { readAtomValueSync } from '../../core/atomRegistry';
import { getLockerConfig } from './state';

// ── Types ──────────────────────────────────────────────────────────────────

interface RoomConnectionLike {
  sendMessage: (payload: unknown) => unknown;
}

interface PageWithRoomConnection extends Window {
  MagicCircle_RoomConnection?: RoomConnectionLike;
  __mga_lastScopePath?: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Must match the flag in ariesHold.ts so we can detect synthetic taps. */
const ARIES_SYN_FLAG = '__qpm_rapid_syn__';

/** Actions this module handles (lowercased for comparison). */
const HANDLED_ACTIONS: ReadonlySet<string> = new Set([
  'removegardenobject',
  'cropcleanser',
  'mutationpotion',
]);

// ── WS send ────────────────────────────────────────────────────────────────

const DEFAULT_SCOPE_PATH = ['Room', 'Quinoa'];

function getScopePath(): string[] {
  const dynamic = (pageWindow as PageWithRoomConnection).__mga_lastScopePath;
  if (Array.isArray(dynamic) && dynamic.length > 0) return dynamic.slice();
  return [...DEFAULT_SCOPE_PATH];
}

function sendMessage(payload: Record<string, unknown>): boolean {
  const connection = (pageWindow as PageWithRoomConnection).MagicCircle_RoomConnection;
  if (!connection || typeof connection.sendMessage !== 'function') return false;
  try {
    connection.sendMessage({ scopePath: getScopePath(), ...payload });
    return true;
  } catch {
    return false;
  }
}

// ── Action handlers ────────────────────────────────────────────────────────

function handleRemoveGardenObject(): boolean {
  const tile = readAtomValueSync('gardenTile') as { localTileIndex?: number; tileType?: string } | null;
  if (!tile || typeof tile.localTileIndex !== 'number' || typeof tile.tileType !== 'string') {
    return false;
  }
  return sendMessage({
    type: 'RemoveGardenObject',
    slot: tile.localTileIndex,
    slotType: tile.tileType,
  });
}

function handleCropCleanser(): boolean {
  const tileIdx = readAtomValueSync('dirtTileIndex');
  if (tileIdx == null) return false;
  const slotIdx = readAtomValueSync('growSlotIndex');
  if (slotIdx == null) return false;
  return sendMessage({
    type: 'CropCleanser',
    tileObjectIdx: tileIdx,
    growSlotIdx: slotIdx,
  });
}

function handleMutationPotion(): boolean {
  const tileIdx = readAtomValueSync('dirtTileIndex');
  if (tileIdx == null) return false;
  const slotIdx = readAtomValueSync('growSlotIndex');
  if (slotIdx == null) return false;
  // Read the selected item to resolve the toolId → mutation mapping.
  // Game tool IDs for potions follow the pattern <Mutation>Potion
  // (e.g. WetPotion → Wet, FrozenPotion → Frozen, AmberlitPotion → Amberlit).
  const selectedItem = readAtomValueSync('selectedItem') as { toolId?: string } | null;
  if (!selectedItem || typeof selectedItem.toolId !== 'string') return false;
  const mutation = resolveGrantedMutation(selectedItem.toolId);
  if (!mutation) return false;
  return sendMessage({
    type: 'MutationPotion',
    tileObjectIdx: tileIdx,
    growSlotIdx: slotIdx,
    mutation,
  });
}

// ── Mutation resolution ────────────────────────────────────────────────────

function resolveGrantedMutation(toolId: string): string | null {
  if (toolId.endsWith('Potion')) {
    const name = toolId.slice(0, -6);
    return name.length > 0 ? name : null;
  }
  return null;
}

// ── Keydown handler ────────────────────────────────────────────────────────

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function onKeyDownCapture(event: KeyboardEvent): void {
  if (event.code !== 'Space') return;
  if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (isTextInputFocused()) return;

  // Accept first press (repeat=false) OR synthetic taps from ariesHold.
  // Natural keyboard repeat (repeat=true, no SYN flag) is skipped — let the
  // game's normal 500ms hold timer handle it.
  const isSynthetic = !!(event as unknown as Record<string, unknown>)[ARIES_SYN_FLAG];
  if (event.repeat && !isSynthetic) return;

  const config = getLockerConfig();
  if (!config.ariesHold) return;

  const actionRaw = readAtomValueSync('action');
  const action = typeof actionRaw === 'string' ? actionRaw : null;
  if (!action) return;

  if (!HANDLED_ACTIONS.has(action.toLowerCase())) return;

  let sent = false;
  switch (action) {
    case 'removeGardenObject':
      sent = handleRemoveGardenObject();
      break;
    case 'cropCleanser':
      sent = handleCropCleanser();
      break;
    case 'mutationPotion':
      sent = handleMutationPotion();
      break;
  }

  if (sent) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

let listening = false;

export function startInstaAction(): void {
  if (listening) return;
  listening = true;
  (pageWindow as unknown as Window).addEventListener(
    'keydown', onKeyDownCapture as EventListener, true,
  );
}

export function stopInstaAction(): void {
  if (!listening) return;
  listening = false;
  (pageWindow as unknown as Window).removeEventListener(
    'keydown', onKeyDownCapture as EventListener, true,
  );
}
