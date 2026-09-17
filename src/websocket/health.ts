// src/websocket/health.ts
// Health-bus wiring + send counters for the websocket subsystem (Phase 2 §13).
// Extracted from api.ts (2026-08-28); api.ts re-exports start/stop so existing
// import sites are unchanged.

import { healthBus } from '../diagnostics/healthBus';
import type { Subsystem, SubsystemHealth } from '../diagnostics/types';
import { visibleInterval } from '../utils/scheduling/timerManager';
import { onRoomConnectionChange, type RoomLike } from './roomConnectionEvents';
import { toUnsub } from './sequencerSocket';

const WS_SUBSYSTEM: Subsystem = 'websocket';

export const wsCounters = {
  sends: 0,
  throttles: 0,
  failures: 0,
  invalidPayloads: 0,
  lockerBlocks: 0,
  noConnections: 0,
  sessionNotReady: 0,
  enveloped: 0,
};

interface WelcomeHost extends RoomLike {
  subscribeToWelcome?: (cb: () => void) => unknown;
}

let diagnosticsStarted = false;
let connectionPollStop: (() => void) | null = null;
let metricsTickStop: (() => void) | null = null;
let stopChainEvents: (() => void) | null = null;
let unsubWelcome: (() => void) | null = null;
let welcomeRoom: object | null = null;
let connectionEverSeen = false;
let hasConnectionFn: (() => boolean) | null = null;
let isSessionReadyFn: (() => boolean) | null = null;

function snapshotMetrics(): Readonly<Record<string, number>> {
  return { ...wsCounters };
}

function serializeCounters(): string {
  return Object.values(wsCounters).join('|');
}

function publishWsHealth(
  status?: SubsystemHealth['status'],
  message?: string,
): void {
  if (!diagnosticsStarted) return;
  healthBus.publish({
    subsystem: WS_SUBSYSTEM,
    category: 'core',
    ...(status === undefined ? {} : { status }),
    ...(message === undefined ? {} : { message }),
    metrics: snapshotMetrics(),
  });
}

export function maybePublishRecovery(): void {
  if (!diagnosticsStarted) return;
  const current = healthBus.read(WS_SUBSYSTEM);
  if (!current) return;
  if (current.status === 'degraded' || current.status === 'failed') {
    publishWsHealth('recovering', 'Send succeeded — recovering');
  }
}

// Game 1195: a socket is OPEN for up to 15 s before the server's Welcome
// admits it, and every send in that window is refused. Mirror that on the bus:
// socket replaced → degraded until Welcome, Welcome → ok (via recovering when
// the bus was degraded, §7.2).
function publishSessionState(): void {
  if (!diagnosticsStarted) return;
  if (isSessionReadyFn?.()) {
    const current = healthBus.read(WS_SUBSYSTEM);
    const wasDown = current?.status === 'degraded' || current?.status === 'failed';
    publishWsHealth(wasDown ? 'recovering' : 'ok', 'Connected');
    return;
  }
  if (connectionEverSeen) publishWsHealth('degraded', 'Socket open — waiting for Welcome');
}

function bindWelcome(room: WelcomeHost | null): void {
  if ((room as object | null) === welcomeRoom) return;
  if (unsubWelcome) { try { unsubWelcome(); } catch { /* closed */ } unsubWelcome = null; }
  welcomeRoom = room;
  if (!room || typeof room.subscribeToWelcome !== 'function') return;
  try {
    unsubWelcome = toUnsub(room.subscribeToWelcome(() => publishSessionState()));
  } catch { unsubWelcome = null; }
}

/**
 * Wire the websocket subsystem into the diagnostics health bus. Idempotent.
 * Must run after initDiagnostics() so the bus exists.
 */
export function startWebsocketHealth(hasConnection: () => boolean, isSessionReady: () => boolean): void {
  if (diagnosticsStarted) return;
  diagnosticsStarted = true;
  hasConnectionFn = hasConnection;
  isSessionReadyFn = isSessionReady;

  healthBus.register(WS_SUBSYSTEM, {
    category: 'core',
    status: 'starting',
    message: 'Waiting for room connection',
  });

  if (hasConnection()) {
    connectionEverSeen = true;
    publishSessionState();
  } else {
    // polling-justified: the window-property trap in roomConnectionEvents is
    // refused on some hosts (Firefox accessor export unverified); this is the
    // room-appeared fallback and stops itself on first sight.
    connectionPollStop = visibleInterval('qpm-ws-diag-connect', () => {
      if (!hasConnectionFn?.()) return;
      connectionEverSeen = true;
      publishSessionState();
      if (connectionPollStop) {
        connectionPollStop();
        connectionPollStop = null;
      }
    }, 1500);
  }

  stopChainEvents = onRoomConnectionChange((room, reason) => {
    bindWelcome(room as WelcomeHost | null);
    if (!room) return;
    if (!connectionEverSeen) { connectionEverSeen = true; publishSessionState(); return; }
    // A new socket starts a fresh admission window; Welcome flips it back.
    if (reason === 'socket' || reason === 'room') publishSessionState();
  });

  // polling-justified: wsCounters mutate on every send; publishing per send
  // would breach the §6.4 bus budget, so a slow tick coalesces the changes.
  let lastSnapshot = serializeCounters();
  metricsTickStop = visibleInterval('qpm-ws-diag-metrics', () => {
    const snap = serializeCounters();
    if (snap === lastSnapshot) return;
    lastSnapshot = snap;
    publishWsHealth(undefined, connectionEverSeen ? 'Connected' : undefined);
  }, 60_000);
}

export function stopWebsocketHealth(): void {
  if (!diagnosticsStarted) return;
  if (connectionPollStop) {
    connectionPollStop();
    connectionPollStop = null;
  }
  if (metricsTickStop) {
    metricsTickStop();
    metricsTickStop = null;
  }
  if (stopChainEvents) {
    stopChainEvents();
    stopChainEvents = null;
  }
  bindWelcome(null);
  hasConnectionFn = null;
  isSessionReadyFn = null;
  diagnosticsStarted = false;
}
