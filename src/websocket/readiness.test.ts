import { describe, expect, it } from 'vitest';
import { describeReadiness } from './readiness';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

function socket(readyState: number): WebSocket {
  return { readyState } as unknown as WebSocket;
}

describe('describeReadiness', () => {
  it('is nothing without a room', () => {
    expect(describeReadiness(null)).toEqual({ socketOpen: false, sessionReady: false });
  });

  it('socket OPEN before Welcome is open but not ready (game 1195 admission window)', () => {
    const room = { currentWebSocket: socket(OPEN), isCommandSessionReady: false };
    expect(describeReadiness(room)).toEqual({ socketOpen: true, sessionReady: false });
  });

  it('socket OPEN after Welcome is ready', () => {
    const room = { currentWebSocket: socket(OPEN), isCommandSessionReady: true };
    expect(describeReadiness(room)).toEqual({ socketOpen: true, sessionReady: true });
  });

  it('a welcomed flag never outranks a socket that is not OPEN', () => {
    expect(describeReadiness({ currentWebSocket: socket(CONNECTING), isCommandSessionReady: true }).sessionReady).toBe(false);
    expect(describeReadiness({ currentWebSocket: socket(CLOSED), isCommandSessionReady: true })).toEqual({ socketOpen: false, sessionReady: false });
    expect(describeReadiness({ currentWebSocket: null, isCommandSessionReady: true }).sessionReady).toBe(false);
  });

  it('a bundle that hides both the socket and the session flag is treated as ready', () => {
    expect(describeReadiness({})).toEqual({ socketOpen: true, sessionReady: true });
  });

  it('a bundle that hides the socket but exposes the flag still honours the flag', () => {
    expect(describeReadiness({ isCommandSessionReady: false })).toEqual({ socketOpen: true, sessionReady: false });
  });

  it('prefers currentWebSocket over the legacy ws/socket fields', () => {
    const room = { currentWebSocket: socket(OPEN), ws: socket(CLOSED), isCommandSessionReady: true };
    expect(describeReadiness(room).sessionReady).toBe(true);
  });
});
