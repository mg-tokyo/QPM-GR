// src/debug/wsMonitor.ts
// WebSocket traffic monitor for the debug API.
// No side effects on import — call createWsMonitor() to get an instance.

import { pageWindow } from '../core/pageContext';
import { onActionSent } from '../websocket/api';
import type { RoomActionType } from '../websocket/api';
import { isQuinoaCommandResult } from '../websocket/envelope';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoomConnection {
  ws?: WebSocket | null;
  socket?: WebSocket | null;
  currentWebSocket?: WebSocket | null;
}

interface PageWithRoomConnection extends Window {
  MagicCircle_RoomConnection?: RoomConnection;
}

interface MessageStats {
  recv: Record<string, number>;
  send: Record<string, number>;
  totalRecv: number;
  totalSend: number;
  filteredRecv: number;
  filteredSend: number;
  startedAt: number;
}

export interface WsMonitor {
  start: () => void;
  stop: () => void;
  filter: (...types: string[]) => void;
  unfilter: (...types: string[]) => void;
  showFiltered: () => string[];
  stats: () => MessageStats;
  status: boolean;
}

// ---------------------------------------------------------------------------
// Console styling
// ---------------------------------------------------------------------------

const STYLE_RECV = 'color:#58d68d;font-weight:bold';
const STYLE_SEND = 'color:#5dade2;font-weight:bold';
const STYLE_TIME = 'color:#aaa;font-weight:normal';

function timestamp(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Default filters — noisy message types excluded by default
// ---------------------------------------------------------------------------

const DEFAULT_FILTERED: ReadonlyArray<string> = [
  // Incoming
  'ping',          // raw heartbeat string
  'Pong',          // heartbeat response
  'PartialState',  // JSON patches — extremely frequent
  // Outgoing
  'PlayerPosition', // movement spam
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWsMonitor(): WsMonitor {
  const filtered = new Set<string>(DEFAULT_FILTERED);
  let active = false;
  let boundSocket: WebSocket | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let unsubAction: (() => void) | null = null;

  const stats: MessageStats = {
    recv: {},
    send: {},
    totalRecv: 0,
    totalSend: 0,
    filteredRecv: 0,
    filteredSend: 0,
    startedAt: 0,
  };

  // ---- socket helpers ----

  function getSocket(): WebSocket | null {
    const conn = (pageWindow as PageWithRoomConnection).MagicCircle_RoomConnection;
    if (!conn) return null;
    return conn.ws ?? conn.socket ?? conn.currentWebSocket ?? null;
  }

  // ---- incoming message handler ----

  function onMessage(event: MessageEvent): void {
    const raw = event.data;

    // Raw "ping" string — heartbeat
    if (raw === 'ping') {
      stats.totalRecv++;
      stats.recv['ping'] = (stats.recv['ping'] ?? 0) + 1;
      if (filtered.has('ping')) {
        stats.filteredRecv++;
        return;
      }
      console.groupCollapsed('%c⬇ RECV  %cping%c  ' + timestamp(), STYLE_RECV, STYLE_RECV, STYLE_TIME);
      console.log('(heartbeat)');
      console.groupEnd();
      return;
    }

    // Try to parse as JSON
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
    } catch {
      // Not JSON — log as raw
      stats.totalRecv++;
      stats.recv['<raw>'] = (stats.recv['<raw>'] ?? 0) + 1;
      if (!filtered.has('<raw>')) {
        console.groupCollapsed('%c⬇ RECV  %c<raw>%c  ' + timestamp(), STYLE_RECV, STYLE_RECV, STYLE_TIME);
        console.log(raw);
        console.groupEnd();
      } else {
        stats.filteredRecv++;
      }
      return;
    }

    if (!parsed) return;

    const msgType = typeof parsed.type === 'string' ? parsed.type : '<unknown>';
    stats.totalRecv++;
    stats.recv[msgType] = (stats.recv[msgType] ?? 0) + 1;

    if (filtered.has(msgType)) {
      stats.filteredRecv++;
      return;
    }

    const label = isQuinoaCommandResult(parsed)
      ? `${msgType} ${parsed.commandType ?? '?'} ${parsed.ok ? 'ok' : `REJECTED:${parsed.code ?? '?'}`}`
      : msgType;
    console.groupCollapsed('%c⬇ RECV  %c' + label + '%c  ' + timestamp(), STYLE_RECV, STYLE_RECV, STYLE_TIME);
    console.log(parsed);
    console.groupEnd();
  }

  // ---- outgoing message handler (via onActionSent) ----

  function onSend(type: RoomActionType, payload: Record<string, unknown>): void {
    const msgType = type as string;
    stats.totalSend++;
    stats.send[msgType] = (stats.send[msgType] ?? 0) + 1;

    if (filtered.has(msgType)) {
      stats.filteredSend++;
      return;
    }

    console.groupCollapsed('%c⬆ SEND  %c' + msgType + '%c  ' + timestamp(), STYLE_SEND, STYLE_SEND, STYLE_TIME);
    console.log(payload);
    console.groupEnd();
  }

  // ---- socket binding ----

  function bindSocket(ws: WebSocket): void {
    if (boundSocket === ws) return;
    unbindSocket();
    boundSocket = ws;
    ws.addEventListener('message', onMessage);
  }

  function unbindSocket(): void {
    if (boundSocket) {
      try {
        boundSocket.removeEventListener('message', onMessage);
      } catch { /* socket may already be closed */ }
      boundSocket = null;
    }
  }

  function pollForSocket(): void {
    const ws = getSocket();
    if (ws && ws !== boundSocket) {
      bindSocket(ws);
    }
  }

  // ---- reset stats ----

  function resetStats(): void {
    stats.recv = {};
    stats.send = {};
    stats.totalRecv = 0;
    stats.totalSend = 0;
    stats.filteredRecv = 0;
    stats.filteredSend = 0;
    stats.startedAt = Date.now();
  }

  // ---- public API ----

  const monitor: WsMonitor = {
    get status() {
      return active;
    },

    start() {
      if (active) {
        console.log('[WS Monitor] Already running.');
        return;
      }
      active = true;
      resetStats();

      // Subscribe to outgoing sends
      unsubAction = onActionSent(onSend);

      // Bind current socket and poll for changes
      pollForSocket();
      pollTimer = setInterval(pollForSocket, 2000);

      console.log(
        '%c[WS Monitor] Started%c — filtering: ' + [...filtered].join(', '),
        'color:#58d68d;font-weight:bold',
        'color:#aaa',
      );
    },

    stop() {
      if (!active) {
        console.log('[WS Monitor] Not running.');
        return;
      }
      active = false;

      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      unbindSocket();
      if (unsubAction) {
        unsubAction();
        unsubAction = null;
      }

      console.log('%c[WS Monitor] Stopped', 'color:#e74c3c;font-weight:bold');
    },

    filter(...types: string[]) {
      for (const t of types) filtered.add(t);
      console.log('[WS Monitor] Filtered types:', [...filtered]);
    },

    unfilter(...types: string[]) {
      for (const t of types) filtered.delete(t);
      console.log('[WS Monitor] Filtered types:', [...filtered]);
    },

    showFiltered() {
      const list = [...filtered];
      console.log('[WS Monitor] Filtered types:', list);
      return list;
    },

    stats() {
      const snapshot = { ...stats, recv: { ...stats.recv }, send: { ...stats.send } };
      const elapsed = active ? ((Date.now() - stats.startedAt) / 1000).toFixed(1) : '0';
      console.log(`[WS Monitor] Stats (${elapsed}s):`);
      console.log(`  Received: ${stats.totalRecv} total, ${stats.filteredRecv} filtered`);
      console.log(`  Sent: ${stats.totalSend} total, ${stats.filteredSend} filtered`);
      if (Object.keys(stats.recv).length > 0) {
        console.log('  Recv breakdown:');
        console.table(stats.recv);
      }
      if (Object.keys(stats.send).length > 0) {
        console.log('  Send breakdown:');
        console.table(stats.send);
      }
      return snapshot;
    },
  };

  return monitor;
}
