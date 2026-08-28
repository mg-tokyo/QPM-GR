// src/websocket/playerData.ts
// SetPlayerData — cosmetic/name changes. scopePath is ['Room'] (NOT Quinoa)
// and it is not a QuinoaCommand, so it never goes through the envelope.
// Moved verbatim from api.ts (2026-08-28); api.ts re-exports it.

import { createNamedLogger } from '../diagnostics/logger';
import { getRoomConnection, type WebSocketSendResult } from './api';
import { wsCounters, maybePublishRecovery } from './health';
import { isNonEmptyString } from './validation';

const log = createNamedLogger('websocket');

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
    wsCounters.invalidPayloads++;
    log.warn('QPM-WS-005', { reason: 'empty_payload' });
    return { ok: false, reason: 'invalid_payload' };
  }

  if (payload.name != null) {
    const trimmed = payload.name.trim();
    if (trimmed.length === 0 || trimmed.length > PLAYER_NAME_MAX) {
      wsCounters.invalidPayloads++;
      log.warn('QPM-WS-005', { reason: 'invalid_name' });
      return { ok: false, reason: 'invalid_payload' };
    }
  }

  if (payload.cosmetic) {
    const { color, avatar } = payload.cosmetic;
    if (!color || typeof color !== 'string') {
      wsCounters.invalidPayloads++;
      return { ok: false, reason: 'invalid_payload' };
    }
    if (!Array.isArray(avatar) || avatar.length !== 4 || avatar.some(s => !isNonEmptyString(s))) {
      wsCounters.invalidPayloads++;
      return { ok: false, reason: 'invalid_payload' };
    }
  }

  const now = Date.now();
  if (now - lastSetPlayerDataAt < SET_PLAYER_DATA_COOLDOWN_MS) {
    wsCounters.throttles++;
    return { ok: false, reason: 'throttled' };
  }

  const connection = getRoomConnection();
  if (!connection) {
    wsCounters.noConnections++;
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
    wsCounters.sends++;
    maybePublishRecovery();
    return { ok: true, transport: 'legacy' };
  } catch (err) {
    wsCounters.failures++;
    log.error('QPM-WS-003', { type: 'SetPlayerData' }, err);
    return { ok: false, reason: 'send_failed' };
  }
}
