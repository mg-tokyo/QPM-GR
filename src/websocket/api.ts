// src/websocket/api.ts
// Centralized send facade for room WebSocket actions.

import { createNamedLogger } from '../diagnostics/logger';
import { pageWindow } from '../core/pageContext';
import {
  buildEnvelope,
  newRequestId,
  type QuinoaCommandResultMessage,
} from './envelope';
import { resolveTransport, takeSendToken, withQpmOrigin } from './transport';
import {
  cancelCommandRequest,
  isCommandSequencerActive,
  isEnvelopeEnabled,
  trackCommandRequest,
} from './commandSequencer';
import { wsCounters, maybePublishRecovery, startWebsocketHealth, stopWebsocketHealth } from './health';
import {
  PET_TEAM_ICON_IDS,
  isFiniteNumber,
  isNonEmptyString,
  type MovePetTeamPayload,
  type PickupPetPayload,
  type PlacePetPayload,
  type PlayerPositionPayload,
  type PurchaseShopItemPayload,
  type PutInStoragePayload,
  type RetrievePayload,
  type SavePetTeamPayload,
  type SetPetTeamEmblemPayload,
  type SwapFromStoragePayload,
  type SwapPayload,
} from './validation';

export { sendSetPlayerData, type CosmeticColor, type SetPlayerDataPayload } from './playerData';
export type { QuinoaCommandResultMessage } from './envelope';

const log = createNamedLogger('websocket');

export type RoomActionType =
  | 'ToggleLockItem'
  | 'ToggleFavoriteItem'
  | 'FeedPet'
  | 'StorePet'
  | 'PickupPet'
  | 'PlacePet'
  | 'SellPet'
  | 'PlayerPosition'
  | 'RetrieveItemFromStorage'
  | 'PutItemInStorage'
  | 'PurchaseShopItem'
  | 'SwapPet'
  | 'XPPotion'
  | 'ReplenishPotion'
  | 'LogItems'
  | 'RequestPetGreet'
  | 'RidePet'
  | 'HarvestCrop'
  | 'RemoveGardenObject'
  | 'CropCleanser'
  | 'MutationPotion'
  | 'DismountPet'
  | 'SwapPetFromStorage'
  | 'UpgradePetHutch'
  | 'UpgradeSeedSilo'
  | 'UpgradeDecorShed'
  | 'SavePetTeam'
  | 'DeletePetTeam'
  | 'ApplyPetTeam'
  | 'MovePetTeam'
  | 'SetPetTeamEmblem'
  // Keep the SetRiddenPet member as the final entry of this union — the
  // QPM FULL PRIVATE overlay's apply-transforms.js anchors ws:extend-union
  // to that literal line and inserts automation-only types after it. Add
  // new base members ABOVE this comment, not below.
  | 'SetRiddenPet';

export type WebSocketSendFailureReason =
  | 'no_connection'
  | 'invalid_payload'
  | 'throttled'
  | 'send_failed'
  | 'locker_blocked';

export interface WebSocketSendResult {
  ok: boolean;
  reason?: WebSocketSendFailureReason;
  transport?: 'legacy' | 'envelope';
  /** Envelope sends only. */
  requestId?: string;
  /**
   * Envelope sends only. Resolves with the server's QuinoaCommandResult;
   * rejects with QuinoaCommandTimeoutError after 5 s or on reconnect — the
   * outcome is then UNKNOWN, never a confirmed failure.
   */
  awaitResult?: () => Promise<QuinoaCommandResultMessage>;
}

/**
 * Room-state patch as delivered by `MagicCircle_RoomConnection.subscribeToPatches`.
 * Shape is game-internal; we only care that fullState fires after each patch.
 */
export type RoomPatchListener = (patches: unknown, fullState: unknown) => void;

/** Payload of `subscribeToRoomFrames` (v1040 `publishRoomFrame`). */
export interface RoomFrame {
  events?: unknown[];
  publishedAtServerMs?: number;
  /** Server frontier: highest command sequence executed so far. */
  executedCommandSequence?: number;
  state?: { patches?: unknown; nextState?: unknown };
}

export interface RoomConnection {
  sendMessage: (payload: unknown) => void;
  /**
   * Immediate send; returns false (and drops the message) when disconnected
   * or before Welcome. QuinoaCommand envelopes MUST use this — `sendMessage`
   * would queue them for a later session where their sequence is invalid.
   */
  trySendMessageNow?: (payload: unknown) => boolean;
  ws?: WebSocket | null;
  socket?: WebSocket | null;
  currentWebSocket?: WebSocket | null;
  isConnected?: () => boolean;
  isCommandSessionReady?: boolean;
  /**
   * Fires `cb(patches, fullState)` on every room state update. Returns
   * either a bare unsubscribe function (older bundles) or
   * `{ currentState, unsubscribe }` (newest Thundershop bundle, verified
   * at scraped-data/BetaGameSourceFiles/Thundershop/preview.magicgarden.gg/
   * src/connection/RoomConnection.ts:143-156). Callers must handle both.
   * Preferred atom-free source for the state tree — see src/core/stateTree.ts.
   * Only present on newer bundles.
   */
  subscribeToPatches?: (cb: RoomPatchListener) => unknown;
  /**
   * Fires on initial connection and after every reconnect; if already
   * connected when subscribing, fires immediately with the current
   * publication. Live v1040 passes `(state, publishedAtServerMs,
   * executedCommandSequence)`. Returns a bare unsubscribe function.
   */
  subscribeToWelcome?: (
    cb: (state: unknown, publishedAtServerMs?: number, executedCommandSequence?: number) => void,
  ) => unknown;
  /** Fires on every RoomFrame (v1040). Returns a bare unsubscribe function. */
  subscribeToRoomFrames?: (cb: (frame: RoomFrame) => void) => unknown;
  lastDistributedRoomPublication?: {
    state?: unknown;
    publishedAtServerMs?: number;
    executedCommandSequence?: number;
  };
  /**
   * Synchronous snapshot of the last-delivered room state. Alternative to
   * subscribing when only a one-shot read is needed. Present when
   * subscribeToPatches is present.
   */
  lastRoomStateJsonable?: unknown;
}

interface PageWithRoomConnection extends Window {
  MagicCircle_RoomConnection?: RoomConnection;
  __mga_lastScopePath?: string[];
}

type SendPreflightFn = (type: string, payload: Record<string, unknown>) => { ok: boolean; reason?: string };
let sendPreflightFn: SendPreflightFn | null = null;

export function registerSendPreflight(fn: SendPreflightFn): void { sendPreflightFn = fn; }
export function clearSendPreflight(): void { sendPreflightFn = null; }

const DEFAULT_SCOPE_PATH = ['Room', 'Quinoa'] as const;
const DEFAULT_THROTTLE_MS = 100;
const lastSentAt = new Map<string, number>();

export function getRoomConnection(): RoomConnection | null {
  return (pageWindow as PageWithRoomConnection).MagicCircle_RoomConnection ?? null;
}

export function hasRoomConnection(): boolean {
  return getRoomConnection() !== null;
}

function getRoomSocket(connection: RoomConnection | null): WebSocket | null {
  if (!connection) return null;
  return connection.ws ?? connection.socket ?? connection.currentWebSocket ?? null;
}

export function isRoomSocketOpen(): boolean {
  const connection = getRoomConnection();
  if (!connection) return false;
  const socket = getRoomSocket(connection);
  if (!socket) {
    // Some builds hide the socket field on the room connection; treat as unknown/open.
    return true;
  }
  return socket.readyState === WebSocket.OPEN;
}

function getScopePath(): string[] {
  const dynamic = (pageWindow as PageWithRoomConnection).__mga_lastScopePath;
  if (Array.isArray(dynamic) && dynamic.length > 0) return dynamic.slice();
  return [...DEFAULT_SCOPE_PATH];
}

function validatePayload(type: RoomActionType, payload: Record<string, unknown>): boolean {
  switch (type) {
    case 'ToggleLockItem':
    case 'ToggleFavoriteItem':
      return isNonEmptyString(payload.itemId);
    case 'FeedPet':
      return isNonEmptyString(payload.petItemId) && isNonEmptyString(payload.cropItemId);
    case 'PickupPet': {
      const p = payload as PickupPetPayload;
      return isNonEmptyString(p.petId);
    }
    case 'StorePet':
    case 'SellPet':
      return isNonEmptyString(payload.itemId);
    case 'PlacePet': {
      const p = payload as PlacePetPayload;
      return (
        isNonEmptyString(p.itemId) &&
        !!p.position &&
        isFiniteNumber(p.position.x) &&
        isFiniteNumber(p.position.y) &&
        isNonEmptyString(p.tileType) &&
        isFiniteNumber(p.localTileIndex)
      );
    }
    case 'PlayerPosition': {
      const p = payload as PlayerPositionPayload;
      return !!p.position && isFiniteNumber(p.position.x) && isFiniteNumber(p.position.y);
    }
    case 'RetrieveItemFromStorage': {
      const p = payload as RetrievePayload;
      const hasIndex = p.toInventoryIndex == null || isFiniteNumber(p.toInventoryIndex);
      const hasQuantity = p.quantity == null || (isFiniteNumber(p.quantity) && p.quantity > 0);
      return isNonEmptyString(p.itemId) && isNonEmptyString(p.storageId) && hasIndex && hasQuantity;
    }
    case 'PutItemInStorage': {
      const p = payload as PutInStoragePayload;
      const hasIndex = p.toStorageIndex == null || isFiniteNumber(p.toStorageIndex);
      const hasQuantity = p.quantity == null || (isFiniteNumber(p.quantity) && p.quantity > 0);
      return isNonEmptyString(p.itemId) && isNonEmptyString(p.storageId) && hasIndex && hasQuantity;
    }
    case 'PurchaseShopItem': {
      const p = payload as unknown as PurchaseShopItemPayload;
      return isNonEmptyString(p.shop) && !!p.item && isNonEmptyString(p.item.itemType);
    }
    case 'SwapPet': {
      const p = payload as SwapPayload;
      return isNonEmptyString(p.petSlotId) && isNonEmptyString(p.petInventoryId);
    }
    case 'SwapPetFromStorage': {
      const p = payload as SwapFromStoragePayload;
      return (
        isNonEmptyString(p.petSlotId) &&
        isNonEmptyString(p.storagePetId) &&
        isNonEmptyString(p.storageId)
      );
    }
    case 'XPPotion':
    case 'ReplenishPotion':
      return isNonEmptyString(payload.petItemId);
    case 'LogItems':
      return true;
    case 'RequestPetGreet': {
      const p = payload as PlayerPositionPayload;
      return !!p.position && isFiniteNumber(p.position.x) && isFiniteNumber(p.position.y);
    }
    case 'RidePet':
      return isNonEmptyString(payload.petItemId);
    case 'DismountPet':
      return true;
    case 'UpgradePetHutch':
    case 'UpgradeSeedSilo':
    case 'UpgradeDecorShed':
      return true;
    case 'SetRiddenPet':
      // petId can be a string (mount) or null (dismount)
      return payload.petId === null || isNonEmptyString(payload.petId);
    case 'HarvestCrop':
      // `slot` is the dirt-tile index; `slotsIndex` is the grow-slot id within
      // that tile. Both required and finite.
      return isFiniteNumber(payload.slot) && isFiniteNumber(payload.slotsIndex);
    case 'RemoveGardenObject':
      // `slot` is the local tile index; `slotType` is the tile type string.
      return isFiniteNumber(payload.slot) && isNonEmptyString(payload.slotType);
    case 'CropCleanser':
      return isFiniteNumber(payload.tileObjectIdx) && isFiniteNumber(payload.growSlotIdx);
    case 'MutationPotion':
      return (
        isFiniteNumber(payload.tileObjectIdx)
        && isFiniteNumber(payload.growSlotIdx)
        && isNonEmptyString(payload.mutation)
      );
    case 'SavePetTeam': {
      const p = payload as unknown as SavePetTeamPayload;
      const teamIdOk = p.teamId === null || isNonEmptyString(p.teamId);
      const nameOk = isNonEmptyString(p.name);
      const petIdsOk =
        Array.isArray(p.petIds)
        && p.petIds.length >= 1
        && p.petIds.length <= 3
        && p.petIds.every(isNonEmptyString);
      return teamIdOk && nameOk && petIdsOk;
    }
    case 'DeletePetTeam':
    case 'ApplyPetTeam':
      return isNonEmptyString(payload.teamId);
    case 'MovePetTeam': {
      const p = payload as unknown as MovePetTeamPayload;
      return (
        isNonEmptyString(p.movePetTeamId)
        && isFiniteNumber(p.toPetTeamIndex)
        && p.toPetTeamIndex >= 0
        && Number.isInteger(p.toPetTeamIndex)
      );
    }
    case 'SetPetTeamEmblem': {
      const p = payload as unknown as SetPetTeamEmblemPayload;
      if (!isNonEmptyString(p.teamId) || !p.emblem || typeof p.emblem !== 'object') return false;
      const em = p.emblem;
      if (em.type === 'number') {
        return isFiniteNumber(em.number) && em.number >= 1 && em.number <= 26 && Number.isInteger(em.number);
      }
      if (em.type === 'pet') return isNonEmptyString(em.petSpecies);
      if (em.type === 'icon') return typeof em.icon === 'string' && PET_TEAM_ICON_IDS.has(em.icon);
      return false;
    }
    default:
      return false;
  }
}

function getThrottleKey(type: RoomActionType, payload: Record<string, unknown>): string {
  switch (type) {
    case 'ToggleLockItem':
    case 'ToggleFavoriteItem':
    case 'StorePet':
    case 'SellPet':
    case 'RetrieveItemFromStorage':
    case 'PutItemInStorage':
      return `${type}:${String(payload.itemId ?? '')}`;
    case 'PurchaseShopItem': {
      const item = (payload as unknown as PurchaseShopItemPayload).item;
      const id = item?.species ?? item?.eggId ?? item?.toolId ?? item?.decorId ?? '';
      return `${type}:${String(payload.shop ?? '')}:${String(id)}`;
    }
    case 'PickupPet':
      return `${type}:${String(payload.petId ?? '')}`;
    case 'FeedPet':
      return `${type}:${String(payload.petItemId ?? '')}:${String(payload.cropItemId ?? '')}`;
    case 'PlacePet':
      return `${type}:${String(payload.itemId ?? '')}`;
    case 'PlayerPosition':
      return type;
    case 'SwapPet':
      return `${type}:${String(payload.petSlotId ?? '')}:${String(payload.petInventoryId ?? '')}`;
    case 'SwapPetFromStorage':
      return `${type}:${String(payload.petSlotId ?? '')}:${String(payload.storagePetId ?? '')}`;
    case 'XPPotion':
    case 'ReplenishPotion':
      return `${type}:${String(payload.petItemId ?? '')}`;
    case 'LogItems':
      return type;
    case 'RequestPetGreet':
      return type;
    case 'RidePet':
      return `${type}:${String(payload.petItemId ?? '')}`;
    case 'DismountPet':
      return type;
    case 'UpgradePetHutch':
    case 'UpgradeSeedSilo':
    case 'UpgradeDecorShed':
      return type;
    case 'SetRiddenPet':
      return type;
    case 'HarvestCrop':
      return `${type}:${String(payload.slot ?? '')}:${String(payload.slotsIndex ?? '')}`;
    case 'RemoveGardenObject':
      return `${type}:${String(payload.slot ?? '')}:${String(payload.slotType ?? '')}`;
    case 'CropCleanser':
    case 'MutationPotion':
      return `${type}:${String(payload.tileObjectIdx ?? '')}:${String(payload.growSlotIdx ?? '')}`;
    case 'SavePetTeam': {
      const p = payload as { teamId?: unknown; name?: unknown; petIds?: unknown };
      if (typeof p.teamId === 'string') return `${type}:${p.teamId}`;
      const ids = Array.isArray(p.petIds) ? p.petIds.join(',') : '';
      return `${type}:new:${String(p.name ?? '')}:${ids}`;
    }
    case 'DeletePetTeam':
    case 'ApplyPetTeam':
      return `${type}:${String(payload.teamId ?? '')}`;
    case 'MovePetTeam':
      return `${type}:${String((payload as { movePetTeamId?: unknown }).movePetTeamId ?? '')}`;
    case 'SetPetTeamEmblem':
      return `${type}:${String(payload.teamId ?? '')}`;
    default:
      return type;
  }
}

export type ActionSentListener = (type: RoomActionType, payload: Record<string, unknown>) => void;
const actionSentListeners = new Set<ActionSentListener>();

/** Register a callback that fires after every successful WS send. Returns unsubscribe. */
export function onActionSent(listener: ActionSentListener): () => void {
  actionSentListeners.add(listener);
  return () => { actionSentListeners.delete(listener); };
}

export function startWebsocketDiagnostics(): void {
  startWebsocketHealth(hasRoomConnection);
}

export function stopWebsocketDiagnostics(): void {
  stopWebsocketHealth();
}

function shouldEnvelope(connection: RoomConnection, type: string): boolean {
  if (!isEnvelopeEnabled()) return false;
  // Mirror whatever transport the game was observed using for this type;
  // the allowlist only covers types the game hasn't sent yet this session.
  if (resolveTransport(type).transport !== 'envelope') return false;
  return typeof connection.trySendMessageNow === 'function'
    // Without the sequencer the placeholder commandSequence would be
    // silently dropped by the server — legacy flat is the safe fallback.
    && isCommandSequencerActive(connection);
}

/**
 * Put one already-validated, already-throttled action on the wire. Shared by
 * sendRoomAction and the QPM FULL PRIVATE overlay's replacement body, so the
 * envelope-vs-legacy decision lives in exactly one place. Throws only if the
 * native send throws.
 */
export function transmitRoomAction(
  connection: RoomConnection,
  type: string,
  payload: Record<string, unknown>,
): WebSocketSendResult {
  const scopePath = getScopePath();
  if (shouldEnvelope(connection, type)) {
    const envelope = buildEnvelope(scopePath, type, payload, newRequestId());
    const resultPromise = trackCommandRequest(envelope);
    // Most callers never await the result; a timeout must not surface as an
    // unhandled rejection.
    resultPromise.catch(() => { /* observed via awaitResult() */ });
    const sent = withQpmOrigin(() => connection.trySendMessageNow!(envelope));
    if (!sent) {
      cancelCommandRequest(envelope.requestId);
      return { ok: false, reason: 'no_connection' };
    }
    wsCounters.enveloped++;
    return {
      ok: true,
      transport: 'envelope',
      requestId: envelope.requestId,
      awaitResult: () => resultPromise,
    };
  }
  withQpmOrigin(() => connection.sendMessage({ scopePath, type, ...payload }));
  return { ok: true, transport: 'legacy' };
}

export function sendRoomAction(
  type: RoomActionType,
  payload: Record<string, unknown>,
  options?: { throttleMs?: number; skipThrottle?: boolean },
): WebSocketSendResult {
  // The game has no ToggleFavoriteItem command (absent from every bundle and
  // beta source; ToggleLockItem is the real one). Kept as an accepted input
  // for callers; remapped here so an envelope never carries an unknown type.
  const actionType: RoomActionType = type === 'ToggleFavoriteItem' ? 'ToggleLockItem' : type;

  if (!validatePayload(actionType, payload)) {
    wsCounters.invalidPayloads++;
    log.warn('QPM-WS-004', { type: actionType });
    return { ok: false, reason: 'invalid_payload' };
  }

  if (sendPreflightFn) {
    const check = sendPreflightFn(actionType, payload);
    if (!check.ok) {
      wsCounters.lockerBlocks++;
      return { ok: false, reason: 'locker_blocked' };
    }
  }

  const connection = getRoomConnection();
  if (!connection) {
    wsCounters.noConnections++;
    log.warn('QPM-WS-001', { type: actionType });
    return { ok: false, reason: 'no_connection' };
  }

  const throttleMs = Math.max(0, Math.floor(options?.throttleMs ?? DEFAULT_THROTTLE_MS));
  if (!options?.skipThrottle && throttleMs > 0) {
    const key = getThrottleKey(actionType, payload);
    const now = Date.now();
    const prev = lastSentAt.get(key) ?? 0;
    if (now - prev < throttleMs) {
      wsCounters.throttles++;
      return { ok: false, reason: 'throttled' };
    }
    lastSentAt.set(key, now);
  }

  // Global budget: the server allows ~300 commands per ~10 s window for the
  // whole socket (measured 2026-08-28) and rate-limits the USER's own actions
  // once it's gone. QPM keeps itself to a third of that.
  if (!takeSendToken()) {
    wsCounters.throttles++;
    log.warn('QPM-WS-010', { type: actionType });
    return { ok: false, reason: 'throttled' };
  }

  try {
    const result = transmitRoomAction(connection, actionType, payload);
    if (!result.ok) {
      wsCounters.noConnections++;
      log.warn('QPM-WS-001', { type: actionType, reason: result.reason });
      return result;
    }
    // Notify listeners after successful send
    for (const cb of actionSentListeners) {
      try { cb(actionType, payload); } catch { /* ignore listener errors */ }
    }
    wsCounters.sends++;
    maybePublishRecovery();
    return result;
  } catch (err) {
    wsCounters.failures++;
    log.error('QPM-WS-003', { type: actionType }, err);
    return { ok: false, reason: 'send_failed' };
  }
}
