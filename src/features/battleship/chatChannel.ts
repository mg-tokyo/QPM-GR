import { subscribe as subscribeState } from '../../core/stateTree';
import { sendChatMessage } from '../../websocket/chat';
import { getPlayerIdSync } from '../../core/playerContext';
import { createNamedLogger } from '../../diagnostics/logger';
import { encodeLine, parseLine } from './protocol';
import { CHAT_PREFIX } from './constants';
import type { GameMsg } from './types';

const log = createNamedLogger('battleship');

// Chat entry shape verified live in spike findings §2:
// { seq: number, timestamp: number, playerId: string, message: string }
interface ChatEntry {
  seq?: number;
  timestamp?: number;
  playerId?: string;
  message?: string;
}

export interface IncomingGameMsg {
  msg: GameMsg;
  fromPlayerId: string;
  seq: number;
}

export interface ChatChannelHandle {
  close(): void;
}

/**
 * Subscribe to chat, filter ⚓-prefixed lines to battleship messages, and
 * dispatch them. Own-echo lines (sent by us) are skipped so the handshake
 * loop doesn't re-enter itself. On first fire, the tail is primed so
 * pre-existing history isn't re-processed.
 */
export function openChatChannel(handlers: {
  onGameMsg(m: IncomingGameMsg): void;
}): ChatChannelHandle {
  let lastSeenSeq = -1;
  let primed = false;
  const myPlayerId = getPlayerIdSync();

  const stop = subscribeState(
    (s) => (s.data?.chat?.messages ?? []) as ChatEntry[],
    (messages) => {
      if (!messages) return;
      if (!primed) {
        for (const e of messages) {
          if (typeof e?.seq === 'number' && e.seq > lastSeenSeq) lastSeenSeq = e.seq;
        }
        primed = true;
        return;
      }
      for (const entry of messages) {
        if (typeof entry?.seq !== 'number' || entry.seq <= lastSeenSeq) continue;
        lastSeenSeq = entry.seq;
        const text = typeof entry.message === 'string' ? entry.message : '';
        if (!text.startsWith(`${CHAT_PREFIX} `)) continue;
        const fromPlayerId = typeof entry.playerId === 'string' ? entry.playerId : '';
        if (!fromPlayerId) continue;
        if (myPlayerId && fromPlayerId === myPlayerId) continue;
        const parsed = parseLine(text);
        if (!parsed) continue;
        try {
          handlers.onGameMsg({ msg: parsed, fromPlayerId, seq: entry.seq });
        } catch (err) {
          log.warn('QPM-BS-CHAT-002', { kind: parsed.kind }, err);
        }
      }
    },
    'battleship-chat',
  );

  return {
    close(): void {
      try {
        stop();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Encode + send a game message. Returns true if the send was accepted by the
 * chat layer (not that the opponent received it — chat is broadcast).
 */
export function sendGameMsg(msg: GameMsg, myName: string): boolean {
  const line = encodeLine(msg, myName);
  // All battleship msgs bypass the 500ms chat throttle. Gameplay is turn-based
  // and naturally low-frequency (walk + SPACE), so we won't spam the server;
  // meanwhile the throttle causes real desyncs — resign right after a shot,
  // verdict right after another verdict, etc. — where the throttle-dropped
  // msg leaves the opponent hanging with no way to know. Spike findings §3
  // confirmed n=2 rapid sends succeed with no server rate limit observed.
  const result = sendChatMessage(line, { skipThrottle: true });
  if (!result.ok) {
    log.warn('QPM-BS-CHAT-001', { kind: msg.kind, reason: result.reason });
    return false;
  }
  return true;
}
