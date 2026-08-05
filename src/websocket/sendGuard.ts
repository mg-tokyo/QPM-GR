import { getRoomConnection, type RoomConnection } from './api';
import { createNamedLogger } from '../diagnostics/logger';

const log = createNamedLogger('websocket');

// Wraps MagicCircle_RoomConnection.sendMessage to drop selected outgoing types
// (pattern verified live 2026-08-04, battleship spike findings §7). Intercepts
// BOTH the game's native sends and QPM's own sendRoomAction — keep the blocked
// set narrow.

export type BlockedSendPayload = Record<string, unknown>;

let guarded: {
  connection: RoomConnection;
  original: RoomConnection['sendMessage'];
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
  guarded = { connection, original, blockedCount: 0 };
  connection.sendMessage = (payload: unknown) => {
    const type = (payload as { type?: unknown } | null)?.type;
    if (typeof type === 'string' && blockedTypes.has(type)) {
      const g = guarded;
      if (g) g.blockedCount++;
      log.info('QPM-WS-GUARD', { blocked: type });
      try {
        onBlocked(type, (payload ?? {}) as BlockedSendPayload);
      } catch {
        /* listener errors never break the guard */
      }
      return;
    }
    return original(payload);
  };
  return true;
}

export function getSendGuardStats(): { active: boolean; blockedCount: number } | null {
  if (!guarded) return { active: false, blockedCount: 0 };
  return { active: getRoomConnection() === guarded.connection, blockedCount: guarded.blockedCount };
}

export function removeSendGuard(): void {
  if (!guarded) return;
  guarded.connection.sendMessage = guarded.original;
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
