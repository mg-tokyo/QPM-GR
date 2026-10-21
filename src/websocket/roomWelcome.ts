import { isRecord } from '../utils/typeGuards';
import { toUnsub } from './sequencerSocket';

export interface WelcomeArgs {
  state: unknown;
  publishedAtServerMs: unknown;
  executedCommandSequence: unknown;
}

export interface WelcomeHost {
  subscribeToWelcome?: (cb: (state: unknown, publishedAtServerMs?: number, executedCommandSequence?: number) => void) => unknown;
  // Game 1686+: the Welcome handler calls it with { isConnected: true } after
  // setRoomState, admitted sockets only; failed attempts send isConnected: false.
  addReconnectionListener?: (cb: (event: unknown) => void) => unknown;
  isConnected?: () => boolean;
}

/**
 * Runs `cb` on every Welcome (connect + reconnect), and once immediately when
 * the session is already admitted. `args` is null on 1686+, where the Welcome
 * publication lives in roomPublicationAtom. Returns null when the build has
 * neither hook.
 */
export function subscribeRoomWelcome(room: WelcomeHost, cb: (args: WelcomeArgs | null) => void): (() => void) | null {
  if (typeof room.subscribeToWelcome === 'function') {
    return toUnsub(room.subscribeToWelcome((state, publishedAtServerMs, executedCommandSequence) => {
      cb({ state, publishedAtServerMs, executedCommandSequence });
    }));
  }
  if (typeof room.addReconnectionListener !== 'function') return null;
  const unsub = toUnsub(room.addReconnectionListener((event) => {
    if (isRecord(event) && event.isConnected === true) cb(null);
  }));
  if (room.isConnected?.() === true) cb(null);
  return unsub;
}
