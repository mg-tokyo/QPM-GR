import { getRoomConnection, type WebSocketSendResult } from './api';
import { createNamedLogger } from '../diagnostics/logger';

const log = createNamedLogger('websocket');

// Verified live 2026-08-04 (battleship spike findings §1/§3):
// scopePath ['Room'] (NOT Quinoa), field name `message`, server truncates at 100 chars.
const CHAT_SCOPE_PATH = ['Room'] as const;
const CHAT_MAX_LEN = 100;
const CHAT_COOLDOWN_MS = 500;

let lastChatAt = 0;

export function sendChatMessage(message: string, opts?: { skipThrottle?: boolean }): WebSocketSendResult {
  const text = message.trim();
  if (text.length === 0 || text.length > CHAT_MAX_LEN) {
    log.warn('QPM-WS-004', { type: 'Chat', len: text.length });
    return { ok: false, reason: 'invalid_payload' };
  }
  const now = Date.now();
  if (!opts?.skipThrottle && now - lastChatAt < CHAT_COOLDOWN_MS) {
    return { ok: false, reason: 'throttled' };
  }
  const connection = getRoomConnection();
  if (!connection) {
    log.warn('QPM-WS-001', { type: 'Chat' });
    return { ok: false, reason: 'no_connection' };
  }
  try {
    connection.sendMessage({ scopePath: [...CHAT_SCOPE_PATH], type: 'Chat', message: text });
    lastChatAt = now;
    return { ok: true };
  } catch (err) {
    log.error('QPM-WS-003', { type: 'Chat' }, err);
    return { ok: false, reason: 'send_failed' };
  }
}
