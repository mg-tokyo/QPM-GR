// src/websocket/api.ts
// Centralized send facade for room WebSocket actions.

import { healthBus } from '../diagnostics/healthBus';
import { createNamedLogger } from '../diagnostics/logger';
import type { Subsystem, SubsystemHealth } from '../diagnostics/types';
import { pageWindow } from '../core/pageContext';
import { visibleInterval } from '../utils/scheduling/timerManager';

const log = createNamedLogger('websocket');
const WS_SUBSYSTEM: Subsystem = 'websocket';

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
}

/**
 * Room-state patch as delivered by `MagicCircle_RoomConnection.subscribeToPatches`.
 * Shape is game-internal; we only care that fullState fires after each patch.
 */
export type RoomPatchListener = (patches: unknown, fullState: unknown) => void;

export interface RoomConnection {
  sendMessage: (payload: unknown) => void;
  ws?: WebSocket | null;
  socket?: WebSocket | null;
  currentWebSocket?: WebSocket | null;
  /**
   * Fires `cb(patches, fullState)` on every room state update. Returns an
   * unsubscribe function when available. Preferred atom-free source for the
   * state tree — see src/core/stateTree.ts. Only present on newer bundles.
   */
  subscribeToPatches?: (cb: RoomPatchListener) => (() => void) | void;
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

type PlacePetPayload = {
  itemId: string;
  position: { x: number; y: number };
  tileType: string;
  localTileIndex: number;
};

type PlayerPositionPayload = {
  position: { x: number; y: number };
};

type RetrievePayload = { itemId: string; storageId: string; toInventoryIndex?: number; quantity?: number };
type PutInStoragePayload = { itemId: string; storageId: string; toStorageIndex?: number; quantity?: number };
type PickupPetPayload = { petId: string };
type SwapPayload = { petSlotId: string; petInventoryId: string };
/** V16 unified shop purchase payload. itemType values: 'Seed'|'Egg'|'Tool'|'Decor'. */
type PurchaseShopItemPayload = {
  shop: string;
  item: { itemType: string } & Record<string, unknown>;
};

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
    case 'SetRiddenPet':
      return type;
    case 'HarvestCrop':
      return `${type}:${String(payload.slot ?? '')}:${String(payload.slotsIndex ?? '')}`;
    case 'RemoveGardenObject':
      return `${type}:${String(payload.slot ?? '')}:${String(payload.slotType ?? '')}`;
    case 'CropCleanser':
    case 'MutationPotion':
      return `${type}:${String(payload.tileObjectIdx ?? '')}:${String(payload.growSlotIdx ?? '')}`;
    default:
      return type;
  }
}

// ---------------------------------------------------------------------------
// Action-sent listeners — fire after a successful sendMessage()
// ---------------------------------------------------------------------------

export type ActionSentListener = (type: RoomActionType, payload: Record<string, unknown>) => void;
const actionSentListeners = new Set<ActionSentListener>();

/** Register a callback that fires after every successful WS send. Returns unsubscribe. */
export function onActionSent(listener: ActionSentListener): () => void {
  actionSentListeners.add(listener);
  return () => { actionSentListeners.delete(listener); };
}

// ---------------------------------------------------------------------------
// Diagnostics — health bus registration + counters (Phase 2 §13)
// ---------------------------------------------------------------------------

const counters = {
  sends: 0,
  throttles: 0,
  failures: 0,
  invalidPayloads: 0,
  lockerBlocks: 0,
  noConnections: 0,
};

let diagnosticsStarted = false;
let connectionPollStop: (() => void) | null = null;
let metricsTickStop: (() => void) | null = null;
let connectionEverSeen = false;

function snapshotMetrics(): Readonly<Record<string, number>> {
  return {
    sends: counters.sends,
    throttles: counters.throttles,
    failures: counters.failures,
    invalidPayloads: counters.invalidPayloads,
    lockerBlocks: counters.lockerBlocks,
    noConnections: counters.noConnections,
  };
}

function serializeCounters(): string {
  return `${counters.sends}|${counters.throttles}|${counters.failures}|${counters.invalidPayloads}|${counters.lockerBlocks}|${counters.noConnections}`;
}

function publishWsHealth(
  status?: SubsystemHealth['status'],
  message?: string,
): void {
  if (!diagnosticsStarted) return;
  healthBus.publish({
    subsystem: WS_SUBSYSTEM,
    category: 'core',
    ...(status === undefined ? {} : { status }),
    ...(message === undefined ? {} : { message }),
    metrics: snapshotMetrics(),
  });
}

function maybePublishRecovery(): void {
  if (!diagnosticsStarted) return;
  const current = healthBus.read(WS_SUBSYSTEM);
  if (!current) return;
  if (current.status === 'degraded' || current.status === 'failed') {
    publishWsHealth('recovering', 'Send succeeded — recovering');
  }
}

/**
 * Wire the websocket subsystem into the diagnostics health bus. Idempotent.
 * Must run after initDiagnostics() so the bus exists.
 */
export function startWebsocketDiagnostics(): void {
  if (diagnosticsStarted) return;
  diagnosticsStarted = true;

  healthBus.register(WS_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Waiting for room connection',
  });

  if (hasRoomConnection()) {
    connectionEverSeen = true;
    publishWsHealth('ok', 'Connected');
  } else {
    connectionPollStop = visibleInterval('qpm-ws-diag-connect', () => {
      if (!hasRoomConnection()) return;
      connectionEverSeen = true;
      publishWsHealth('ok', 'Connected');
      if (connectionPollStop) {
        connectionPollStop();
        connectionPollStop = null;
      }
    }, 1500);
  }

  // Slow metrics tick — only publish when counters actually change, so the
  // bus diff stays cheap (§6.4 budget).
  let lastSnapshot = serializeCounters();
  metricsTickStop = visibleInterval('qpm-ws-diag-metrics', () => {
    const snap = serializeCounters();
    if (snap === lastSnapshot) return;
    lastSnapshot = snap;
    publishWsHealth(undefined, connectionEverSeen ? 'Connected' : undefined);
  }, 60_000);
}

export function stopWebsocketDiagnostics(): void {
  if (!diagnosticsStarted) return;
  if (connectionPollStop) {
    connectionPollStop();
    connectionPollStop = null;
  }
  if (metricsTickStop) {
    metricsTickStop();
    metricsTickStop = null;
  }
  diagnosticsStarted = false;
}

export function sendRoomAction(
  type: RoomActionType,
  payload: Record<string, unknown>,
  options?: { throttleMs?: number; skipThrottle?: boolean },
): WebSocketSendResult {
  if (!validatePayload(type, payload)) {
    counters.invalidPayloads++;
    log.warn('QPM-WS-004', { type });
    return { ok: false, reason: 'invalid_payload' };
  }

  if (sendPreflightFn) {
    const check = sendPreflightFn(type, payload);
    if (!check.ok) {
      counters.lockerBlocks++;
      return { ok: false, reason: 'locker_blocked' };
    }
  }

  const connection = getRoomConnection();
  if (!connection) {
    counters.noConnections++;
    log.warn('QPM-WS-001', { type });
    return { ok: false, reason: 'no_connection' };
  }

  const throttleMs = Math.max(0, Math.floor(options?.throttleMs ?? DEFAULT_THROTTLE_MS));
  if (!options?.skipThrottle && throttleMs > 0) {
    const key = getThrottleKey(type, payload);
    const now = Date.now();
    const prev = lastSentAt.get(key) ?? 0;
    if (now - prev < throttleMs) {
      counters.throttles++;
      return { ok: false, reason: 'throttled' };
    }
    lastSentAt.set(key, now);
  }

  try {
    connection.sendMessage({
      scopePath: getScopePath(),
      type,
      ...payload,
    });
    // Notify listeners after successful send
    for (const cb of actionSentListeners) {
      try { cb(type, payload); } catch { /* ignore listener errors */ }
    }
    counters.sends++;
    maybePublishRecovery();
    return { ok: true };
  } catch (err) {
    counters.failures++;
    log.error('QPM-WS-003', { type }, err);
    return { ok: false, reason: 'send_failed' };
  }
}

// ---------------------------------------------------------------------------
// SetPlayerData — cosmetic/name changes (scopePath: ['Room'], not Quinoa)
// ---------------------------------------------------------------------------

export type CosmeticColor =
  | 'Red' | 'Orange' | 'Yellow' | 'Green'
  | 'Blue' | 'Purple' | 'White' | 'Black';

export interface SetPlayerDataPayload {
  name?: string;
  cosmetic?: {
    color: CosmeticColor;
    avatar: [string, string, string, string];
  };
}

const PLAYER_NAME_MAX = 32;
const SET_PLAYER_DATA_COOLDOWN_MS = 2000;
let lastSetPlayerDataAt = 0;

export function sendSetPlayerData(payload: SetPlayerDataPayload): WebSocketSendResult {
  if (!payload.name && !payload.cosmetic) {
    counters.invalidPayloads++;
    log.warn('QPM-WS-005', { reason: 'empty_payload' });
    return { ok: false, reason: 'invalid_payload' };
  }

  if (payload.name != null) {
    const trimmed = payload.name.trim();
    if (trimmed.length === 0 || trimmed.length > PLAYER_NAME_MAX) {
      counters.invalidPayloads++;
      log.warn('QPM-WS-005', { reason: 'invalid_name' });
      return { ok: false, reason: 'invalid_payload' };
    }
  }

  if (payload.cosmetic) {
    const { color, avatar } = payload.cosmetic;
    if (!color || typeof color !== 'string') {
      counters.invalidPayloads++;
      return { ok: false, reason: 'invalid_payload' };
    }
    if (!Array.isArray(avatar) || avatar.length !== 4 || avatar.some(s => !isNonEmptyString(s))) {
      counters.invalidPayloads++;
      return { ok: false, reason: 'invalid_payload' };
    }
  }

  const now = Date.now();
  if (now - lastSetPlayerDataAt < SET_PLAYER_DATA_COOLDOWN_MS) {
    counters.throttles++;
    return { ok: false, reason: 'throttled' };
  }

  const connection = getRoomConnection();
  if (!connection) {
    counters.noConnections++;
    log.warn('QPM-WS-001', { type: 'SetPlayerData' });
    return { ok: false, reason: 'no_connection' };
  }

  try {
    const message: Record<string, unknown> = {
      scopePath: ['Room'],
      type: 'SetPlayerData',
    };
    if (payload.name != null) message.name = payload.name.trim();
    if (payload.cosmetic) message.cosmetic = payload.cosmetic;

    connection.sendMessage(message);
    lastSetPlayerDataAt = now;
    counters.sends++;
    maybePublishRecovery();
    return { ok: true };
  } catch (err) {
    counters.failures++;
    log.error('QPM-WS-003', { type: 'SetPlayerData' }, err);
    return { ok: false, reason: 'send_failed' };
  }
}
