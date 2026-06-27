// src/features/gardenQol/instaAction.ts
// Bypass the game's 500ms press-and-hold delay for tool actions.
//
// The game requires a 500ms sustained hold for certain actions
// (removeGardenObject, cropCleanser, mutationPotion, etc.).
// When ariesHold is enabled, its rapid tap cycle (20ms keydown->keyup)
// never reaches the 500ms threshold, so actions never fire.
//
// This module intercepts Space keydowns and sends the WS message via the
// centralised sendRoomAction facade (Locker guard rules still apply).
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
import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { Subsystem } from '../../diagnostics/types';
import { sendRoomAction, type RoomActionType, type WebSocketSendResult } from '../../websocket/api';
import { getGardenQolConfig } from './state';

// ── Diagnostics ───────────────────────────────────────────────────────────

const FEATURE_SUBSYSTEM: Subsystem = 'feature:gardenInstaAction';
const FEATURE_NAME = 'gardenInstaAction';
const log = createNamedLogger(FEATURE_SUBSYSTEM);

/**
 * Re-attribute a FEATURE-* code emission to this feature's bus row. The
 * registered placeholder subsystem on FEATURE-001 is `'feature'`; without this
 * override the bus would degrade a generic `feature` entry instead of
 * `feature:gardenInstaAction`.
 */
function warnFeature(code: Parameters<typeof buildError>[0], ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  log.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
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

// ── Action handlers ────────────────────────────────────────────────────────

function sendAction(type: RoomActionType, payload: Record<string, unknown>): WebSocketSendResult {
  // Skip the per-key throttle: the keydown handler already filters natural
  // key-repeat and only synthetic ariesHold taps re-enter; a per-(type,key)
  // throttle here would silently drop legitimate retries after Locker
  // rejection.
  return sendRoomAction(type, payload, { skipThrottle: true });
}

function handleRemoveGardenObject(): WebSocketSendResult | null {
  const tile = readAtomValueSync('gardenTile') as { localTileIndex?: number; tileType?: string } | null;
  if (!tile || typeof tile.localTileIndex !== 'number' || typeof tile.tileType !== 'string') {
    return null;
  }
  return sendAction('RemoveGardenObject', {
    slot: tile.localTileIndex,
    slotType: tile.tileType,
  });
}

function handleCropCleanser(): WebSocketSendResult | null {
  const tileIdx = readAtomValueSync('dirtTileIndex');
  if (tileIdx == null) return null;
  const slotIdx = readAtomValueSync('selectedSlotId');
  if (slotIdx == null) return null;
  return sendAction('CropCleanser', {
    tileObjectIdx: tileIdx,
    growSlotIdx: slotIdx,
  });
}

function handleMutationPotion(): WebSocketSendResult | null {
  const tileIdx = readAtomValueSync('dirtTileIndex');
  if (tileIdx == null) return null;
  const slotIdx = readAtomValueSync('selectedSlotId');
  if (slotIdx == null) return null;
  // For Tool items, mySelectedItemIdAtom holds the toolId directly (game's
  // getInventoryItemId returns toolId for tools). Potion toolIds follow
  // <Mutation>Potion — WetPotion → Wet, FrozenPotion → Frozen, etc.
  const selectedItemId = readAtomValueSync('selectedItemId');
  if (typeof selectedItemId !== 'string') return null;
  const mutation = resolveGrantedMutation(selectedItemId);
  if (!mutation) return null;
  return sendAction('MutationPotion', {
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

  const config = getGardenQolConfig();
  if (!config.ariesHold) return;

  const actionRaw = readAtomValueSync('action');
  const action = typeof actionRaw === 'string' ? actionRaw : null;
  if (!action) return;

  if (!HANDLED_ACTIONS.has(action.toLowerCase())) return;

  let result: WebSocketSendResult | null = null;
  switch (action) {
    case 'removeGardenObject':
      result = handleRemoveGardenObject();
      break;
    case 'cropCleanser':
      result = handleCropCleanser();
      break;
    case 'mutationPotion':
      result = handleMutationPotion();
      break;
  }

  if (!result) return;

  if (result.ok) {
    event.stopImmediatePropagation();
    event.preventDefault();
    return;
  }

  // Result-aware path — the WS layer already logs a WS-* code with the
  // underlying reason (no_connection / invalid_payload / send_failed /
  // locker_blocked). FEATURE-001 re-attributes that failure to this
  // feature's bus row so the user can see which feature degraded.
  warnFeature('QPM-FEATURE-001', {
    type: action,
    reason: result.reason ?? 'unknown',
  });
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

let listening = false;

export function startInstaAction(): void {
  if (listening) return;
  listening = true;
  // Register the feature's bus row on first start; idempotent (healthBus
  // .register preserves an existing entry's status if it's already there).
  healthBus.register(FEATURE_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
  (pageWindow as unknown as Window).addEventListener(
    'keydown', onKeyDownCapture as EventListener, true,
  );
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message: 'Listening (capture-phase keydown)',
  });
}

export function stopInstaAction(): void {
  if (!listening) return;
  listening = false;
  (pageWindow as unknown as Window).removeEventListener(
    'keydown', onKeyDownCapture as EventListener, true,
  );
}
