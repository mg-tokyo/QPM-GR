import { getRoomConnection, type RoomConnection } from './api';
import { createNamedLogger } from '../diagnostics/logger';
import { effectiveMessageType } from './envelope';

const log = createNamedLogger('websocket');

// Wraps MagicCircle_RoomConnection.sendMessage + trySendMessageNow to drop
// selected outgoing types (pattern verified live 2026-08-04, battleship spike
// findings §7). Matches the UNWRAPPED type: on v1040 the garden commands this
// blocks (HarvestCrop, PlantSeed, …) travel as QuinoaCommand envelopes via
// trySendMessageNow. Intercepts BOTH the game's native sends and QPM's own
// sendRoomAction — keep the blocked set narrow.

export type BlockedSendPayload = Record<string, unknown>;

let guarded: {
  connection: RoomConnection;
  original: RoomConnection['sendMessage'];
  originalTry: ((payload: unknown) => boolean) | null;
  blockedCount: number;
} | null = null;

export function installSendGuard(
  blockedTypes: ReadonlySet<string>,
  onBlocked: (type: string, payload: BlockedSendPayload) => void,
): boolean {
  if (guarded) return true;
  const connection = getRoomConnection();
  if (!connection || typeof connection.sendMessage !== 'function') return false;
  const original = connection.sendMessage.bind(connection);
  const rawTry = connection.trySendMessageNow;
  const originalTry = typeof rawTry === 'function' ? rawTry.bind(connection) : null;
  guarded = { connection, original, originalTry, blockedCount: 0 };

  const block = (type: string, payload: unknown): void => {
    const g = guarded;
    if (g) g.blockedCount++;
    log.info('QPM-WS-GUARD', { blocked: type });
    try {
      onBlocked(type, (payload ?? {}) as BlockedSendPayload);
    } catch {
      /* listener errors never break the guard */
    }
  };

  connection.sendMessage = (payload: unknown) => {
    const type = effectiveMessageType(payload);
    if (type !== null && blockedTypes.has(type)) {
      block(type, payload);
      return;
    }
    return original(payload);
  };
  if (originalTry) {
    // false mirrors "connection closed" — the game's RPC caller rejects its
    // pending command and swallows the rejection.
    connection.trySendMessageNow = (payload: unknown): boolean => {
      const type = effectiveMessageType(payload);
      if (type !== null && blockedTypes.has(type)) {
        block(type, payload);
        return false;
      }
      return originalTry(payload);
    };
  }
  return true;
}

export function getSendGuardStats(): { active: boolean; blockedCount: number } | null {
  if (!guarded) return { active: false, blockedCount: 0 };
  return { active: getRoomConnection() === guarded.connection, blockedCount: guarded.blockedCount };
}

export function removeSendGuard(): void {
  if (!guarded) return;
  guarded.connection.sendMessage = guarded.original;
  if (guarded.originalTry) guarded.connection.trySendMessageNow = guarded.originalTry;
  guarded = null;
}

/**
 * True while the wrap is installed on the SAME connection object that is
 * currently live. After a reconnect the game may replace the connection —
 * callers should re-install when this returns false mid-match.
 */
export function isSendGuardActive(): boolean {
  if (!guarded) return false;
  return getRoomConnection() === guarded.connection;
}
