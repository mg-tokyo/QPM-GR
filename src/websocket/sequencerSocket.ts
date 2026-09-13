// Raw-socket plumbing for the command sequencer: find the live WebSocket on a
// room connection, listen for QuinoaCommandResult frames on it, and normalise
// the game's subscribe* return values into unsubscribe functions. Split out of
// commandSequencer.ts so that file keeps only counter and result logic (the
// standing split-the-sequencer note on the command-session tracker).

import {
  QUINOA_COMMAND_RESULT_TYPE,
  isQuinoaCommandResult,
  type QuinoaCommandResultMessage,
} from './envelope';

export interface SocketHost {
  ws?: WebSocket | null;
  socket?: WebSocket | null;
  currentWebSocket?: WebSocket | null;
}

// `currentWebSocket` first: it is the only field the game's RoomConnection
// declares (scraped-data/BetaGameSourceFiles/3651-amber+rainshop/…/
// src/connection/RoomConnection.ts:150); `ws`/`socket` are legacy guesses.
// Shared with api.ts so the result listener and the send facade agree.
export function getSocket(room: SocketHost | null): WebSocket | null {
  if (!room) return null;
  return room.currentWebSocket ?? room.ws ?? room.socket ?? null;
}

/** Normalise a `subscribeTo*` return value (function or `{ unsubscribe }`) into an unsubscribe. */
export function toUnsub(result: unknown): (() => void) | null {
  if (typeof result === 'function') return result as () => void;
  if (result && typeof result === 'object' && typeof (result as { unsubscribe?: unknown }).unsubscribe === 'function') {
    return (result as { unsubscribe: () => void }).unsubscribe;
  }
  return null;
}

export interface ResultBinder {
  /** Idempotent: re-binding the same socket is a no-op; a swapped socket rebinds. */
  bind: (room: SocketHost | null) => void;
  unbind: () => void;
}

export function createResultBinder(onResult: (res: QuinoaCommandResultMessage) => void): ResultBinder {
  let bound: WebSocket | null = null;

  const listener = (event: MessageEvent): void => {
    const raw = event.data;
    if (typeof raw !== 'string' || raw.indexOf(QUINOA_COMMAND_RESULT_TYPE) === -1) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (isQuinoaCommandResult(parsed)) onResult(parsed);
  };

  const unbind = (): void => {
    if (!bound) return;
    try { bound.removeEventListener('message', listener); } catch { /* closed */ }
    bound = null;
  };

  return {
    bind(room: SocketHost | null): void {
      const ws = getSocket(room);
      if (ws === bound) return;
      unbind();
      if (!ws) return;
      ws.addEventListener('message', listener);
      bound = ws;
    },
    unbind,
  };
}
