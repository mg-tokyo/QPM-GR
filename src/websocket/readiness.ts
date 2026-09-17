// Ready-to-send is the game's rule, not "socket OPEN". Since game 1195 the
// room connection's open handler sends `{type:'SocketOpened'}` on the RAW
// socket (bypassing sendMessage/trySendMessageNow/sendOpenMessage, so no QPM
// wrapper ever sees it) and `isConnected()` is `socket OPEN &&
// isCommandSessionReady`; the server closes an admitted socket that stays
// silent for 10 s, and the client abandons a socket with no Welcome in 15 s.

import { getSocket, type SocketHost } from './sequencerSocket';

const SOCKET_OPEN = 1; // WebSocket.OPEN

export interface ReadinessHost extends SocketHost {
  /** False from socket creation until the server's Welcome (pre-1195 bundles: same field). */
  isCommandSessionReady?: boolean;
}

export interface Readiness {
  /** Transport-level: the socket field is OPEN (true when the bundle hides the field). */
  socketOpen: boolean;
  /** Game-level: socket open AND the command session has been welcomed. Gate sends on this. */
  sessionReady: boolean;
}

const SOCKET_FIELDS = ['currentWebSocket', 'ws', 'socket'] as const;

// A bundle that exposes no socket field at all is unknowable → assume open
// (legacy behaviour). A field that exists but holds null is the game saying
// "no socket" (1195 `disconnect()` nulls currentWebSocket) → not open.
function socketFieldExposed(room: ReadinessHost): boolean {
  return SOCKET_FIELDS.some((k) => k in room);
}

export function describeReadiness(room: ReadinessHost | null): Readiness {
  if (!room) return { socketOpen: false, sessionReady: false };
  const socket = getSocket(room);
  const socketOpen = socket ? socket.readyState === SOCKET_OPEN : !socketFieldExposed(room);
  return { socketOpen, sessionReady: socketOpen && room.isCommandSessionReady !== false };
}
